/**
 * Scanner Context - Event Handlers
 * 
 * This file contains all event handlers for scan output, completion, and parsing.
 * Handlers are lazy-loaded to avoid blocking startup.
 * 
 * @module scanner-handlers
 */

import type { Tab, ScannerType, ScanCompleteData, ScanOutputData } from './scanner-types';
import {
  cancelScanRun,
  getScanRunId,
  getScanRunSessionId,
  getScanRunTarget,
  getScanRunOutputMarker,
  getScanRunOutputOffset,
} from './scan-run-registry';
import { getLatestScanTranscript } from './scan-transcript';

function extractScanTabId(scanId: string): string | null {
  if (typeof scanId !== 'string' || !scanId.startsWith('scan-')) return null;

  const body = scanId.slice('scan-'.length);
  const lastDash = body.lastIndexOf('-');
  const suffix = lastDash >= 0 ? body.slice(lastDash + 1) : '';

  // Tab ids contain dashes themselves. Only strip the generated timestamp (or
  // the synthetic closed marker); taking the first dash used to route every
  // `scan-tab-...` event to a non-existent terminal named just `tab`.
  if (lastDash > 0 && (/^\d+$/.test(suffix) || suffix === 'closed')) {
    return body.slice(0, lastDash);
  }

  return body || null;
}

const SCANNER_TYPES: ScannerType[] = ['nmap', 'nikto', 'nuclei', 'dirbuster', 'universal'];

/**
 * Scanner PTYs are deliberately reusable. Slice a retained transcript to the
 * run that owned the close event before handing it to a parser; otherwise a
 * crash after a replacement run can make old findings look like new ones.
 */
function getCurrentRunOutput(
  output: string,
  terminalId: string,
  outputOffset = getScanRunOutputOffset(terminalId),
  outputMarker = getScanRunOutputMarker(terminalId),
): string {
  if (!output) return '';

  if (outputOffset !== undefined && output.length >= outputOffset) {
    return output.slice(outputOffset);
  }

  if (outputMarker) {
    const markerIndex = output.lastIndexOf(outputMarker);
    if (markerIndex >= 0) {
      return output.slice(markerIndex + outputMarker.length);
    }
  }

  // Backward-compatible fallback for transcripts created before run markers
  // existed. This still prevents a newer marker from being parsed as history.
  return getLatestScanTranscript(output);
}

function normalizeScannerType(value: unknown): ScannerType {
  return typeof value === 'string' && SCANNER_TYPES.includes(value as ScannerType)
    ? value as ScannerType
    : 'nmap';
}

/**
 * Create scan event handlers
 */
