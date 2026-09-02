/**
 * PTY Manager - Handles process lifecycle only
 */

import { logger } from '@/lib/utils/logger';
import { TERMINAL_CONSTANTS } from '@/lib/constants';

export type SessionType = 'scan' | 'foothold' | 'tunneling' | 'metasploit' | 'general';

export interface PTYInstance {
  ptyId: string;
  sessionType: SessionType;
  isActive: boolean;
  isAttached: boolean;
  createdAt: number;
  outputCleanup: (() => void) | null;
  closedCleanup: (() => void) | null;
  errorCleanup: (() => void) | null;
}

export class PTYManager {
  private ptys = new Map<string, PTYInstance>();
  private readonly MAX_PTYS = TERMINAL_CONSTANTS.MAX_PTYS;

  constructor(private readonly onDestroy?: (ptyId: string, sessionType: SessionType) => void) {}

  createPTY(ptyId: string, sessionType: SessionType = 'general'): PTYInstance {
    if (!ptyId || ptyId === 'undefined' || ptyId === 'null') {
      throw new Error(`Invalid PTY ID: "${ptyId}"`);
    }

    if (this.ptys.has(ptyId)) {
      logger.debug('PTYManager', `PTY already exists: ${ptyId}`);
      return this.ptys.get(ptyId)!;
    }

    if (this.ptys.size >= this.MAX_PTYS) {
      this.cleanupOldestInactive();
    }

    const pty: PTYInstance = {
      ptyId,
      sessionType,
      isActive: false,
      isAttached: false,
      createdAt: Date.now(),
      outputCleanup: null,
      closedCleanup: null,
      errorCleanup: null,
    };

    this.ptys.set(ptyId, pty);
    logger.debug('PTYManager', `Created PTY: ${ptyId}`);
    return pty;
  }

  destroyPTY(ptyId: string): void {
    const pty = this.ptys.get(ptyId);
    if (!pty) {
      logger.debug('PTYManager', `PTY not found: ${ptyId}`);
      return;
    }

    logger.debug('PTYManager', `Destroying PTY: ${ptyId}`);

    try {
      this.onDestroy?.(ptyId, pty.sessionType);

      if (pty.outputCleanup) {
        pty.outputCleanup();
        pty.outputCleanup = null;
      }
      if (pty.closedCleanup) {
        pty.closedCleanup();
        pty.closedCleanup = null;
      }
      if (pty.errorCleanup) {
        pty.errorCleanup();
        pty.errorCleanup = null;
      }
    } catch (error) {
      logger.error('PTYManager', 'Error disposing PTY handlers', error);
    }

    // PTYManager is intentionally storage/lifecycle-state only. Backend
    // termination belongs to TerminalService so a caller cannot accidentally
    // issue a second stop while it is also cleaning up a session.
    this.ptys.delete(ptyId);
    logger.debug('PTYManager', `PTY destroyed: ${ptyId}`);
  }

  /**
   * Remove renderer bookkeeping for a backend that has already exited.
   *
   * Unlike destroyPTY(), this must not invoke the onDestroy callback. Recovery
   * immediately creates a new PTY with the same stable id; issuing a second
   * stop for the old process can race that new start and terminate the
   * replacement session.
   */
  forgetPTY(ptyId: string): void {
    if (!this.ptys.delete(ptyId)) {
      logger.debug('PTYManager', `PTY already forgotten: ${ptyId}`);
      return;
    }

    logger.debug('PTYManager', `Forgot exited PTY without backend stop: ${ptyId}`);
  }

  getPTY(ptyId: string): PTYInstance | undefined {
    return this.ptys.get(ptyId);
  }

  hasPTY(ptyId: string): boolean {
    return this.ptys.has(ptyId);
  }

  getAllPTYs(): Map<string, PTYInstance> {
    return new Map(this.ptys);
  }

  private cleanupOldestInactive(): void {
    const inactivePTYs = Array.from(this.ptys.entries())
      .filter(([_, pty]) => !pty.isActive && !pty.isAttached)
      .sort(([_, a], [__, b]) => a.createdAt - b.createdAt);

    if (inactivePTYs.length > 0) {
      const [oldestId] = inactivePTYs[0];
      logger.info('PTYManager', `Auto-cleaning oldest inactive PTY: ${oldestId}`);
      this.destroyPTY(oldestId);
    }
  }

  destroyAll(): void {
    logger.info('PTYManager', 'Destroying all PTYs');
    Array.from(this.ptys.keys()).forEach(id => this.destroyPTY(id));
    this.ptys.clear();
  }
}
