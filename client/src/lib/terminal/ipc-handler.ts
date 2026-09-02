/**
 * IPC Handler - Manages Electron IPC communication for terminals
 */

import { logger } from '@/lib/utils/logger';
import type { PTYInstance } from './pty-manager';

export interface IPCHandlers {
  outputHandler: () => void;
  closedHandler: () => void;
  errorHandler: () => void;
}

export class IPCHandler {
  private handlers = new Map<string, IPCHandlers>();
  private outputCallbacks = new Map<string, (data: string) => void>();
  private outputRouterCleanup: (() => void) | null = null;

  private ensureOutputRouter(): void {
    if (this.outputRouterCleanup || !window.electron?.onListenerOutput) return;

    this.outputRouterCleanup = window.electron.onListenerOutput((data: { listenerId: string; data: string }) => {
      const callback = this.outputCallbacks.get(data.listenerId);
      if (callback && data.data) callback(data.data);
    });
  }

  private cleanupOutputRouterIfIdle(): void {
    if (this.handlers.size > 0 || this.outputCallbacks.size > 0) return;
    this.outputRouterCleanup?.();
    this.outputRouterCleanup = null;
  }

  setupPTYHandlers(
    pty: PTYInstance,
    onOutput: (data: string) => void,
    onClosed: (code: number) => void,
    onError: (error: string) => void
  ): void {
    if (!window.electron) {
      throw new Error('Electron API not available');
    }

    // Clean up existing handlers FIRST to prevent leaks
    this.cleanupHandlers(pty.ptyId);

    // Add stale handler guard to prevent memory leaks
    this.ensureOutputRouter();
    this.outputCallbacks.set(pty.ptyId, onOutput);
    const outputHandler = () => {
      this.outputCallbacks.delete(pty.ptyId);
    };

    const closedHandler = window.electron.onListenerClosed?.((data: { listenerId: string; code: number }) => {
      // Guard against stale handlers after cleanup
      if (!this.handlers.has(pty.ptyId)) return;
      if (data.listenerId !== pty.ptyId) return;
      onClosed(data.code);
    });

    const errorHandler = window.electron.onListenerError?.((data: { listenerId: string; error: string }) => {
      // Guard against stale handlers after cleanup
      if (!this.handlers.has(pty.ptyId)) return;
      if (data.listenerId !== pty.ptyId) return;
      onError(data.error);
    });

    this.handlers.set(pty.ptyId, {
      outputHandler: outputHandler || (() => {}),
      closedHandler: closedHandler || (() => {}),
      errorHandler: errorHandler || (() => {}),
    });

    // Store cleanup functions in PTY instance
    pty.outputCleanup = outputHandler;
    pty.closedCleanup = closedHandler;
    pty.errorCleanup = errorHandler;

    logger.debug('IPCHandler', `Setup handlers for PTY: ${pty.ptyId}`);
  }

  cleanupHandlers(ptyId: string): void {
    const handlers = this.handlers.get(ptyId);
    if (!handlers) {
      return;
    }

    try {
      handlers.outputHandler();
      handlers.closedHandler();
      handlers.errorHandler();
    } catch (error) {
      logger.warn('IPCHandler', `Error cleaning up handlers for ${ptyId}`, error);
    }

    this.handlers.delete(ptyId);
    this.cleanupOutputRouterIfIdle();
    logger.debug('IPCHandler', `Cleaned up handlers for PTY: ${ptyId}`);
  }

  async startPTY(ptyId: string, sessionType: string): Promise<void> {
    if (!window.electron) {
      throw new Error('Electron API not available');
    }

    // FIX: Don't start PTY for metasploit sessions
    if (sessionType === 'metasploit') {
      logger.debug('IPCHandler', `Skipping PTY start for metasploit session: ${ptyId}`);
      return;
    }

    try {
      let result: {
        success: boolean;
        listenerId?: string;
        error?: string;
        cancelled?: boolean;
        starting?: boolean;
      } = { success: false, error: 'PTY start did not return a result' };

      // Older/equivalent backends may answer a duplicate start with a
      // temporary `starting` acknowledgement. Do not mark the renderer PTY
      // active from that acknowledgement; wait for the owner startup to
      // finish and read the final result instead.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        result = await window.electron.startListener({
          command: 'bash', // Default interactive shell
          listenerId: ptyId,
        });
        if (!(result as any).starting) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to start PTY');
      }

      // A listener can be stopped while WSL is still booting/history is being
      // initialized. The backend returns a successful, idempotent cancellation
      // result so Stop itself does not surface an error, but this renderer PTY
      // must not be marked active when no process was registered.
      if ((result as { cancelled?: boolean }).cancelled) {
        throw new Error('PTY startup cancelled');
      }

      logger.debug('IPCHandler', `Started PTY: ${ptyId}`);
    } catch (error) {
      logger.error('IPCHandler', `Failed to start PTY: ${ptyId}`, error);
      throw error;
    }
  }

  async stopPTY(ptyId: string): Promise<void> {
    if (!window.electron) {
      return;
    }

    try {
      await window.electron.stopListener(ptyId);
      logger.debug('IPCHandler', `Stopped PTY: ${ptyId}`);
    } catch (error) {
      logger.warn('IPCHandler', `Failed to stop PTY: ${ptyId}`, error);
    }
  }

  async writeToListener(ptyId: string, data: string): Promise<void> {
    if (!window.electron) {
      throw new Error('Electron API not available');
    }

    // Metasploit has a persistent backend-owned PTY. Route it through its
    // dedicated IPC channel so the manager can queue input while the prompt
    // is starting; the generic listener path used to drop those keystrokes.
    if (ptyId === 'msf-console-persistent') {
      window.electron.msfConsoleInput(data);
      return;
    }

    // True fire-and-forget - no await, no catch. Let the write happen
    // asynchronously without blocking the UI thread for regular PTYs.
    window.electron.writeToListener({
      listenerId: ptyId,
      data,
    });
  }

  async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
    if (!window.electron) {
      return;
    }

    try {
      await window.electron.resizeTerminal({
        sessionId,
        cols,
        rows,
      });
    } catch (error) {
      logger.warn('IPCHandler', `Failed to resize terminal: ${sessionId}`, error);
    }
  }

  cleanupAll(): void {
    logger.info('IPCHandler', 'Cleaning up all IPC handlers');
    Array.from(this.handlers.keys()).forEach(ptyId => this.cleanupHandlers(ptyId));
    this.handlers.clear();
    this.outputCallbacks.clear();
    this.cleanupOutputRouterIfIdle();
  }

  getStats() {
    return {
      totalHandlers: this.handlers.size,
      handlers: Array.from(this.handlers.keys()),
    };
  }
}
