/**
 * Scanner Context - Scan Execution
 * 
 * This file contains the scan execution logic including command building,
 * error detection, completion detection, and result parsing.
 * 
 * @module scanner-scan
 */

import type { Tab, ScannerType, ScanError } from './scanner-types';
import { validateScanTarget, isDnsFreeScanTarget } from './target-validation';
import {
  beginScanRun,
  finishScanRun,
  getScanRunOutputMarker,
  getScanRunOutputOffset,
  getScanWorkspaceGeneration,
  isLatestScanRun,
  isScanRunCurrent,
  registerScanRunCleanup,
  setScanRunOutputBoundary,
} from './scan-run-registry';
import {
  interruptTerminalCommand,
  waitForTerminalReady,
  waitForTerminalInterrupt,
  buildManagedShellCommand,
  formatShellExecutable,
  getManagedShellRuntime,
  quoteShellArgument,
} from '@/lib/terminal/command-lifecycle';
import { formatScannerOptions } from './scanner-options';

/**
 * Get the terminal session ID for a specific scanner within a tab.
 * Each scanner type (nmap/nikto/nuclei/dirbuster) gets its own independent terminal.
 */
export function getScannerTerminalId(tabId: string, scannerType: ScannerType | undefined): string {
  return `${tabId}::${scannerType || 'nmap'}`;
}

const MANAGED_EXIT_MARKER = /\x1b\]9;osecbox-command-exit;(\d+)\x07/g;

function getManagedExitCode(output: string): number | null {
  const matches = [...String(output || '').matchAll(MANAGED_EXIT_MARKER)];
  const last = matches.at(-1)?.[1];
  return last === undefined ? null : Number(last);
}

/**
 * Make the lifecycle result visible in the same durable transcript as the
 * tool output. The OSC marker is intentionally invisible in xterm, so without
 * this line a completed scan looked indistinguishable from a hung shell.
 */
async function appendScanTerminalStatus(
  terminalId: string,
  toolName: string,
  reason: 'complete' | 'stale' | 'timeout' | 'error',
  runOutput?: string,
): Promise<void> {
  try {
    const { terminalService } = await import('../terminal-service');
    const output = runOutput ?? terminalService.getOutput(terminalId);
    const exitCode = getManagedExitCode(output);
    const normalizedTool = toolName.toUpperCase();
    const status = reason === 'complete' && exitCode !== null
      ? `${normalizedTool} scan completed (exit code ${exitCode})`
      : reason === 'complete'
        ? `${normalizedTool} scan completed`
        : reason === 'stale'
          ? `${normalizedTool} scan output idle; results retained`
          : reason === 'timeout'
            ? `${normalizedTool} scan timed out; partial output retained`
            : `${normalizedTool} scan ended with an error; output retained`;

    terminalService.writeExternalOutput(
      terminalId,
      `\r\n\x1b[90m[${status}]\x1b[0m\r\n`,
      true,
    );
  } catch (error) {
    // The parser/result path must remain independent from a renderer teardown.
    console.debug('[runScan] Could not append terminal lifecycle status:', error);
  }
}

type ScannerCommandSettings = Partial<{
  nmapPath: string;
  niktoPath: string;
  nucleiPath: string;
  gobusterPath: string;
  wordlistPath: string;
}>;

async function getScannerCommandSettings(): Promise<ScannerCommandSettings> {
  if (typeof window === 'undefined' || !window.electron) return {};

  try {
    const result = await window.electron.invoke('get-settings');
    return result?.success && result.settings ? result.settings : {};
  } catch {
    // The shell still has PATH-based tool resolution when settings IPC is not
    // available (for example, during renderer-only development).
    return {};
  }
}

function isPathForRuntime(pathValue: string, runtime: 'posix' | 'powershell'): boolean {
  const normalized = pathValue.trim();
  if (!normalized) return false;

  // A saved path can come from another machine/runtime. Do not send a Linux
  // absolute path to native PowerShell or a Windows drive path into WSL.
  if (runtime === 'powershell') {
    return !/^\/(?:bin|etc|home|opt|usr|var)(?:\/|$)/i.test(normalized);
  }

  return !/^[A-Za-z]:[\\/]/.test(normalized);
}

function getConfiguredExecutable(
  configuredPath: string | undefined,
  fallback: string,
  runtime: 'posix' | 'powershell',
): string {
  const candidate = configuredPath?.trim();
  return formatShellExecutable(
    candidate && isPathForRuntime(candidate, runtime) ? candidate : fallback,
    runtime,
  );
}

function getConfiguredWordlist(
  configuredPath: string | undefined,
  runtime: 'posix' | 'powershell',
): string {
  const candidate = configuredPath?.trim();
  if (!candidate || !isPathForRuntime(candidate, runtime)) {
    // The backend resolves the real default for managed tool execution. The
    // terminal command remains usable when that setting is not hydrated yet.
    return 'common.txt';
  }
  return candidate;
}

function dnsPreflightScanner(scannerKey: string): boolean {
  return ['nmap', 'nikto', 'nuclei', 'dirbuster'].includes(scannerKey);
}

function dnsPreflightToolName(scannerKey: string): string {
  switch (scannerKey) {
    case 'nmap': return 'Nmap';
    case 'nikto': return 'Nikto';
    case 'nuclei': return 'Nuclei';
    case 'dirbuster': return 'Gobuster';
    default: return scannerKey;
  }
}

async function getDnsPreflightFailure(
  target: string,
  scannerKey: string,
): Promise<{ title: string; message: string; details: string } | null> {
  if (!dnsPreflightScanner(scannerKey) || isDnsFreeScanTarget(target)) return null;

  const diagnoseDns = window.electron?.diagnoseDns;
  if (typeof diagnoseDns !== 'function') {
    // Browser-only/dev surfaces may not have the Electron bridge. Preserve
    // their existing behavior; packaged OsecBox always exposes this method.
    return null;
  }

  try {
    const result = await diagnoseDns({ target });
    if (result.success && result.diagnostic?.ok) return null;

    const diagnostic = result.diagnostic;
    if (!diagnostic) {
      return {
        title: 'DNS Preflight Unavailable',
        message: `${dnsPreflightToolName(scannerKey)} was not started because the DNS preflight could not be completed.`,
        details: result.error || result.message || 'The Electron DNS diagnostic returned no details. Open Settings → Platform & WSL2 and run DNS preflight there.',
      };
    }

    return {
      title: 'DNS Preflight Blocked',
      message: `${dnsPreflightToolName(scannerKey)} was not started: ${diagnostic.message}`,
      details: [
        `Status: ${diagnostic.status}`,
        `Runtime: ${diagnostic.runtime}`,
        diagnostic.nameservers.length > 0 ? `Nameservers: ${diagnostic.nameservers.join(', ')}` : '',
        ...diagnostic.remediation.map(item => `- ${item}`),
      ].filter(Boolean).join('\n'),
    };
  } catch (error: any) {
    return {
      title: 'DNS Preflight Unavailable',
      message: `${dnsPreflightToolName(scannerKey)} was not started because the DNS diagnostic failed before it could classify the problem.`,
      details: error?.message || 'Open Settings → Platform & WSL2 and run DNS preflight there.',
    };
  }
}

