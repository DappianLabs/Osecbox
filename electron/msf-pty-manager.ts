/**
 * Metasploit PTY Manager - Hybrid Approach
 * Uses node-pty for real terminal + state parsing for UI features
 */

import type * as pty from 'node-pty';
import type { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { platformService } from './platform-service';
import { settingsService } from './services/settings-service';
import { loadPTY } from './lazy-pty';
import { buildWslPath, shellQuotePathSegment } from './utils/wsl-path';

export interface MsfConsoleState {
  isReady: boolean;
  currentModule: string | null;
  currentContext: 'main' | 'module' | 'session' | 'auxiliary';
  activeSessionId: number | null;
  moduleOptions: Record<string, any>;
  sessions: MsfSession[];
  jobs: MsfJob[];
  prompt: string;
  lastCommand: string;
  commandHistory: string[];
}

export interface MsfSession {
  id: number;
  type: 'meterpreter' | 'shell' | 'unknown';
  info: string;
  tunnel: string;
  via: string;
  uuid: string;
  machineId: string;
  checkedIn: string;
  platform: string;
  arch: string;
  user: string;
  computer: string;
}

export interface MsfJob {
  id: number;
  name: string;
  payload: string;
  lhost: string;
  lport: number;
  uripath: string;
  started: string;
}

export class MsfPtyManager extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private isInitialized = false;
  private initializationFailed = false;
  private initializationPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  private processExited = false;
  private lastInitializationError: Error | null = null;
  private pendingInput: string[] = [];
  private pendingInputBytes = 0;
  private readonly MAX_PENDING_INPUT_BYTES = 64 * 1024;
  // Electron delivers terminal keystrokes through fire-and-forget IPC. Keep
  // the manager-side writes serialized so an async IPC handler/import cannot
  // let Enter overtake the last printable character of a command line.
  private inputDispatchChain: Promise<void> = Promise.resolve();
  // Keep normal keystrokes out of a command's streaming output. MSF uses a
  // real readline PTY, so Ctrl+C must still pass through immediately, while a
  // command typed before the next prompt must wait for that prompt instead of
  // being echoed into the middle of the previous command's output.
  private deferredInput = '';
  private deferredInputBytes = 0;
  private readonly MAX_DEFERRED_INPUT_BYTES = 64 * 1024;
  private promptReadyForInput = false;
  private commandInFlight = false;
  private inputLineActive = false;
  private promptReadinessTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDisplayPrompt = '';
  private displayPromptTimer: ReturnType<typeof setTimeout> | null = null;
  private historyAppendChain: Promise<void> = Promise.resolve();
  private historyGeneration = 0;
  private readonly PROMPT_SETTLE_DELAY_MS = 80;
  private mainWindow: BrowserWindow | null = null;
  private readonly TERMINAL_SESSION_ID = 'msf-console-persistent';
  
  // State tracking (parsed from output)
  private state: MsfConsoleState = {
    isReady: false,
    currentModule: null,
    currentContext: 'main',
    activeSessionId: null,
    moduleOptions: {},
    sessions: [],
    jobs: [],
    prompt: 'msf6 >',
    lastCommand: '',
    commandHistory: []
  };
  
  // Output buffer for state parsing (separate from terminal display)
  private stateParsingBuffer = '';
  // Bounded renderer-recovery view. The durable terminal-history service owns
  // the complete MSF transcript; this buffer is only a fast fallback for a
  // renderer remount and must never be treated as the full evidence store.
  private terminalOutputBuffer = '';
  private readonly MAX_TERMINAL_OUTPUT_BUFFER = 2 * 1024 * 1024;
  
  // Prompt patterns
  private readonly PROMPTS = {
    MAIN: /^msf(?:\d+)?\s*>\s*$/,
    MODULE: /^msf(?:\d+)?\s+(?:exploit|auxiliary|post|payload)\([^)]+\)\s*>\s*$/,
    SESSION: /^(?:meterpreter|shell)\s*>\s*$/,
  };

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized && this.ptyProcess && !this.processExited) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // A failed WSL boot or a temporarily unavailable tool must not brick the
    // console for the rest of the app lifetime. The shared promise above still
    // serializes concurrent callers; a later activation can make a fresh,
    // evidence-based attempt without requiring a full Electron restart.
    if (this.initializationFailed) {
      console.log('[MsfPtyManager] Retrying after previous initialization failure');
      this.initializationFailed = false;
      this.lastInitializationError = null;
    }

    const generation = ++this.lifecycleGeneration;
    const initialization = this.initializeInternal(generation);
    this.initializationPromise = initialization;

    try {
      await initialization;
    } finally {
      if (this.initializationPromise === initialization) {
        this.initializationPromise = null;
      }
    }
  }

  private async initializeInternal(generation: number): Promise<void> {
    console.log('[MsfPtyManager] Starting initialization...');

    try {
      // Loading node-pty is independent of settings, platform detection, and
      // tool resolution. Start it immediately so the WSL/tool checks do not
      // sit in front of the PTY module on the first console open.
      const ptyModulePromise = loadPTY();

      // A process that exited may have left an old prompt in the parser. A new
      // generation must wait for its own PTY output, never stale history.
      this.stateParsingBuffer = '';
      this.processExited = false;
      this.resetInputFlow();

      // Settings are loaded asynchronously during Electron startup. Waiting here
      // prevents the first console open from racing the settings service and
      // using a stale/hard-coded path.
      await settingsService.waitUntilReady();
      const config = settingsService.getToolConfig('msfconsole');
      const configuredPath = String(config?.path || 'msfconsole').trim() || 'msfconsole';
      const usesPortableDefault = /^(?:msfconsole|msfconsole\.exe)$/i.test(configuredPath);

      // Resolve the executable in the same environment that will run it. The
      // old implementation used `wsl which msfconsole`, which ignored the
      // selected distro/user and could report a false positive or false
      // negative on another machine.
      const availability = await platformService.checkToolAvailability('msfconsole', true);
      const strategy = await platformService.getExecutionStrategy(true);
      let toolPath = configuredPath;

      if (usesPortableDefault) {
        if (!availability.available) {
          const environment = strategy.shouldUseWSL ? 'the selected WSL distribution' : 'this system';
          throw new Error(`msfconsole was not found in ${environment}. Install Metasploit or configure its path in Settings.`);
        }
        toolPath = availability.path || configuredPath;
      } else if (strategy.shouldUseWSL && /^[A-Za-z]:[\\/]/.test(toolPath)) {
        throw new Error('The configured msfconsole path is a Windows path, but Metasploit is running through WSL. Configure a Linux path or use the portable msfconsole setting.');
      }

      // History is auxiliary to prompt readiness. Initialize it in parallel so
      // disk recovery/manifest work never delays the interactive console. The
      // history service serializes a first append behind this same init promise,
      // so output cannot be lost or reordered while the chunk is opening.
      void import('./terminal-history-service')
        .then(({ terminalHistoryService }) => terminalHistoryService.initHistory(this.TERMINAL_SESSION_ID))
        .catch(error => {
          console.warn('[MsfPtyManager] Failed to init history:', error);
        });

      let spawnCommand: string;
      let spawnArgs: string[];
      
      if (strategy.shouldUseWSL) {
        // WSL receives one command string after `bash -c`; keep the executable
        // and arguments together and quote the path so spaces are supported.
        const settings = settingsService.getSettings();
        const pathSetup = `export PATH=${buildWslPath(settings.wsl2ExtraPaths || [])}; `;
        const fullCommand = `${pathSetup}exec ${shellQuotePathSegment(toolPath)} -q`;

        // Use an interactive login shell so readline and the MSF prompt work
        // consistently in WSL. The command itself remains one structured arg.
        const prefix = [...strategy.commandPrefix];
        const bashIdx = prefix.indexOf('bash');
        if (bashIdx !== -1 && prefix[bashIdx + 1] === '-c') {
          prefix[bashIdx + 1] = '-lic';
        }

        spawnCommand = prefix[0];
        spawnArgs = [...prefix.slice(1), fullCommand];
      } else if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(toolPath)) {
        // A native Windows installation may expose a .cmd/.bat launcher. node-
        // pty cannot execute those launchers directly on every Windows version.
        spawnCommand = process.env.ComSpec || 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', `"${toolPath}" -q`];
      } else {
        // Native Linux/macOS (or a native Windows executable): execute the
        // detected/configured command directly.
        spawnCommand = toolPath;
        spawnArgs = ['-q'];
      }

      console.log('[MsfPtyManager] Spawning PTY:', spawnCommand, spawnArgs);

      const ptyModule = await ptyModulePromise;

      // FIX #1: Start with standard terminal dimensions (will be resized by xterm)
      // Don't hardcode 120x30 — let the terminal component control dimensions
      // Spawn PTY process
      const spawnedProcess = ptyModule.spawn(spawnCommand, spawnArgs, {
        name: 'xterm-256color',
        cols: 80,  // Standard width (will be updated on first fit)
        rows: 24,  // Standard height
        // The WSL strategy uses `--cd ~`, while node-pty still needs a valid
        // Windows cwd for the wsl.exe shim. Use the same user-home contract as
        // every other terminal instead of inheriting the packaged app cwd.
        cwd: strategy.homeDir || process.cwd(),
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLUMNS: '80',
          LINES: '24',
          TMOUT: '0',
        } as any,
      });

      // A restart can happen while the previous spawn is still unwinding. Do
      // not let stale output/exit callbacks mutate the new console instance.
      if (generation !== this.lifecycleGeneration) {
        try { spawnedProcess.kill(); } catch { /* process is already gone */ }
        return;
      }

      this.ptyProcess = spawnedProcess;
      this.processExited = false;

      // Setup data handler
      spawnedProcess.onData((data) => {
        if (this.ptyProcess !== spawnedProcess || generation !== this.lifecycleGeneration) return;
        this.handleOutput(data);
      });

      // Setup exit handler
      spawnedProcess.onExit((exitCode) => {
        if (this.ptyProcess !== spawnedProcess || generation !== this.lifecycleGeneration) return;
        console.log('[MsfPtyManager] Process exited:', exitCode.exitCode);
        this.handleExit(exitCode.exitCode || 0);
      });

      // Wait for initial prompt
      await this.waitForReady(30000, generation);

      if (generation !== this.lifecycleGeneration || this.ptyProcess !== spawnedProcess) {
        return;
      }
      
      this.isInitialized = true;
      this.state.isReady = true;
      this.initializationFailed = false;
      this.lastInitializationError = null;
      
      console.log('[MsfPtyManager] Initialization complete');
      this.emit('ready', this.state);
      this.flushPendingInput();

    } catch (error) {
      if (generation !== this.lifecycleGeneration) {
        return;
      }

      console.error('[MsfPtyManager] Initialization failed:', error);
      this.initializationFailed = true;
      this.lastInitializationError = error instanceof Error ? error : new Error(String(error));
      this.isInitialized = false;
      this.state.isReady = false;
      this.destroyProcess();
      this.clearPendingInput();
      throw this.lastInitializationError;
    }
  }

  private async handleOutput(data: string): Promise<void> {
    if (!data) return;

    // node-pty has already decoded this event into a JavaScript string. Do not
    // inspect UTF-8 lead bytes here: a character such as `é` has code point
    // 0xE9 and the old heuristic dropped it from the visible transcript.
    // Likewise, banners are real terminal output and must remain available to
    // a pentester and to export. State parsing normalizes its own copy below.

    // Add to state parsing buffer
    this.stateParsingBuffer += data;

    // A prompt is the synchronization boundary for interactive MSF input.
    // If the user typed while a command was still streaming, release only the
    // first queued line now; additional queued lines wait for their own prompt.
    this.updatePromptReadiness(data);
    
    // Keep the state parser on the raw PTY stream, but serialize what reaches
    // xterm/history. MSF can emit a prompt in the middle of a PTY burst and
    // then flush more table rows. Holding exact prompt lines until the stream
    // settles keeps the visible transcript in the same order a user expects:
    // command output first, prompt after the completed output.
    this.queueDisplayOutput(data);
    
    // Parse state from output (async, doesn't block terminal)
    this.parseStateFromOutput();
  }

  private queueDisplayOutput(data: string): void {
    const promptRegex = this.createPromptRegex('gi');
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = promptRegex.exec(data)) !== null) {
      // Group 1 is the line separator which makes the match line-aware. Keep
      // that separator in the preceding output and delay only the prompt
      // itself. This also works when the prompt is embedded in one large
      // node-pty data event rather than arriving as the final token.
      const promptStart = match.index + match[1].length + match[2].length;
      const promptEnd = match.index + match[0].length;
      if (promptStart < cursor) continue;

      this.publishDisplayOutput(data.slice(cursor, promptStart));
      this.pendingDisplayPrompt = data.slice(promptStart, promptEnd);
      cursor = promptEnd;
    }

    // Bytes after a prompt candidate are deliberately published before the
    // delayed prompt. If this was only a redraw boundary, the prompt now lands
    // after the rows that followed it instead of between those rows.
    this.publishDisplayOutput(data.slice(cursor));

    if (this.pendingDisplayPrompt) {
      this.scheduleDisplayPromptFlush();
    }
  }

  private publishDisplayOutput(data: string): void {
    if (!data) return;

    this.terminalOutputBuffer += data;
    if (this.terminalOutputBuffer.length > this.MAX_TERMINAL_OUTPUT_BUFFER) {
      this.terminalOutputBuffer = this.terminalOutputBuffer.slice(-this.MAX_TERMINAL_OUTPUT_BUFFER);
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('listener-output', {
        listenerId: this.TERMINAL_SESSION_ID,
        data,
        type: 'stdout',
      });
    }

    // Preserve display order in durable history as well. The promise chain is
    // intentionally fire-and-forget so disk I/O never blocks PTY rendering.
    const historyGeneration = this.historyGeneration;
    this.historyAppendChain = this.historyAppendChain
      .catch(() => undefined)
      .then(async () => {
        if (historyGeneration !== this.historyGeneration) return;
        try {
          const { terminalHistoryService } = await import('./terminal-history-service');
          if (historyGeneration !== this.historyGeneration) return;
          await terminalHistoryService.appendOutput(this.TERMINAL_SESSION_ID, data);
        } catch {
          // History is auxiliary to the live PTY; retain the terminal if disk
          // persistence is temporarily unavailable.
        }
      });

    this.emit('output', data);
  }

  private scheduleDisplayPromptFlush(): void {
    if (this.displayPromptTimer) {
      clearTimeout(this.displayPromptTimer);
    }

    this.displayPromptTimer = setTimeout(() => {
      this.displayPromptTimer = null;
      this.flushPendingDisplayPrompt();
    }, this.PROMPT_SETTLE_DELAY_MS);
  }

  private flushPendingDisplayPrompt(): void {
    if (this.displayPromptTimer) {
      clearTimeout(this.displayPromptTimer);
      this.displayPromptTimer = null;
    }

    const prompt = this.pendingDisplayPrompt;
    this.pendingDisplayPrompt = '';
    if (prompt) {
      this.publishDisplayOutput(prompt);
    }
  }

  private createPromptRegex(flags: string): RegExp {
    // A prompt is recognized only as a complete line. A search result such as
    // "msf > time ..." therefore remains ordinary output and is never removed
    // or rewritten. The look-ahead is important because the regex is global
    // and must not match the prompt prefix of a longer help line.
    const ansi = '\\x1b(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\x07]*(?:\\x07|\\x1b\\\\))';
    const sgr = '\\x1b\\[[0-9;?]*m';
    const styled = `(?:${sgr})*`;
    // msfconsole commonly emits readline styling between the literal prompt
    // characters (for example: ESC[4mmsfESC[0m ESC[0m>). Treat those escapes
    // as formatting, not as bytes that change the prompt grammar.
    const prompt = `(?:${styled}msf${styled}(?:\\d+)?${styled}(?:[ \\t]+${styled}(?:exploit|auxiliary|post|payload)${styled}\\([^)]*\\))?${styled}[ \\t]*${styled}>|${styled}(?:meterpreter|shell)${styled}[ \\t]*${styled}>)`;
    return new RegExp(
      `(^|[\\r\\n])((?:(?!${sgr})${ansi})*)(${prompt}[ \\t]*(?:${ansi})*(?:\\r?\\n)?)(?=$|[\\r\\n])`,
      flags,
    );
  }

  private parseStateFromOutput(): void {
    const output = this.stateParsingBuffer;
    
    // Detect current context from prompt
    const lines = this.normalizePromptText(output)
      .split('\n')
      .map(line => line.trim());
    const lastLine = lines[lines.length - 1];
    const lastPromptLine = [...lines].reverse().find(line =>
      this.PROMPTS.MODULE.test(line) ||
      this.PROMPTS.SESSION.test(line) ||
      this.PROMPTS.MAIN.test(line)
    );
    const currentLine = lastPromptLine || lastLine;
    
    if (this.PROMPTS.MODULE.test(currentLine)) {
      this.state.currentContext = 'module';
      this.state.prompt = currentLine;
      
      const moduleMatch = currentLine.match(/(?:exploit|auxiliary|post|payload)\(([^)]+)\)/);
      if (moduleMatch) {
        this.state.currentModule = moduleMatch[1];
      }
    } else if (this.PROMPTS.SESSION.test(currentLine)) {
      this.state.currentContext = 'session';
      this.state.prompt = currentLine;
    } else if (this.PROMPTS.MAIN.test(currentLine)) {
      this.state.currentContext = 'main';
      this.state.currentModule = null;
      this.state.activeSessionId = null;
      this.state.prompt = currentLine;
    }
    
    // Parse sessions if present
    if (output.includes('Active sessions')) {
      this.parseSessions(output);
    }
    
    // Parse jobs if present
    if (output.includes('Jobs')) {
      this.parseJobs(output);
    }
    
    // Emit state change
    this.emit('stateChange', this.state);
    
    // Keep buffer manageable (last 10KB)
    if (this.stateParsingBuffer.length > 10000) {
      this.stateParsingBuffer = this.stateParsingBuffer.slice(-10000);
    }
  }

  private parseSessions(output: string): void {
    const sessions: MsfSession[] = [];
    const lines = output.split('\n');
    let inSessionsSection = false;

    for (const line of lines) {
      if (line.includes('Active sessions')) {
        inSessionsSection = true;
        continue;
      }

      if (inSessionsSection && line.includes('===')) {
        continue;
      }

      if (inSessionsSection && line.trim()) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && !isNaN(parseInt(parts[0]))) {
          sessions.push({
            id: parseInt(parts[0]),
            type: parts[1].toLowerCase().includes('meterpreter') ? 'meterpreter' : 'shell',
            info: parts.slice(2, -1).join(' '),
            tunnel: parts[parts.length - 1],
            via: '',
            uuid: '',
            machineId: '',
            checkedIn: new Date().toISOString(),
            platform: parts[2] || 'unknown',
            arch: parts[3] || 'unknown',
            user: '',
            computer: ''
          });
        }
      }

      if (inSessionsSection && line.trim() === '') {
        break;
      }
    }

    this.state.sessions = sessions;
  }

  private parseJobs(output: string): void {
    const jobs: MsfJob[] = [];
    const lines = output.split('\n');
    let inJobsSection = false;

    for (const line of lines) {
      if (line.includes('Jobs')) {
        inJobsSection = true;
        continue;
      }

      if (inJobsSection && line.includes('===')) {
        continue;
      }

      if (inJobsSection && line.trim()) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
          jobs.push({
            id: parseInt(parts[0]),
            name: parts.slice(1).join(' '),
            payload: '',
            lhost: '',
            lport: 0,
            uripath: '',
            started: new Date().toISOString()
          });
        }
      }

      if (inJobsSection && line.trim() === '') {
        break;
      }
    }

    this.state.jobs = jobs;
  }

  private async waitForReady(timeout: number, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();

      const checkReady = () => {
        if (generation !== this.lifecycleGeneration) {
          reject(new Error('Metasploit console initialization cancelled'));
          return;
        }

        if (this.processExited || !this.ptyProcess) {
          reject(new Error('Metasploit console exited before its prompt was ready'));
          return;
        }

        if (this.hasPromptLine(this.stateParsingBuffer)) {
          // Initialization has already waited for a prompt boundary. Do not
          // make early keystrokes wait for the renderer settle timer as well.
          this.clearPromptReadinessTimer();
          this.promptReadyForInput = true;
          this.commandInFlight = false;
          this.inputLineActive = false;
          resolve();
          return;
        }

        if (Date.now() - startedAt >= timeout) {
          reject(new Error('Timeout waiting for msfconsole prompt'));
          return;
        }

        setTimeout(checkReady, 100);
      };

      checkReady();
    });
  }

  private handleExit(code: number): void {
    console.log('[MsfPtyManager] Process exited with code:', code);
    this.flushPendingDisplayPrompt();
    this.processExited = true;
    this.ptyProcess = null;
    this.isInitialized = false;
    this.state.isReady = false;
    this.stateParsingBuffer = '';
    this.resetInputFlow();
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('listener-closed', {
        listenerId: this.TERMINAL_SESSION_ID,
        code: code
      });
    }
    
    this.emit('close', code);
  }

  // Public API
  async writeInput(data: string): Promise<void> {
    if (!data) return;

    const dispatch = this.inputDispatchChain.then(() => this.writeInputNow(data));
    this.inputDispatchChain = dispatch.catch(() => undefined);
    return dispatch;
  }

  private async writeInputNow(data: string): Promise<void> {
    if (!data) return;

    // A real input event is the definitive evidence that the user needs the
    // current prompt before their characters are echoed by the PTY.
    this.flushPendingDisplayPrompt();

    if (this.ptyProcess && this.isInitialized && this.state.isReady && !this.processExited) {
      this.acceptInteractiveInput(data);
      return;
    }

    // Do not drop keystrokes while the initial prompt is being negotiated.
    // This is especially important for xterm: the user can type immediately
    // after the tab appears, before msfconsole has finished loading modules.
    this.enqueueInput(data);

    try {
      await this.initialize();
      this.flushPendingInput();
    } catch (error) {
      this.clearPendingInput();
      throw error;
    }
  }

  private writeToProcess(data: string): void {
    if (!this.ptyProcess || this.processExited) return;

    this.ptyProcess.write(data);

    // Track command history only after the input has reached the live PTY.
    if (data.includes('\n') || data.includes('\r')) {
      const cmd = data.trim();
      if (cmd) {
        this.state.commandHistory.push(cmd);
        this.state.lastCommand = cmd;
      }
    }
  }

  private isImmediateControlInput(data: string): boolean {
    // Interrupt/EOF/suspend must never wait for a command prompt. This keeps a
    // long-running search or exploit cancellable even while normal text is
    // being held behind the prompt boundary.
    return /[\x03\x04\x1a]/.test(data);
  }

  private acceptInteractiveInput(data: string): void {
    if (!this.ptyProcess || this.processExited) return;

    const isInterrupt = this.isImmediateControlInput(data);
    const canWriteCurrentLine = this.promptReadyForInput || this.inputLineActive;

    if (this.commandInFlight || (!canWriteCurrentLine && !isInterrupt)) {
      if (isInterrupt) {
        // A user interrupt cancels text that was waiting for the old command;
        // otherwise that stale text would unexpectedly run at the next prompt.
        this.clearDeferredInput();
        this.promptReadyForInput = false;
        this.commandInFlight = true;
        this.inputLineActive = false;
        this.writeToProcess(data);
      } else {
        this.deferInput(data);
      }
      return;
    }

    this.clearPromptReadinessTimer();
    this.writeToProcess(data);
    this.updateInputFlow(data);
  }

  private deferInput(data: string): void {
    const bytes = Buffer.byteLength(data, 'utf8');
    if (bytes > this.MAX_DEFERRED_INPUT_BYTES || this.deferredInputBytes + bytes > this.MAX_DEFERRED_INPUT_BYTES) {
      throw new Error('Metasploit input is too large while the current command is running');
    }

    this.deferredInput += data;
    this.deferredInputBytes += bytes;
  }

  private clearDeferredInput(): void {
    this.deferredInput = '';
    this.deferredInputBytes = 0;
  }

  private resetInputFlow(): void {
    this.clearPromptReadinessTimer();
    this.clearDeferredInput();
    this.promptReadyForInput = false;
    this.commandInFlight = false;
    this.inputLineActive = false;
  }

  private updateInputFlow(data: string): void {
    if (!data) return;

    if (this.isImmediateControlInput(data)) {
      this.promptReadyForInput = false;
      this.commandInFlight = true;
      this.inputLineActive = false;
      return;
    }

    if (/[\r\n]/.test(data)) {
      this.promptReadyForInput = false;
      this.commandInFlight = true;
      this.inputLineActive = false;
      return;
    }

    this.promptReadyForInput = false;
    this.inputLineActive = true;
  }

  private updatePromptReadiness(data: string): void {
    const normalized = this.normalizePromptText(this.stateParsingBuffer);
    const lastLine = normalized.split('\n').at(-1)?.trim() || '';
    const promptInChunk = this.createPromptRegex('i').test(data);
    if (!promptInChunk && !this.isPromptLine(lastLine)) {
      // Do not cancel a prompt timer merely because bytes following a real
      // prompt arrived in the same PTY burst. Background job output is legal
      // in MSF and should not permanently lock the input line.
      return;
    }

    if (this.promptReadyForInput && !this.commandInFlight && !this.deferredInput) {
      return;
    }

    // Require a short quiet window after an exact prompt boundary. This avoids
    // releasing queued input on a transient redraw while still recovering when
    // legitimate asynchronous output follows the prompt.
    this.clearPromptReadinessTimer();
    this.promptReadinessTimer = setTimeout(() => {
      this.promptReadinessTimer = null;
      this.promptReadyForInput = true;
      this.commandInFlight = false;
      this.inputLineActive = false;
      this.flushDeferredInput();
    }, this.PROMPT_SETTLE_DELAY_MS);
  }

  private clearPromptReadinessTimer(): void {
    if (this.promptReadinessTimer) {
      clearTimeout(this.promptReadinessTimer);
      this.promptReadinessTimer = null;
    }
  }

  /**
   * Clear only the user-visible MSF transcript. The PTY stays alive and its
   * input state is deliberately preserved, so Clear cannot make the console
   * lose its prompt or drop the next command.
   */
  async clearDisplayOutput(): Promise<void> {
    if (this.displayPromptTimer) {
      clearTimeout(this.displayPromptTimer);
      this.displayPromptTimer = null;
    }
    this.pendingDisplayPrompt = '';
    this.terminalOutputBuffer = '';

    // Prevent output already queued before Clear from being appended to the
    // newly-created durable transcript. The history service's own clear lock
    // handles bytes that arrive concurrently after this boundary.
    this.historyGeneration += 1;
    const historyBeforeClear = this.historyAppendChain.catch(() => undefined);
    this.historyAppendChain = Promise.resolve();
    await historyBeforeClear;
  }

  private flushDeferredInput(): void {
    if (!this.ptyProcess || this.processExited || !this.promptReadyForInput || this.commandInFlight || !this.deferredInput) {
      return;
    }

    // Send one logical line at a time. Sending multiple queued commands in one
    // PTY write would put the next command into MSF before its new prompt and
    // recreates the exact interleaving this gate is intended to prevent.
    const newlineMatch = this.deferredInput.match(/[\r\n]/);
    const end = newlineMatch?.index === undefined
      ? this.deferredInput.length
      : newlineMatch.index + 1;
    const nextInput = this.deferredInput.slice(0, end);
    this.deferredInput = this.deferredInput.slice(end);
    this.deferredInputBytes = Buffer.byteLength(this.deferredInput, 'utf8');

    this.writeToProcess(nextInput);
    this.updateInputFlow(nextInput);
  }

  private normalizePromptText(value: string): string {
    return value
      .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\r/g, '');
  }

  private isPromptLine(line: string): boolean {
    return this.PROMPTS.MODULE.test(line) ||
      this.PROMPTS.SESSION.test(line) ||
      this.PROMPTS.MAIN.test(line);
  }

  private hasPromptLine(value: string): boolean {
    return this.normalizePromptText(value)
      .split('\n')
      .some(line => this.isPromptLine(line.trim()));
  }

  private enqueueInput(data: string): void {
    const bytes = Buffer.byteLength(data, 'utf8');
    if (bytes > this.MAX_PENDING_INPUT_BYTES || this.pendingInputBytes + bytes > this.MAX_PENDING_INPUT_BYTES) {
      throw new Error('Metasploit input is too large while the console is starting');
    }

    this.pendingInput.push(data);
    this.pendingInputBytes += bytes;
  }

  private flushPendingInput(): void {
    if (!this.ptyProcess || !this.isInitialized || !this.state.isReady || this.processExited) return;
    const queued = this.pendingInput.splice(0);
    this.pendingInputBytes = 0;
    queued.forEach(data => this.acceptInteractiveInput(data));
  }

  private clearPendingInput(): void {
    this.pendingInput = [];
    this.pendingInputBytes = 0;
  }

  resize(cols: number, rows: number): void {
    if (this.ptyProcess && !this.processExited) {
      try {
        this.ptyProcess.resize(cols, rows);
      } catch (error: any) {
        const message = error?.message || String(error);
        if (!/already exited|cannot resize|closed|not found/i.test(message)) {
          console.warn('[MsfPtyManager] Resize failed:', error);
        }
      }
    }
  }

  getBufferedOutput(): string {
    // Only return bytes that actually came from the PTY. A synthetic prompt
    // here makes renderer remounts indistinguishable from real console output.
    return this.terminalOutputBuffer;
  }

  getState(): MsfConsoleState {
    return { ...this.state };
  }

  isReady(): boolean {
    return this.isInitialized && this.state.isReady;
  }

  getPty(): pty.IPty | null {
    return this.ptyProcess;
  }

  cleanup(): void {
    console.log('[MsfPtyManager] Cleaning up...');

    this.flushPendingDisplayPrompt();

    // Invalidate callbacks before killing the process so a late exit event
    // cannot close or reset a newly restarted console.
    this.lifecycleGeneration += 1;
    this.destroyProcess();

    this.isInitialized = false;
    this.state.isReady = false;
    this.processExited = false;
    this.initializationFailed = false;
    this.lastInitializationError = null;
    this.clearPendingInput();
    this.resetInputFlow();
    this.stateParsingBuffer = '';
    this.terminalOutputBuffer = '';
    this.historyGeneration += 1;
    this.state.currentModule = null;
    this.state.currentContext = 'main';
    this.state.activeSessionId = null;
    this.state.moduleOptions = {};
    this.state.sessions = [];
    this.state.jobs = [];
    this.state.prompt = 'msf6 >';
    this.state.lastCommand = '';
    this.state.commandHistory = [];
  }

  private destroyProcess(): void {
    const processToKill = this.ptyProcess;
    this.ptyProcess = null;
    if (!processToKill) return;

    try {
      processToKill.kill();
    } catch (error) {
      console.error('[MsfPtyManager] Error killing PTY:', error);
    }
  }

  async restart(): Promise<void> {
    console.log('[MsfPtyManager] Restarting...');
    const inFlightInitialization = this.initializationPromise;
    this.cleanup();
    if (inFlightInitialization) {
      try {
        await inFlightInitialization;
      } catch {
        // The old generation is expected to reject after cleanup.
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    await this.initialize();
  }

  // Legacy command API (for quick commands from UI)
  // These write commands directly to PTY and return immediately
  async sendCommand(command: string): Promise<any> {
    if (!this.isInitialized || !this.state.isReady) {
      throw new Error('MsfConsole not initialized');
    }

    // Use the same readiness-gated input path as interactive typing. Awaiting
    // it also makes quick-command buttons deterministic during a cold WSL
    // start, instead of reporting success while the write is still queued.
    await this.writeInput(command + '\n');
    
    // Return success immediately (output streams to terminal in real-time)
    return {
      success: true,
      output: '', // Output goes to terminal, not returned
      state: this.getState(),
      prompt: this.state.prompt,
      context: this.state.currentContext
    };
  }

  async useModule(modulePath: string): Promise<any> {
    return this.sendCommand(`use ${modulePath}`);
  }

  async setOption(name: string, value: string): Promise<any> {
    return this.sendCommand(`set ${name} ${value}`);
  }

  async showOptions(): Promise<any> {
    return this.sendCommand('show options');
  }

  async exploit(): Promise<any> {
    return this.sendCommand('exploit');
  }

  async run(): Promise<any> {
    return this.sendCommand('run');
  }

  async back(): Promise<any> {
    return this.sendCommand('back');
  }

  async sessions(action?: string, sessionId?: number): Promise<any> {
    let command = 'sessions';
    if (action === 'list') {
      command += ' -l';
    } else if (action === 'interact' && sessionId !== undefined) {
      command += ` -i ${sessionId}`;
    } else if (action === 'kill' && sessionId !== undefined) {
      command += ` -k ${sessionId}`;
    } else if (action === 'killall') {
      command += ' -K';
    }
    return this.sendCommand(command);
  }

  async background(): Promise<any> {
    return this.sendCommand('background');
  }

  async jobs(action?: string, jobId?: number): Promise<any> {
    let command = 'jobs';
    if (action === 'list') {
      command += ' -l';
    } else if (action === 'kill' && jobId !== undefined) {
      command += ` -k ${jobId}`;
    } else if (action === 'killall') {
      command += ' -K';
    }
    return this.sendCommand(command);
  }

  async search(query: string): Promise<any> {
    return this.sendCommand(`search ${query}`);
  }

  async info(modulePath?: string): Promise<any> {
    const command = modulePath ? `info ${modulePath}` : 'info';
    return this.sendCommand(command);
  }

  async refreshSessions(): Promise<void> {
    await this.sendCommand('sessions -l');
  }

  async refreshJobs(): Promise<void> {
    await this.sendCommand('jobs -l');
  }

  async refreshModuleOptions(): Promise<void> {
    if (this.state.currentModule) {
      await this.sendCommand('show options');
    }
  }
}

// Singleton instance
export const msfPtyManager = new MsfPtyManager();
