/**
 * Terminal Service - Orchestrates terminal management components
 * 
 * Clean architecture with separated concerns:
 * - PTYManager: Process lifecycle
 * - TerminalRenderer: xterm.js instances
 * - BufferManager: Output buffering
 * - ScrollManager: Position preservation
 * - IPCHandler: Electron communication
 */

import { logger } from '@/lib/utils/logger';
import { PTYManager, type SessionType, type PTYInstance } from './terminal/pty-manager';
import { TerminalRenderer, type TerminalInstance } from './terminal/terminal-renderer';
import { BufferManager } from './terminal/buffer-manager';
import { ScrollManager } from './terminal/scroll-manager';
import { IPCHandler } from './terminal/ipc-handler';
import { MemoryMonitor } from './terminal/memory-monitor';
import { TerminalErrorHandler, TerminalErrorType } from './terminal/error-handler';
import { redactSensitiveText } from './ai-data-policy';
import { cleanANSIForDisplay } from './utils/ansi-cleaner';

function extractCommandTarget(command: string, tool: string | undefined): string | undefined {
  const flagged = command.match(/(?:^|\s)(?:-h|-u|--url|--target|--domain)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const flaggedTarget = flagged?.[1] || flagged?.[2] || flagged?.[3];
  if (flaggedTarget && !flaggedTarget.startsWith('-')) return flaggedTarget.replace(/[;,]$/, '');

  if (tool?.toLowerCase() === 'nmap') {
    const tokens = command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const candidate = tokens.at(-1)?.replace(/^['"]|['"]$/g, '');
    if (candidate && !candidate.startsWith('-') && !/^nmap(?:\.exe)?$/i.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export interface TerminalEvidenceProvenance {
  sessionId?: string;
  runId?: string;
  target?: string;
  outputOffset?: number;
  generation: number;
}

export type { SessionType, PTYInstance, TerminalInstance };

class TerminalService {
  private ptyManager = new PTYManager((ptyId, sessionType) => {
    if (sessionType === 'metasploit') return;
    if (typeof window !== 'undefined' && window.electron) {
      void this.ipcHandler.stopPTY(ptyId);
    }
  });
  private terminalRenderer = new TerminalRenderer();
  private bufferManager = new BufferManager();
  private scrollManager = new ScrollManager();
  private ipcHandler = new IPCHandler();
  private memoryMonitor = new MemoryMonitor();
  private errorHandler = new TerminalErrorHandler();
  
  // Add missing buffer constants
  private readonly BUFFER_CLEANUP_THRESHOLD = 10000;
  private readonly MAX_BUFFER_LINES = 5000;
  
  // PTY to Terminal mapping
  private ptyToTerminal = new Map<string, string>();
  // External tool processes (for example subdomain enumeration) stream under
  // their own process id rather than a PTY id. Keep routing here, outside the
  // view component, so navigation/unmounting cannot drop their output.
  private externalOutputRoutes = new Map<string, string>();
  private invalidatedExternalOutputIds = new Set<string>();
  private externalOutputRouterCleanup: (() => void) | null = null;
  // Synthetic tool/status output is persisted through IPC. Serialize those
  // calls per terminal so an immediate Save or Clear has a real ordering
  // boundary instead of racing a fire-and-forget append.
  private historyAppendChains = new Map<string, Promise<void>>();
  private terminalTargets = new Map<string, string>();
  private terminalEvidenceProvenance = new Map<string, TerminalEvidenceProvenance>();
  private quarantinedEvidenceTerminals = new Set<string>();
  private evidenceGeneration = 0;
  private attachingPTY = new Set<string>();
  private terminalReleaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private ptyStartPromises = new Map<string, Promise<void>>();
  private closedPTYs = new Set<string>();
  private readonly TERMINAL_RELEASE_DELAY = 30_000;

  // READINESS-GATED INPUT: track PTYs that have emitted their first output
  // (i.e. the shell prompt is up). Auto-entered commands wait for this instead of
  // a fixed timeout — fixes dropped first characters (e.g. "socat" → "ocat") and
  // the lateness/extra-line artifacts from sending before the shell could read.
  private readyPtys = new Set<string>();
  private pendingReadyWrites = new Map<string, Array<{ data: string; timer: ReturnType<typeof setTimeout> | null }>>();

  constructor() {
    this.terminalRenderer.setTerminalEvictionHandler((terminalId) => {
      this.handleRendererEviction(terminalId);
    });

    // Start memory monitoring
    this.memoryMonitor.startMonitoring(
      () => this.getStats(),
      async () => {
        if (typeof window === 'undefined' || !window.electron?.invoke) return null;
        return await window.electron.invoke('get-app-memory');
      },
    );
  }

  /**
   * Detach only an evicted xterm renderer. The PTY, BufferManager tail, and
   * durable history stay alive; a mounted Terminal component receives the
   * event below and recreates the renderer against the same session id.
   */
  private handleRendererEviction(terminalId: string): void {
    let ptyId: string | undefined;

    for (const [candidatePtyId, mappedTerminalId] of this.ptyToTerminal) {
      if (mappedTerminalId === terminalId) {
        ptyId = candidatePtyId;
        break;
      }
    }

    if (ptyId) {
      const pty = this.ptyManager.getPTY(ptyId);
      if (pty) pty.isAttached = false;
      this.ptyToTerminal.delete(ptyId);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('terminal-renderer-evicted', {
        detail: { terminalId, ptyId },
      }));
    }
  }

  async getOrCreateTerminal(terminalId: string, sessionType: SessionType = 'general'): Promise<TerminalInstance> {
    try {
      this.cancelScheduledTerminalRelease(terminalId);
      return await this.terminalRenderer.createTerminal(terminalId, sessionType);
    } catch (error) {
      this.errorHandler.handleError(
        TerminalErrorType.TERMINAL_CREATION_FAILED,
        `Failed to create terminal: ${terminalId}`,
        { terminalId, sessionType },
        error as Error
      );
      throw error;
    }
  }

  /** Warm xterm's shared module promise without creating a renderer instance. */
  preloadTerminalRenderer(): void {
    this.terminalRenderer.preload();
  }

  private ensureExternalOutputRouter(): void {
    if (this.externalOutputRouterCleanup || typeof window === 'undefined' || !window.electron?.onListenerOutput) {
      return;
    }

    this.externalOutputRouterCleanup = window.electron.onListenerOutput((data) => {
      const terminalId = this.externalOutputRoutes.get(data.listenerId);
      if (!terminalId || !data.data) return;
      this.writeExternalOutput(terminalId, data.data);
    });
  }

  /** Route a non-PTY child process into a persistent terminal transcript. */
  registerExternalOutputRoute(processId: string, terminalId: string): void {
    if (!processId || !terminalId) return;
    this.invalidatedExternalOutputIds.delete(processId);
    this.externalOutputRoutes.set(processId, terminalId);
    this.ensureExternalOutputRouter();
  }

  getExternalOutputRoute(processId: string): string | undefined {
    return this.externalOutputRoutes.get(processId);
  }

  isExternalOutputRouteInvalidated(processId: string): boolean {
    return this.invalidatedExternalOutputIds.has(processId);
  }

  unregisterExternalOutputRoute(processId: string): void {
    if (!processId) return;
    this.externalOutputRoutes.delete(processId);
    if (this.externalOutputRoutes.size === 0) {
      this.externalOutputRouterCleanup?.();
      this.externalOutputRouterCleanup = null;
    }
  }

  private unregisterExternalRoutesForTerminal(terminalId: string): void {
    for (const [processId, routedTerminalId] of this.externalOutputRoutes) {
      if (routedTerminalId === terminalId) {
        this.externalOutputRoutes.delete(processId);
      }
    }
    if (this.externalOutputRoutes.size === 0) {
      this.externalOutputRouterCleanup?.();
      this.externalOutputRouterCleanup = null;
    }
  }

  getOrCreatePTY(ptyId: string, sessionType: SessionType = 'general'): PTYInstance {
    try {
      let pty = this.ptyManager.getPTY(ptyId);

      // A shell can exit unexpectedly while its renderer/session remains
      // open. Treat an inactive PTY as stale so the next Start recreates it
      // instead of queueing input into a dead process.
      if (pty && !pty.isActive && !this.ptyStartPromises.has(ptyId)) {
        // A dead process is recoverable session state, not a user-requested
        // destroy. The full destroy path clears BufferManager, which used to
        // make a terminal appear empty when the user returned to a scanner
        // after WSL/bash crashed. Retire only the process/IPC ownership here;
        // keep the bounded transcript for the reattach below.
        this.retireInactivePTYForRecovery(ptyId);
        pty = undefined;
      }
      
      if (!pty) {
        pty = this.ptyManager.createPTY(ptyId, sessionType);
        
        // Persistent Metasploit owns the real PTY in Electron; this renderer
        // entry only bridges output and input to that manager.
        if (sessionType !== 'metasploit') {
          // Start in the background so terminal creation stays responsive, but
          // keep the promise and mark the PTY active only after Electron has
          // successfully created the backend process. Previously a failed WSL
          // spawn still looked active and queued input into a dead shell.
          void this.startPTY(ptyId).catch(error => {
            logger.error('TerminalService', `Failed to start PTY: ${ptyId}`, error);
          });
        } else {
          // For metasploit, just set up event handlers without starting a PTY
          this.setupMetasploitHandlers(ptyId);
        }
      }
      
      return pty;
    } catch (error) {
      this.errorHandler.handleError(
        TerminalErrorType.PTY_CREATION_FAILED,
        `Failed to create PTY: ${ptyId}`,
        { ptyId, sessionType },
        error as Error
      );
      throw error;
    }
  }

  setTerminalTarget(terminalId: string, target: string): void {
    const normalizedTarget = String(target || '').trim();
    if (normalizedTarget) this.terminalTargets.set(terminalId, normalizedTarget);
    else this.terminalTargets.delete(terminalId);
  }

  getTerminalTarget(terminalId: string): string | undefined {
    return this.terminalTargets.get(terminalId);
  }

  /**
   * Bind a reusable terminal to the session/run that owns its next command.
   * Reset command tracking first so a prior run cannot be finalized with this
   * run's mutable target or session metadata.
   */
  setTerminalProvenance(
    terminalId: string,
    provenance: { sessionId?: string; runId?: string; target?: string },
  ): void {
    this.clearCommandTrackingState(terminalId);
    this.quarantinedEvidenceTerminals.delete(terminalId);
    const normalizedTarget = String(provenance.target || '').trim() || undefined;
    this.terminalEvidenceProvenance.set(terminalId, {
      sessionId: provenance.sessionId,
      runId: provenance.runId,
      target: normalizedTarget,
      outputOffset: this.getOutput(terminalId).length,
      generation: this.evidenceGeneration,
    });
    if (normalizedTarget) this.terminalTargets.set(terminalId, normalizedTarget);
    else this.terminalTargets.delete(terminalId);
  }

  /** Mark the exact transcript position at which a run's evidence begins. */
  markTerminalEvidenceStart(terminalId: string): void {
    const provenance = this.terminalEvidenceProvenance.get(terminalId);
    if (!provenance || provenance.generation !== this.evidenceGeneration) return;
    provenance.outputOffset = this.getOutput(terminalId).length;
  }

  /** Read only bytes written after the current immutable run boundary. */
  getOutputSinceProvenance(terminalId: string): string {
    const provenance = this.getTerminalProvenance(terminalId);
    if (!provenance) return '';
    const output = this.getOutput(terminalId);
    const offset = Math.max(0, provenance.outputOffset || 0);
    // A rotated buffer no longer has a trustworthy relationship to the run
    // boundary. Prefer an empty safe tail over presenting prior-run bytes as
    // current evidence.
    return output.length >= offset ? output.slice(offset) : '';
  }

  /** Return immutable ownership for safe active-tail/finalizer checks. */
  getTerminalProvenance(terminalId: string): TerminalEvidenceProvenance | undefined {
    const provenance = this.terminalEvidenceProvenance.get(terminalId);
    if (!provenance || provenance.generation !== this.evidenceGeneration) return undefined;
    return { ...provenance };
  }

  /**
   * Invalidate command ownership without destroying PTYs or terminal history.
   * Session replacement can therefore preserve the terminal/listener UI while
   * preventing old bytes and delayed finalizers from entering the new session.
   */
  invalidateEvidenceProvenance(): void {
    this.evidenceGeneration += 1;
    const ownedTerminals = new Set<string>([
      ...this.ptyToTerminal.keys(),
      ...this.commandBuffers.keys(),
      ...this.cmdTrackPending.keys(),
      ...this.cmdTrackTimers.keys(),
      ...this.processingTimers.keys(),
      ...this.terminalEvidenceProvenance.keys(),
    ]);
    for (const terminalId of ownedTerminals) {
      this.quarantinedEvidenceTerminals.add(terminalId);
    }
    for (const processId of this.externalOutputRoutes.keys()) {
      this.invalidatedExternalOutputIds.add(processId);
    }
    for (const ptyId of new Set([
      ...this.commandBuffers.keys(),
      ...this.cmdTrackPending.keys(),
      ...this.cmdTrackTimers.keys(),
      ...this.processingTimers.keys(),
      ...this.terminalEvidenceProvenance.keys(),
    ])) {
      this.clearCommandTrackingState(ptyId);
    }
    this.terminalEvidenceProvenance.clear();
    this.terminalTargets.clear();
    this.externalOutputRoutes.clear();
    this.externalOutputRouterCleanup?.();
    this.externalOutputRouterCleanup = null;

    // Keep the quarantine bounded across repeated session loads.
    while (this.quarantinedEvidenceTerminals.size > 512) {
      const oldest = this.quarantinedEvidenceTerminals.values().next().value;
      if (!oldest) break;
      this.quarantinedEvidenceTerminals.delete(oldest);
    }
    while (this.invalidatedExternalOutputIds.size > 512) {
      const oldest = this.invalidatedExternalOutputIds.values().next().value;
      if (!oldest) break;
      this.invalidatedExternalOutputIds.delete(oldest);
    }
  }
  
  private setupMetasploitHandlers(ptyId: string): void {
    const pty = this.ptyManager.getPTY(ptyId);
    if (!pty) return;

    // Set up handlers for the persistent Metasploit manager's output events
    this.ipcHandler.setupPTYHandlers(
      pty,
      (data: string) => this.handlePTYOutput(ptyId, data),
      (code: number) => this.handlePTYClosed(ptyId, code),
      (error: string) => this.handlePTYError(ptyId, error)
    );

    // Mark as active so it can receive events
    pty.isActive = true;
    
    logger.debug('TerminalService', `Setup metasploit handlers for: ${ptyId}`);
  }

  async attach(terminalId: string, container: HTMLElement): Promise<void> {
    try {
      this.cancelScheduledTerminalRelease(terminalId);
      const terminal = await this.getOrCreateTerminal(terminalId);
      this.terminalRenderer.attachToContainer(terminalId, container);
      
      // If there's a PTY with the same ID, attach it
      if (this.ptyManager.hasPTY(terminalId)) {
        this.attachPTY(terminalId, terminalId);
      }
    } catch (error) {
      this.errorHandler.handleError(
        TerminalErrorType.ATTACH_FAILED,
        `Failed to attach terminal: ${terminalId}`,
        { terminalId },
        error as Error
      );
      throw error;
    }
  }

  private startPTY(ptyId: string): Promise<void> {
    const pty = this.ptyManager.getPTY(ptyId);
    if (!pty) return Promise.resolve();

    const existingStart = this.ptyStartPromises.get(ptyId);
    if (existingStart) return existingStart;

    this.closedPTYs.delete(ptyId);

    if (pty.outputCleanup || pty.closedCleanup || pty.errorCleanup) {
      logger.warn('TerminalService', `PTY handlers already exist for: ${ptyId}, cleaning up first`);
      this.ipcHandler.cleanupHandlers(ptyId);
    }

    this.ipcHandler.setupPTYHandlers(
      pty,
      (data: string) => this.handlePTYOutput(ptyId, data),
      (code: number) => this.handlePTYClosed(ptyId, code),
      (error: string) => this.handlePTYError(ptyId, error)
    );

    const startPromise = this.ipcHandler.startPTY(ptyId, pty.sessionType)
      .then(() => {
        // The process can exit immediately after startListener resolves. Do
        // not resurrect an already-closed PTY as active in that race.
        const current = this.ptyManager.getPTY(ptyId);
        if (current === pty && !this.closedPTYs.has(ptyId)) {
          pty.isActive = true;
        }
      })
      .catch(error => {
        const current = this.ptyManager.getPTY(ptyId);
        if (current === pty) {
          pty.isActive = false;
          this.ipcHandler.cleanupHandlers(ptyId);
          this.recordPTYStartFailure(ptyId, error);
        }
        throw error;
      })
      .finally(() => {
        if (this.ptyStartPromises.get(ptyId) === startPromise) {
          this.ptyStartPromises.delete(ptyId);
        }
      });

    this.ptyStartPromises.set(ptyId, startPromise);
    return startPromise;
  }

  /** Keep backend startup failures visible in the retained terminal transcript. */
  private recordPTYStartFailure(ptyId: string, error: unknown): void {
    const message = (error instanceof Error ? error.message : String(error || 'Unknown error'))
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 240);
    const statusLine = `\r\n[Terminal failed to start${message ? `: ${message}` : ''}]\r\n`;

    this.appendSyntheticOutput(ptyId, statusLine);
    const terminalId = this.ptyToTerminal.get(ptyId);
    if (terminalId) {
      this.terminalRenderer.writeToTerminal(terminalId, statusLine);
    }
  }

  private handlePTYOutput(ptyId: string, data: string): void {
    // VERIFICATION: Log that we're receiving output
    if (data.length > 0) {
    }

    this.bufferManager.appendToBuffer(ptyId, data);

    // READINESS: the first output means the shell prompt is up. Check the
    // retained tail instead of only this IPC chunk: Windows/WSL can split the
    // prompt itself across two reads. Readiness means a real prompt exists,
    // not merely that WSL emitted an error banner or startup control bytes.
    if (!this.readyPtys.has(ptyId)) {
      const readinessTail = this.bufferManager.getBuffer(ptyId).slice(-2048);
      if (readinessTail && this.outputLooksLikePrompt(readinessTail)) {
        this.readyPtys.add(ptyId);
        const queued = this.pendingReadyWrites.get(ptyId);
        if (queued && queued.length > 0) {
          this.pendingReadyWrites.delete(ptyId);
          // Small settle so bash has reached its read loop before we send.
          setTimeout(() => {
            // The terminal can be removed between the first output chunk and
            // this settle delay (for example Stop while WSL is still starting).
            // Do not send queued text into a replacement session or a dead
            // backend PTY.
            if (!this.isPTYActive(ptyId)) return;
            for (const entry of queued) {
              if (entry.timer) clearTimeout(entry.timer);
              this.ipcHandler.writeToListener(ptyId, entry.data);
            }
          }, 60);
        }
      }
    }
    
    // If PTY is attached to a terminal, write to it
    const terminalId = this.ptyToTerminal.get(ptyId);
    if (terminalId) {
      this.terminalRenderer.writeToTerminal(terminalId, data);
    }
    
    // PERF FIX: Track commands for AI context OFF the render hot path.
    // Previously trackCommandExecution() ran stripANSI() + prompt regexes on EVERY
    // PTY chunk (hundreds/sec during a flood). Now chunks are coalesced and analyzed
    // at most every 150ms, which keeps the live render path cheap.
    this.queueCommandTracking(ptyId, data);
  }
  
  /**
   * Track command execution for attack state
   * Handles extreme pentest scenarios: background jobs, massive outputs, rapid execution
   */
  private commandBuffers = new Map<string, {
    lines: string[];
    startTime: number;
    lastPromptIndex: number;
    pendingCommand: string | null;
    commandStartLine: number;
    commandTarget?: string;
    evidenceGeneration: number;
    provenance?: TerminalEvidenceProvenance;
  }>();
  
  // PERF FIX: Coalesce AI command-tracking OFF the render hot path. Raw PTY
  // chunks are buffered and analyzed at most every CMD_TRACK_INTERVAL ms instead of
  // running stripANSI() + prompt regexes on every single chunk (hundreds/sec).
  private cmdTrackPending = new Map<string, string[]>();
  private cmdTrackPendingSizes = new Map<string, number>();
  private cmdTrackTimers = new Map<string, NodeJS.Timeout>();
  private readonly CMD_TRACK_INTERVAL = 150;
  
  private queueCommandTracking(ptyId: string, data: string): void {
    const pending = this.cmdTrackPending.get(ptyId) || [];
    pending.push(data);
    let pendingSize = (this.cmdTrackPendingSizes.get(ptyId) || 0) + data.length;
    if (pendingSize > 512 * 1024) {
      const compacted = pending.join('').slice(-256 * 1024);
      pending.length = 0;
      pending.push(compacted);
      pendingSize = compacted.length;
    }
    this.cmdTrackPending.set(ptyId, pending);
    this.cmdTrackPendingSizes.set(ptyId, pendingSize);
    
    if (this.cmdTrackTimers.has(ptyId)) return;
    
    const timer = setTimeout(() => {
      this.cmdTrackTimers.delete(ptyId);
      const chunks = this.cmdTrackPending.get(ptyId);
      this.cmdTrackPending.delete(ptyId);
      this.cmdTrackPendingSizes.delete(ptyId);
      if (chunks && chunks.length > 0) {
        try {
          this.trackCommandExecution(ptyId, chunks.join(''));
        } catch (error) {
          logger.warn('TerminalService', `Command tracking failed for ${ptyId}`, error);
        }
      }
    }, this.CMD_TRACK_INTERVAL);
    
    this.cmdTrackTimers.set(ptyId, timer);
  }
  
  private trackCommandExecution(ptyId: string, data: string): void {
    // Strip ANSI codes and control characters FIRST
    const cleanData = this.stripANSI(data);
    
    // Get or create buffer for this PTY
    let buffer = this.commandBuffers.get(ptyId);
    const mappedTerminalId = this.ptyToTerminal.get(ptyId) || ptyId;
    const currentProvenance = this.terminalEvidenceProvenance.get(ptyId)
      || this.terminalEvidenceProvenance.get(mappedTerminalId);
    if (this.quarantinedEvidenceTerminals.has(ptyId)
      || this.quarantinedEvidenceTerminals.has(mappedTerminalId)) {
      // Late bytes from a session that was invalidated are still displayed in
      // the retained PTY transcript, but cannot create current-session AI
      // evidence until a new run/user command explicitly rebinds the PTY.
      if (!currentProvenance) return;
    }
    if (!buffer) {
      buffer = {
        lines: [],
        startTime: Date.now(),
        lastPromptIndex: -1,
        pendingCommand: null,
        commandStartLine: -1,
        evidenceGeneration: this.evidenceGeneration,
        provenance: currentProvenance,
      };
      this.commandBuffers.set(ptyId, buffer);
    }
    
    // Add new lines to buffer
    const newLines = cleanData.split('\n');
    buffer.lines.push(...newLines);
    
    // Use constants instead of hardcoded values
    if (buffer.lines.length > this.BUFFER_CLEANUP_THRESHOLD) {
      const removed = buffer.lines.length - this.MAX_BUFFER_LINES;
      buffer.lines = buffer.lines.slice(-this.MAX_BUFFER_LINES);
      
      // Adjust indices
      if (buffer.lastPromptIndex >= 0) {
        buffer.lastPromptIndex = Math.max(0, buffer.lastPromptIndex - removed);
      }
      if (buffer.commandStartLine >= 0) {
        buffer.commandStartLine = Math.max(0, buffer.commandStartLine - removed);
      }
    }
    
    // IMPROVED: Detect command prompt with multiple patterns
    // Patterns: user@host:~$ or root@host:~# or [user@host]$ or just $ or #
    const promptPatterns = [
      /(?:^|\n)(?:.*?[@\[].*?[\]:].*?[\$#])\s*$/,  // user@host:~$ or [user@host]$
      /(?:^|\n)[\$#]\s*$/,                          // Just $ or #
      /(?:^|\n)(?:root|bash|sh)[@#]\s*$/,          // root@ or bash#
      // Console-style tool prompts so the AI also captures exploitation steps:
      /(?:^|\n)msf\d?(?:\s+\w+\([^)]*\))?\s*>\s*$/i, // msf6 > or msf6 exploit(...) >
      /(?:^|\n)meterpreter\s*>\s*$/i,                // meterpreter >
    ];
    
    const fullText = buffer.lines.slice(-10).join('\n'); // Check last 10 lines only
    const hasPrompt = promptPatterns.some(pattern => pattern.test(fullText));
    
    if (!hasPrompt) return;
    
    // Find where the prompt is
    const currentPromptIndex = buffer.lines.length - 1;
    
    // Wait for output to stabilize (background jobs)
    // If we just saw a prompt, wait 500ms before processing
    if (buffer.lastPromptIndex === currentPromptIndex) {
      return; // Same prompt, still waiting
    }
    
    // First prompt - initialize
    if (buffer.lastPromptIndex === -1) {
      buffer.lastPromptIndex = currentPromptIndex;
      return;
    }
    
    // DEBOUNCE: Schedule command processing after 500ms of no new prompts
    this.scheduleCommandProcessing(ptyId, buffer, currentPromptIndex);
  }
  
  private processingTimers = new Map<string, NodeJS.Timeout>();
  
  private scheduleCommandProcessing(ptyId: string, buffer: any, promptIndex: number): void {
    // Clear existing timer
    const existing = this.processingTimers.get(ptyId);
    if (existing) {
      clearTimeout(existing);
    }
    
    // Schedule processing after 500ms (wait for background jobs)
    const timer = setTimeout(() => {
      this.processCompletedCommand(ptyId, buffer, promptIndex);
      this.processingTimers.delete(ptyId);
    }, 500);
    
    this.processingTimers.set(ptyId, timer);
  }
  
  private processCompletedCommand(ptyId: string, buffer: any, currentPromptIndex: number): void {
    const commandStartIndex = buffer.lastPromptIndex;
    const commandEndIndex = currentPromptIndex;
    
    if (commandEndIndex <= commandStartIndex + 1) {
      buffer.lastPromptIndex = currentPromptIndex;
      return;
    }
    
    // IMPROVED: Extract command with multi-line support
    const commandLines: string[] = [];
    let idx = commandStartIndex + 1;
    
    while (idx < commandEndIndex) {
      const line = buffer.lines[idx]?.trim() || '';
      
      if (!line) {
        idx++;
        continue;
      }
      
      // Check if this is command start (has prompt)
      if (line.match(/[\$#>]\s/)) {
        commandLines.push(line);
        idx++;
        
        // Handle line continuation (\)
        while (idx < commandEndIndex) {
          const nextLine = buffer.lines[idx]?.trim() || '';
          if (nextLine.startsWith('>') || nextLine.startsWith('\\')) {
            commandLines.push(nextLine.replace(/^[>\\]\s*/, ''));
            idx++;
          } else {
            break;
          }
        }
        break;
      }
      
      idx++;
    }
    
    if (commandLines.length === 0) {
      buffer.lastPromptIndex = currentPromptIndex;
      return;
    }
    
    // Join multi-line command
    const commandLine = commandLines.join(' ').replace(/\s+/g, ' ');
    
    // Extract actual command (remove prompt prefix)
    const command = commandLine.replace(/^.*?[\$#>]\s*/, '').trim();
    
    // Capture target from the command itself while this command is being
    // finalized. The terminal target map is mutable and may already point at
    // a newer Stop -> Start run.
    const scannerTool = ptyId.includes('::') ? ptyId.split('::')[1] : undefined;
    const provenance = buffer.provenance
      || this.terminalEvidenceProvenance.get(ptyId)
      || this.terminalEvidenceProvenance.get(this.ptyToTerminal.get(ptyId) || '');
    const commandTarget = extractCommandTarget(command, scannerTool);
    const noiseCommands: string[] = ['cd', 'clear', 'ls', 'pwd', 'exit', 'history', 'echo', 'jobs', 'fg', 'bg'];
    buffer.commandTarget = buffer.commandTarget || commandTarget || provenance?.target;
    const isNoise = noiseCommands.some(noise => 
      command === noise || command.startsWith(noise + ' ')
    );
    
    // Skip empty commands or just whitespace
    if (!command || command.length < 2 || isNoise || /^\s*$/.test(command)) {
      buffer.lastPromptIndex = currentPromptIndex;
      return;
    }
    
    // VERIFICATION: Log command detection
    console.log(`[TerminalService] 🔍 Command detected: "${redactSensitiveText(command).substring(0, 50)}..."`);
    
    // Get ALL output including background job results
    const outputStartIndex = commandStartIndex + 1 + commandLines.length;
    const outputLines = buffer.lines.slice(outputStartIndex, commandEndIndex);
    let output = outputLines.join('\n').trim();
    
    // Filter out job control messages
    output = this.filterJobControlMessages(output);
    
    // Truncate massive outputs (keep first + last + critical)
    const truncatedOutput = this.truncateMassiveOutput(output);
    
    // Calculate duration
    const duration = Date.now() - buffer.startTime;
    
    // Detect exit code
    const exitCode = this.detectExitCode(output);
    
    // VERIFICATION: Log what we're about to send
    console.log(`[TerminalService] 📤 Preparing to send: command="${redactSensitiveText(command).substring(0, 30)}...", exitCode=${exitCode}, outputSize=${truncatedOutput.length}`);
    
    // Only send meaningful commands (not empty output)
    if (truncatedOutput.length > 0 || exitCode !== 0) {
      this.sendToAttackState(command, exitCode, truncatedOutput, duration, ptyId, {
        sessionId: provenance?.sessionId,
        runId: provenance?.runId,
        target: commandTarget || provenance?.target || this.terminalTargets.get(ptyId),
        tabId: ptyId.includes('::') ? ptyId.split('::')[0] : ptyId,
        terminalId: ptyId,
        tool: scannerTool,
        evidenceGeneration: buffer.evidenceGeneration,
      }).catch(error => {
        console.error('[TerminalService] ❌ Failed to send command to attack state:', error);
      });
    } else {
      console.debug(`[TerminalService] ⏭️ Skipping command with no output: "${command}"`);
    }

    // Notify renderer-lifetime lifecycle bridges even when the command had no
    // meaningful output. Active listener/tunnel projections are provisional and
    // must disappear as soon as the reusable shell reaches its prompt.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('terminal-command-finalized', {
        detail: {
          listenerId: ptyId,
          terminalId: ptyId,
          command,
          exitCode,
          timestamp: Date.now(),
        },
      }));
    }
    
    // Update for next command
    buffer.lastPromptIndex = currentPromptIndex;
    buffer.startTime = Date.now();
    buffer.commandTarget = undefined;
  }
  
  /**
   * Filter out bash job control messages
   */
  private filterJobControlMessages(output: string): string {
    const lines = output.split('\n');
    const filtered = lines.filter(line => {
      const trimmed = line.trim();
      
      // Skip job control messages
      if (/^\[\d+\]\s+(Done|Exit|Running|Stopped)/.test(trimmed)) {
        return false;
      }
      
      // Skip job number assignments
      if (/^\[\d+\]\s+\d+$/.test(trimmed)) {
        return false;
      }
      
      return true;
    });
    
    return filtered.join('\n');
  }
  
  /**
   * Strip ANSI escape codes and control characters
   * Handles all terminal control sequences
   */
  private stripANSI(text: string): string {
    return cleanANSIForDisplay(text);
  }
  
  /**
   * Truncate massive outputs intelligently
   * Handles 100K+ line outputs from heavy pentests
   */
  /**
     * Truncate massive outputs intelligently
     * OPTIMIZED: Sampling for extreme outputs
     */
    private truncateMassiveOutput(output: string): string {
      const MAX_OUTPUT_SIZE = 150000; // INCREASED

      if (output.length <= MAX_OUTPUT_SIZE) {
        return output;
      }

      const lines = output.split('\n');

      const firstLines = lines.slice(0, 500);
      const lastLines = lines.slice(-500);

      // OPTIMIZED: Sample middle instead of scanning all
      const middleLines = lines.slice(500, -500);
      const criticalMiddle: string[] = [];

      if (middleLines.length > 0) {
        for (let i = 0; i < middleLines.length && criticalMiddle.length < 320; i += 1) {
          const line = middleLines[i];
          const l = line.toLowerCase();

          if (
            l.includes('open') || l.includes('found') || l.includes('vulnerable') ||
            l.includes('root') || l.includes('password') || l.includes('passwd') ||
            l.includes('credential') || l.includes('secret') || l.includes('token') ||
            l.includes('api_key') || l.includes('private key') || l.includes('aws_') ||
            l.includes('docker') || l.includes('kubernetes') || l.includes('cve-') ||
            l.includes('error') || l.includes('denied') || l.includes('listen') ||
            /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(line)
          ) {
            criticalMiddle.push(line);
          }
        }
      }

      const totalHidden = middleLines.length - criticalMiddle.length;

      return [
        ...firstLines,
        totalHidden > 0 ? `\n[${totalHidden.toLocaleString()} lines hidden]\n` : '',
        ...criticalMiddle,
        '\n[last 500 lines]\n',
        ...lastLines
      ].join('\n');
    }

  
  /**
   * Detect exit code from command output
   */
  private detectExitCode(output: string): number {
    const lower = output.toLowerCase();
    
    // Common error patterns
    const errorPatterns = [
      'command not found',
      'permission denied',
      'connection refused',
      'no such file',
      'cannot access',
      'error:',
      'failed',
      'not found',
      'invalid',
      'unable to',
      'could not',
      'access denied',
      'forbidden',
      'timeout',
      'unreachable',
      'refused',
      'killed',
      'segmentation fault',
      'core dumped'
    ];
    
    for (const pattern of errorPatterns) {
      if (lower.includes(pattern)) {
        return 1;
      }
    }
    
    // Check for explicit exit code in output
    const exitCodeMatch = output.match(/exit code:?\s*(\d+)/i);
    if (exitCodeMatch) {
      return parseInt(exitCodeMatch[1], 10);
    }
    
    return 0;
  }
  
  /**
   * Send command to attack state manager
   */
  private async sendToAttackState(
    command: string,
    exitCode: number,
    output: string,
    duration: number,
    terminalId: string,
    metadata: import('./attack-state/state-manager').CommandMetadata = {},
  ): Promise<void> {
    try {
      // A command finalizer without immutable ownership is unsafe on a
      // reusable PTY that crossed a session boundary.
      if (this.quarantinedEvidenceTerminals.has(terminalId) && !metadata.sessionId) return;
      // A finalizer can resolve after session replacement or Stop -> Start.
      // Reject it before looking up the mutable current manager.
      if (
        metadata.evidenceGeneration !== undefined
        && metadata.evidenceGeneration !== this.evidenceGeneration
      ) return;
      // A scanner run without a session at start must not be attributed to a
      // later session that happens to exist when its shell reaches a prompt.
      if (metadata.runId && !metadata.sessionId) return;

      const { useAttackState } = await import('./attack-state-store');
      const state = useAttackState.getState();
      const { manager, session } = state;
      if (!manager || !session) return;
      if (metadata.sessionId && metadata.sessionId !== session.id) return;

      console.log(`[TerminalService] ✅ Sending command to attack state: "${redactSensitiveText(command).substring(0, 50)}..." (exit: ${exitCode}, output: ${output.length} bytes)`);
      await state.processCommand(command, exitCode, output, '', duration, {
        ...metadata,
        tabId: metadata.tabId || (terminalId.includes('::') ? terminalId.split('::')[0] : terminalId),
        terminalId: metadata.terminalId || terminalId,
        sessionId: metadata.sessionId,
        target: metadata.target || this.terminalTargets.get(terminalId) || session.target_ip,
      });
      console.log('[TerminalService] ✅ Command processed by attack state successfully');
    } catch (error) {
      // Silent fail - attack state is optional
      console.debug('[TerminalService] Attack state not available:', error);
    }
  }

  private handlePTYClosed(ptyId: string, code: number): void {
    logger.info('TerminalService', `PTY closed: ${ptyId} with code ${code}`);

    // A closed shell cannot accept a queued command. Clear readiness and any
    // deferred writes so a later Start cannot send input into a dead PTY.
    this.readyPtys.delete(ptyId);
    const pendingWrites = this.pendingReadyWrites.get(ptyId);
    if (pendingWrites) {
      pendingWrites.forEach(entry => {
        if (entry.timer) clearTimeout(entry.timer);
      });
      this.pendingReadyWrites.delete(ptyId);
    }
    
    const pty = this.ptyManager.getPTY(ptyId);
    if (pty) {
      pty.isActive = false;
      pty.isAttached = false;
    }
    this.closedPTYs.add(ptyId);
    // The close event is terminal for this backend session. Remove the IPC
    // listeners now so late output/duplicate close notifications cannot be
    // routed into the next PTY that reuses this stable id.
    this.ipcHandler.cleanupHandlers(ptyId);

    // Keep the closure visible in both the retained transcript and the live
    // terminal. This gives users an honest state after a WSL crash or shell
    // exit and makes the next Start/recovery path explain what happened.
    const terminalId = this.ptyToTerminal.get(ptyId);
    const statusLine = code === 0
      ? '\r\n[Terminal stopped]\r\n'
      : `\r\n[Terminal exited unexpectedly (code ${code})]\r\n`;
    this.appendSyntheticOutput(ptyId, statusLine);
    if (terminalId) {
      this.ptyToTerminal.delete(ptyId);
      const terminal = this.terminalRenderer.getTerminalInstance(terminalId);
      if (terminal?.currentPtyId === ptyId) {
        terminal.currentPtyId = null;
        terminal.needsBufferReplay = true;
        terminal.inputHandler?.dispose();
        terminal.inputHandler = null;
      }
      this.terminalRenderer.writeToTerminal(terminalId, statusLine);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('terminal-pty-closed', {
          detail: { terminalId, ptyId, code, unexpected: code !== 0 },
        }));
      }
    }
  }

  private handlePTYError(ptyId: string, error: string): void {
    logger.error('TerminalService', `PTY error: ${ptyId}`, error);
  }

  private outputLooksLikePrompt(data: string): boolean {
    const clean = this.stripANSI(data).replace(/\r/g, '');
    const lastLine = clean.split('\n').at(-1)?.trim() || '';
    if (!lastLine) return false;

    return /^(?:PS\s+[^>]+>|.*@.*[$#]|[$#]|msf\d?(?:\s+\w+\([^)]*\))?\s*>|meterpreter\s*>)[ \t]*$/i.test(lastLine);
  }

  /**
   * Set up input handler for terminal -> PTY communication
   */
  private setupInputHandler(terminalId: string, ptyId: string): void {
    const terminal = this.terminalRenderer.getTerminalInstance(terminalId);
    if (!terminal) {
      logger.warn('TerminalService', `Cannot setup input handler - terminal not found: ${terminalId}`);
      return;
    }

    if (!terminal.terminal) {
      logger.warn('TerminalService', `Cannot setup input handler - xterm instance not found: ${terminalId}`);
      return;
    }

    // Remove existing input handler if any
    if (terminal.inputHandler) {
      terminal.inputHandler.dispose();
      logger.debug('TerminalService', `Disposed existing input handler for ${terminalId}`);
    }

    // Set up new input handler
    terminal.inputHandler = terminal.terminal.onData((data: string) => {
      // A user-entered command is an explicit rebind of a quarantined
      // reusable PTY after session replacement. Scanner/subdomain runs bind
      // themselves with immutable run provenance before writing commands.
      this.quarantinedEvidenceTerminals.delete(terminalId);
      this.quarantinedEvidenceTerminals.delete(ptyId);
      // PERFORMANCE: Use fire-and-forget IPC for instant input response
      this.ipcHandler.writeToListener(ptyId, data);
    });

    logger.debug('TerminalService', `✅ Input handler set up for terminal ${terminalId} -> PTY ${ptyId}`);
    console.log(`[TerminalService] ✅ Input handler ACTIVE for ${terminalId} -> ${ptyId}`);
  }
  
  /**
   * PUBLIC: Ensure input handler is set up (for metasploit and other special cases)
   */
  ensureInputHandler(terminalId: string, ptyId?: string): void {
    const actualPtyId = ptyId || terminalId;
    this.setupInputHandler(terminalId, actualPtyId);
    
    // VERIFICATION: Check if input handler was actually set up
    const terminal = this.terminalRenderer.getTerminalInstance(terminalId);
    if (terminal && terminal.inputHandler) {
      console.log(`[TerminalService] ✅ VERIFIED: Input handler is active for ${terminalId}`);
    } else {
      console.error(`[TerminalService] ❌ FAILED: Input handler not active for ${terminalId}`);
    }
  }

  attachPTY(terminalId: string, ptyId: string): void {
    if (this.attachingPTY.has(terminalId)) {
      logger.debug('TerminalService', `Already attaching PTY to terminal: ${terminalId}`);
      return;
    }

    // performPTYAttach is synchronous. A zero-delay timer used to make
    // attach() return before the PTY mapping/input handler/replay were ready;
    // live output could then race the snapshot and a returning terminal could
    // paint the prompt twice. Attach in the same turn so callers have a real
    // lifecycle boundary and the single renderer owner is immediately set.
    this.attachingPTY.add(terminalId);
    try {
      this.performPTYAttach(terminalId, ptyId);
    } catch (error) {
      logger.error('TerminalService', `Attach failed: ${terminalId} -> ${ptyId}`, error);
    } finally {
      this.attachingPTY.delete(terminalId);
    }
  }

  private performPTYAttach(terminalId: string, ptyId: string): void {
    try {
      const terminal = this.terminalRenderer.getTerminalInstance(terminalId);
      const pty = this.ptyManager.getPTY(ptyId);

      if (!terminal || !pty) {
        logger.warn('TerminalService', `Cannot attach - terminal or PTY not found: ${terminalId}, ${ptyId}`);
        return;
      }

      // Reattaching the same live PTY is common when a section is hidden and
      // shown again. The xterm instance already owns its scrollback in this
      // case; replaying the complete bounded buffer would duplicate every
      // line on each remount. Only replay below for a new attachment.
      const alreadyAttached = terminal.currentPtyId === ptyId &&
        this.ptyToTerminal.get(ptyId) === terminalId;
      if (alreadyAttached) {
        this.setupInputHandler(terminalId, ptyId);
        logger.debug('TerminalService', `PTY already attached; skipped buffer replay: ${terminalId} -> ${ptyId}`);
        return;
      }

      // Detach current PTY if any
      if (terminal.currentPtyId) {
        const currentPty = this.ptyManager.getPTY(terminal.currentPtyId);
        if (currentPty) {
          currentPty.isAttached = false;
        }
        this.ptyToTerminal.delete(terminal.currentPtyId);
      }

      // Attach new PTY. If the previous generation closed while the xterm
      // instance remained mounted, clear its old canvas before replaying the
      // retained buffer; otherwise Stop -> Start duplicates the transcript.
      if (terminal.needsBufferReplay) {
        this.terminalRenderer.clearTerminal(terminalId);
        terminal.needsBufferReplay = false;
      }
      terminal.currentPtyId = ptyId;
      pty.isAttached = true;
      this.ptyToTerminal.set(ptyId, terminalId);

      // Set up input handler for user typing
      this.setupInputHandler(terminalId, ptyId);

      // Replay the snapshot synchronously into TerminalRenderer's ordered write
      // queue. Deferring this to requestAnimationFrame let live PTY output queue
      // first; the snapshot then rendered after newer bytes and duplicated the
      // prompt/output when a shell produced data during attach.
      const bufferedOutput = this.bufferManager.getBuffer(ptyId);
      if (bufferedOutput) {
        this.terminalRenderer.writeToTerminal(terminalId, bufferedOutput);
        logger.info('TerminalService', `✅ Restored ${bufferedOutput.length} bytes to terminal ${terminalId} after reattach`);
      }

      logger.debug('TerminalService', `Attached PTY ${ptyId} to terminal ${terminalId}`);
    } finally {
      this.attachingPTY.delete(terminalId);
    }
  }

  fit(terminalId: string): void {
    try {
      this.terminalRenderer.fitTerminal(terminalId);
    } catch (error) {
      this.errorHandler.handleError(
        TerminalErrorType.RESIZE_FAILED,
        `Failed to fit terminal: ${terminalId}`,
        { terminalId },
        error as Error
      );
    }
  }

  quickFit(terminalId: string): void {
    // For now, same as regular fit - can be optimized later
    this.fit(terminalId);
  }

  focus(terminalId: string): void {
    this.terminalRenderer.focusTerminal(terminalId);
  }

  /**
   * Verify terminal content matches PTY buffer
   * Used to detect and fix display corruption (black box issue)
   * FIX: Only restore if terminal is TRULY empty (not just has few lines)
   * FIX: Never clear a terminal that already has content — prevents scrambling
   */
  verifyTerminalContent(terminalId: string): void {
    try {
      const terminalInstance = this.terminalRenderer.getTerminalInstance(terminalId);
      if (!terminalInstance || !terminalInstance.currentPtyId) {
        return;
      }

      const pty = this.ptyManager.getPTY(terminalInstance.currentPtyId);
      if (!pty) {
        return;
      }

      // Check if terminal appears empty
      const terminal = terminalInstance.terminal;
      const terminalBuffer = terminal.buffer.active;
      
      // FIX #1: Count non-blank lines, not just total lines
      let visibleNonBlankLines = 0;
      for (let i = 0; i < terminalBuffer.length; i++) {
        const line = terminalBuffer.getLine(i);
        if (line && line.length > 0) {
          // Check if line has any non-whitespace content
          let hasContent = false;
          for (let cell = 0; cell < line.length; cell++) {
            const cellData = line.getCell(cell);
            if (cellData && cellData.getChars().trim()) {
              hasContent = true;
              break;
            }
          }
          if (hasContent) {
            visibleNonBlankLines++;
          }
        }
      }

      // Get PTY buffer
      const ptyBuffer = this.bufferManager.getBuffer(terminalInstance.currentPtyId);

      // FIX #2: Only restore if terminal is COMPLETELY empty (0 non-blank lines)
      // AND PTY has substantial content (>500 chars to avoid restoring just prompts)
      if (visibleNonBlankLines === 0 && ptyBuffer && ptyBuffer.length > 500) {
        logger.warn('TerminalService', `Terminal display is completely empty but PTY has content — restoring from buffer`);
        logger.info('TerminalService', `PTY buffer size: ${ptyBuffer.length}, Terminal non-blank lines: ${visibleNonBlankLines}`);

        try {
          // Restore through the renderer's ordered queue. Calling xterm.write
          // directly here bypasses the same write lock used by live PTY
          // chunks, so a late verification pass could paint an old snapshot
          // after newer output and make the prompt appear duplicated.
          this.terminalRenderer.writeToTerminal(terminalId, ptyBuffer);
          logger.info('TerminalService', `✅ Terminal content restored for ${terminalId}`);
        } catch (error) {
          logger.error('TerminalService', `Failed to restore terminal content for ${terminalId}`, error);
        }
      } else if (visibleNonBlankLines > 0) {
        // Terminal already has content — never clear it
        logger.debug('TerminalService', `Terminal ${terminalId} has ${visibleNonBlankLines} non-blank lines — skipping verification`);
      }
    } catch (error) {
      logger.error('TerminalService', `verifyTerminalContent failed for ${terminalId}`, error);
    }
  }

  saveScrollPosition(terminalId: string): void {
    try {
      const terminal = this.terminalRenderer.getTerminal(terminalId);
      if (terminal) {
        this.scrollManager.saveScrollPosition(terminalId, terminal);
      }
    } catch (error) {
      this.errorHandler.handleError(
        TerminalErrorType.SCROLL_FAILED,
        `Failed to save scroll position: ${terminalId}`,
        { terminalId },
        error as Error
      );
    }
  }

  restoreScrollPosition(terminalId: string): void {
    try {
      const terminal = this.terminalRenderer.getTerminal(terminalId);
      if (terminal) {
        this.scrollManager.restoreScrollPosition(terminalId, terminal);
      }
    } catch (error) {
      this.errorHandler.handleError(
        TerminalErrorType.SCROLL_FAILED,
        `Failed to restore scroll position: ${terminalId}`,
        { terminalId },
        error as Error
      );
    }
  }

  lockScrollPosition(terminalId: string): void {
    const terminal = this.terminalRenderer.getTerminal(terminalId);
    if (terminal) {
      this.scrollManager.lockScrollPosition(terminalId, terminal);
    }
  }

  scrollToBottom(terminalId: string): void {
    const terminal = this.terminalRenderer.getTerminal(terminalId);
    if (terminal) {
      this.scrollManager.scrollToBottom(terminalId, terminal);
    }
  }

  fixScrollLock(terminalId: string): void {
    // Legacy method - delegate to scroll manager
    this.lockScrollPosition(terminalId);
  }

  forceRestoreScrollPosition(terminalId: string): void {
    // Legacy method - delegate to scroll manager
    this.restoreScrollPosition(terminalId);
  }

  recoverFrozenTerminal(terminalId: string): boolean {
    try {
      const terminal = this.terminalRenderer.getTerminalInstance(terminalId);
      if (!terminal) return false;

      // Refresh terminal
      this.terminalRenderer.refreshTerminal(terminalId);
      this.fit(terminalId);

      // If the attached PTY exited, recover it just like a missing PTY. The
      // recovery branch retains the transcript and replays it on reattach.
      if (!terminal.currentPtyId || !this.isPTYActive(terminal.currentPtyId)) {
        this.getOrCreatePTY(terminalId, terminal.sessionType);
        this.attachPTY(terminalId, terminalId);
      }

      return true;
    } catch (error) {
      logger.error('TerminalService', `Recovery failed for ${terminalId}`, error);
      return false;
    }
  }

  // Getters for compatibility
  getTerminal(terminalId: string) {
    return this.terminalRenderer.getTerminal(terminalId);
  }

  getFitAddon(terminalId: string) {
    return this.terminalRenderer.getFitAddon(terminalId);
  }

  getSearchAddon(terminalId: string) {
    return this.terminalRenderer.getSearchAddon(terminalId);
  }

  getTerminalInstance(terminalId: string) {
    return this.terminalRenderer.getTerminalInstance(terminalId);
  }

  getPTY(ptyId: string) {
    return this.ptyManager.getPTY(ptyId);
  }

  hasTerminal(terminalId: string): boolean {
    return this.terminalRenderer.hasTerminal(terminalId);
  }

  hasPTY(ptyId: string): boolean {
    return this.ptyManager.hasPTY(ptyId);
  }

  isPTYReady(ptyId: string): boolean {
    return this.readyPtys.has(ptyId);
  }

  isPTYActive(ptyId: string): boolean {
    return this.ptyManager.getPTY(ptyId)?.isActive ?? false;
  }

  /**
   * Stop a backend shell that did not return to a prompt after Ctrl+C.
   *
   * The Electron stop handler keeps backend listeners attached until exit, so
   * final shutdown output is retained before the renderer PTY is marked closed.
   * The bounded transcript remains available for the next attach.
   */
  async forceStopPTY(ptyId: string): Promise<boolean> {
    if (!ptyId || ptyId === 'msf-console-persistent') return false;

    try {
      if (typeof window !== 'undefined' && window.electron?.stopListener) {
        await window.electron.stopListener(ptyId);
      }
    } catch (error) {
      logger.warn('TerminalService', `Force stop failed for ${ptyId}`, error);
    }

    const pty = this.ptyManager.getPTY(ptyId);
    if (pty?.isActive) {
      this.handlePTYClosed(ptyId, 130);
    }

    return !this.isPTYActive(ptyId);
  }

  /** Wait for the backend PTY spawn to settle before a caller starts a command. */
  async waitForPTYStart(ptyId: string, timeoutMs = 5000): Promise<boolean> {
    const startPromise = this.ptyStartPromises.get(ptyId);
    if (startPromise) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          startPromise,
          new Promise<void>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('PTY start timed out')), timeoutMs);
          }),
        ]);
      } catch (error) {
        logger.warn('TerminalService', `PTY start did not complete for ${ptyId}`, error);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    return this.isPTYActive(ptyId);
  }

  getOutput(ptyId: string): string {
    return this.bufferManager.getBuffer(ptyId);
  }

  /**
   * Hydrate an empty renderer-side cache from the durable transcript before a
   * fresh PTY is started. This preserves ordering: older output is replayed
   * first, then the new shell prompt arrives. A populated cache is never
   * merged again, so navigation cannot duplicate the transcript.
   */
  async hydrateFromHistory(ptyId: string, maxBytes = 4 * 1024 * 1024): Promise<boolean> {
    if (this.bufferManager.getBuffer(ptyId).length > 0) return false;
    if (typeof window === 'undefined' || !window.electron?.terminalHistoryGetTail) return false;

    try {
      const result = await window.electron.terminalHistoryGetTail({ ptyId, maxBytes });
      if (!result.success || !result.data) return false;
      if (this.bufferManager.getBuffer(ptyId).length > 0) return false;

      this.bufferManager.appendToBuffer(ptyId, result.data);
      logger.info(
        'TerminalService',
        'Hydrated ' + result.data.length + ' bytes from durable history for ' + ptyId +
          (result.truncated ? ' (tail view)' : ''),
      );
      return true;
    } catch (error) {
      logger.warn('TerminalService', 'Durable history hydration failed for ' + ptyId, error);
      return false;
    }
  }

  writeToTerminal(terminalId: string, data: string): void {
    this.terminalRenderer.writeToTerminal(terminalId, data);
  }

  /**
   * Append output produced by a process that is associated with this terminal
   * but is not running inside the terminal's shell PTY (for example a
   * subdomain tool launched through the Electron tool service).
   */
  private appendSyntheticOutput(ptyId: string, data: string): void {
    this.bufferManager.appendToBuffer(ptyId, data);
    if (typeof window !== 'undefined' && window.electron?.terminalHistoryAppend) {
      const previous = this.historyAppendChains.get(ptyId) || Promise.resolve();
      const append = previous
        .catch(() => undefined)
        .then(async () => {
          const result = await window.electron!.terminalHistoryAppend!({ ptyId, data });
          if (!result.success) {
            throw new Error(result.error || 'Terminal history append failed');
          }
        });
      const settled = append.catch(error => {
        logger.warn('TerminalService', 'Failed to persist synthetic output for ' + ptyId, error);
      });
      this.historyAppendChains.set(ptyId, settled);
      void settled.finally(() => {
        if (this.historyAppendChains.get(ptyId) === settled) {
          this.historyAppendChains.delete(ptyId);
        }
      });
    }
  }

  /** Wait for renderer-originated status/tool output before exporting/clearing. */
  async flushPersistedHistory(ptyIds: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(ptyIds.filter(Boolean)));
    await Promise.all(uniqueIds.map(async (ptyId) => {
      await this.historyAppendChains.get(ptyId)?.catch(() => undefined);
    }));
  }

  writeExternalOutput(terminalId: string, data: string, persist = false): void {
    if (!data) return;
    if (persist) {
      this.appendSyntheticOutput(terminalId, data);
    } else {
      this.bufferManager.appendToBuffer(terminalId, data);
    }
    this.terminalRenderer.writeToTerminal(terminalId, data);
  }

  /**
   * Write input to a PTY once its shell is ready (first prompt emitted).
   * Prevents the first characters of auto-entered commands from being dropped
   * (WSL interactive bash eats input sent before it's in its read loop) and removes
   * the need for fixed guess delays. If the PTY is already ready, sends immediately;
   * otherwise queues and flushes on first output, with a `fallbackMs` safety net in
   * case no output ever arrives.
   */
  writeWhenReady(ptyId: string, data: string, fallbackMs = 2000): void {
    if (this.readyPtys.has(ptyId)) {
      if (!this.isPTYActive(ptyId)) return;
      this.ipcHandler.writeToListener(ptyId, data);
      return;
    }

    const entry: { data: string; timer: ReturnType<typeof setTimeout> | null } = { data, timer: null };
    // Keep the input queued until the prompt-derived readiness signal arrives.
    // The old fallback timer sent as soon as the PTY was merely active, which
    // is not enough for a cold WSL shell: the first characters could be
    // consumed by startup and the command would appear truncated or vanish.
    // Keep a bounded safety deadline so a broken shell cannot retain input
    // forever, while retrying in short intervals for slow but healthy WSL boot.
    const fallbackDeadline = Date.now() + Math.max(fallbackMs, 10_000);
    const sendAfterFallback = () => {
      // A pre-filled command can be queued before the Terminal component has
      // finished creating its PTY. Keep waiting for a slow WSL boot instead
      // of either dropping the command or writing into a dead session.
      const isReady = this.readyPtys.has(ptyId);
      if (!this.isPTYActive(ptyId) || !isReady) {
        if (Date.now() < fallbackDeadline) {
          // A live PTY is not necessarily a prompt-ready shell. Keep waiting
          // for the same readiness signal used by the normal flush path.
          entry.timer = setTimeout(sendAfterFallback, 100);
        } else {
          const pending = this.pendingReadyWrites.get(ptyId);
          if (pending) {
            const idx = pending.indexOf(entry);
            if (idx !== -1) pending.splice(idx, 1);
            if (pending.length === 0) this.pendingReadyWrites.delete(ptyId);
          }
          logger.debug('TerminalService', `Dropping input after PTY readiness timeout: ${ptyId}`);
        }
        return;
      }

      const queue = this.pendingReadyWrites.get(ptyId);
      if (queue) {
        const idx = queue.indexOf(entry);
        if (idx !== -1) queue.splice(idx, 1);
      }
      this.ipcHandler.writeToListener(ptyId, data);
    };
    entry.timer = setTimeout(sendAfterFallback, fallbackMs);

    const queue = this.pendingReadyWrites.get(ptyId) || [];
    queue.push(entry);
    this.pendingReadyWrites.set(ptyId, queue);
  }

  /** Cancel queued preset/input writes before replacing them with a newer action. */
  cancelPendingWrites(ptyId: string): void {
    const pending = this.pendingReadyWrites.get(ptyId);
    if (!pending) return;

    pending.forEach(entry => {
      if (entry.timer) clearTimeout(entry.timer);
    });
    this.pendingReadyWrites.delete(ptyId);
  }

  clearOutput(ptyId: string): void {
    // Renderer-triggered Clear is the only path that deletes durable transcript
    // chunks. MSF performs the transcript reset in its backend transaction so
    // the PTY display queue and disk history share the same boundary.
    if (typeof window !== 'undefined' && window.electron?.terminalHistoryClear) {
      const clearTask = ptyId === 'msf-console-persistent' && typeof window.electron.msfConsoleClear === 'function'
        ? window.electron.msfConsoleClear().then(result => {
            if (!result.success) {
              throw new Error(result.error || 'Metasploit output clear failed');
            }
          })
        : this.flushPersistedHistory([ptyId])
            .then(() => window.electron!.terminalHistoryClear!({ ptyId }))

      void clearTask
        .catch(error => {
          logger.warn('TerminalService', 'Failed to clear durable history for ' + ptyId, error);
        });
    }

    this.bufferManager.clearBuffer(ptyId);
    this.scrollManager.clearScrollState(ptyId);

    // A clear must reset every representation of the session. Clearing only
    // BufferManager left old xterm scrollback and command-tracking data
    // visible after a subsequent scan reused the same PTY.
    const cmdTimer = this.cmdTrackTimers.get(ptyId);
    if (cmdTimer) {
      clearTimeout(cmdTimer);
      this.cmdTrackTimers.delete(ptyId);
    }
    const procTimer = this.processingTimers.get(ptyId);
    if (procTimer) {
      clearTimeout(procTimer);
      this.processingTimers.delete(ptyId);
    }
    this.cmdTrackPending.delete(ptyId);
    this.cmdTrackPendingSizes.delete(ptyId);
    this.commandBuffers.delete(ptyId);
    this.terminalEvidenceProvenance.delete(ptyId);
    this.terminalTargets.delete(ptyId);
    this.terminalRenderer.clearTerminal(ptyId);
  }

  /**
   * SESSION RESTORE: Restore buffer from saved session output
   * This ensures buffer manager has the complete history after page reload
   */
  restoreBufferFromSnapshot(ptyId: string, output: string): void {
    this.bufferManager.appendToBuffer(ptyId, output);
    logger.info('TerminalService', `Restored ${output.length} bytes to buffer for ${ptyId}`);
  }

  /**
   * Remove a dead PTY without deleting the session transcript. A subsequent
   * getOrCreatePTY call creates a fresh shell with the same stable id and the
   * existing BufferManager content is replayed when it is attached.
   */
  private retireInactivePTYForRecovery(ptyId: string): void {
    const terminalId = this.ptyToTerminal.get(ptyId);
    if (terminalId) {
      const terminal = this.terminalRenderer.getTerminalInstance(terminalId);
      if (terminal?.currentPtyId === ptyId) {
        terminal.inputHandler?.dispose();
        terminal.inputHandler = null;
        terminal.currentPtyId = null;
        this.terminalRenderer.clearTerminal(terminalId);
      }
      this.ptyToTerminal.delete(ptyId);
    }

    this.ipcHandler.cleanupHandlers(ptyId);
    this.cancelPendingWrites(ptyId);
    this.readyPtys.delete(ptyId);
    this.closedPTYs.delete(ptyId);
    this.ptyStartPromises.delete(ptyId);
    this.clearCommandTrackingState(ptyId);

    // The backend is already dead. Do not call destroyPTY(): its onDestroy
    // callback would send stop-listener and could race the replacement start.
    this.ptyManager.forgetPTY(ptyId);
  }

  private clearCommandTrackingState(ptyId: string): void {
    const cmdTimer = this.cmdTrackTimers.get(ptyId);
    if (cmdTimer) {
      clearTimeout(cmdTimer);
      this.cmdTrackTimers.delete(ptyId);
    }
    const procTimer = this.processingTimers.get(ptyId);
    if (procTimer) {
      clearTimeout(procTimer);
      this.processingTimers.delete(ptyId);
    }
    this.cmdTrackPending.delete(ptyId);
    this.cmdTrackPendingSizes.delete(ptyId);
    this.commandBuffers.delete(ptyId);
  }

  destroyPTY(ptyId: string): void {
    const pty = this.ptyManager.getPTY(ptyId);

    // If the renderer entry is already gone, there is no PTYManager callback
    // left to route the backend stop. Keep this fallback idempotent; the main
    // process treats an unknown listener as already stopped.
    if (!pty && ptyId !== 'msf-console-persistent' && typeof window !== 'undefined' && window.electron) {
      void this.ipcHandler.stopPTY(ptyId);
    }

    this.closedPTYs.delete(ptyId);
    this.ptyStartPromises.delete(ptyId);
    // Clean up IPC handlers first
    this.ipcHandler.cleanupHandlers(ptyId);
    
    // Clean up buffer
    this.bufferManager.cleanup(ptyId);
    
    // PERF FIX: Clear command-tracking throttle + state to prevent leaks
    this.clearCommandTrackingState(ptyId);
    this.terminalEvidenceProvenance.delete(ptyId);
    this.terminalTargets.delete(ptyId);
    
    // READINESS: clear ready state + any queued (pending) writes for this PTY
    this.readyPtys.delete(ptyId);
    const pendingWrites = this.pendingReadyWrites.get(ptyId);
    if (pendingWrites) {
      pendingWrites.forEach(e => { if (e.timer) clearTimeout(e.timer); });
      this.pendingReadyWrites.delete(ptyId);
    }
    
    // Remove from mapping
    this.ptyToTerminal.delete(ptyId);
    this.unregisterExternalRoutesForTerminal(ptyId);
    
    // Destroy PTY
    this.ptyManager.destroyPTY(ptyId);
  }

  destroyTerminal(terminalId: string): void {
    this.cancelScheduledTerminalRelease(terminalId);
    this.unregisterExternalRoutesForTerminal(terminalId);
    // Clean up scroll state
    this.scrollManager.clearScrollState(terminalId);
    this.terminalTargets.delete(terminalId);
    this.terminalEvidenceProvenance.delete(terminalId);
    
    // Destroy terminal
    this.terminalRenderer.destroyTerminal(terminalId);
  }

  /**
   * Release only the renderer after a terminal has been out of the UI for a
   * while. The PTY and bounded output buffer remain alive, so returning to the
   * section is fast and can restore the terminal without losing output.
   */
  scheduleTerminalRelease(terminalId: string): void {
    this.cancelScheduledTerminalRelease(terminalId);
    const timer = setTimeout(() => {
      this.terminalReleaseTimers.delete(terminalId);
      const instance = this.terminalRenderer.getTerminalInstance(terminalId);
      if (!instance) return;

      if (instance.currentPtyId) {
        const pty = this.ptyManager.getPTY(instance.currentPtyId);
        if (pty) pty.isAttached = false;
        this.ptyToTerminal.delete(instance.currentPtyId);
        instance.currentPtyId = null;
      }

      this.terminalRenderer.destroyTerminal(terminalId);
    }, this.TERMINAL_RELEASE_DELAY);
    this.terminalReleaseTimers.set(terminalId, timer);
  }

  private cancelScheduledTerminalRelease(terminalId: string): void {
    const timer = this.terminalReleaseTimers.get(terminalId);
    if (!timer) return;
    clearTimeout(timer);
    this.terminalReleaseTimers.delete(terminalId);
  }

  destroyAll(): void {
    logger.info('TerminalService', 'Destroying all terminals and PTYs');
    
    // Stop memory monitoring
    this.memoryMonitor.stopMonitoring();
    
    this.terminalReleaseTimers.forEach(timer => clearTimeout(timer));
    this.terminalReleaseTimers.clear();

    // Clear all per-PTY queues and timers as well. destroyAll() can be called
    // while the renderer remains alive (for example during session reset), so
    // relying on PTY manager destruction alone would retain closures and
    // pending writes in this singleton.
    this.cmdTrackTimers.forEach(timer => clearTimeout(timer));
    this.cmdTrackTimers.clear();
    this.processingTimers.forEach(timer => clearTimeout(timer));
    this.processingTimers.clear();
    this.pendingReadyWrites.forEach(entries => {
      entries.forEach(entry => {
        if (entry.timer) clearTimeout(entry.timer);
      });
    });
    this.pendingReadyWrites.clear();
    this.cmdTrackPending.clear();
    this.cmdTrackPendingSizes.clear();
    this.commandBuffers.clear();
    this.readyPtys.clear();
    
    this.ptyStartPromises.clear();
    this.closedPTYs.clear();

    // Route every backend stop through the same single-session path before
    // dropping the manager entries. This keeps destroyAll consistent with an
    // explicit tab close and covers PTYs that are still being spawned.
    const ptyIds = Array.from(this.ptyManager.getAllPTYs().keys());
    ptyIds.forEach(ptyId => this.destroyPTY(ptyId));
    
    // Cleanup all managers
    this.ipcHandler.cleanupAll();
    this.bufferManager.cleanupAll();
    this.scrollManager.clearAllScrollStates();
    this.terminalRenderer.destroyAll();
    this.ptyManager.destroyAll();
    
    // Clear mappings
    this.ptyToTerminal.clear();
    this.terminalTargets.clear();
    this.terminalEvidenceProvenance.clear();
    this.externalOutputRoutes.clear();
    this.externalOutputRouterCleanup?.();
    this.externalOutputRouterCleanup = null;
    this.attachingPTY.clear();
  }

  // Legacy compatibility methods
  has(ptyId: string): boolean {
    return this.hasPTY(ptyId);
  }

  getOrCreate(ptyId: string, sessionType: SessionType = 'general'): PTYInstance {
    return this.getOrCreatePTY(ptyId, sessionType);
  }

  destroy(ptyId: string): void {
    this.destroyPTY(ptyId);
  }

  isTerminalFresh(terminalId: string): boolean {
    const buffer = this.bufferManager.getBuffer(terminalId);
    return buffer.length === 0;
  }

  getStats() {
    return {
      ptyManager: this.ptyManager.getAllPTYs().size,
      terminalRenderer: this.terminalRenderer.getStats(),
      bufferManager: this.bufferManager.getStats(),
      scrollManager: this.scrollManager.getStats(),
      ipcHandler: this.ipcHandler.getStats(),
      mappings: {
        ptyToTerminal: this.ptyToTerminal.size,
        attachingPTY: this.attachingPTY.size,
      },
    };
  }

  getMemoryReport(): string {
    return this.memoryMonitor.getMemoryReport(this.getStats());
  }

  getErrorReport(): string {
    return this.errorHandler.formatErrorReport();
  }

  getSystemHealth() {
    const stats = this.getStats();
    const memoryStats = this.memoryMonitor.analyzeMemoryUsage(stats);
    const errorStats = this.errorHandler.getErrorStats();
    
    return {
      memory: memoryStats,
      errors: errorStats,
      stats,
      healthy: memoryStats.memoryPressure === 'low' && errorStats.criticalErrors === 0,
    };
  }

  debugAttachPTY(terminalId: string, ptyId?: string): void {
    const actualPtyId = ptyId || terminalId;
    logger.debug('TerminalService', `Debug attach: ${terminalId} -> ${actualPtyId}`);
    this.attachPTY(terminalId, actualPtyId);
  }
}

// Export singleton instance
export const terminalService = new TerminalService();