/**
 * Create scan execution function
 */
export function createRunScan(
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  addError: (tabId: string, error: Omit<ScanError, 'id' | 'timestamp'>) => void
) {
  return async (id: string, overrideTarget?: string, _forceSystemCommand?: boolean, scannerOptions?: string[]) => {
    console.log('[runScan] ========== SCAN START ==========');
    console.log('[runScan] Tab ID:', id);
    console.log('[runScan] Override target:', overrideTarget);
    console.log('[runScan] Scanner options:', scannerOptions);
    
    // FIX: Use synchronous tab lookup via setTabs callback
    // The callback runs synchronously but assigning outside is unreliable.
    // Use a Promise to ensure we have the tab before continuing.
    const tab = await new Promise<Tab | undefined>((resolve) => {
      setTabs((prev) => {
        const found = prev.find(t => t.id === id);
        console.log('[runScan] Found tab:', found ? `${found.scannerType} - ${found.target}` : 'NOT FOUND');
        resolve(found);
        return prev;
      });
    });
    
    if (!tab) {
      console.error('[runScan] ❌ Tab not found:', id);
      return;
    }

    // VALIDATION: never start a scan without a real target. Previously an empty
    // target was silently defaulted to 127.0.0.1, so a stray "Run Scan" click would
    // scan localhost. Validate up-front and bail (surfacing an error) when invalid.
    const rawTarget = (overrideTarget ?? tab.target ?? '').trim();
    const validation = validateScanTarget(rawTarget, tab.scannerType);
    if (!validation.valid) {
      console.warn('[runScan] ❌ Invalid target, aborting scan:', validation.error);
      addError(id, {
        type: 'error',
        title: 'Cannot start scan',
        message: validation.error || 'Enter a valid target before scanning.',
        tool: tab.scannerType,
        target: rawTarget,
      });
      // Make sure we don't leave the UI stuck in a "scanning" state.
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const scanningByScanner = { ...(t.scanningByScanner || {}), [t.scannerType || 'nmap']: false };
          return { ...t, isScanning: false, scanningByScanner };
        })
      );
      try {
        (window as any).showToast?.(validation.error || 'Enter a valid target before scanning.', 'error');
      } catch {
        /* toast is best-effort */
      }
      return;
    }

    let target = rawTarget;
    
    // Strip protocol from URLs for nmap
    if (tab.scannerType === 'nmap' && (target.startsWith('http://') || target.startsWith('https://'))) {
      try {
        const url = new URL(target);
        target = url.hostname;
        console.log('[runScan] Stripped protocol from URL:', tab.target, '→', target);
      } catch (e) {
        target = target.replace(/^https?:\/\//, '').split('/')[0];
        console.log('[runScan] Stripped protocol (fallback):', tab.target, '→', target);
      }
    }
    
    console.log('[runScan] Target:', target);
    console.log('[runScan] Scanner type:', tab.scannerType);
    
    const scannerKey = tab.scannerType || 'nmap';
    const terminalId = getScannerTerminalId(id, tab.scannerType);
    // Capture the attack session at start. Completion may arrive after the
    // user loads another session; late evidence must never be attributed to it.
    const { useAttackState } = await import('../attack-state-store');
    const scanSessionId = useAttackState.getState().session?.id;
    const runId = beginScanRun(terminalId, { sessionId: scanSessionId, target });
    const runWorkspaceGeneration = getScanWorkspaceGeneration();
    const isCurrentRun = () =>
      runWorkspaceGeneration === getScanWorkspaceGeneration() && isScanRunCurrent(terminalId, runId);
    const isLatestRun = () =>
      runWorkspaceGeneration === getScanWorkspaceGeneration() && isLatestScanRun(terminalId, runId);
    const addRunError = (error: Omit<ScanError, 'id' | 'timestamp'>) => {
      if (isCurrentRun()) addError(id, error);
    };

    // Do the lookup before constructing or sending a hostname-based command.
    // This is a read-only preflight in the same runtime as the terminal tool;
    // IP/CIDR targets are classified as not requiring DNS.
    const dnsFailure = await getDnsPreflightFailure(target, scannerKey);
    if (dnsFailure) {
      if (!isCurrentRun()) {
        finishScanRun(terminalId, runId);
        return;
      }

      addRunError({
        type: 'error',
        title: dnsFailure.title,
        message: dnsFailure.message,
        details: dnsFailure.details,
        tool: dnsPreflightToolName(scannerKey),
        target,
      });
      finishScanRun(terminalId, runId);
      setTabs((prev) => prev.map((t) => {
        if (!isLatestRun() || t.id !== id) return t;
        const scanningByScanner = { ...(t.scanningByScanner || {}), [scannerKey]: false };
        return {
          ...t,
          isScanning: false,
          lastScanStatus: 'failed',
          lastScanExitCode: 1,
          scanningByScanner,
        };
      }));
      try {
        (window as any).showToast?.(dnsFailure.message, 'error');
      } catch {
        /* toast is best-effort */
      }
      return;
    }

    let command: string;
    let toolName: string;
    try {
      ({ command, toolName } = await buildScanCommand(tab, target, scannerOptions));
    } catch (error: any) {
      if (!isCurrentRun()) return;
      addRunError({
        type: 'error',
        title: 'Scan Command Build Failed',
        message: error?.message || 'Failed to build the scan command',
        details: error?.stack,
        tool: scannerKey,
        target,
      });
      finishScanRun(terminalId, runId);
      setTabs((prev) => prev.map((t) => {
        if (!isLatestRun() || t.id !== id) return t;
        const scanningByScanner = { ...(t.scanningByScanner || {}), [scannerKey]: false };
        return { ...t, isScanning: false, lastScanStatus: 'failed', lastScanExitCode: 1, scanningByScanner };
      }));
      return;
    }
    console.log('[runScan] Executing command:', command);

    if (!isCurrentRun()) {
      console.log(`[runScan] Run canceled while building command: ${terminalId}`);
      return;
    }
    
    // Mark as scanning (both top-level for current view and per-scanner)
    setTabs((prev) =>
      prev.map((t) => {
        if (!isCurrentRun() || t.id !== id) return t;
        const scanningByScanner = { ...(t.scanningByScanner || {}), [scannerKey]: true };
        return {
          ...t,
          isScanning: true,
          scanProgress: 0,
          lastScanStatus: 'running',
          lastScanExitCode: undefined,
          terminalOutput: [],
          commandsByScanner: {
            ...(t.commandsByScanner || {}),
            [scannerKey]: command,
          },
          errors: [],
          results: [],
          resultsByScanner: {
            ...(t.resultsByScanner || {}),
            [scannerKey]: [],
          },
          structuredResultsByScanner: {
            ...(t.structuredResultsByScanner || {}),
            [scannerKey]: null,
          },
          scanningByScanner,
        };
      })
    );
    
    // Execute command on terminal
    if (window.electron) {
      try {
        // FIX: Each scanner type gets its own independent terminal
        console.log(`[runScan] Executing command on terminal: ${terminalId}`);
        
        // Ensure terminal and PTY exist
        const { terminalService } = await import('../terminal-service');
        await waitForTerminalInterrupt(terminalId);
        if (!isCurrentRun()) return;
        
        // Interrupt any prior command before changing the target provenance. A
        // Stop -> Start transition must not make late output from the prior run
        // look as if it belonged to this target.
        if (terminalService.hasPTY(terminalId)) {
          try {
            await interruptTerminalCommand(terminalId);
          } catch (interruptError) {
            console.debug('[runScan] Previous command was already stopped:', interruptError);
          }
        }
        if (!isCurrentRun()) return;
        terminalService.setTerminalProvenance(terminalId, {
          sessionId: scanSessionId,
          runId,
          target,
        });

        terminalService.cancelPendingWrites(terminalId);

        // Start the backend shell and xterm module load together. The PTY can
        // produce the first prompt while the renderer is being attached; its
        // output is buffered and replayed instead of delaying the scan.
        terminalService.preloadTerminalRenderer();
        terminalService.getOrCreatePTY(terminalId, 'scan');

        if (!terminalService.hasTerminal(terminalId)) {
          console.log(`[runScan] Creating terminal: ${terminalId}`);
          await terminalService.getOrCreateTerminal(terminalId, 'scan');
        }
        // A shell may have died while the terminal component remained
        // mounted. Reattach the replacement PTY before its output starts so
        // the retained transcript and live stream share one destination.
        terminalService.attachPTY(terminalId, terminalId);

        if (!isCurrentRun()) return;
        
        // Wait for the shell prompt instead of guessing a fixed startup delay.
        const terminalReady = await waitForTerminalReady(terminalId, 5000);
        if (!terminalReady) {
          throw new Error('Scan terminal did not become ready');
        }
        if (!isCurrentRun()) return;
        
        // The PTY backend already injects the correct clean PATH for WSL and
        // preserves the native Windows PATH for PowerShell. Do not prepend a
        // POSIX-only `export` here: it breaks native fallback execution and
        // also prevents the shared completion marker from being observed.
        const fullCommand = await buildManagedShellCommand(command);

        // Mark the exact beginning of this run in the retained transcript. The
        // offset is fast for normal output; the invisible marker is a fallback
        // if the bounded buffer rotates while a very noisy tool is running.
        const outputMarker = `\x1b]9;osecbox-scan-start;${runId}\x07`;
        terminalService.writeExternalOutput(terminalId, outputMarker, true);
        const outputOffset = terminalService.getOutput(terminalId).length;
        terminalService.markTerminalEvidenceStart(terminalId);
        if (!setScanRunOutputBoundary(terminalId, runId, outputOffset, outputMarker)) {
          return;
        }
        if (!isCurrentRun()) return;
        
        // PERFORMANCE: Fire-and-forget for instant command execution
        window.electron.writeToListener({
          listenerId: terminalId,
          data: fullCommand
        }).catch(error => {
          console.error('[runScan] Failed to send command:', error);
        });
        
        console.log(`[runScan] ✅ Command sent successfully: ${fullCommand}`);
        
        // Monitor for completion (uses terminal-specific ID for output buffer)
        await monitorScanCompletion(
          id,
          terminalId,
          runId,
          tab,
          target,
          command,
          toolName,
          setTabs,
          addError,
          isCurrentRun,
          scanSessionId,
        );
        
      } catch (error: any) {
        // Cancellation/replacement is a normal lifecycle transition, not a
        // scan error. Do not let a stale setup report after Stop or a restart.
        if (!isCurrentRun()) return;
        finishScanRun(terminalId, runId);
        console.error('[runScan] ❌ Execution failed:', error);
        
        addRunError({
          type: 'error',
          title: 'Scan Execution Failed',
          message: error.message || 'Failed to execute scan',
          details: error.stack,
          tool: toolName,
          target: target,
          command: command,
        });
        
        setTabs((prev) =>
          prev.map((t) => {
            if (!isLatestRun() || t.id !== id) return t;
            const scanningByScanner = { ...(t.scanningByScanner || {}), [tab.scannerType || 'nmap']: false };
            return {
              ...t,
              isScanning: false,
              lastScanStatus: 'failed',
              lastScanExitCode: 1,
              scanningByScanner,
            };
          })
        );
      }
    } else {
      if (!isCurrentRun()) return;
      finishScanRun(terminalId, runId);
      setTabs((prev) => prev.map((t) => {
        if (!isLatestRun() || t.id !== id) return t;
        const scanningByScanner = { ...(t.scanningByScanner || {}), [scannerKey]: false };
        return {
          ...t,
          isScanning: false,
          lastScanStatus: 'failed',
          lastScanExitCode: 1,
          scanningByScanner,
        };
      }));
    }
  };
}

