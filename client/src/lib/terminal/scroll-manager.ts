/**
 * Scroll Manager - Handles scroll position preservation
 */

import { logger } from '@/lib/utils/logger';
import type { Terminal } from '@xterm/xterm';

export interface ScrollState {
  terminalId: string;
  savedPosition?: number;
  lastPosition: number;
  // FIX #1: Store distance-from-bottom instead of absolute line index
  // This survives reflows that change total line count
  distanceFromBottom?: number;
  totalLines?: number;
}

export class ScrollManager {
  private scrollStates = new Map<string, ScrollState>();
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private restoreGenerations = new Map<string, number>();

  saveScrollPosition(terminalId: string, terminal: Terminal): void {
    try {
      const buffer = terminal.buffer.active;
      const position = buffer.viewportY;
      const totalLines = buffer.length;
      
      // Calculate the distance from the user's visible viewport to the end of
      // the buffer. `baseY` is the buffer's current scroll origin, not the
      // user's viewport position; using it here made every saved position look
      // like "at bottom" and a resize/navigation cycle snapped the terminal
      // back to the newest output.
      const visibleBottomLine = position + terminal.rows;
      const distanceFromBottom = Math.max(0, totalLines - visibleBottomLine);
      
      const state = this.scrollStates.get(terminalId) || {
        terminalId,
        lastPosition: 0,
      };
      
      state.savedPosition = position;
      state.lastPosition = position;
      state.distanceFromBottom = distanceFromBottom;
      state.totalLines = totalLines;
      
      this.scrollStates.set(terminalId, state);
      logger.debug('ScrollManager', `Saved scroll position for ${terminalId}: pos=${position}, fromBottom=${distanceFromBottom}, total=${totalLines}`);
    } catch (error) {
      logger.warn('ScrollManager', 'Save scroll position error', error);
    }
  }

  restoreScrollPosition(terminalId: string, terminal: Terminal): void {
    try {
      const state = this.scrollStates.get(terminalId);
      if (!state) {
        return;
      }

      const buffer = terminal.buffer.active;
      const currentTotalLines = buffer.length;
      
      // FIX #3: Restore using distance-from-bottom if available (reflow-safe)
      // Falls back to absolute position only if distance isn't set
      let targetLine: number;
      
      if (state.distanceFromBottom !== undefined && state.totalLines !== undefined) {
        // Reflow may have changed total line count — use distance-from-bottom
        const currentBottomLine = currentTotalLines - state.distanceFromBottom;
        targetLine = Math.max(0, currentBottomLine - terminal.rows);
        
        logger.debug('ScrollManager', `Restoring scroll for ${terminalId}: fromBottom=${state.distanceFromBottom}, oldTotal=${state.totalLines}, newTotal=${currentTotalLines}, target=${targetLine}`);
      } else {
        // Fallback to absolute position (legacy or first save)
        targetLine = state.savedPosition || 0;
        logger.debug('ScrollManager', `Restoring scroll for ${terminalId} (absolute): ${targetLine}`);
      }
      
      // Always apply the clamped position, including zero. Returning early at
      // the top left a previous viewport in place after a reflow.
      const maxTargetLine = Math.max(0, buffer.baseY);
      terminal.scrollToLine(Math.min(targetLine, maxTargetLine));
      
      // Force refresh to ensure scroll is applied, but invalidate older
      // refreshes when a user drags the scrollbar or a panel reflows again.
      const generation = (this.restoreGenerations.get(terminalId) || 0) + 1;
      this.restoreGenerations.set(terminalId, generation);
      const previousTimer = this.refreshTimers.get(terminalId);
      if (previousTimer) clearTimeout(previousTimer);
      const refreshTimer = setTimeout(() => {
        this.refreshTimers.delete(terminalId);
        if (this.restoreGenerations.get(terminalId) !== generation) return;
        try {
          terminal.refresh(0, terminal.rows - 1);
        } catch (error) {
          logger.debug('ScrollManager', `Skipped stale terminal refresh for ${terminalId}`, error);
        }
      }, 25);
      this.refreshTimers.set(terminalId, refreshTimer);
    } catch (error) {
      logger.warn('ScrollManager', 'Restore scroll position error', error);
    }
  }

  lockScrollPosition(terminalId: string, terminal: Terminal): void {
    try {
      const buffer = terminal.buffer.active;
      const position = buffer.viewportY;
      const distanceFromBottom = Math.max(
        0,
        buffer.length - (position + terminal.rows),
      );
      
      const state = this.scrollStates.get(terminalId) || {
        terminalId,
        lastPosition: 0,
      };
      
      state.savedPosition = position;
      state.lastPosition = position;
      state.distanceFromBottom = distanceFromBottom;
      state.totalLines = buffer.length;
      
      this.scrollStates.set(terminalId, state);
      logger.debug('ScrollManager', `Locked scroll position for ${terminalId}: ${position}`);
    } catch (error) {
      logger.warn('ScrollManager', 'Lock scroll position error', error);
    }
  }

  scrollToBottom(terminalId: string, terminal: Terminal): void {
    try {
      const buffer = terminal.buffer.active;
      const bottomLine = buffer.baseY + terminal.rows - 1;
      terminal.scrollToLine(bottomLine);
      
      const state = this.scrollStates.get(terminalId) || {
        terminalId,
        lastPosition: 0,
      };
      
      state.lastPosition = bottomLine;
      this.scrollStates.set(terminalId, state);
      
      logger.debug('ScrollManager', `Scrolled to bottom for ${terminalId}: ${bottomLine}`);
    } catch (error) {
      logger.warn('ScrollManager', 'Scroll to bottom error', error);
    }
  }

  updateLastPosition(terminalId: string, position: number): void {
    const state = this.scrollStates.get(terminalId) || {
      terminalId,
      lastPosition: 0,
    };
    
    state.lastPosition = position;
    this.scrollStates.set(terminalId, state);
  }

  getScrollState(terminalId: string): ScrollState | undefined {
    return this.scrollStates.get(terminalId);
  }

  clearScrollState(terminalId: string): void {
    this.scrollStates.delete(terminalId);
    const timer = this.refreshTimers.get(terminalId);
    if (timer) clearTimeout(timer);
    this.refreshTimers.delete(terminalId);
    this.restoreGenerations.delete(terminalId);
  }

  clearAllScrollStates(): void {
    this.scrollStates.clear();
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    this.restoreGenerations.clear();
  }

  getStats() {
    return {
      totalStates: this.scrollStates.size,
      states: Array.from(this.scrollStates.entries()).map(([terminalId, state]) => ({
        terminalId,
        savedPosition: state.savedPosition,
        lastPosition: state.lastPosition,
      })),
    };
  }
}
