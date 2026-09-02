/**
 * Terminal Renderer - Handles xterm.js instances and rendering
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { logger } from '@/lib/utils/logger';
import { TERMINAL_CONSTANTS } from '@/lib/constants';
import { useSettingsStore } from '@/lib/settings-store';
import type { SessionType } from './pty-manager';

export interface TerminalInstance {
  terminalId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  container: HTMLElement | null;
  sessionType: SessionType;
  createdAt: number;
  currentPtyId: string | null;
  // A closed/replaced PTY leaves the xterm instance mounted with the previous
  // generation's scrollback. The next PTY must clear that canvas before the
  // retained BufferManager transcript is replayed, otherwise Stop -> Start
  // duplicates the entire terminal history.
  needsBufferReplay: boolean;
  scrollHandler: { dispose: () => void } | null;
  inputHandler: { dispose: () => void } | null;
}

export class TerminalRenderer {
  private terminals = new Map<string, TerminalInstance>();
  // The renderer cache is intentionally bounded, but evicting an xterm must
  // never orphan the live PTY that feeds it. TerminalService uses this hook to
  // detach the renderer mapping and notify a mounted Terminal component so it
  // can recreate the view from the retained buffer/history.
  private terminalEvictionHandler: ((terminalId: string) => void) | null = null;
  private xtermModulesPromise: Promise<{
    Terminal: typeof Terminal;
    FitAddon: typeof FitAddon;
    SearchAddon: typeof SearchAddon;
  }> | null = null;
  
  // ✅ PERFORMANCE FIX: Batch terminal writes to prevent jittery scrolling
  private writeBatches = new Map<string, {
    buffer: string;
    rafId: number | null;
  }>();

  // xterm parses writes asynchronously. Keep a promise for the complete
  // parser tail (not merely the call to terminal.write) so a resize never
  // reflows half-parsed output. New batches chain onto the same tail.
  private fittingTerminals = new Set<string>();
  private writeLocks = new Map<string, Promise<void>>();
  private fitAfterWrite = new Set<string>();
  private fitQueued = new Set<string>();
  // Incremented whenever a terminal is reset/destroyed. Deferred RAF writes
  // and fit-wait callbacks carry the generation they were created under, so a
  // fast Stop -> Start/reset cannot replay stale output into the new run.
  private writeGenerations = new Map<string, object>();

  private getWriteGeneration(terminalId: string): object {
    let generation = this.writeGenerations.get(terminalId);
    if (!generation) {
      generation = {};
      this.writeGenerations.set(terminalId, generation);
    }
    return generation;
  }

  private invalidateWriteGeneration(terminalId: string): void {
    this.writeGenerations.set(terminalId, {});
  }
  
  // ✅ FIX: Reflow cooldown to prevent rapid successive reflows (causes cumulative corruption)
  private lastReflowTime = new Map<string, number>();
  // ResizeObserver and panel dragging can request several fits during the
  // cooldown. Keep the latest request instead of dropping it, otherwise xterm
  // can remain at the pre-drag column count until the next interaction.
  private fitCooldownTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly REFLOW_COOLDOWN = TERMINAL_CONSTANTS.REFLOW_COOLDOWN;

  constructor() {
    // Existing xterm instances should follow a scrollback change too. The
    // renderer remains the single owner of these instances, so this avoids
    // stale settings without creating a second terminal lifecycle.
    useSettingsStore.subscribe((state, previousState) => {
      if (state.settings.terminalScrollback !== previousState.settings.terminalScrollback) {
        this.applyScrollbackSetting();
      }
    });
  }

  setTerminalEvictionHandler(handler: ((terminalId: string) => void) | null): void {
    this.terminalEvictionHandler = handler;
  }

  private get maxTerminals(): number {
    const configured = Number(useSettingsStore.getState().settings.terminalMaxTerminals);
    if (!Number.isFinite(configured)) return TERMINAL_CONSTANTS.MAX_TERMINALS;
    return Math.max(1, Math.min(Math.floor(configured), TERMINAL_CONSTANTS.MAX_TERMINALS));
  }

  private get scrollback(): number {
    const configured = Number(useSettingsStore.getState().settings.terminalScrollback);
    if (!Number.isFinite(configured)) return TERMINAL_CONSTANTS.DEFAULT_SCROLLBACK;
    return Math.max(
      TERMINAL_CONSTANTS.MIN_SCROLLBACK,
      Math.min(Math.floor(configured), TERMINAL_CONSTANTS.MAX_SCROLLBACK),
    );
  }

  private applyScrollbackSetting(): void {
    const scrollback = this.scrollback;
    for (const instance of this.terminals.values()) {
      if (instance.terminal.options.scrollback !== scrollback) {
        instance.terminal.options.scrollback = scrollback;
      }
    }
  }

  async createTerminal(terminalId: string, sessionType: SessionType = 'general'): Promise<TerminalInstance> {
    if (!terminalId || terminalId === 'undefined' || terminalId === 'null') {
      throw new Error(`Invalid terminal ID: "${terminalId}"`);
    }

    if (this.terminals.has(terminalId)) {
      logger.debug('TerminalRenderer', `Terminal already exists: ${terminalId}`);
      return this.terminals.get(terminalId)!;
    }

    if (this.terminals.size >= this.maxTerminals) {
      this.cleanupOldestTerminal();
    }

    try {
      // Load xterm.js modules
      const { Terminal: XTerminal, FitAddon: XFitAddon, SearchAddon: XSearchAddon } = await this.loadXtermModules();

      const terminal = new XTerminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Consolas, "Courier New", monospace',
        theme: {
          background: '#000000',
          foreground: '#ffffff',
          cursor: '#ffffff',
          selectionBackground: 'rgba(255, 255, 255, 0.3)',
        },
        scrollback: this.scrollback,
        convertEol: true,
        fastScrollModifier: 'shift',
        fastScrollSensitivity: 1,
        scrollSensitivity: 1,
        allowProposedApi: true,
        smoothScrollDuration: 0,
        wordSeparator: ' ()[]{}",\'`',
        windowOptions: {
          setWinLines: false,
        },
      });

      const fitAddon = new XFitAddon();
      const searchAddon = new XSearchAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);

      const instance: TerminalInstance = {
        terminalId,
        terminal,
        fitAddon,
        searchAddon,
        container: null,
        sessionType,
        createdAt: Date.now(),
        currentPtyId: null,
        needsBufferReplay: false,
        scrollHandler: null,
        inputHandler: null,
      };

      this.terminals.set(terminalId, instance);
      logger.debug('TerminalRenderer', `Created terminal: ${terminalId}`);
      return instance;
    } catch (error) {
      logger.error('TerminalRenderer', `Failed to create terminal ${terminalId}`, error);
      throw new Error(`Terminal creation failed: ${error}`);
    }
  }

  attachToContainer(terminalId: string, container: HTMLElement): void {
    const instance = this.terminals.get(terminalId);
    if (!instance) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }

    if (instance.container === container) {
      logger.debug('TerminalRenderer', `Terminal already attached to container: ${terminalId}`);
      return;
    }

    if (instance.container) {
      logger.debug('TerminalRenderer', `Moving terminal to new container: ${terminalId}`);
    }

    // xterm.open() is a one-time DOM initialization. When a hidden section
    // removes its wrapper, move the existing xterm root instead of opening it a
    // second time; otherwise the textarea/canvas can remain detached and show a
    // blank terminal when the user returns.
    const terminalElement = instance.terminal.element;
    if (terminalElement) {
      if (terminalElement.parentElement !== container) {
        container.appendChild(terminalElement);
      }
    } else {
      instance.terminal.open(container);
    }
    instance.container = container;

    requestAnimationFrame(() => {
      this.fitTerminal(terminalId);
    });

    logger.debug('TerminalRenderer', `Attached terminal to container: ${terminalId}`);
  }

  fitTerminal(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (!instance || !instance.terminal.element || !instance.container) {
      return;
    }

    // Flush the frame-sized queue into the parser tail before measuring. This
    // makes fit() wait for both queued and in-flight xterm writes instead of
    // resizing while xterm is still applying line wraps.
    this.flushPendingWrite(terminalId);

    // ✅ FIX #-1: Enforce reflow cooldown to prevent rapid successive reflows
    const now = Date.now();
    const lastReflow = this.lastReflowTime.get(terminalId) || 0;
    if (now - lastReflow < this.REFLOW_COOLDOWN) {
      const existingTimer = this.fitCooldownTimers.get(terminalId);
      if (!existingTimer) {
        const delay = Math.max(1, this.REFLOW_COOLDOWN - (now - lastReflow));
        const timer = setTimeout(() => {
          this.fitCooldownTimers.delete(terminalId);
          this.fitTerminal(terminalId);
        }, delay);
        this.fitCooldownTimers.set(terminalId, timer);
      }
      logger.debug('TerminalRenderer', `Queued fit after cooldown: ${terminalId} (${now - lastReflow}ms since last)`);
      return;
    }

    // Wait for xterm's actual parser callback, not just the scheduling RAF.
    const pendingWrite = this.writeLocks.get(terminalId);
    if (pendingWrite) {
      if (this.fitAfterWrite.has(terminalId)) return;
      this.fitAfterWrite.add(terminalId);
      pendingWrite.finally(() => {
        this.fitAfterWrite.delete(terminalId);
        this.fitTerminal(terminalId);
      });
      return;
    }

    // ✅ FIX: Mark terminal as fitting to block concurrent writes
    if (this.fittingTerminals.has(terminalId)) {
      this.fitQueued.add(terminalId);
      return;
    }
    this.fittingTerminals.add(terminalId);

    try {
      // Check if container has valid dimensions
      const containerRect = instance.container.getBoundingClientRect();
      const hasValidDimensions = containerRect.width > 0 && containerRect.height > 0;
      const hasOffsetDimensions = instance.container.offsetWidth > 0 && instance.container.offsetHeight > 0;
      
      if (!hasValidDimensions && !hasOffsetDimensions) {
        logger.debug('TerminalRenderer', `Skipping fit - container has no dimensions: ${terminalId}`);
        this.fittingTerminals.delete(terminalId);
        return;
      }

      // Preserve the user's viewport across xterm's reflow. This is separate
      // from ScrollManager's cross-navigation snapshot and also covers rapid
      // drag-resize cycles while the component stays mounted.
      const activeBuffer = instance.terminal.buffer.active;
      const distanceFromBottom = Math.max(
        0,
        activeBuffer.length - (activeBuffer.viewportY + instance.terminal.rows),
      );

      // ✅ FIX #1: Store pre-fit geometry to detect if reflow is actually needed
      const oldCols = instance.terminal.cols;
      const oldRows = instance.terminal.rows;

      instance.fitAddon.fit();
      
      const actualCols = instance.terminal.cols;
      const actualRows = instance.terminal.rows;
      
      // ✅ FIX #2: Only resize PTY if dimensions actually changed (avoid spurious reflows)
      if (actualCols === oldCols && actualRows === oldRows) {
        logger.debug('TerminalRenderer', `Skipping PTY resize - dimensions unchanged: ${terminalId} (${actualCols}x${actualRows})`);
        this.fittingTerminals.delete(terminalId);
        return;
      }

      const nextBuffer = instance.terminal.buffer.active;
      const targetLine = Math.max(
        0,
        nextBuffer.length - distanceFromBottom - instance.terminal.rows,
      );
      instance.terminal.scrollToLine(Math.min(targetLine, Math.max(0, nextBuffer.baseY)));
      
      // ✅ FIX: Record reflow time AFTER confirming dimensions changed
      this.lastReflowTime.set(terminalId, now);
      
      logger.debug('TerminalRenderer', `Fitted terminal ${terminalId}: ${oldCols}x${oldRows} → ${actualCols}x${actualRows}`);

      // ✅ FIX #3: Notify PTY of new dimensions BEFORE writing new content
      // This ensures the PTY matches xterm width before any new output arrives
      if (window.electron && instance.currentPtyId) {
        window.electron.resizeTerminal({
          sessionId: instance.currentPtyId,
          cols: actualCols,
          rows: actualRows,
        }).catch(error => {
          logger.warn('TerminalRenderer', 'PTY resize failed', error);
        });
      }
    } catch (error) {
      logger.error('TerminalRenderer', `Fit operation failed for ${terminalId}`, error);
    } finally {
      this.fittingTerminals.delete(terminalId);
      if (this.fitQueued.delete(terminalId)) {
        requestAnimationFrame(() => this.fitTerminal(terminalId));
      }
    }
  }

  writeToTerminal(terminalId: string, data: string): void {
    const instance = this.terminals.get(terminalId);
    if (!instance || !instance.terminal.element) {
      return;
    }

    const generation = this.getWriteGeneration(terminalId);

    try {
      // Batch writes using requestAnimationFrame for smooth 60fps scrolling.
      // The batch remains in memory until xterm acknowledges it through the
      // write callback; this is bounded and lossless for the renderer path.
      let batch = this.writeBatches.get(terminalId);
      
      if (!batch) {
        batch = {
          buffer: '',
          rafId: null,
        };
        this.writeBatches.set(terminalId, batch);
      }
      
      // Add data to buffer
      batch.buffer += data;
      // Chromium can pause RAF for a hidden/minimized window. Flush a large
      // burst immediately so output does not sit in an unbounded pending
      // string, while still serializing it behind any parser work in flight.
      if (batch.buffer.length >= 262144) {
        this.flushPendingWrite(terminalId);
      } else {
        this.scheduleWriteFlush(terminalId, generation);
      }
    } catch (error) {
      logger.error('TerminalRenderer', `Write error for ${terminalId}`, error);
    }
  }

  private scheduleWriteFlush(terminalId: string, generation: object): void {
    const batch = this.writeBatches.get(terminalId);
    if (!batch || batch.rafId !== null) return;

    batch.rafId = requestAnimationFrame(() => {
      const currentBatch = this.writeBatches.get(terminalId);
      if (!currentBatch) return;
      currentBatch.rafId = null;
      if (this.getWriteGeneration(terminalId) !== generation) {
        currentBatch.buffer = '';
        return;
      }
      this.flushPendingWrite(terminalId);
    });
  }

  private flushPendingWrite(terminalId: string): void {
    const batch = this.writeBatches.get(terminalId);
    if (!batch) return;

    if (batch.rafId !== null) {
      cancelAnimationFrame(batch.rafId);
      batch.rafId = null;
    }

    const payload = batch.buffer;
    if (!payload) return;
    batch.buffer = '';

    const generation = this.getWriteGeneration(terminalId);
    const previous = this.writeLocks.get(terminalId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
      const instance = this.terminals.get(terminalId);
      if (!instance || !instance.terminal.element || this.getWriteGeneration(terminalId) !== generation) {
        resolve();
        return;
      }

      let settled = false;
      let safetyTimer: ReturnType<typeof setTimeout> | null = null;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (safetyTimer) clearTimeout(safetyTimer);
        resolve();
      };

      try {
        // The callback fires after xterm has parsed the payload, which is the
        // safe point for a reflow. The fallback only protects against a
        // disposed/failed parser callback and never drops the payload.
        instance.terminal.write(payload, settle);
        safetyTimer = setTimeout(settle, 5000);
      } catch (error) {
        logger.error('TerminalRenderer', `Batched write error for ${terminalId}`, error);
        settle();
      }
    }));

    this.writeLocks.set(terminalId, next);
    next.finally(() => {
      if (this.writeLocks.get(terminalId) === next) {
        this.writeLocks.delete(terminalId);
        const currentBatch = this.writeBatches.get(terminalId);
        if (currentBatch?.buffer && currentBatch.rafId === null) {
          this.scheduleWriteFlush(terminalId, this.getWriteGeneration(terminalId));
        }
      }
    });
  }

  focusTerminal(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (!instance || !instance.terminal.element) {
      logger.warn('TerminalRenderer', `Cannot focus - terminal not ready: ${terminalId}`);
      return;
    }

    try {
      // ✅ ROOT CAUSE FIX: Ensure terminal textarea exists before focusing
      const textarea = instance.terminal.element.querySelector('textarea');
      if (!textarea) {
        logger.warn('TerminalRenderer', `Cannot focus - textarea not found: ${terminalId}`);
        return;
      }
      
      instance.terminal.focus();
      logger.debug('TerminalRenderer', `Focused terminal: ${terminalId}`);
    } catch (error) {
      logger.warn('TerminalRenderer', `Focus error for ${terminalId}`, error);
    }
  }

  refreshTerminal(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (!instance) {
      return;
    }

    try {
      instance.terminal.refresh(0, instance.terminal.rows - 1);
    } catch (error) {
      logger.warn('TerminalRenderer', `Refresh error for ${terminalId}`, error);
    }
  }

  /** Start loading xterm in the background without waiting for a terminal mount. */
  preload(): void {
    void this.loadXtermModules().catch(() => {
      // The next createTerminal call reports the actionable error. Preloading is
      // deliberately best-effort so it never blocks PTY/WSL startup.
    });
  }

  /** Clear a terminal without destroying the reusable xterm instance. */
  clearTerminal(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (!instance) return;

    // xterm parses writes asynchronously. Preserve the current parser tail as
    // a barrier: clearing synchronously while an older payload is still being
    // parsed lets that payload repaint the supposedly cleared screen. New
    // writes are chained behind the clear so a fast Stop -> Start cannot
    // resurrect an old prompt or transcript.
    const previousWrite = this.writeLocks.get(terminalId) || Promise.resolve();
    this.invalidateWriteGeneration(terminalId);

    const batch = this.writeBatches.get(terminalId);
    if (batch?.rafId !== null && batch?.rafId !== undefined) {
      cancelAnimationFrame(batch.rafId);
    }
    this.writeBatches.delete(terminalId);
    this.fitAfterWrite.delete(terminalId);
    this.fitQueued.delete(terminalId);

    const clearPromise = previousWrite
      .catch(() => undefined)
      .then(() => {
        const current = this.terminals.get(terminalId);
        if (current !== instance) return;

        try {
           // `reset()` also places the cursor at row zero. `clear()` only
           // erases cells and can leave a stale cursor/viewport after repeated
           // panel drags, which presents as a large blank terminal region.
           // This path is explicit reset/recovery only; normal scanner reruns
           // never call clearTerminal and therefore retain their transcript.
           instance.terminal.reset();
        } catch (error) {
          logger.warn('TerminalRenderer', `Clear error for ${terminalId}`, error);
        }
      });

    this.writeLocks.set(terminalId, clearPromise);
    void clearPromise.finally(() => {
      if (this.writeLocks.get(terminalId) === clearPromise) {
        this.writeLocks.delete(terminalId);
      }
    });
  }

  getTerminal(terminalId: string): Terminal | null {
    return this.terminals.get(terminalId)?.terminal || null;
  }

  getTerminalInstance(terminalId: string): TerminalInstance | undefined {
    return this.terminals.get(terminalId);
  }

  getFitAddon(terminalId: string): FitAddon | null {
    return this.terminals.get(terminalId)?.fitAddon || null;
  }

  getSearchAddon(terminalId: string): SearchAddon | null {
    return this.terminals.get(terminalId)?.searchAddon || null;
  }

  hasTerminal(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }

  destroyTerminal(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (!instance) {
      return;
    }

    this.invalidateWriteGeneration(terminalId);

    logger.debug('TerminalRenderer', `Destroying terminal: ${terminalId}`);
    
    // ✅ PERFORMANCE FIX: Cancel any pending write batches
    const batch = this.writeBatches.get(terminalId);
    if (batch && batch.rafId !== null) {
      cancelAnimationFrame(batch.rafId);
    }
    this.writeBatches.delete(terminalId);
    
    // ✅ FIX: Clear coordination locks
    this.writeLocks.delete(terminalId);
    this.fittingTerminals.delete(terminalId);
    this.fitAfterWrite.delete(terminalId);
    this.fitQueued.delete(terminalId);
    const cooldownTimer = this.fitCooldownTimers.get(terminalId);
    if (cooldownTimer) clearTimeout(cooldownTimer);
    this.fitCooldownTimers.delete(terminalId);
    this.lastReflowTime.delete(terminalId);
    this.writeGenerations.delete(terminalId);

    if (instance.scrollHandler) {
      instance.scrollHandler.dispose();
      instance.scrollHandler = null;
    }

    if (instance.inputHandler) {
      instance.inputHandler.dispose();
      instance.inputHandler = null;
    }

    try {
      instance.terminal.dispose();
    } catch (error) {
      logger.warn('TerminalRenderer', `Error disposing terminal: ${terminalId}`, error);
    }

    this.terminals.delete(terminalId);
    logger.debug('TerminalRenderer', `Terminal destroyed: ${terminalId}`);
  }

  private cleanupOldestTerminal(): void {
    const terminals = Array.from(this.terminals.entries())
      .sort(([_, a], [__, b]) => a.createdAt - b.createdAt);

    if (terminals.length > 0) {
      const [oldestId] = terminals[0];
      logger.info('TerminalRenderer', `Auto-cleaning oldest terminal: ${oldestId}`);
      this.destroyTerminal(oldestId);
      this.terminalEvictionHandler?.(oldestId);
    }
  }

  private loadXtermModules() {
    if (this.xtermModulesPromise) return this.xtermModulesPromise;

    this.xtermModulesPromise = (async () => {
      try {
        const [
          { Terminal: XTerminal },
          { FitAddon: XFitAddon },
          { SearchAddon: XSearchAddon }
        ] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-search')
        ]);

        // Import CSS separately to avoid potential issues
        try {
          await import('@xterm/xterm/css/xterm.css');
        } catch (cssError) {
          logger.warn('TerminalRenderer', 'Failed to load xterm CSS, continuing without it', cssError);
        }

        return { Terminal: XTerminal, FitAddon: XFitAddon, SearchAddon: XSearchAddon };
      } catch (error) {
        this.xtermModulesPromise = null;
        logger.error('TerminalRenderer', 'Failed to load xterm modules', error);
        throw new Error(`Failed to load terminal modules: ${error}`);
      }
    })();

    return this.xtermModulesPromise;
  }

  destroyAll(): void {
    logger.info('TerminalRenderer', 'Destroying all terminals');
    
    // ✅ PERFORMANCE FIX: Cancel all pending write batches
    for (const [terminalId, batch] of this.writeBatches.entries()) {
      if (batch.rafId !== null) {
        cancelAnimationFrame(batch.rafId);
      }
    }
    this.writeBatches.clear();
    
    // ✅ FIX: Clear all coordination locks
    this.writeLocks.clear();
    this.fittingTerminals.clear();
    this.fitAfterWrite.clear();
    this.fitQueued.clear();
    for (const timer of this.fitCooldownTimers.values()) clearTimeout(timer);
    this.fitCooldownTimers.clear();
    this.lastReflowTime.clear();
    this.writeGenerations.clear();
    
    Array.from(this.terminals.keys()).forEach(id => this.destroyTerminal(id));
    this.terminals.clear();
  }

  getStats() {
    return {
      totalTerminals: this.terminals.size,
      maxTerminals: this.maxTerminals,
      totalScrollbackLines: Array.from(this.terminals.values())
        .reduce((total, instance) => total + (instance.terminal.buffer.active.length || 0), 0),
      // xterm exposes line counts rather than byte usage. This conservative
      // estimate gives the memory monitor visibility into scrollback without
      // walking every line on every health check.
      estimatedScrollbackBytes: Array.from(this.terminals.values())
        .reduce((total, instance) => {
          const lines = instance.terminal.buffer.active.length || 0;
          const columns = Math.max(instance.terminal.cols || 0, 80);
          return total + (lines * columns * 2);
        }, 0),
      terminals: Array.from(this.terminals.entries()).map(([id, instance]) => ({
        id,
        sessionType: instance.sessionType,
        currentPtyId: instance.currentPtyId,
        hasContainer: !!instance.container,
        createdAt: instance.createdAt,
      })),
    };
  }
}