/**
 * Build scan command based on scanner type
 */
async function buildScanCommand(
  tab: Tab,
  target: string,
  scannerOptions?: string[]
): Promise<{ command: string; toolName: string }> {
  let command = '';
  let toolName = '';
  const [settings, runtime] = await Promise.all([
    getScannerCommandSettings(),
    getManagedShellRuntime(),
  ]);
  const formattedScannerOptions = formatScannerOptions(scannerOptions, runtime);
  const appendOptions = (baseCommand: string) => formattedScannerOptions
    ? `${baseCommand} ${formattedScannerOptions}`
    : baseCommand;
  
  switch (tab.scannerType) {
    case 'nikto':
      toolName = 'nikto';
      command = appendOptions(`${getConfiguredExecutable(settings.niktoPath, 'nikto', runtime)} -h ${quoteShellArgument(target, runtime)}`);
      break;
      
    case 'nuclei':
      toolName = 'nuclei';
      command = appendOptions(`${getConfiguredExecutable(settings.nucleiPath, 'nuclei', runtime)} -u ${quoteShellArgument(target, runtime)}`);
      break;
      
    case 'dirbuster':
      toolName = 'gobuster';
      const wordlist = getConfiguredWordlist(settings.wordlistPath, runtime);
      command = appendOptions(
        `${getConfiguredExecutable(settings.gobusterPath, 'gobuster', runtime)} dir -u ${quoteShellArgument(target, runtime)} -w ${quoteShellArgument(wordlist, runtime)}`,
      );
      break;
      
    case 'universal':
      command = target;
      const firstWord = target.trim().split(/\s+/)[0];
      if (firstWord && !firstWord.startsWith('/') && !firstWord.startsWith('.')) {
        toolName = firstWord;
      }
      break;
      
    case 'nmap':
    default:
      toolName = 'nmap';
      const executable = getConfiguredExecutable(settings.nmapPath, 'nmap', runtime);
      if (/^nmap(?=\s|$)/i.test(target)) {
        // Accept the documented full-command input case-insensitively while
        // still honoring a configured executable path.
        command = target.replace(/^nmap(?=\s|$)/i, executable);
      } else if (formattedScannerOptions) {
        // Automation and the scanner carousel can provide flags that are not
        // represented by the visual option catalogue (for example
        // `--script vuln` or a user supplied port range). Preserve those
        // flags instead of silently dropping them, while quoting every token
        // for the managed shell.
        command = `${executable} ${quoteShellArgument(target, runtime)} ${formattedScannerOptions}`;
      } else if (tab.selectedOptions.length > 0) {
        const { NmapCommandBuilder } = await import('../nmap-command-builder');
        const builder = new NmapCommandBuilder(target);
        tab.selectedOptions.forEach(option => {
          builder.addOption(option);
        });
        const generatedCommand = builder.buildCommand();
        command = generatedCommand.replace(/^nmap(?=\s|$)/, executable);
      } else {
        command = `${executable} ${quoteShellArgument(target, runtime)}`;
      }
      break;
  }
  
  return { command, toolName };
}

