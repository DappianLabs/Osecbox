/**
 * System Command Handlers
 * Handles execution of system commands with PTY support
 * Used for scanners (nmap, nikto, nuclei, etc.)
 */

import { platformService } from '../platform-service';
import { loadPTY } from '../lazy-pty';
import { rateLimiters } from './rate-limiter';
import { logSecurityEvent } from '../utils/security-logger';
import { BoundedOutput } from '../utils/bounded-output';
import { buildWslPath, toWslPath } from '../utils/wsl-path';
import { tokenizeShellFreeCommand } from './command-handlers';

const ALLOWED_COMMANDS = new Set([
  'nmap', 'nikto', 'nuclei', 'gobuster', 'dirb', 'dirbuster',
  'subfinder', 'amass', 'assetfinder', 'ffuf', 'sublist3r',
  'sqlmap', 'wpscan', 'hydra', 'john', 'hashcat',
  'metasploit', 'msfconsole', 'msfvenom',
  'burpsuite', 'zaproxy', 'wireshark', 'tcpdump',
  'netcat', 'nc', 'socat', 'ncat',
  'curl', 'wget', 'ping', 'traceroute', 'dig', 'nslookup', 'host',
  'ssh', 'scp', 'ftp', 'telnet',
  'masscan', 'zmap', 'rustscan',
  'enum4linux', 'smbclient', 'rpcclient',
  'searchsploit', 'exploitdb',
]);

const MAX_COMMAND_LENGTH = 256 * 1024;
const MAX_SCAN_ID_LENGTH = 256;
const COMMAND_TIMEOUT = 3600000;
const FORCE_KILL_DELAY = 5000;
const COMMAND_ERROR_DELAY = 500;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandBasename(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  return basename.toLowerCase().replace(/\.exe$/i, '');
}