export function createScanHandlers(
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
) {
  /**
   * Handle scan output (real-time)
   */
  const handleScanOutput = (data: ScanOutputData) => {
    
    const tabId = extractScanTabId(data.scanId);
    if (tabId) {
      
      // Forward to terminal as listener-output
      window.dispatchEvent(new CustomEvent('listener-output', {
        detail: {
          listenerId: `${tabId}::nmap`,
          data: data.data,
          type: data.type
        }
      }));
    }
    
    // Don't update React state on every chunk - terminal manager handles buffering
  };

  /**
   * Handle scan completion
   */
  const handleScanComplete = async (
    data: ScanCompleteData,
    outputSnapshot?: string,
    ignoreIfReplacementRunStarted = false,
    runIdOverride?: string,
    sessionIdOverride?: string,
    targetOverride?: string,
  ) => {
    console.log('[scanner-handlers] Command complete:', data.scanId, 'code:', data.code);
    
    const tabId = extractScanTabId(data.scanId);

    if (!tabId) return;

    // Never infer identity from the currently visible scanner. A completion can
    // arrive after the user switched tools or left the scan section.
    const scannerType = normalizeScannerType(data.scannerType);
    const terminalId = data.terminalId || `${tabId}::${scannerType}`;
    const capturedRunId = runIdOverride || getScanRunId(terminalId);
    const capturedSessionId = sessionIdOverride || getScanRunSessionId(terminalId);
    const capturedTarget = targetOverride || getScanRunTarget(terminalId);
    const replacementRunActive = () => {
      const currentRunId = getScanRunId(terminalId);
      return Boolean(currentRunId && currentRunId !== capturedRunId);
    };

    // A stale close must not mutate replacement UI, but its captured transcript
    // is still independently attributable and should be indexed below.
    const canApplyClosedRun = () => !ignoreIfReplacementRunStarted || !replacementRunActive();

    // Do not publish completion until the retained transcript has been parsed
    // and committed to attack state. This closes the race where an immediate AI
    // request observes an idle scanner before its evidence write finishes.
    setTimeout(async () => {
      try {
        const { terminalService } = await import('../terminal-service');
        const outputString = outputSnapshot ?? getCurrentRunOutput(
          terminalService.getOutput(terminalId),
          terminalId,
        );
        let parsedResults: any[] = [];

        if (outputString) {
          console.log(`[scanner-handlers] Parsing ${scannerType} output (${outputString.length} chars, code ${data.code})`);
          // Parsing is pure for this phase. UI publication happens only after
          // evidence indexing succeeds; replacement runs remain UI-isolated.
          parsedResults = await parseScanOutput(scannerType, outputString, tabId, setTabs, () => false);
        }

        let evidenceCommitted = true;
        const currentTab = (window as any).__nmapContextState?.tabs?.find(
          (candidate: Tab) => candidate.id === tabId,
        ) as Tab | undefined;
        const resultTarget = capturedTarget || currentTab?.target || '';

        if (outputString.trim() && capturedSessionId && resultTarget) {
          const { useAttackState } = await import('../attack-state-store');
          const state = useAttackState.getState();
          if (state.session?.id !== capturedSessionId) {
            evidenceCommitted = false;
          } else {
            const committed = await state.processScannerResults(resultTarget, {
              scannerType,
              results: parsedResults,
              command: currentTab?.commandsByScanner?.[scannerType] || scannerType,
              output: outputString,
              timestamp: Date.now(),
              target: resultTarget,
              tabId,
              terminalId,
              sessionId: capturedSessionId,
              tool: scannerType,
              runId: capturedRunId,
            });
            evidenceCommitted = committed !== false
              && useAttackState.getState().session?.id === capturedSessionId;
          }
        }

        if (!evidenceCommitted) {
          console.warn('[scanner-handlers] Completion evidence was not committed; suppressing stale/success UI publication');
          if (canApplyClosedRun()) {
            setTabs((prev) => prev.map((tab) => {
              if (tab.id !== tabId) return tab;
              const scanningByScanner = { ...(tab.scanningByScanner || {}), [scannerType]: false };
              return {
                ...tab,
                isScanning: (tab.scannerType || 'nmap') === scannerType ? false : tab.isScanning,
                lastScanStatus: 'failed',
                lastScanExitCode: 1,
                scanningByScanner,
              };
            }));
          }
          return;
        }

        if (parsedResults.length > 0 && canApplyClosedRun()) {
          applyParsedResults(tabId, scannerType, parsedResults, setTabs, canApplyClosedRun);
        }

        if (canApplyClosedRun()) {
          setTabs((prev) => prev.map(tab => {
            if (tab.id !== tabId) return tab;
            const scanningByScanner = { ...(tab.scanningByScanner || {}), [scannerType]: false };
            return {
              ...tab,
              isScanning: (tab.scannerType || 'nmap') === scannerType ? false : tab.isScanning,
              lastScanStatus: data.code === 0 ? 'completed' : 'failed',
              lastScanExitCode: data.code,
              scanningByScanner,
            };
          }));
        }
      } catch (error) {
        console.error('[scanner-handlers] Failed to parse/index output:', error);
        if (canApplyClosedRun()) {
          setTabs((prev) => prev.map(tab => {
            if (tab.id !== tabId) return tab;
            const scanningByScanner = { ...(tab.scanningByScanner || {}), [scannerType]: false };
            return {
              ...tab,
              isScanning: (tab.scannerType || 'nmap') === scannerType ? false : tab.isScanning,
              lastScanStatus: 'failed',
              lastScanExitCode: data.code || 1,
              scanningByScanner,
            };
          }));
        }
      }
    }, 100);
  };

  /**
   * Handle listener closed event (for nikto/nuclei/etc)
   */
  const handleListenerClosed = async (data: { listenerId: string; code: number }) => {
    console.log('[scanner-handlers] listener-closed event:', data);

    // Scanner terminals are named `${tabId}::${scannerType}`. Do not turn
    // foothold/tunnel closures into fake scan completions.
    const separator = data.listenerId.indexOf('::');
    if (separator <= 0) return;

    const scannerTabId = data.listenerId.slice(0, separator);
    const scannerType = normalizeScannerType(data.listenerId.slice(separator + 2));
    const terminalId = `${scannerTabId}::${scannerType}`;

    if (!SCANNER_TYPES.includes(data.listenerId.slice(separator + 2) as ScannerType)) return;

    // Capture the run boundary and provenance before cancelScanRun removes the
    // registry entry. The close event may be the final signal for a crashed
    // WSL process, so the parser still needs the exact run transcript after
    // ownership is released.
    const outputOffset = getScanRunOutputOffset(terminalId);
    const outputMarker = getScanRunOutputMarker(terminalId);
    const closedRunId = getScanRunId(terminalId);
    const closedSessionId = getScanRunSessionId(terminalId);
    const closedTarget = getScanRunTarget(terminalId);
    let outputSnapshot = '';
    try {
      const { terminalService } = await import('../terminal-service');
      outputSnapshot = getCurrentRunOutput(
        terminalService.getOutput(terminalId),
        terminalId,
        outputOffset,
        outputMarker,
      );
    } catch (error) {
      console.warn('[scanner-handlers] Could not snapshot closed scan output:', error);
    }

    // A backend close may arrive before the managed shell marker (WSL crash,
    // external kill, or teardown). Prevent a stale monitor from living on and
    // mutating a later run; parsing below still consumes the retained buffer.
    cancelScanRun(terminalId);

    await handleScanComplete({
      scanId: `scan-${scannerTabId}-closed`,
      code: data.code,
      scannerType,
      terminalId,
    }, outputSnapshot, true, closedRunId, closedSessionId, closedTarget);
  };

  return {
    handleScanOutput,
    handleScanComplete,
    handleListenerClosed,
  };
}

