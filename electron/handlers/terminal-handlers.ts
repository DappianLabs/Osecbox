/**
 * Terminal/PTY Handlers
 * Handles terminal operations, PTY management, and terminal history
 * 
 * NOTE: This is the most complex handler file due to:
 * - Cross-platform PTY management (Windows/Linux/Mac/WSL2)
 * - Interactive shell vs command execution
 * - Output buffering and backpressure
 * - Terminal history persistence
 * - Process lifecycle management
 */

import { BrowserWindow, dialog } from 'electron';
import { execFile } from 'child_process';
import { platformService } from '../platform-service';
import { loadPTY } from '../lazy-pty';
import { buildWslPath } from '../utils/wsl-path';

// Terminal history service with proper initialization tracking
let terminalHistoryService: any = null;
let historyServiceInitPromise: Promise<any> | null = null;

async function getTerminalHistoryService() {
  // If already loaded, return immediately
  if (terminalHistoryService) {
    return terminalHistoryService;
  }
  
  // If loading in progress, wait for it
  if (historyServiceInitPromise) {
    return await historyServiceInitPromise;
  }
  
  // Start loading
  historyServiceInitPromise = (async () => {
    try {
      const module = await import('../terminal-history-service');
      terminalHistoryService = module.terminalHistoryService;
      return terminalHistoryService;
    } catch (error) {
      console.error('[TerminalHandlers] Failed to load history service:', error);
      // Do not return a fake successful service. A silent no-op here made
      // Save report success while producing an empty file, which is worse
      // than a visible fallback/error when durable history is unavailable.
      return null;
    } finally {
      historyServiceInitPromise = null;
    }
  })();
  
  return await historyServiceInitPromise;
}

function normalizeHistoryCount(value: unknown, fallback = 1000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(5000, Math.floor(parsed)));
}

function normalizeHistoryLine(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(parsed)));
}

// Cache platform info to avoid async calls on every terminal start
let cachedPlatformInfo: any = null;
let cachedStrategy: any = null;
let platformCachePromise: Promise<void> | null = null;
let platformCacheGeneration = 0;
let wslWarmedUp = false;

// Tool re-checks can recover after WSL is repaired while the app remains open.
// Do not keep the terminal strategy on the old native/WSL decision forever.
export function clearTerminalPlatformCache(): void {
  platformCacheGeneration += 1;
  cachedPlatformInfo = null;
  cachedStrategy = null;
  wslWarmedUp = false;
}

async function ensurePlatformCache() {
  if (cachedPlatformInfo && cachedStrategy) {
    return; // Already cached
  }
  
  if (platformCachePromise) {
    await platformCachePromise; // Wait for existing cache operation
    // A settings change may have invalidated the result while the previous
    // detection was still in flight. Re-enter once so the next terminal uses
    // current runtime settings instead of stale state.
    if (!cachedPlatformInfo || !cachedStrategy) {
      return ensurePlatformCache();
    }
    return;
  }
  const generation = platformCacheGeneration;
  platformCachePromise = (async () => {
    try {
      const platformInfo = await platformService.getPlatformInfo();
      const preferWSL = platformInfo.isWindows && platformInfo.wsl2Status === 'available';
      const strategy = await platformService.getExecutionStrategy(preferWSL);
      if (generation !== platformCacheGeneration) return;
      cachedPlatformInfo = platformInfo;
      cachedStrategy = strategy;
      console.log('[TerminalHandlers] ✅ Platform info cached for fast terminal startup');
    } catch (error) {
      console.error('[TerminalHandlers] Failed to cache platform info:', error);
    } finally {
      platformCachePromise = null;
    }
  })();
  
  await platformCachePromise;
  if (!cachedPlatformInfo || !cachedStrategy) {
    if (generation !== platformCacheGeneration) {
      return ensurePlatformCache();
    }
    throw new Error('Platform execution strategy could not be initialized');
  }
}

// Boot the WSL distro in the background at startup so the first
// real terminal PTY spawns against an already-running distro. On Windows the first
// `wsl` invocation cold-boots the distro VM (1-3s), which is why the prompt appears
// late. This pays that cost in parallel with UI startup instead of on first view.
async function warmUpShell() {
  if (wslWarmedUp) return;
  try {
    await ensurePlatformCache();
    if (!cachedStrategy?.shouldUseWSL) return; // Only WSL has the cold-boot cost
    // Respect a custom distro if one is configured (mirrors the real spawn prefix).
    const prefix: string[] = cachedStrategy.commandPrefix || [];
    const execIndex = prefix.indexOf('--exec');
    // Reuse every WSL selection flag (including a configured user) and stop
    // before the bash wrapper. Warming a different user than the real PTY
    // makes detection look healthy while the first terminal still fails.
    const selectionArgs = execIndex > 0 ? prefix.slice(1, execIndex) : [];
    const args = [...selectionArgs, '--exec', 'true'];
    const generation = platformCacheGeneration;
    console.log(`[TerminalHandlers] Warming up WSL distro: wsl.exe ${args.join(' ')}`);
    execFile('wsl.exe', args, { timeout: 20000, windowsHide: true }, (error) => {
      if (generation !== platformCacheGeneration) {
        wslWarmedUp = false;
        return;
      }
      if (error) {
        wslWarmedUp = false;
        console.warn('[TerminalHandlers] WSL warm-up failed (non-fatal):', error.message);
      } else {
        wslWarmedUp = true;
        console.log('[TerminalHandlers] ✅ WSL distro warmed up — first terminal will be fast');
      }
    });
  } catch {
    // Non-fatal — warm-up is best-effort
    wslWarmedUp = false;
  }
}