/**
 * Monitor scan for completion and errors
 */
async function monitorScanCompletion(
  id: string,
  terminalId: string,
  runId: string,
  tab: Tab,
  target: string,
  command: string,
  toolName: string,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  addError: (tabId: string, error: Omit<ScanError, 'id' | 'timestamp'>) => void,
  isRunCurrent: () => boolean = () => isScanRunCurrent(terminalId, runId),
  sessionId?: string,
) {
  let checkInterval: NodeJS.Timeout | null = null;
  let timeout: NodeJS.Timeout | null = null;
  let pollInFlight = false;
  let finished = false;
  let lastOutputLength = 0;
  let noChangeCount = 0;
  let failureReported = false;
  let terminalStatusWritten = false;
  const reportError = (error: Omit<ScanError, 'id' | 'timestamp'>) => {
    if (isRunCurrent()) addError(id, error);
  };

  const cleanup = () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  if (!registerScanRunCleanup(terminalId, runId, cleanup)) {
    cleanup();
    return;
  }

  const getRunOutput = (terminalService: { getOutput: (id: string) => string }): string => {
    const output = terminalService.getOutput(terminalId);
    const outputOffset = getScanRunOutputOffset(terminalId);
    if (outputOffset !== undefined && output.length >= outputOffset) {
      return output.slice(outputOffset);
    }

    // If the bounded recovery buffer rotated, the absolute offset is no longer
    // valid. Find the invisible run boundary when it survived the rotation;
    // otherwise the remaining tail is the safest available evidence.
    const outputMarker = getScanRunOutputMarker(terminalId);
    if (outputMarker) {
      const markerIndex = output.lastIndexOf(outputMarker);
      if (markerIndex >= 0) return output.slice(markerIndex + outputMarker.length);
    }
    return output;
  };

  const finish = async (reason: 'complete' | 'error' | 'stale' | 'timeout') => {
    if (finished || !isScanRunCurrent(terminalId, runId)) return;
    finished = true;
    cleanup();

    if (reason === 'timeout') {
      reportError({
        type: 'error',
        title: `${toolName} monitor timed out`,
        message: 'The scan did not finish within five minutes. The process was stopped so a new scan can start cleanly.',
        tool: toolName,
        target,
        command,
      });
      let timeoutEvidenceFound = false;
      try {
        await interruptTerminalCommand(terminalId);
      } catch {
        // The shell may already have exited; cleanup below is still valid.
      }

      // A timeout is also a partial-result outcome. Preserve the same parser
      // and AI/loot evidence path used by normal completion before releasing
      // the run registry, otherwise a five-minute scan can disappear after
      // producing useful ports, credentials, or vulnerability lines.
      try {
        const { terminalService } = await import('../terminal-service');
        const retainedOutput = getRunOutput(terminalService);
        if (retainedOutput.trim()) {
          timeoutEvidenceFound = true;
          await handleScanCompletion(
            id,
            tab,
            retainedOutput,
            target,
            command,
            terminalId,
            toolName,
            setTabs,
            isRunCurrent,
            'timeout',
            getManagedExitCode(retainedOutput) ?? undefined,
            sessionId,
            runId,
          );
        }
      } catch (parseError) {
        console.warn('[runScan] Failed to parse timed-out scan output:', parseError);
      }

      // If the timed-out terminal had no retained transcript, there is no
      // evidence commit to publish first; still finalize the UI lifecycle.
      if (!timeoutEvidenceFound) {
        setTabs((prev) => prev.map((t) => {
          if (!isRunCurrent() || t.id !== id) return t;
          const scanningByScanner = { ...(t.scanningByScanner || {}), [tab.scannerType || 'nmap']: false };
          return {
            ...t,
            isScanning: (t.scannerType || 'nmap') === (tab.scannerType || 'nmap') ? false : t.isScanning,
            lastScanStatus: 'timeout',
            lastScanExitCode: undefined,
            scanningByScanner,
          };
        }));
      }
    }

    if (!terminalStatusWritten) {
      terminalStatusWritten = true;
      const { terminalService } = await import('../terminal-service');
      await appendScanTerminalStatus(terminalId, toolName, reason, getRunOutput(terminalService));
    }

    finishScanRun(terminalId, runId);
  };
  
  const poll = async () => {
    if (pollInFlight || finished || !isScanRunCurrent(terminalId, runId)) return;
    pollInFlight = true;
    try {
      // Per-scanner terminals run independently. The run registry is the
      // source of truth, so switching scanner tabs does not kill a background
      // run and a replaced run cannot mutate the new run's state.
      // Read the provider's published snapshot instead of scheduling a React
      // state updater every second for every running scan.
      let currentTabState = (window as any).__nmapContextState?.tabs?.find(
        (candidate: Tab) => candidate.id === id
      ) as Tab | undefined;
      if (!currentTabState) {
        // Fallback for scheduler/tests that do not mount ScannerProvider.
        setTabs((prev) => {
          currentTabState = prev.find(t => t.id === id);
          return prev;
        });
      }
      
      if (!currentTabState) {
        console.log(`[runScan] Tab gone, stopping monitor: ${terminalId}`);
        cleanup();
        finishScanRun(terminalId, runId);
        return;
      }

      if (!isScanRunCurrent(terminalId, runId)) {
        cleanup();
        return;
      }
      
      const { terminalService } = await import('../terminal-service');
      const output = getRunOutput(terminalService);
      
      if (!output || output.length === 0) {
        return; // No output yet
      }
      
      // FIX: Detect if output has stopped growing (scan might be complete)
      if (output.length === lastOutputLength) {
        noChangeCount++;
      } else {
        noChangeCount = 0;
        lastOutputLength = output.length;
      }
      
      // Get completion and error patterns
      const { completionPatterns, errorPatterns } = getScanPatterns(tab.scannerType);
      
      // Completion markers are emitted at the end of tool output; checking a
      // bounded head/tail window avoids repeatedly scanning multi-megabyte
      // terminal buffers while a scan is running.
      const patternInput = output.length > 96 * 1024
        ? `${output.slice(0, 8 * 1024)}\n${output.slice(-88 * 1024)}`
        : output;
      const isComplete = completionPatterns.some(pattern => pattern.test(patternInput));
      const hasError = errorPatterns.some(pattern => pattern.test(patternInput));
      
      // FIX: Stale-complete should NEVER trigger for nmap during port scanning.
      // Nmap is silent for many seconds during port scanning, then prints results.
      // Only trigger stale-complete after a long timeout AND require minimum output.
      // For real completion, we MUST see an explicit completion pattern in output.
      const STALE_TIMEOUT_SECS = 30; // 30 seconds of no change
      // Nmap can be silent for a long time while it waits on ports. It must
      // have its explicit end marker; otherwise a slow scan is misclassified
      // as complete and the next run inherits a half-finished process.
      const staleComplete = tab.scannerType !== 'nmap'
        && noChangeCount >= STALE_TIMEOUT_SECS
        && output.length > 500;
      
      // Tool output can contain recoverable warnings, `[ERR]` lines, or a
      // failed sub-request before the shell emits its authoritative exit
      // marker. Do not stop the monitor here: doing so discarded partial
      // findings and left the reusable shell in a misleading state.
      if (hasError && !isComplete) {
        console.debug('[runScan] Diagnostic error text observed; waiting for process completion:', toolName);
      }
      
      if (isComplete) {
        // FIX: Wait for output to settle - at least 1 poll with no new data
        // This ensures trailing output (port table after "Nmap done:") is captured
        if (noChangeCount < 1) {
          return; // Wait one more cycle for trailing data
        }

        if (!isScanRunCurrent(terminalId, runId)) return;

        const managedFailure = patternInput.match(/\x1b\]9;osecbox-command-exit;([1-9][0-9]*)\x07/);
        const managedExitCode = getManagedExitCode(output);
        if (managedFailure && !failureReported) {
          failureReported = true;
          reportError({
            type: 'error',
            title: `${toolName} exited with code ${managedFailure[1]}`,
            message: 'The command exited with an error. Partial output and parsed findings were retained.',
            details: `Exit code: ${managedFailure[1]}\nReview the terminal output for the tool-specific cause.`,
            tool: toolName,
            target,
            command,
          });
        }

        // Some tools (notably Nmap) can print a fatal diagnostic and still
        // exit zero. Surface the tool error instead of presenting that run as
        // an unexplained empty result panel.
        if (hasError && !failureReported) {
          await handleScanError(
            id,
            output,
            errorPatterns,
            toolName,
            target,
            command,
            tab.scannerType,
            addError,
            setTabs,
            isRunCurrent,
          );
          failureReported = true;
        }
        
        console.log(`[runScan] Scan complete (pattern match) - parsing ${output.length} chars`);
        
        await handleScanCompletion(
          id,
          tab,
          output,
          target,
          command,
          terminalId,
          toolName,
          setTabs,
          isRunCurrent,
          managedExitCode === null ? 'completed' : managedExitCode === 0 ? 'completed' : 'failed',
          managedExitCode ?? undefined,
          sessionId,
          runId,
        );
        await finish(managedExitCode !== null && managedExitCode !== 0 ? 'error' : 'complete');
        return;
      }
      
      if (staleComplete) {
        if (!isScanRunCurrent(terminalId, runId)) return;
        console.log(`[runScan] Scan stale-complete (${STALE_TIMEOUT_SECS}s no change) - parsing ${output.length} chars`);
        
        await handleScanCompletion(
          id,
          tab,
          output,
          target,
          command,
          terminalId,
          toolName,
          setTabs,
          isRunCurrent,
          'stale',
          getManagedExitCode(output) ?? undefined,
          sessionId,
          runId,
        );
        await finish('stale');
        return;
      }
    } catch (err) {
      console.error('[runScan] Monitor error:', err);
    } finally {
      pollInFlight = false;
    }
  };

  checkInterval = setInterval(() => { void poll(); }, 1000);
  void poll();
  
  // Timeout after 5 minutes
  timeout = setTimeout(() => {
    console.warn('[runScan] Scan monitoring timeout');
    void finish('timeout');
  }, 300000);
  
  // Hold the run open until completion, cancellation, or timeout. This lets
  // createRunScan cleanly await the monitor without leaking timer handles.
  await new Promise<void>((resolve) => {
    const wait = setInterval(() => {
      if (finished || !isScanRunCurrent(terminalId, runId)) {
        clearInterval(wait);
        resolve();
      }
    }, 100);
  });
}