export function registerSystemCommandHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void,
  getMainWindow: () => any,
  activeScans: Map<string, any>,
  registerScanWithTTL: (scanId: string, process: any, type: 'pty' | 'regular') => void
) {
  const pendingScanIds = new Set<string>();

  // Execute a system command with whitelist validation and no user-controlled
  // shell syntax. WSL retains a fixed bash wrapper only to inject the shared
  // PATH; the command and every argument are reconstructed and shell-quoted.
  registerIPCHandler('execute-system-command', async (_event, rawArgs: unknown) => {
    const responseScanId = isPlainRecord(rawArgs) && typeof rawArgs.scanId === 'string'
      ? rawArgs.scanId
      : '';

    if (!isPlainRecord(rawArgs)) {
      return { success: false, error: 'Invalid command arguments', scanId: responseScanId };
    }

    const keys = Reflect.ownKeys(rawArgs);
    if (keys.length !== 2 || keys.some(key => typeof key !== 'string' || (key !== 'command' && key !== 'scanId'))) {
      return { success: false, error: 'Invalid command arguments', scanId: responseScanId };
    }

    const command = rawArgs.command;
    const scanId = rawArgs.scanId;
    if (typeof command !== 'string' || typeof scanId !== 'string') {
      return { success: false, error: 'Invalid command arguments', scanId: responseScanId };
    }
    if (!scanId.trim() || scanId.length > MAX_SCAN_ID_LENGTH || CONTROL_CHARACTERS.test(scanId)) {
      return { success: false, error: 'Invalid scan ID', scanId: responseScanId };
    }
    if (!command || command.length > MAX_COMMAND_LENGTH) {
      return { success: false, error: command ? 'Command too large' : 'Invalid command', scanId };
    }

    const parsed = tokenizeShellFreeCommand(command);
    if (!parsed.args) {
      logSecurityEvent.commandBlocked('unknown', parsed.error || 'Invalid command syntax');
      return { success: false, error: parsed.error || 'Invalid command', scanId };
    }

    const commandArgs = parsed.args;
    const commandName = commandBasename(commandArgs[0]);
    if (!ALLOWED_COMMANDS.has(commandName)) {
      console.error(`[SECURITY] Blocked unauthorized command: ${commandName}`);
      logSecurityEvent.commandBlocked(commandName, 'Not in whitelist');
      return {
        success: false,
        error: `Command '${commandName}' is not allowed. Only pentesting tools are permitted.`,
        scanId,
      };
    }

    if (activeScans.has(scanId) || pendingScanIds.has(scanId)) {
      return { success: false, error: 'A command with this scan ID is already running', scanId };
    }

    console.log(`[SECURITY] Authorized command execution: ${commandName}`);
    logSecurityEvent.commandExecution(commandName, true);

    // SECURITY: Rate limiting to prevent DoS
    const rateLimitCheck = rateLimiters.systemCommand.check('system-command');
    if (!rateLimitCheck.allowed) {
      console.error('[SECURITY] Rate limit exceeded for system commands');
      logSecurityEvent.rateLimitExceeded('system-command', 'global');
      return {
        success: false,
        error: `Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.`,
        scanId,
      };
    }

    pendingScanIds.add(scanId);
    let spawnedProcess: any = null;

    try {
      const mainWindow = getMainWindow();

      // Scanner tools require Linux - use WSL on Windows
      const platformInfo = await platformService.getPlatformInfo();
      const strategy = await platformService.getExecutionStrategy(true);

      // Check if Linux tools are being run on Windows without WSL
      if (platformInfo.isWindows && !strategy.shouldUseWSL) {
        const errorMsg = 'WSL2 is required to run Linux pentesting tools on Windows. Please install WSL2 and a Linux distribution such as Ubuntu, Debian, or Kali.';
        console.error(`[execute-system-command] ${errorMsg}`);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('nmap-output', {
            scanId,
            data: `\r\n\x1b[31m[ERROR]\x1b[0m ${errorMsg}\r\n\r\n` +
                  'To install WSL2:\r\n' +
                  '1. Open PowerShell as Administrator\r\n' +
                  '2. Run: wsl --install\r\n' +
                  '3. Restart your computer\r\n' +
                  '4. Set up Ubuntu when prompted\r\n\r\n' +
                  'For more info: https://learn.microsoft.com/en-us/windows/wsl/install\r\n',
            type: 'stderr',
          });
          mainWindow.webContents.send('nmap-complete', { scanId, code: 1 });
        }

        return { success: false, error: errorMsg, scanId };
      }

      let actualCommand: string;
      let actualArgs: string[];
      if (strategy.shouldUseWSL) {
        const { settingsService } = await import('../services/settings-service');
        await settingsService.waitUntilReady();
        const settings = settingsService.getSettings();
        const runtimeArgs = commandArgs.map(toWslPath);
        const pathString = buildWslPath(settings.wsl2ExtraPaths || []);
        const prefix = strategy.commandPrefix;
        const usesFixedBashWrapper = prefix.length >= 3
          && prefix[prefix.length - 2] === 'bash'
          && prefix[prefix.length - 1] === '-c';

        actualCommand = prefix[0] || 'wsl.exe';
        if (usesFixedBashWrapper) {
          // The only shell syntax here is fixed by this handler/helper. All
          // renderer input is represented by individually quoted argv values.
          const script = `exec env PATH=${pathString} ${runtimeArgs.map(shellQuote).join(' ')}`;
          actualArgs = [...prefix.slice(1), script];
        } else {
          // Future strategies can opt into a direct WSL invocation. The
          // current strategy always uses the fixed wrapper above for PATH.
          actualArgs = [...prefix.slice(1), ...runtimeArgs];
        }
      } else {
        actualCommand = commandArgs[0];
        actualArgs = commandArgs.slice(1);
      }

      console.log(`[execute-system-command] Starting PTY for: ${commandName} (WSL: ${strategy.shouldUseWSL})`);

      const envWithPath = {
        ...process.env,
        PATH: process.env.PATH || '',
        TMOUT: '0',
      };

      const pty = await loadPTY();
      spawnedProcess = pty.spawn(actualCommand, actualArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: strategy.homeDir,
        env: envWithPath as any,
        handleFlowControl: true,
      });

      registerScanWithTTL(scanId, spawnedProcess, 'pty');

      // Keep the legacy one-shot path lossless too. The renderer event is only
      // a live view; the transcript service is the recovery/export source.
      const historyReady = import('../terminal-history-service')
        .then(async module => {
          await module.terminalHistoryService.initHistory(scanId);
          return module.terminalHistoryService;
        })
        .catch(error => {
          console.warn('[execute-system-command] History unavailable:', error);
          return null;
        });
      let historyWritePromise: Promise<void> = Promise.resolve();
      let historyClosed = false;
      const appendHistory = (data: string) => {
        if (!data) return;
        historyWritePromise = historyWritePromise
          .then(async () => {
            const service = await historyReady;
            await service?.appendOutput(scanId, data);
          })
          .catch(error => {
            console.warn('[execute-system-command] History append failed:', error);
          });
      };
      const closeHistory = async () => {
        if (historyClosed) return;
        historyClosed = true;
        await historyWritePromise;
        const service = await historyReady;
        await service?.close?.(scanId);
      };

      let timeoutHandle: NodeJS.Timeout | null = null;
      let forceKillHandle: NodeJS.Timeout | null = null;
      let completionTimer: NodeJS.Timeout | null = null;
      let outputBuffer = '';
      let flushTimeout: NodeJS.Timeout | null = null;
      let lastFlushTime = 0;
      let finalized = false;
      let timedOut = false;
      let errorDetected = false;

      const fullOutput = new BoundedOutput();
      const flushOutput = (force = false) => {
        if (flushTimeout) {
          clearTimeout(flushTimeout);
          flushTimeout = null;
        }
        if (!outputBuffer) return;

        const currentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const now = Date.now();
        if (!force && currentWindow && now - (lastFlushTime || 0) < 16) {
          flushTimeout = setTimeout(() => flushOutput(false), 16 - (now - lastFlushTime));
          return;
        }

        if (currentWindow) {
          try {
            currentWindow.webContents.send('nmap-output', {
              scanId,
              data: outputBuffer,
              type: 'stdout',
            });
          } catch (error: any) {
            if (error?.code !== 'EPIPE') console.error('[PTY] Send error:', error);
          }
        }
        outputBuffer = '';
        lastFlushTime = now;
      };

      return await new Promise((resolve) => {
        const finalize = async (
          exitCode: number | null,
          success: boolean,
          errorMessage?: string,
          killProcess = false,
        ) => {
          if (finalized) return;
          finalized = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (forceKillHandle) clearTimeout(forceKillHandle);
          if (completionTimer) clearTimeout(completionTimer);
          if (flushTimeout) clearTimeout(flushTimeout);

          if (killProcess) {
            try {
              spawnedProcess.kill('SIGTERM');
            } catch {
              // The process may have already exited.
            }
          }
          flushOutput(true);

          if (activeScans.get(scanId) === spawnedProcess) {
            activeScans.delete(scanId);
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              mainWindow.webContents.send('nmap-complete', {
                scanId,
                code: exitCode === null ? (timedOut ? 124 : 1) : exitCode,
              });
            } catch (error: any) {
              console.error('[PTY] Completion send error:', error);
            }
          }

          try {
            await closeHistory();
          } catch (error) {
            console.warn('[execute-system-command] History close failed:', error);
          }

          resolve(success
            ? { success: true, output: fullOutput.toString(), scanId }
            : { success: false, error: errorMessage || 'Command execution failed', scanId });
        };

        const terminateOnTimeout = () => {
          if (finalized) return;
          timedOut = true;
          console.log(`[SECURITY] Command timeout reached for scanId: ${scanId}`);
          try {
            spawnedProcess.kill('SIGTERM');
          } catch {
            // The process may have exited between the timer and this call.
          }
          forceKillHandle = setTimeout(() => {
            if (finalized) return;
            try {
              spawnedProcess.kill('SIGKILL');
            } catch {
              // The process may already be dead.
            }
            void finalize(124, false, 'Command timed out');
          }, FORCE_KILL_DELAY);
        };

        timeoutHandle = setTimeout(terminateOnTimeout, COMMAND_TIMEOUT);

        spawnedProcess.onData((data: string) => {
          if (finalized) return;
          appendHistory(data);
          fullOutput.append(data);
          outputBuffer += data;
          if (outputBuffer.length > 64 * 1024) {
            outputBuffer = outputBuffer.slice(-32 * 1024);
          }

          const errorPatterns = [
            /command not found/i,
            /No such file or directory/i,
            /not recognized as an internal or external command/i,
            /is not recognized/i,
            /bash:.*not found/i,
            /sh:.*not found/i,
          ];
          if (!errorDetected && errorPatterns.some(pattern => pattern.test(data))) {
            errorDetected = true;
            completionTimer = setTimeout(() => {
              void finalize(127, false, 'Command not found or failed', true);
            }, COMMAND_ERROR_DELAY);
          }

          if (!flushTimeout) flushTimeout = setTimeout(() => flushOutput(false), 16);
          if (outputBuffer.length > 4096) flushOutput();
        });

        spawnedProcess.onExit(({ exitCode }: { exitCode: number }) => {
          void finalize(exitCode, !timedOut && exitCode === 0, timedOut ? 'Command timed out' : undefined);
        });
      });
    } catch (error: any) {
      if (spawnedProcess) {
        try {
          spawnedProcess.kill('SIGKILL');
        } catch {
          // The process may not have started or may already be gone.
        }
      }
      if (activeScans.get(scanId) === spawnedProcess) {
        activeScans.delete(scanId);
      }
      return { success: false, error: error?.message || 'Command execution failed', scanId };
    } finally {
      pendingScanIds.delete(scanId);
    }
  });
}