export function registerTerminalHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void,
  registerIPCListener: (channel: string, handler: (...args: any[]) => void) => void,
  getMainWindow: () => BrowserWindow | null,
  activeScans: Map<string, any>,
  registerScanWithTTL: (scanId: string, process: any, type: 'pty' | 'regular') => void,
  updateScanActivity: (scanId: string) => void,
  systemInfo: any,
  unregisterScan?: (scanId: string, process?: any) => void,
) {
  // A renderer can close a session while the WSL/PTY startup promise is still
  // resolving. Keep a small per-listener cancellation gate so that a stop
  // issued in that window cannot be lost before activeScans is registered.
  const pendingStarts = new Set<string>();
  const pendingStartPromises = new Map<string, Promise<any>>();
  const cancelledStarts = new Set<string>();
  const historyCleanupHandlers = new Map<string, () => Promise<void>>();
  // The PTY transport coalesces history writes for throughput. Reads and
  // exports flush this small in-memory queue first so a Save clicked
  // immediately after a process exits cannot miss the final batch.
  const historyFlushHandlers = new Map<string, () => Promise<void>>();
  const flushPendingHistory = async (ptyIds: string[]) => {
    await Promise.all(Array.from(new Set(ptyIds)).map(async (ptyId) => {
      try {
        await historyFlushHandlers.get(ptyId)?.();
      } catch (error) {
        console.warn(`[HistoryService] Pending output flush failed for ${ptyId}:`, error);
      }
    }));
  };

  // Pre-cache platform info on handler registration
  ensurePlatformCache().catch(console.error);
  // Warm up the WSL distro in the background so the first terminal
  // prompt appears quickly instead of waiting on a cold WSL boot.
  void warmUpShell();
  // Open terminal with command pre-filled
  registerIPCHandler('open-terminal-with-command', async (_event, command: string) => {
    try {
      const mainWindow = getMainWindow();
      
      if (!mainWindow) {
        return { success: false, error: 'Main window not available' };
      }
      
      // Send command to renderer to open terminal
      mainWindow.webContents.send('open-terminal-tab', { command });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Start listener (PTY terminal)
  registerIPCHandler('start-listener', async (_event, args: { command: string; listenerId: string }) => {
    const { command, listenerId } = args;
    const mainWindow = getMainWindow();
    
    if (!command || !command.trim()) {
      return { success: false, error: 'Empty command' };
    }
    
    // FIX: MSF console needs special handling - create virtual PTY
    if (listenerId === 'msf-console-persistent') {
      console.log(`[start-listener] MSF console - creating virtual PTY for terminal integration`);
      
      // Check if already exists
      if (activeScans.has(listenerId)) {
        console.log(`[start-listener] MSF console PTY already exists, reusing`);
        return { success: true, listenerId, reused: true };
      }
      
      // Create a virtual PTY object that forwards to hybrid PTY manager
      const virtualPTY = {
        write: (data: string) => {
          // Forward input to the manager; it queues input until the prompt is
          // ready instead of silently dropping early keystrokes.
          import('../msf-pty-manager').then(({ msfPtyManager }) => {
            return msfPtyManager.writeInput(data);
          }).catch(console.error);
        },
        resize: (cols: number, rows: number) => {
          // Forward resize to MSF PTY manager
          import('../msf-pty-manager').then(({ msfPtyManager }) => {
            if (msfPtyManager.isReady()) {
              msfPtyManager.resize(cols, rows);
            }
          }).catch(console.error);
        },
        kill: () => {
          // Don't kill MSF console - it's persistent
          console.log('[start-listener] MSF console kill requested - ignoring (persistent)');
        },
        removeAllListeners: () => {
          // No-op for virtual PTY
        }
      };
      
      // Register virtual PTY
      registerScanWithTTL(listenerId, virtualPTY, 'pty');
      
      // History is auxiliary; do not hold the MSF console handshake on disk
      // initialization. The in-memory terminal buffer is the source of truth
      // for the first prompt and live output.
      void getTerminalHistoryService()
        .then(service => service.initHistory(listenerId))
        .catch(error => console.warn(`[HistoryService] MSF history unavailable:`, error?.message || error));
      
      console.log(`[start-listener] MSF console virtual PTY created successfully`);
      return { success: true, listenerId, managed: true };
    }

    // Check if listener already exists - prevent duplicates
    if (activeScans.has(listenerId)) {
      console.log(`[start-listener] Listener ${listenerId} already exists, reusing`);
      return { success: true, listenerId, reused: true };
    }

    // A second Start must not be acknowledged while the first WSL startup is
    // still resolving. If Stop marked that startup for cancellation, wait for
    // it to settle and then let this request create the replacement PTY.
    const pendingStart = pendingStartPromises.get(listenerId);
    if (pendingStart) {
      if (cancelledStarts.has(listenerId)) {
        await pendingStart.catch(() => undefined);
        if (activeScans.has(listenerId)) {
          return { success: true, listenerId, reused: true };
        }
      } else {
        return await pendingStart;
      }
    }

    if (pendingStarts.has(listenerId)) {
      console.log(`[start-listener] Listener ${listenerId} is already starting, reusing startup`);
      return { success: true, listenerId, starting: true };
    }

    pendingStarts.add(listenerId);
    cancelledStarts.delete(listenerId);

    let resolvePendingStart: (result: any) => void = () => undefined;
    const pendingStartPromise = new Promise<any>((resolve) => {
      resolvePendingStart = resolve;
    });
    pendingStartPromises.set(listenerId, pendingStartPromise);
    const completeStart = (result: any) => {
      // Stop can arrive in the same event-loop turn as the final startup
      // bookkeeping. Never publish a successful start after that cancellation
      // intent has been recorded; the renderer must wait for a replacement
      // PTY instead of attaching to a process that Stop already owns.
      const finalResult = result?.success && cancelledStarts.has(listenerId)
        ? { ...result, success: true, cancelled: true }
        : result;
      resolvePendingStart(finalResult);
      return finalResult;
    };

    let cleanupStartedHistory: (() => Promise<void>) | null = null;
    try {
      // Detect if this is an interactive shell request
      const isInteractiveShell = 
        command === 'bash' || 
        command === 'bash -i' || 
        command === 'sh' || 
        command === '/bin/bash' || 
        command === '/bin/bash -i' ||
        command === '/bin/sh' || 
        command === 'zsh' || 
        command === '/bin/zsh' ||
        command === 'wsl bash' ||
        command === 'wsl bash -i';
      
      // Use cached platform info (no async delay)
      await ensurePlatformCache();
      const platformInfo = cachedPlatformInfo!;
      const strategy = cachedStrategy!;
      const shell = strategy.shellCommand;
      const homeDir = strategy.homeDir;
      
      console.log(`[start-listener] Starting PTY for: ${command} (WSL: ${strategy.shouldUseWSL})`);
      
      let actualShell: string;
      let shellArgs: string[];
      
      if (isInteractiveShell) {
        // Interactive shell - spawn directly with proper prompt
        if (strategy.shouldUseWSL) {
          // Use clean PATH for interactive shells too
          const { settingsService } = await import('../services/settings-service');
          await settingsService.waitUntilReady();
          const settings = settingsService.getSettings();
          
          const extraPaths = settings.wsl2ExtraPaths || [];
          const pathString = buildWslPath(extraPaths);
          
          actualShell = (cachedStrategy.commandPrefix as string[])[0] || 'wsl.exe';
          // FIX: Set clean PATH in interactive shell with proper prompt
          // The setup shell only exports environment state. It must not be
          // interactive: an interactive `bash -i -c ...` can paint a prompt
          // before `exec` replaces it, leaving a duplicate prompt at the top
          // of a fresh terminal. The single nested interactive shell below is
          // the only process that should own readline/prompt rendering.
          shellArgs = ['bash', '--norc', '--noprofile', '-c', `export PATH=${pathString}; export PS1="\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ "; exec bash --norc --noprofile -i`];
          if (strategy.shouldUseWSL) {
            const prefix = cachedStrategy.commandPrefix as string[];
            const bashIndex = prefix.lastIndexOf('bash');
            const wslPrefix = bashIndex > 0 ? prefix.slice(1, bashIndex) : [];
            shellArgs = [
              ...wslPrefix,
              'bash', '--norc', '--noprofile', '-c',
              `export PATH=${pathString}; export PS1="\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ "; exec bash --norc --noprofile -i`,
            ];
          }
        } else if (platformInfo.isWindows) {
          actualShell = 'powershell.exe';
          shellArgs = ['-NoLogo', '-NoExit'];
        } else {
          actualShell = shell;
          shellArgs = /bash(?:\.exe)?$/i.test(shell)
            ? ['--norc', '--noprofile', '-c', 'export PS1="\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ "; exec bash --norc --noprofile -i']
            : ['-i'];
        }
      } else {
        // Command execution - ensure output is visible
        if (strategy.shouldUseWSL) {
          // Use clean PATH to prevent Windows path pollution breaking bash
          // Import settings service to get extra paths
          const { settingsService } = await import('../services/settings-service');
          await settingsService.waitUntilReady();
          const settings = settingsService.getSettings();
          
          // Build clean Linux PATH (exclude $PATH which contains Windows paths with parentheses)
          const extraPaths = settings.wsl2ExtraPaths || [];
          const pathString = buildWslPath(extraPaths);
          
          const prefix = cachedStrategy.commandPrefix as string[];
          const bashIndex = prefix.lastIndexOf('bash');
          const wslPrefix = bashIndex > 0 ? prefix.slice(1, bashIndex) : [];
          actualShell = prefix[0] || 'wsl.exe';
          // FIX: Inject clean PATH, echo command, then execute
          shellArgs = [
            ...wslPrefix,
            'bash', '--norc', '--noprofile', '-c',
            `export PATH=${pathString}; echo "$ ${command}"; ${command}`,
          ];
        } else {
          actualShell = shell;
          shellArgs = ['-c', `echo "$ ${command}"; ${command}`];
        }
      }
      
      // Enhanced environment setup
      const envWithPath = {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        PS1: '\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ ',
        // Never append POSIX ':' entries to a native Windows PATH. WSL
        // receives its clean PATH through the bash command above.
        PATH: strategy.shouldUseWSL
          ? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin'
          : (process.env.PATH || ''),
        TMOUT: '0',
        PYTHONPATH: process.env.PYTHONPATH || '',
        GOPATH: process.env.GOPATH || (strategy.shouldUseWSL ? '$HOME/go' : ''),
        GOBIN: process.env.GOBIN || (strategy.shouldUseWSL ? '$HOME/go/bin' : ''),
        SHELL: strategy.shouldUseWSL
          ? '/bin/bash'
          : (platformInfo.isWindows ? 'powershell.exe' : (process.env.SHELL || shell)),
      };
      
      // Determine working directory
      let ptyCwd: string | undefined;
      if (strategy.shouldUseWSL) {
        // The WSL prefix explicitly uses `--cd ~`. Keep node-pty itself in a
        // real, user-writable Windows directory as well; inheriting the
        // packaged process cwd can point at Program Files or the repo checkout
        // and makes startup depend on installer location/permissions.
        ptyCwd = homeDir;
      } else {
        ptyCwd = homeDir;
      }
      
      // Start history initialization in parallel with PTY loading. Renderer
      // BufferManager captures output immediately, so disk history must never
      // delay the first prompt (or make WSL startup look frozen).
      const historyReady = getTerminalHistoryService()
        .then(async service => {
          await service.initHistory(listenerId);
          return service;
        })
        .catch(error => {
          console.warn(`[HistoryService] Non-fatal initialization failure for ${listenerId}:`, error?.message || error);
          return null;
        });
      let historyChunks: string[] = [];
      let historyChunkSize = 0;
      let historyFlushTimer: NodeJS.Timeout | null = null;
      let historyWritePromise: Promise<void> = Promise.resolve();
      const HISTORY_BATCH_SIZE = 64 * 1024;

      const flushHistory = (): Promise<void> => {
        if (historyFlushTimer) {
          clearTimeout(historyFlushTimer);
          historyFlushTimer = null;
        }

        if (historyChunkSize === 0) return historyWritePromise;

        const chunk = historyChunks.length === 1 ? historyChunks[0] : historyChunks.join('');
        historyChunks = [];
        historyChunkSize = 0;

        historyWritePromise = historyWritePromise
          .then(async () => {
            const service = await historyReady;
            await service?.appendOutput(listenerId, chunk);
          })
          .catch(error => {
            console.warn(`[HistoryService] Output append failed for ${listenerId}:`, error?.message || error);
          });

        return historyWritePromise;
      };

      const enqueueHistory = (data: string) => {
        if (!data) return;
        historyChunks.push(data);
        historyChunkSize += data.length;

        if (historyChunkSize >= HISTORY_BATCH_SIZE) {
          void flushHistory();
        } else if (!historyFlushTimer) {
          historyFlushTimer = setTimeout(() => {
            void flushHistory();
          }, 50);
        }
      };

      let historyCleaned = false;
      const cleanupHistory = async () => {
        if (historyCleaned) return;
        historyCleaned = true;
        await flushHistory();
        await historyWritePromise;
        const service = await historyReady;
        await Promise.resolve(
          service?.close ? service.close(listenerId) : service?.cleanup?.(listenerId),
        ).catch(() => {});
        if (historyCleanupHandlers.get(listenerId) === cleanupHistory) {
          historyCleanupHandlers.delete(listenerId);
        }
        if (historyFlushHandlers.get(listenerId) === flushHistory) {
          historyFlushHandlers.delete(listenerId);
        }
      };
      historyCleanupHandlers.set(listenerId, cleanupHistory);
      historyFlushHandlers.set(listenerId, flushHistory);
      cleanupStartedHistory = cleanupHistory;

      if (cancelledStarts.has(listenerId)) {
        await cleanupHistory();
        console.log(`[start-listener] Startup cancelled before PTY spawn: ${listenerId}`);
        return completeStart({ success: true, listenerId, cancelled: true });
      }

      // Load PTY and spawn
      const pty = await loadPTY();
      
      // FIX #1: Start with reasonable default dimensions that will be updated on first fit
      // Don't hardcode 120x40 — let xterm control the width from the start
      const ptyProcess = pty.spawn(actualShell, shellArgs, {
        name: 'xterm-256color',
        cols: 80,  // Start with standard 80 cols (will be resized by xterm immediately)
        rows: 24,  // Standard 24 rows
        cwd: ptyCwd,
        env: envWithPath as any,
        handleFlowControl: true,
      });
      
      console.log(`[start-listener] PTY spawned successfully for ${listenerId}`);
      
      if (cancelledStarts.has(listenerId)) {
        try {
          ptyProcess.kill();
        } catch {
          // The process may have exited during cancellation.
        }
        await cleanupHistory();
        console.log(`[start-listener] Startup cancelled before registration: ${listenerId}`);
        return completeStart({ success: true, listenerId, cancelled: true });
      }
      
      registerScanWithTTL(listenerId, ptyProcess, 'pty');

      // Stop may have arrived after spawn but before the startup promise
      // completed. Tear down this just-registered process and resolve as a
      // cancellation, rather than allowing the renderer to mark it active.
      if (cancelledStarts.has(listenerId)) {
        try {
          ptyProcess.kill();
        } catch {
          // The stop path may already have terminated it.
        }
        if (unregisterScan) {
          unregisterScan(listenerId, ptyProcess);
        } else if (activeScans.get(listenerId) === ptyProcess) {
          activeScans.delete(listenerId);
        }
        await cleanupHistory();
        console.log(`[start-listener] Startup cancelled after PTY registration: ${listenerId}`);
        return completeStart({ success: true, listenerId, cancelled: true });
      }

      // Output buffering with backpressure. History is written independently
      // above, so this queue is only a renderer transport queue. It must never
      // be allowed to reorder or silently discard bytes while the window is
      // alive. xterm's parser is stateful across writes, therefore slicing a
      // large event is safe as long as the slices are sent synchronously in
      // their original order.
      let outputChunks: string[] = [];
      let outputBufferSize = 0;
      let flushTimeout: NodeJS.Timeout | null = null;
      let isFirstOutput = true;

      const BATCH_INTERVAL = 16; // one frame
      const FLUSH_THRESHOLD = 64 * 1024;
      const MAX_BUFFER_SIZE = 256 * 1024;
      const MAX_RENDERER_IPC_CHUNK = 64 * 1024;

      const appendOutput = (chunk: string) => {
        if (!chunk) return;
        outputChunks.push(chunk);
        outputBufferSize += chunk.length;
      };

      const takeOutput = () => {
        const output = outputChunks.length === 1 ? outputChunks[0] : outputChunks.join('');
        outputChunks = [];
        outputBufferSize = 0;
        return output;
      };
      
      const sendRendererOutput = (data: string) => {
        if (!data || !mainWindow || mainWindow.isDestroyed()) return;

        // webContents.send queues IPC messages in call order. Keep the loop
        // synchronous: an async 10ms stream here used to let later PTY events
        // overtake the tail of a large event and made terminal transcripts look
        // randomly reset or duplicated.
        for (let offset = 0; offset < data.length;) {
          let end = Math.min(data.length, offset + MAX_RENDERER_IPC_CHUNK);
          // Do not split a UTF-16 surrogate pair at an IPC boundary.
          if (
            end < data.length &&
            data.charCodeAt(end - 1) >= 0xd800 &&
            data.charCodeAt(end - 1) <= 0xdbff &&
            data.charCodeAt(end) >= 0xdc00 &&
            data.charCodeAt(end) <= 0xdfff
          ) {
            end -= 1;
          }
          if (end <= offset) end = Math.min(data.length, offset + MAX_RENDERER_IPC_CHUNK);

          mainWindow.webContents.send('listener-output', {
            listenerId,
            data: data.slice(offset, end),
            type: 'stdout',
          });
          offset = end;
        }
      };

      const flushOutput = () => {
        if (flushTimeout) {
          clearTimeout(flushTimeout);
          flushTimeout = null;
        }
        if (outputBufferSize === 0) return;

        const bufferedOutput = takeOutput();
        try {
          // Send output whenever the window exists, including while minimized
          // or hidden. The renderer's BufferManager captures it and durable
          // history remains the recovery source if the window is unavailable.
          sendRendererOutput(bufferedOutput);
        } catch (error: any) {
          if (error?.code !== 'EPIPE') {
            console.error('[PTY] Send error:', error);
          }
          // This is renderer transport failure only. The raw chunk has already
          // been queued to disk history and must not be replayed a second time
          // from this aggregate buffer.
        }
      };

      // Handle PTY data with proper cleanup tracking
      const dataHandler = (data: string) => {
        updateScanActivity(listenerId);
        
        // Durable history is lossless, but writes are coalesced off the PTY
        // event path so disk I/O cannot delay the first prompt or flood the
        // Electron main thread during a large scan.
        enqueueHistory(data);
        
        const firstOutput = isFirstOutput;
        if (firstOutput) {
          console.log(`[PTY] First output for ${listenerId} (${data.length} bytes)`);
          isFirstOutput = false;
        }

        // Keep the raw PTY string intact. The history service receives the
        // same string, and xterm can carry ANSI escape sequences across write
        // calls without a synthetic escape/newline repair layer.
        appendOutput(data);

        if (firstOutput || outputBufferSize >= MAX_BUFFER_SIZE || outputBufferSize >= FLUSH_THRESHOLD) {
          flushOutput();
          return;
        }
        
        if (!flushTimeout) {
          flushTimeout = setTimeout(flushOutput, BATCH_INTERVAL);
        }
      };

      // Store handler reference for cleanup
      ptyProcess.onData(dataHandler);

      // Handle PTY exit with proper cleanup
      const exitHandler = ({ exitCode }: { exitCode: number }) => {
        if (flushTimeout) {
          clearTimeout(flushTimeout);
        }
        flushOutput();
        
        // Remove from both maps
        if (unregisterScan) {
          unregisterScan(listenerId, ptyProcess);
        } else if (activeScans.get(listenerId) === ptyProcess) {
          activeScans.delete(listenerId);
        }
        
        void cleanupHistory();
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.webContents.send('listener-closed', { listenerId, code: exitCode });
            mainWindow.webContents.send('listener-exit', { 
              listenerId, 
              exitCode,
              timestamp: Date.now()
            });
          } catch (error: any) {
            console.error('[PTY] Exit send error:', error);
          }
        }
      };

      // Store handler reference for cleanup
      ptyProcess.onExit(exitHandler);

      // A Stop request can race the final handler registration. Check once
      // more immediately before resolving startup so no late success result
      // can resurrect a process that is already being stopped.
      if (cancelledStarts.has(listenerId)) {
        try {
          ptyProcess.kill();
        } catch {
          // The stop path may already have terminated it.
        }
        if (unregisterScan) {
          unregisterScan(listenerId, ptyProcess);
        } else if (activeScans.get(listenerId) === ptyProcess) {
          activeScans.delete(listenerId);
        }
        await cleanupHistory();
        console.log(`[start-listener] Startup cancelled during final registration: ${listenerId}`);
        return completeStart({ success: true, listenerId, cancelled: true });
      }

      return completeStart({ success: true, listenerId, usedWSL: strategy.shouldUseWSL });
    } catch (error: any) {
      await cleanupStartedHistory?.();
      return completeStart({ success: false, error: error.message });
    } finally {
      pendingStarts.delete(listenerId);
      cancelledStarts.delete(listenerId);
      if (pendingStartPromises.get(listenerId) === pendingStartPromise) {
        pendingStartPromises.delete(listenerId);
      }
    }
  });

  // Stop listener
  registerIPCHandler('stop-listener', async (_event, listenerId: string) => {
    try {
      const process = activeScans.get(listenerId);
      // Mark the entire startup handshake as canceled, including the short
      // window after registerScanWithTTL() but before start-listener resolves.
      // This makes Stop -> Start deterministic even when spawn is fast.
      if (pendingStarts.has(listenerId)) {
        cancelledStarts.add(listenerId);
        console.log(`[stop-listener] Marked pending startup for cancellation: ${listenerId}`);
      }
      if (process) {
        try {
          if ('kill' in process && typeof process.kill === 'function') {
            // Do not return as soon as SIGTERM is sent. A same-ID Start can
            // otherwise spawn a replacement while the old WSL process is
            // still unwinding, and the old process can consume/overwrite the
            // replacement's lifecycle events. Keep the normal data/exit
            // handlers attached until the process actually exits so final
            // shutdown output is retained in the terminal and on disk. Wait
            // for exit (or the force-kill deadline) before releasing the ID
            // to the next Start.
            let exited = false;
            let resolveExit: (() => void) | null = null;
            let forceKillTimeout: ReturnType<typeof setTimeout> | null = null;
            const exitPromise = new Promise<void>((resolve) => {
              resolveExit = resolve;
            });
            const settleExit = () => {
              if (exited) return;
              exited = true;
              if (forceKillTimeout) clearTimeout(forceKillTimeout);
              resolveExit?.();
            };

            process.onExit(() => {
              console.log(`[stop-listener] Process exited gracefully: ${listenerId}`);
              settleExit();
            });

            forceKillTimeout = setTimeout(() => {
              try {
                console.log(`[stop-listener] Force-killing process after 2s timeout: ${listenerId}`);
                process.kill('SIGKILL');
              } catch (forceKillError: any) {
                console.log(`[stop-listener] Force kill failed (process likely dead): ${listenerId}`);
                settleExit();
              }
            }, 2000);

            try {
              process.kill('SIGTERM');
            } catch (killError: any) {
              console.log(`[stop-listener] Process already terminated: ${listenerId}`);
              settleExit();
            }

            await Promise.race([
              exitPromise,
              new Promise<void>((resolve) => setTimeout(resolve, 2500)),
            ]);
          } else {
            console.log(`[stop-listener] Terminating regular process: ${listenerId}`);
            process.kill('SIGTERM');
            
            setTimeout(() => {
              try {
                process.kill('SIGKILL');
                console.warn(`[stop-listener] Force-killed regular process: ${listenerId}`);
              } catch (forceKillError: any) {
                console.log(`[stop-listener] Regular process already dead: ${listenerId}`);
              }
            }, 2000);
          }
        } catch (killError: any) {
          console.log('[stop-listener] Process already terminated:', listenerId);
        }
        
        // Remove from activeScans AND activeScansTTL
        if (unregisterScan) {
          unregisterScan(listenerId, process);
        } else if (activeScans.get(listenerId) === process) {
          activeScans.delete(listenerId);
        }
        
        // Cleanup terminal history in the same startup promise used by the PTY.
        // This prevents Stop -> Start from opening a new history stream while
        // the old stream is still being initialized/closed.
        const cleanupHistory = historyCleanupHandlers.get(listenerId);
        if (cleanupHistory) {
          await cleanupHistory();
        } else {
          await getTerminalHistoryService()
            .then(service => service?.close ? service.close(listenerId) : service?.cleanup?.(listenerId))
            .catch(() => {});
        }
        
        return { success: true };
      }
      return { success: true, message: 'Listener not found (already stopped)' };
    } catch (error: any) {
      console.error('[stop-listener] Error:', error);
      return { success: true, message: 'Cleanup completed with warnings' };
    }
  });

  // Write to listener (fire and forget for zero-latency)
  registerIPCListener('write-to-listener', async (_event, args: { listenerId: string; data: string }) => {
    const { listenerId, data } = args;
    
    // FIX: Route MSF console input directly to msfPtyManager
    // No script wrapper, no duplicate PTY - just forward to the managed instance
    if (listenerId === 'msf-console-persistent') {
      try {
        const { msfPtyManager } = await import('../msf-pty-manager');
        // Keep this compatibility path lossless as well. The manager owns the
        // shared initialization promise and input queue, so concurrent writes
        // cannot disappear while the console is becoming ready.
        await msfPtyManager.writeInput(data);
      } catch (error: any) {
        console.error('[write-to-listener] MSF error:', error);
      }
      return;
    }
    
    // Regular PTY input
    const ptyProc = activeScans.get(listenerId);
    
    if (ptyProc && 'write' in ptyProc) {
      try {
        updateScanActivity(listenerId);
        ptyProc.write(data);
      } catch (error: any) {
        console.error('[write-to-listener] Error:', error);
      }
    }
  });

  // Send command to terminal
  registerIPCListener('send-to-terminal', (_event, command: string) => {
    console.log('[send-to-terminal] Received command:', command);
    // This is handled by the renderer - just log for debugging
  });

  // Resize terminal PTY
  registerIPCHandler('resize-terminal', async (_event, args: { sessionId: string; cols: number; rows: number }) => {
    const { sessionId, cols, rows } = args;
    
    // Route MSF console resize to hybrid PTY manager
    if (sessionId === 'msf-console-persistent') {
      try {
        const { msfPtyManager } = await import('../msf-pty-manager');
        if (msfPtyManager.isReady()) {
          msfPtyManager.resize(cols, rows);
        }
        return { success: true };
      } catch (error: any) {
        console.error('[resize-terminal] MSF console error:', error);
        return { success: false, error: error.message };
      }
    }
    
    // Regular PTY resize
    const process = activeScans.get(sessionId);
    
    if (process && 'resize' in process) {
      try {
        process.resize(cols, rows);
        return { success: true };
      } catch (error: any) {
        const message = error?.message || String(error);
        if (/already exited|cannot resize|closed|not found/i.test(message)) {
          console.debug(`[resize-terminal] Ignored resize for exited PTY: ${sessionId}`);
        } else {
          console.warn('[resize-terminal] Error:', error);
        }
        return { success: false, error: message };
      }
    }
    return { success: false, error: 'Terminal not found' };
  });

  // SESSION RESTORE: Restore terminal state (working directory, env vars)
  registerIPCHandler('restore-terminal-state', async (_event, args: {
    sessionId: string;
    workingDirectory?: string;
    envVars?: Record<string, string>;
  }) => {
    const { sessionId, workingDirectory, envVars } = args;
    
    try {
      const ptyProcess = activeScans.get(sessionId);
      
      if (!ptyProcess || !('write' in ptyProcess)) {
        return { success: false, error: 'PTY not found or not ready' };
      }
      
      // Change directory silently (no echo to terminal). Use literal single
      // quoting for both shell families so spaces, quotes, and shell
      // metacharacters in a restored path remain data.
      if (workingDirectory && workingDirectory !== '~') {
        if (typeof workingDirectory !== 'string'
          || workingDirectory.length > 4096
          || /[\u0000-\u001f\u007f]/.test(workingDirectory)) {
          return { success: false, error: 'Invalid working directory' };
        }

        const isPowerShell = envVars?.SHELL_TYPE === 'powershell';
        if (isPowerShell) {
          const quotedPath = `'${workingDirectory.replace(/'/g, "''")}'`;
          ptyProcess.write(`Set-Location -LiteralPath ${quotedPath} 2>$null\n`);
        } else {
          const quotedPath = `'${workingDirectory.replace(/'/g, "'\\''")}'`;
          ptyProcess.write(`cd -- ${quotedPath} 2>/dev/null\n`);
        }

        console.log(`[restore-terminal-state] Restored working directory: ${workingDirectory}`);
      }
      
      return { success: true };
    } catch (error: any) {
      console.error('[restore-terminal-state] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Terminal history handlers
  registerIPCHandler('terminal-history-get-recent', async (_event, args: { ptyId: string; count?: number }) => {
    try {
      await flushPendingHistory([args.ptyId]);
      const service = await getTerminalHistoryService();
      if (!service) throw new Error('Terminal history is unavailable');
      const lines = await service.getRecentLines(args.ptyId, normalizeHistoryCount(args.count));
      return { success: true, lines };
    } catch (error: any) {
      return { success: false, lines: [], error: error.message };
    }
  });

  registerIPCHandler('terminal-history-load-older', async (_event, args: { ptyId: string; fromLine: number; count: number }) => {
    try {
      await flushPendingHistory([args.ptyId]);
      const service = await getTerminalHistoryService();
      if (!service) throw new Error('Terminal history is unavailable');
      const lines = await service.loadOlderLines(
        args.ptyId,
        normalizeHistoryLine(args.fromLine),
        normalizeHistoryCount(args.count),
      );
      return { success: true, lines };
    } catch (error: any) {
      return { success: false, lines: [], error: error.message };
    }
  });

  registerIPCHandler('terminal-history-search', async (_event, args: { ptyId: string; query: string; caseSensitive?: boolean }) => {
    try {
      await flushPendingHistory([args.ptyId]);
      const service = await getTerminalHistoryService();
      if (!service) throw new Error('Terminal history is unavailable');
      const results = await service.search(args.ptyId, args.query, args.caseSensitive);
      return { success: true, results };
    } catch (error: any) {
      return { success: false, results: [], error: error.message };
    }
  });

  registerIPCHandler('terminal-history-get-total-lines', async (_event, args: { ptyId: string }) => {
    try {
      await flushPendingHistory([args.ptyId]);
      const service = await getTerminalHistoryService();
      if (!service) throw new Error('Terminal history is unavailable');
      const totalLines = await service.getTotalLines(args.ptyId);
      return { success: true, totalLines };
    } catch (error: any) {
      return { success: false, totalLines: 0, error: error.message };
    }
  });

  registerIPCHandler('terminal-history-get-stats', async (_event, args: { ptyId: string }) => {
    try {
      await flushPendingHistory([args.ptyId]);
      const service = await getTerminalHistoryService();
      if (!service) throw new Error('Terminal history is unavailable');
      // Stats are also used by SessionManager as the durability boundary.
      // Initialize first so an idle/restarted terminal cannot report null and
      // get saved without its disk-backed transcript being checked.
      await service.initHistory(args.ptyId);
      const stats = await service.getStats(args.ptyId);
      return { success: true, stats };
    } catch (error: any) {
      return { success: false, stats: null, error: error.message };
    }
  });

  registerIPCHandler('terminal-history-get-tail', async (_event, args: { ptyId: string; maxBytes?: number }) => {
    try {
      await flushPendingHistory([args.ptyId]);
      const service = await getTerminalHistoryService();
      if (!service) throw new Error('Terminal history is unavailable');
      const maxBytes = Math.max(
        1,
        Math.min(16 * 1024 * 1024, Math.floor(Number(args?.maxBytes) || 4 * 1024 * 1024)),
      );
      const tail = await service.getTail(args.ptyId, maxBytes);
      return { success: true, ...tail };
    } catch (error: any) {
      return { success: false, data: '', totalBytes: 0, truncated: false, error: error.message };
    }
  });

  registerIPCHandler('terminal-history-export', async (
    _event,
    args: { ptyIds: string[]; suggestedName?: string },
  ) => {
    try {
      if (!Array.isArray(args?.ptyIds) || args.ptyIds.length === 0) {
        return { success: false, error: 'No terminal sessions selected' };
      }

      await flushPendingHistory(args.ptyIds);
      const service = await getTerminalHistoryService();
      if (!service) return { success: false, error: 'Terminal history is unavailable' };
      const mainWindow = getMainWindow();
      const suggestedBase = typeof args.suggestedName === 'string'
        ? args.suggestedName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
        : '';
      const defaultPath = (suggestedBase || 'osecbox-terminal-export') + '-' + Date.now() + '.txt';
      const options = {
        title: 'Export terminal transcript',
        defaultPath,
        filters: [
          { name: 'Text files', extensions: ['txt', 'log'] },
          { name: 'All files', extensions: ['*'] },
        ],
      };
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      const exported = await service.exportToFile(args.ptyIds.slice(0, 50), result.filePath);
      return { success: true, path: result.filePath, bytes: exported.bytes };
    } catch (error: any) {
      console.error('[terminal-history-export] Error:', error);
      return { success: false, error: error.message || 'Failed to export terminal history' };
    }
  });

  registerIPCHandler('terminal-history-clear', async (_event, args: { ptyId: string }) => {
    try {
      if (!args?.ptyId || typeof args.ptyId !== 'string') {
        return { success: false, error: 'Invalid terminal ID' };
      }
      await flushPendingHistory([args.ptyId]);
      const service = await getTerminalHistoryService();
      if (!service) throw new Error('Terminal history is unavailable');
      await service.clear(args.ptyId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to clear terminal history' };
    }
  });

  registerIPCHandler('terminal-history-append', async (_event, args: { ptyId: string; data: string }) => {
    try {
      if (
        !args ||
        typeof args.ptyId !== 'string' ||
        args.ptyId.length > 512 ||
        typeof args.data !== 'string' ||
        args.data.length > 4 * 1024 * 1024
      ) {
        return { success: false, error: 'Invalid terminal history append' };
      }
      const service = await getTerminalHistoryService();
      if (!service) throw new Error('Terminal history is unavailable');
      await service.appendOutput(args.ptyId, args.data);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to append terminal history' };
    }
  });
}
