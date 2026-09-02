import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferManager } from '../client/src/lib/terminal/buffer-manager';
import { MemoryMonitor } from '../client/src/lib/terminal/memory-monitor';
import { ScrollManager } from '../client/src/lib/terminal/scroll-manager';

describe('terminal resource accounting', () => {
  const managers: BufferManager[] = [];

  afterEach(() => {
    managers.forEach((manager) => manager.cleanupAll());
    managers.length = 0;
  });

  it('counts local and pending output before the coalescing timer flushes', () => {
    const manager = new BufferManager();
    managers.push(manager);

    manager.appendToBuffer('pty-1', 'first output');
    manager.appendToBuffer('pty-1', 'second output');

    const stats = manager.getStats();
    expect(stats.totalBuffers).toBe(1);
    expect(stats.totalMemoryBytes).toBeGreaterThan(0);
    expect(stats.buffers[0].size).toBe(stats.totalMemoryBytes);
  });

  it('keeps the newest long-output tail while accounting for renderer-only trimming', () => {
    const manager = new BufferManager();
    managers.push(manager);

    const maxChars = manager.getStats().maxBufferChars;
    const marker = '\n[final-port-and-credential-line]\n';
    manager.appendToBuffer('pty-long', 'x'.repeat(maxChars + 512) + marker);

    const retained = manager.getBuffer('pty-long');
    const stats = manager.getStats().buffers.find((buffer) => buffer.ptyId === 'pty-long');

    expect(retained.endsWith(marker)).toBe(true);
    expect(retained.length).toBeLessThanOrEqual(maxChars);
    expect(stats?.rendererTailOnly).toBe(true);
    expect(stats?.droppedChars).toBeGreaterThan(0);
  });

  it('bounds aggregate renderer cache without dropping the newest terminal tail', () => {
    const manager = new BufferManager();
    managers.push(manager);

    const perTerminal = manager.getStats().maxBufferChars;
    const aggregateLimit = manager.getStats().maxTotalBufferChars;
    const terminalCount = Math.ceil(aggregateLimit / perTerminal) + 1;

    for (let index = 0; index < terminalCount; index += 1) {
      manager.appendToBuffer(`pty-${index}`, 'x'.repeat(perTerminal) + `\n[tail-${index}]`);
    }

    const stats = manager.getStats();
    expect(stats.totalMemoryBytes).toBeLessThanOrEqual(aggregateLimit);
    expect(manager.getBuffer(`pty-${terminalCount - 1}`).endsWith(`[tail-${terminalCount - 1}]`)).toBe(true);
    expect(stats.buffers.some((buffer) => buffer.rendererTailOnly)).toBe(true);
  });

  it('includes estimated xterm scrollback in pressure decisions', () => {
    const monitor = new MemoryMonitor();
    const stats = monitor.analyzeMemoryUsage({
      bufferManager: { totalMemoryBytes: 80 * 1024 * 1024 },
      terminalRenderer: {
        totalTerminals: 2,
        estimatedScrollbackBytes: 30 * 1024 * 1024,
      },
      ptyManager: 2,
      ipcHandler: { totalHandlers: 2 },
    });

    expect(stats.totalTrackedMemory).toBe(110 * 1024 * 1024);
    expect(stats.estimatedScrollbackMemory).toBe(30 * 1024 * 1024);
    expect(stats.memoryPressure).toBe('medium');
    expect(stats.recommendations).toContain('Tracked memory excludes Electron and WSL child-process RSS');
  });

  it('preserves a scrolled-up viewport across a reflow', () => {
    const manager = new ScrollManager();
    const terminal = {
      rows: 20,
      buffer: {
        active: {
          viewportY: 80,
          length: 120,
          baseY: 100,
        },
      },
      scrollToLine: vi.fn(),
      refresh: vi.fn(),
    } as any;

    manager.saveScrollPosition('pty-viewport', terminal);

    // The same content reflowed to a different number of lines. The viewport
    // should remain 20 lines from the end, rather than being forced to baseY.
    terminal.buffer.active.length = 160;
    terminal.buffer.active.baseY = 140;
    manager.restoreScrollPosition('pty-viewport', terminal);

    expect(manager.getScrollState('pty-viewport')?.distanceFromBottom).toBe(20);
    expect(terminal.scrollToLine).toHaveBeenCalledWith(120);
  });

  it('restores the top of the buffer instead of leaving a stale position', () => {
    const manager = new ScrollManager();
    const terminal = {
      rows: 10,
      buffer: {
        active: {
          viewportY: 0,
          length: 10,
          baseY: 0,
        },
      },
      scrollToLine: vi.fn(),
      refresh: vi.fn(),
    } as any;

    manager.saveScrollPosition('pty-top', terminal);
    manager.restoreScrollPosition('pty-top', terminal);

    expect(terminal.scrollToLine).toHaveBeenCalledWith(0);
  });

  it('invalidates delayed refreshes when a second restore happens during a drag', () => {
    vi.useFakeTimers();
    try {
      const manager = new ScrollManager();
      const terminal = {
        rows: 20,
        buffer: {
          active: {
            viewportY: 30,
            length: 100,
            baseY: 80,
          },
        },
        scrollToLine: vi.fn(),
        refresh: vi.fn(),
      } as any;

      manager.saveScrollPosition('pty-drag', terminal);
      manager.restoreScrollPosition('pty-drag', terminal);
      terminal.buffer.active.viewportY = 10;
      manager.saveScrollPosition('pty-drag', terminal);
      manager.restoreScrollPosition('pty-drag', terminal);

      vi.advanceTimersByTime(30);
      expect(terminal.refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
