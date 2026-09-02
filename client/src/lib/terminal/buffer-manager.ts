/**
 * Buffer Manager - Handles output buffering and memory management
 */

import { TERMINAL_CONSTANTS } from '@/lib/constants';
import { logger } from '@/lib/utils/logger';
import { useSettingsStore } from '@/lib/settings-store';

export class BufferManager {
  // This is a renderer cache, not the evidence store. Keep a process-wide
  // ceiling so many quiet terminals cannot retain many independent multi-MB
  // strings after the user has moved on. Electron history remains complete;
  // a released terminal rehydrates its newest tail from disk.
  private readonly MAX_TOTAL_BUFFER_CHARS = 64 * 1024 * 1024;
  private buffers = new Map<string, string>();
  private localBuffers = new Map<string, string[]>();
  private localBufferSizes = new Map<string, number>();
  private flushTimeouts = new Map<string, NodeJS.Timeout>();
  private lastAppendTime = new Map<string, number>();
  private pendingData = new Map<string, string[]>();
  private pendingDataSizes = new Map<string, number>();
  // Renderer-only truncation accounting. The durable Electron history owns
  // the complete stream, so this is a view-cache metric rather than evidence
  // loss.
  private droppedChars = new Map<string, number>();

  private get maxBufferChars(): number {
    const configuredMB = useSettingsStore.getState().settings.terminalBufferSize;
    // The UI uses 0 for the user's "unlimited" choice. Keep that choice
    // usable while enforcing the hard safety ceiling so a noisy tool cannot
    // consume the renderer's memory indefinitely.
    // A zero setting means "managed", not an unbounded renderer buffer.
    // Keep the recovery buffer small enough that several concurrent terminals
    // do not duplicate hundreds of megabytes of output in the renderer.
    const maxMB = configuredMB <= 0 ? 4 : Math.min(configuredMB, 8);
    return maxMB * 1024 * 1024;
  }

  private recordDroppedChars(ptyId: string, count: number): void {
    if (count <= 0) return;
    this.droppedChars.set(ptyId, (this.droppedChars.get(ptyId) || 0) + count);
  }

  appendToBuffer(ptyId: string, data: string): void {
    if (!data) return;

    // Check size BEFORE append to prevent OOM
    const currentSize = this.getBufferSize(ptyId);
    const maxChars = this.maxBufferChars;
    
    // Never drop an entire newest chunk. Very large tool bursts used to be
    // rejected once the recovery buffer was near its cap, which made the last
    // ports/findings from a scan disappear. Keep the newest bounded tail and
    // let the normal cap logic trim older content below.
    if (data.length > maxChars) {
      logger.warn('BufferManager', `Trimming oversized append: ${data.length} bytes for ${ptyId}`);
      this.recordDroppedChars(ptyId, data.length - maxChars);
      data = data.slice(-maxChars);
    }

    // Rate limit per PTY to prevent flooding
    const now = Date.now();
    const lastAppend = this.lastAppendTime.get(ptyId) || 0;
    if (now - lastAppend < 10) { // 10ms minimum between appends
      const pending = this.pendingData.get(ptyId) || [];
      pending.push(data);
      this.pendingData.set(ptyId, pending);
      this.pendingDataSizes.set(ptyId, (this.pendingDataSizes.get(ptyId) || 0) + data.length);
      this.enforcePendingLimit(ptyId);
      // FIX: Schedule a flush so trailing data isn't stuck forever
      this.schedulePendingFlush(ptyId);
      this.enforceGlobalLimit(ptyId);
      return;
    }
    
    this.lastAppendTime.set(ptyId, now);
    
    // Flush any pending data
    const pending = this.pendingData.get(ptyId);
    if (pending && pending.length > 0) {
      data = pending.join('') + data;
      this.pendingData.delete(ptyId);
      this.pendingDataSizes.delete(ptyId);
    }

    const currentBuffer = this.buffers.get(ptyId) || '';
    const localChunks = this.localBuffers.get(ptyId) || [];
    const localSize = this.localBufferSizes.get(ptyId) || 0;
    const totalLength = currentBuffer.length + localSize + data.length;

    if (totalLength > maxChars) {
      // Only join/trim when the cap is reached. Normal PTY chunks stay O(1)
      // instead of copying the complete local buffer on every append.
      localChunks.push(data);
      const combined = currentBuffer + localChunks.join('');
      const keepChars = Math.floor(maxChars * 0.75);
      this.recordDroppedChars(ptyId, combined.length - keepChars);
      this.buffers.set(ptyId, keepChars > 0 ? combined.slice(-keepChars) : '');
      this.localBuffers.delete(ptyId);
      this.localBufferSizes.delete(ptyId);
      logger.warn('BufferManager', `Trimmed ${combined.length - keepChars} chars from buffer: ${ptyId}`);
    } else {
      localChunks.push(data);
      this.localBuffers.set(ptyId, localChunks);
      this.localBufferSizes.set(ptyId, localSize + data.length);
    }
    this.scheduleFlush(ptyId);
    this.enforceGlobalLimit(ptyId);
  }