/**
 * Parse scan output based on scanner type
 */
async function parseScanOutput(
  scannerType: ScannerType | undefined,
  output: string,
  tabId: string,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  canApply: () => boolean = () => true,
): Promise<any[]> {
  try {
    switch (scannerType) {
      case 'nmap':
        return await parseNmapOutput(output, tabId, scannerType, setTabs, canApply);
      
      case 'nuclei':
        return await parseNucleiOutput(output, tabId, scannerType, setTabs, canApply);
      
      case 'nikto':
        return await parseNiktoOutput(output, tabId, scannerType, setTabs, canApply);
      
      case 'dirbuster':
        return await parseDirBusterOutput(output, tabId, scannerType, setTabs, canApply);
      
      case 'universal':
      default: {
        const { parseUniversalOutput } = await import('../universal-parser');
        const parsed = parseUniversalOutput('', output);
        applyParsedResults(tabId, scannerType, parsed.findings, setTabs, canApply);
        return parsed.findings;
      }
    }
  } catch (error) {
    console.error('[scanner-handlers] Failed to parse output:', error);
    return [];
  }
}

function applyParsedResults(
  tabId: string,
  scannerType: ScannerType | undefined,
  parsedResults: any[],
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  canApply: () => boolean = () => true,
) {
  const scannerKey = normalizeScannerType(scannerType);
  setTabs((prev) => prev.map(t => {
    if (!canApply()) return t;
    if (t.id !== tabId) return t;

    const resultsByScanner = {
      ...(t.resultsByScanner || {}),
      [scannerKey]: parsedResults,
    };

    return {
      ...t,
      results: (t.scannerType || 'nmap') === scannerKey ? parsedResults as any : t.results,
      resultsByScanner,
    };
  }));
}