/**
 * Get completion and error patterns for scanner type
 */
function getScanPatterns(scannerType: ScannerType | undefined): {
  completionPatterns: RegExp[];
  errorPatterns: RegExp[];
} {
  // The reusable shell emits this OSC marker after every managed command.
  // Tool-specific banners remain useful for human-readable output, but this
  // marker is the authoritative completion signal when a tool changes its
  // wording or produces no findings.
  const managedSuccess = /\x1b\]9;osecbox-command-exit;0\x07/;
  const managedFailure = /\x1b\]9;osecbox-command-exit;[1-9][0-9]*\x07/;

  // Universal error patterns
  const universalErrorPatterns = [
    managedFailure,
    /command not found/i,
    /not found, but can be installed/i,
    /No such file or directory/i,
    /not recognized as an internal or external command/i,
    /is not recognized/i,
    /connection refused/i,
    /connection timed out/i,
    /connection timeout/i,
    /failed to connect/i,
    /could not connect/i,
    /unable to connect/i,
    /no route to host/i,
    /network is unreachable/i,
    /host is down/i,
    /permission denied/i,
    /access denied/i,
    /operation not permitted/i,
    /requires root privileges/i,
    /you don't have permission/i,
    /must be run as root/i,
    /sudo required/i,
    /failed to resolve/i,
    /could not resolve/i,
    /name or service not known/i,
    /hostname not found/i,
    /invalid target/i,
    /invalid hostname/i,
    /no such host/i,
    /file not found/i,
    /cannot access/i,
    /does not exist/i,
    /no such file/i,
    /killed/i,
    /terminated/i,
    /interrupted/i,
    /aborted/i,
    /SIGTERM/i,
    /SIGKILL/i,
  ];
  
  let completionPatterns: RegExp[] = [];
  let errorPatterns: RegExp[] = [];
  
  switch (scannerType) {
    case 'nmap':
      completionPatterns = [
        managedSuccess,
        /Nmap done:/i,
        /# Nmap.*done at/i,
        /<\/nmaprun>/i,
        /\d+ IP address.*scanned in/i,
      ];
      errorPatterns = [
        ...universalErrorPatterns,
        /Unable to split netmask/i,
        /Failed to resolve/i,
        /Invalid target/i,
        /QUITTING!/i,
        /nexthost: failed to determine route/i,
        /cannot resolve/i,
        /mass_dns: warning/i,
        /giving up on port/i,
      ];
      break;
      
    case 'nikto':
      completionPatterns = [
        managedSuccess,
        /\+ End Time:/i,
        /\d+ host\(s\) tested/i,
        /\d+ item\(s\) reported/i,
        /Scan completed in \d+ seconds/i,
        /<\/niktoscan>/i,
        // FIX: Add more reliable completion patterns
        /\+ \d+ requests:/i,  // Nikto always shows request count at end
        /\+ \d+ error\(s\)/i,  // Error count line at end
      ];
      errorPatterns = [
        ...universalErrorPatterns,
        /ERROR:/i,
        /Cannot connect/i,
        /No web server found/i,
        /Target.*appears to be down/i,
        /SSL negotiation failed/i,
        /Invalid SSL/i,
        /No response from host/i,
      ];
      break;
      
    case 'nuclei':
      completionPatterns = [
        managedSuccess,
        /\[INF\].*Requests \[total:/i,
        /Scan completed in [\d.]+ seconds/i,
        /\[INF\] Scan completed/i,
        // FIX: Add more reliable completion patterns
        /\[INF\].*Templates executed:/i,  // Nuclei shows this at end
        /\[INF\].*Requests \[/i,  // Request summary line
      ];
      errorPatterns = [
        ...universalErrorPatterns,
        /\[ERR\]/i,
        /\[FTL\]/i,
        /\[WRN\].*could not/i,
        /template.*not found/i,
        /no templates found/i,
        /failed to load templates/i,
        /could not resolve/i,
        /no target provided/i,
      ];
      break;
      
    case 'dirbuster':
      completionPatterns = [
        managedSuccess,
        /Finished/i,
        /Progress:.*100%/i,
        /\[!\] Finished/i,
      ];
      errorPatterns = [
        ...universalErrorPatterns,
        /Error:/i,
        /Failed to connect/i,
        /wordlist.*not found/i,
        /unable to connect/i,
        /error on running gobuster/i,
        /invalid url/i,
      ];
      break;
      
    default:
      completionPatterns = [
        managedSuccess,
        /\w+@\w+.*[#$]\s*$/m,
        /\$\s*$/m,
        /#\s*$/m,
      ];
      errorPatterns = universalErrorPatterns;
  }
  
  return { completionPatterns, errorPatterns };
}

/**
 * Handle scan error
 */
async function handleScanError(
  id: string,
  output: string,
  errorPatterns: RegExp[],
  toolName: string,
  target: string,
  command: string,
  scannerType: ScannerType | undefined,
  addError: (tabId: string, error: Omit<ScanError, 'id' | 'timestamp'>) => void,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  isRunCurrent: () => boolean = () => true,
) {
  if (!isRunCurrent()) return;
  const lines = output.split('\n');
  const errorLine = lines.find(line => 
    errorPatterns.some(pattern => pattern.test(line))
  );
  
  // Classify error and provide actionable message
  const { errorTitle, errorMessage, errorDetails } = classifyError(errorLine || '', toolName, target, command);
  
  addError(id, {
    type: 'error',
    title: errorTitle,
    message: errorMessage,
    details: errorDetails,
    tool: toolName,
    target: target,
    command: command,
  });
  
  setTabs((prev) =>
    prev.map((t) => {
      if (!isRunCurrent() || t.id !== id) return t;
      const scannerKey = scannerType || 'nmap';
      const scanningByScanner = { ...(t.scanningByScanner || {}), [scannerKey]: false };
      return {
        ...t,
        isScanning: (t.scannerType || 'nmap') === scannerKey ? false : t.isScanning,
        lastScanStatus: 'failed',
        lastScanExitCode: 1,
        scanningByScanner,
      };
    })
  );
}

/**
 * Classify error and provide actionable message
 */
function classifyError(
  errorLine: string,
  toolName: string,
  target: string,
  command: string
): { errorTitle: string; errorMessage: string; errorDetails: string } {
  let errorTitle = `${toolName.charAt(0).toUpperCase() + toolName.slice(1)} Error`;
  let errorMessage = errorLine || 'Scan encountered an error';
  let errorDetails = '';
  
  const lowerError = errorLine.toLowerCase();
  
  // Tool not installed
  if (lowerError.includes('command not found') || 
      lowerError.includes('not found, but can be installed') ||
      lowerError.includes('not recognized')) {
    errorTitle = `${toolName} Not Installed`;
    errorMessage = `${toolName} is not installed on your system`;
    errorDetails = `Install ${toolName} using your package manager:\n` +
                  `• Debian/Ubuntu: sudo apt install ${toolName}\n` +
                  `• Kali Linux: sudo apt install ${toolName}\n` +
                  `• macOS: brew install ${toolName}`;
  }
  // Connection errors
  else if (lowerError.includes('connection refused') ||
           lowerError.includes('failed to connect') ||
           lowerError.includes('could not connect')) {
    errorTitle = 'Connection Refused';
    errorMessage = `Cannot connect to ${target}`;
    errorDetails = 'The target host refused the connection. Possible causes:\n' +
                  '• Target is down or unreachable\n' +
                  '• Firewall blocking the connection\n' +
                  '• Service not running on target port\n' +
                  '• Wrong target address or port';
  }
  // Connection timeout
  else if (lowerError.includes('timeout') ||
           lowerError.includes('timed out')) {
    errorTitle = 'Connection Timeout';
    errorMessage = `Connection to ${target} timed out`;
    errorDetails = 'The target did not respond in time. Possible causes:\n' +
                  '• Target is down or slow to respond\n' +
                  '• Network congestion or packet loss\n' +
                  '• Firewall dropping packets\n' +
                  '• Try increasing timeout with tool-specific flags';
  }
  // Permission errors
  else if (lowerError.includes('permission denied') ||
           lowerError.includes('requires root') ||
           lowerError.includes('must be run as root')) {
    errorTitle = 'Permission Denied';
    errorMessage = `${toolName} requires elevated privileges`;
    errorDetails = 'This scan requires root/administrator privileges:\n' +
                  `• Linux/macOS: Run with sudo (sudo ${command})\n` +
                  '• Windows: Run terminal as Administrator\n' +
                  '• Some scan types (SYN scan, OS detection) require root';
  }
  // Hostname resolution errors
  else if (lowerError.includes('failed to resolve') ||
           lowerError.includes('could not resolve') ||
           lowerError.includes('name or service not known')) {
    errorTitle = 'Hostname Resolution Failed';
    errorMessage = `The tool could not resolve hostname: ${target}`;
    errorDetails = 'Run Settings → Platform & WSL2 → DNS preflight in the same runtime. Interpret the result as follows:\n' +
                  '• If example.com also fails: repair the WSL/Linux resolver or restore the network/VPN.\n' +
                  '• If example.com works but this target fails: check the target record, spelling, or required private/split-DNS VPN.\n' +
                  '• If the preflight passes but the tool still fails: DNS changed during the run or the command used a different runtime; inspect the terminal command/runtime before retrying.';
  }
  // File/resource not found
  else if (lowerError.includes('file not found') ||
           lowerError.includes('does not exist') ||
           lowerError.includes('no such file') ||
           lowerError.includes('wordlist') && lowerError.includes('not found')) {
    errorTitle = 'File Not Found';
    errorMessage = 'Required file or wordlist not found';
    errorDetails = 'A required file is missing:\n' +
                  '• Check file path is correct\n' +
                  '• Install required wordlists (e.g., seclists)\n' +
                  '• Verify file permissions';
  }
  // Template not found (nuclei)
  else if (lowerError.includes('template') && lowerError.includes('not found')) {
    errorTitle = 'Templates Not Found';
    errorMessage = 'Nuclei templates not found';
    errorDetails = 'Nuclei templates are missing:\n' +
                  '• Run: nuclei -update-templates\n' +
                  '• Or install: sudo apt install nuclei-templates';
  }
  // Process killed/interrupted
  else if (lowerError.includes('killed') ||
           lowerError.includes('terminated') ||
           lowerError.includes('interrupted')) {
    errorTitle = 'Scan Interrupted';
    errorMessage = 'Scan was stopped or killed';
    errorDetails = 'The scan was interrupted before completion:\n' +
                  '• User manually stopped the scan\n' +
                  '• System killed the process (out of memory?)\n' +
                  '• Network connection lost\n' +
                  '• Partial results may be available';
  }
  // Invalid target
  else if (lowerError.includes('invalid target') ||
           lowerError.includes('invalid hostname')) {
    errorTitle = 'Invalid Target';
    errorMessage = `Invalid target specification: ${target}`;
    errorDetails = 'The target format is invalid:\n' +
                  '• Use IP address (e.g., 192.168.1.1)\n' +
                  '• Use hostname (e.g., example.com)\n' +
                  '• Use CIDR notation (e.g., 192.168.1.0/24)\n' +
                  '• Check for typos in target';
  }
  
  return { errorTitle, errorMessage, errorDetails };
}

async function handleScanCompletion(
  id: string,
  tab: Tab,
  output: string,
  target: string,
  command: string,
  terminalId: string,
  toolName: string,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  isRunCurrent: () => boolean = () => true,
  status: 'completed' | 'failed' | 'stale' | 'timeout' = 'completed',
  exitCode?: number,
  sessionId?: string,
  runId?: string,
): Promise<boolean> {
  console.log(`[runScan] ========== SCAN COMPLETION ==========`);
  console.log(`[runScan] Tab ID: ${id}`);
  console.log(`[runScan] Scanner type: ${tab.scannerType}`);
  console.log(`[runScan] Output length: ${output.length} chars`);
  
  // Parse results based on scanner type
  let parsedResults: any[] = [];
  let structuredResult: unknown = null;
  
  try {
    switch (tab.scannerType) {
      case 'nmap':
        const { parseNmapOutput } = await import('../nmap-parser');
        parsedResults = parseNmapOutput(output);
        structuredResult = parsedResults;
        console.log(`[runScan] ✅ Parsed ${parsedResults.length} nmap hosts`);
        break;
        
      case 'nikto':
        const { parseNiktoOutput } = await import('../parsers/nikto-parser');
        const niktoResult = parseNiktoOutput(output);
        structuredResult = niktoResult;
        parsedResults = niktoResult.findings as any[];
        console.log(`[runScan] ✅ Parsed ${parsedResults.length} nikto findings`);
        console.log(`[runScan] Nikto result:`, {
          target: niktoResult.target,
          server: niktoResult.server,
          findingsCount: niktoResult.findings.length,
          summary: niktoResult.summary
        });
        break;
        
      case 'nuclei':
        const { parseNucleiOutput } = await import('../parsers/nuclei-parser');
        const nucleiResult = parseNucleiOutput(output);
        structuredResult = nucleiResult;
        parsedResults = nucleiResult.findings as any[];
        break;
        
      case 'dirbuster':
        const { parseDirBusterOutput } = await import('../dirbuster-parser');
        const dirResult = parseDirBusterOutput(output);
        structuredResult = dirResult;
        parsedResults = dirResult.findings as any[];
        break;

      case 'universal':
      default: {
        // Universal/custom runs must still enter the same structured evidence
        // path as the dedicated scanners. The terminal keeps the complete raw
        // transcript; this bounded parser supplies UI/AI findings.
        const { parseUniversalOutput } = await import('../universal-parser');
        const universalResult = parseUniversalOutput(command, output);
        structuredResult = universalResult;
        parsedResults = universalResult.findings as any[];
        console.log(`[runScan] ✅ Parsed ${parsedResults.length} universal findings (${universalResult.tool})`);
        break;
      }
    }
  } catch (parseError) {
    console.error('[runScan] ❌ Parse error:', parseError);
  }

  if (!isRunCurrent()) {
    console.debug(`[runScan] Ignoring stale parsed results for ${terminalId}`);
    return false;
  }
  
  const scannerKey = tab.scannerType || 'nmap';
  const hasEvidence = Boolean(target && (parsedResults.length > 0 || output.trim().length > 0));
  let evidenceCommitted = true;

  // Commit AI evidence before publishing scan completion to the UI. This makes
  // a request that starts immediately after completion observe the scan rather
  // than racing the asynchronous attack-state projection.
  if (hasEvidence) {
    if (!isRunCurrent()) return false;
    try {
      const { useAttackState } = await import('../attack-state-store');
      const currentState = useAttackState.getState();
      if (!sessionId) {
        console.warn('[runScan] Scan started before an attack session existed; retaining UI results without attributing evidence');
      } else if (currentState.session?.id !== sessionId) {
        console.warn('[runScan] Refusing to publish scan results after the attack session changed');
        evidenceCommitted = false;
      } else {
        const committed = await currentState.processScannerResults(target, {
          scannerType: tab.scannerType,
          results: parsedResults,
          command,
          // AttackStateManager performs the bounded persistence projection after
          // loot extraction. Passing the retained transcript here lets a middle
          // section containing a credential/port/CVE be detected before storage
          // compresses the record.
          output,
          timestamp: Date.now(),
          target,
          tabId: id,
          terminalId,
          sessionId,
          tool: toolName,
          runId,
        });
        evidenceCommitted = committed !== false
          && useAttackState.getState().session?.id === sessionId;
        if (evidenceCommitted) {
          console.log(`[runScan] ✅ Results sent to attack state`);
        }
      }
    } catch (attackStateError) {
      evidenceCommitted = false;
      console.error('[runScan] ❌ Failed to update attack state:', attackStateError);
    }
  }

  if (!evidenceCommitted) {
    // Do not present an unindexed run as a successful completion. Preserve the
    // parsed UI results as a visible failure state so the user can retry while
    // keeping the evidence barrier honest for the next AI request.
    if (isRunCurrent()) {
      setTabs((prev) => prev.map((t) => {
        if (!isRunCurrent() || t.id !== id) return t;
        const resultsByScanner = { ...(t.resultsByScanner || {}), [scannerKey]: parsedResults };
        const structuredResultsByScanner = {
          ...(t.structuredResultsByScanner || {}),
          [scannerKey]: structuredResult,
        };
        const scanningByScanner = { ...(t.scanningByScanner || {}), [scannerKey]: false };
        const isViewingThisScanner = (t.scannerType || 'nmap') === scannerKey;
        return {
          ...t,
          ...(isViewingThisScanner ? {
            isScanning: false,
            results: parsedResults,
            lastScanStatus: 'failed' as const,
            lastScanExitCode: 1,
          } : {}),
          resultsByScanner,
          structuredResultsByScanner,
          scanningByScanner,
        };
      }));
    }
    return false;
  }

  if (!isRunCurrent()) return false;

  console.log(`[runScan] Updating tab with ${parsedResults.length} results`);

  // Update tab with results - store per-scanner so each scanner keeps its own results
  setTabs((prev) =>
    prev.map((t) => {
      if (!isRunCurrent() || t.id !== id) return t;
      
      const resultsByScanner = { ...(t.resultsByScanner || {}), [scannerKey]: parsedResults };
      const structuredResultsByScanner = {
        ...(t.structuredResultsByScanner || {}),
        [scannerKey]: structuredResult,
      };
      const scanningByScanner = { ...(t.scanningByScanner || {}), [scannerKey]: false };
      
      // If user is currently viewing this scanner, also update top-level results/isScanning
      const isViewingThisScanner = (t.scannerType || 'nmap') === scannerKey;
      
      return {
        ...t,
        ...(isViewingThisScanner ? {
          isScanning: false,
          results: parsedResults,
          lastScanStatus: status,
          lastScanExitCode: exitCode,
        } : {}),
        resultsByScanner,
        structuredResultsByScanner,
        scanningByScanner,
      };
    })
  );
  
  console.log(`[runScan] ✅ Tab updated successfully (scanner: ${scannerKey})`);
  console.log(`[runScan] ========== COMPLETION DONE ==========`);
  return true;
}