  private pendingFlushTimeouts = new Map<string, NodeJS.Timeout>();

  private enforcePendingLimit(ptyId: string): void {
    const pending = this.pendingData.get(ptyId);
    if (!pending || pending.length === 0) return;

    // A noisy PTY can produce output faster than the coalescing timer. Keep a
    // bounded newest tail while it is waiting so pending chunks cannot bypass
    // the normal per-PTY recovery limit.
    const maxPendingChars = Math.floor(this.maxBufferChars * 0.5);
    const pendingSize = this.pendingDataSizes.get(ptyId) || 0;
    if (pendingSize <= maxPendingChars) return;

    const bounded = pending.join('').slice(-maxPendingChars);
    this.recordDroppedChars(ptyId, pendingSize - bounded.length);
    this.pendingData.set(ptyId, bounded ? [bounded] : []);
    this.pendingDataSizes.set(ptyId, bounded.length);
    logger.warn('BufferManager', `Trimmed pending PTY output for ${ptyId}`);
  }

  private enforceGlobalLimit(protectedPtyId?: string): void {
    let total = this.getTotalMemoryUsage();
    if (total <= this.MAX_TOTAL_BUFFER_CHARS) return;

    const candidates = Array.from(new Set([
      ...this.buffers.keys(),
      ...this.localBuffers.keys(),
      ...this.pendingData.keys(),
    ]))
      .filter(ptyId => ptyId !== protectedPtyId)
      .sort((left, right) => (this.lastAppendTime.get(left) || 0) - (this.lastAppendTime.get(right) || 0));

    for (const ptyId of candidates) {
      if (total <= this.MAX_TOTAL_BUFFER_CHARS) break;

      const currentSize = this.getBufferSize(ptyId);
      if (currentSize <= 0) continue;

      // Keep a useful tail for the next attach while returning cold renderer
      // memory. The durable transcript is never touched by this path.
      const available = Math.max(0, this.MAX_TOTAL_BUFFER_CHARS - (total - currentSize));
      const keepChars = Math.min(currentSize, Math.max(0, Math.floor(Math.min(
        this.maxBufferChars * 0.25,
        available,
      ))));
      const combined = (this.buffers.get(ptyId) || '')
        + (this.localBuffers.get(ptyId) || []).join('')
        + (this.pendingData.get(ptyId) || []).join('');

      this.buffers.set(ptyId, keepChars > 0 ? combined.slice(-keepChars) : '');
      this.localBuffers.delete(ptyId);
      this.localBufferSizes.delete(ptyId);
      this.pendingData.delete(ptyId);
      this.pendingDataSizes.delete(ptyId);

      const pendingTimeout = this.pendingFlushTimeouts.get(ptyId);
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        this.pendingFlushTimeouts.delete(ptyId);
      }

      const dropped = Math.max(0, combined.length - keepChars);
      this.recordDroppedChars(ptyId, dropped);
      total -= Math.max(0, currentSize - keepChars);
      logger.warn('BufferManager', `Trimmed cold renderer cache for ${ptyId}: ${dropped} chars`);
    }
  }

  private schedulePendingFlush(ptyId: string): void {
    // Don't schedule if already scheduled
    if (this.pendingFlushTimeouts.has(ptyId)) return;

    const timeout = setTimeout(() => {
      this.pendingFlushTimeouts.delete(ptyId);
      const pending = this.pendingData.get(ptyId);
      if (pending && pending.length > 0) {
        this.pendingData.delete(ptyId);
        this.pendingDataSizes.delete(ptyId);
        // Route delayed data through the same bounded append path as live
        // output so a full committed buffer cannot be exceeded on flush.
        this.lastAppendTime.delete(ptyId);
        this.appendToBuffer(ptyId, pending.join(''));
      }
    }, 50); // Flush trailing data after 50ms

    this.pendingFlushTimeouts.set(ptyId, timeout);
  }

  private scheduleFlush(ptyId: string): void {
    const existingTimeout = this.flushTimeouts.get(ptyId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      this.flushBuffer(ptyId);
    }, TERMINAL_CONSTANTS.OUTPUT_BATCH_INTERVAL);

    this.flushTimeouts.set(ptyId, timeout);
  }

  private flushBuffer(ptyId: string): void {
    const localBuffer = this.localBuffers.get(ptyId);
    if (!localBuffer || localBuffer.length === 0) return;

    const currentBuffer = this.buffers.get(ptyId) || '';
    this.buffers.set(ptyId, currentBuffer + localBuffer.join(''));
    this.localBuffers.delete(ptyId);
    this.localBufferSizes.delete(ptyId);
    this.flushTimeouts.delete(ptyId);
  }

  getBuffer(ptyId: string): string {
    // FIX: Flush pending data first (rate-limited stuck data)
    const pending = this.pendingData.get(ptyId);
    if (pending && pending.length > 0) {
      this.pendingData.delete(ptyId);
      this.pendingDataSizes.delete(ptyId);
      // Cancel pending flush timeout since we're flushing now
      const pendingTimeout = this.pendingFlushTimeouts.get(ptyId);
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        this.pendingFlushTimeouts.delete(ptyId);
      }
      this.lastAppendTime.delete(ptyId);
      this.appendToBuffer(ptyId, pending.join(''));
    }
    this.flushBuffer(ptyId); // Ensure latest data is included
    return this.buffers.get(ptyId) || '';
  }

  clearBuffer(ptyId: string): void {
    this.buffers.delete(ptyId);
    this.localBuffers.delete(ptyId);
    this.localBufferSizes.delete(ptyId);
    // FIX: Also clear pending data and rate-limit state on buffer clear
    this.pendingData.delete(ptyId);
    this.pendingDataSizes.delete(ptyId);
    this.droppedChars.delete(ptyId);
    this.lastAppendTime.delete(ptyId);
    
    const timeout = this.flushTimeouts.get(ptyId);
    if (timeout) {
      clearTimeout(timeout);
      this.flushTimeouts.delete(ptyId);
    }
    const pendingTimeout = this.pendingFlushTimeouts.get(ptyId);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this.pendingFlushTimeouts.delete(ptyId);
    }
  }

  getBufferSize(ptyId: string): number {
    const buffer = this.buffers.get(ptyId) || '';
    return buffer.length
      + (this.localBufferSizes.get(ptyId) || 0)
      + (this.pendingDataSizes.get(ptyId) || 0);
  }

  getTotalMemoryUsage(): number {
    let total = 0;
    const ptyIds = new Set([
      ...this.buffers.keys(),
      ...this.localBuffers.keys(),
      ...this.pendingData.keys(),
    ]);
    ptyIds.forEach((ptyId) => {
      total += this.getBufferSize(ptyId);
    });
    return total;
  }

  getStats() {
    const ptyIds = new Set([
      ...this.buffers.keys(),
      ...this.localBuffers.keys(),
      ...this.pendingData.keys(),
    ]);
    return {
      totalBuffers: ptyIds.size,
      totalMemoryBytes: this.getTotalMemoryUsage(),
      maxBufferChars: this.maxBufferChars,
      maxTotalBufferChars: this.MAX_TOTAL_BUFFER_CHARS,
      buffers: Array.from(ptyIds).map((ptyId) => ({
        ptyId,
        size: this.getBufferSize(ptyId),
        bufferLength: (this.buffers.get(ptyId) || '').length,
        localBufferLength: this.localBufferSizes.get(ptyId) || 0,
        pendingBufferLength: this.pendingDataSizes.get(ptyId) || 0,
        droppedChars: this.droppedChars.get(ptyId) || 0,
        rendererTailOnly: (this.droppedChars.get(ptyId) || 0) > 0,
      })),
    };
  }

  cleanup(ptyId: string): void {
    this.clearBuffer(ptyId);
    // FIX: Clean up rate limiting maps to prevent memory leak
    this.lastAppendTime.delete(ptyId);
    this.droppedChars.delete(ptyId);
    this.pendingData.delete(ptyId);
    this.pendingDataSizes.delete(ptyId);
    const pendingTimeout = this.pendingFlushTimeouts.get(ptyId);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this.pendingFlushTimeouts.delete(ptyId);
    }
  }

  cleanupAll(): void {
    this.buffers.clear();
    this.localBuffers.clear();
    this.localBufferSizes.clear();
    this.flushTimeouts.forEach(timeout => clearTimeout(timeout));
    this.flushTimeouts.clear();
    // FIX: Clean up rate limiting maps to prevent memory leak
    this.lastAppendTime.clear();
    this.pendingData.clear();
    this.pendingDataSizes.clear();
    this.droppedChars.clear();
    this.pendingFlushTimeouts.forEach(timeout => clearTimeout(timeout));
    this.pendingFlushTimeouts.clear();
  }
}