/**
 * Parse nmap output
 */
async function parseNmapOutput(
  output: string,
  tabId: string,
  scannerType: ScannerType | undefined,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  canApply: () => boolean = () => true,
): Promise<any[]> {
  try {
    const { parseNmapOutput } = await import('../nmap-parser');
    const parsedResults = parseNmapOutput(output);
    
    if (parsedResults.length > 0) {
      console.log('[scanner-handlers] Parsed', parsedResults.length, 'hosts from nmap output');
      applyParsedResults(tabId, scannerType, parsedResults, setTabs, canApply);
    }
    return parsedResults;
  } catch (error) {
    console.error('[scanner-handlers] Failed to parse nmap output:', error);
    return [];
  }
}

/**
 * Parse nuclei output
 */
async function parseNucleiOutput(
  output: string,
  tabId: string,
  scannerType: ScannerType | undefined,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  canApply: () => boolean = () => true,
): Promise<any[]> {
  try {
    const { parseNucleiOutput } = await import('../parsers/nuclei-parser');
    const parsed = parseNucleiOutput(output);
    
    if (parsed.findings.length > 0) {
      applyParsedResults(tabId, scannerType, parsed.findings as any[], setTabs, canApply);
    }
    return parsed.findings as any[];
  } catch (error) {
    console.error('[scanner-handlers] Failed to parse nuclei output:', error);
    return [];
  }
}

/**
 * Parse nikto output
 */
async function parseNiktoOutput(
  output: string,
  tabId: string,
  scannerType: ScannerType | undefined,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  canApply: () => boolean = () => true,
): Promise<any[]> {
  try {
    const { parseNiktoOutput } = await import('../parsers/nikto-parser');
    const parsed = parseNiktoOutput(output);
    console.log('[scanner-handlers] Parsed', parsed.findings.length, 'findings from nikto output');
    
    if (parsed.findings.length > 0) {
      applyParsedResults(tabId, scannerType, parsed.findings as any[], setTabs, canApply);
    }
    return parsed.findings as any[];
  } catch (error) {
    console.error('[scanner-handlers] Failed to parse nikto output:', error);
    return [];
  }
}

/**
 * Parse dirbuster output
 */
async function parseDirBusterOutput(
  output: string,
  tabId: string,
  scannerType: ScannerType | undefined,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  canApply: () => boolean = () => true,
): Promise<any[]> {
  try {
    const { parseDirBusterOutput } = await import('../dirbuster-parser');
    const parsed = parseDirBusterOutput(output);
    console.log('[scanner-handlers] Parsed', parsed.findings.length, 'findings from dirbuster output');
    
    if (parsed.findings.length > 0) {
      applyParsedResults(tabId, scannerType, parsed.findings as any[], setTabs, canApply);
    }
    return parsed.findings as any[];
  } catch (error) {
    console.error('[scanner-handlers] Failed to parse dirbuster output:', error);
    return [];
  }
}

/**
 * Setup scheduler integration
 */
export async function setupScheduler(
  _setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
) {
  try {
    const { Scheduler } = await import('../scheduler');
    // The scheduler owns the bounded/cancellable executor. Do not replace it
    // with a renderer-only completion listener: that path loses partial output
    // and cannot cancel the child reliably.
    await Scheduler.initializeExecutor();
  } catch (error) {
    console.error('[scanner-handlers] Failed to setup scheduler:', error);
  }
}
