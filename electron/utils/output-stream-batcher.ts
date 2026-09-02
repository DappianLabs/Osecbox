/**
 * Coalesces noisy child-process output before it crosses the Electron IPC
 * boundary. A short frame keeps output feeling live while avoiding one IPC
 * message per stdout chunk.
 */
export type OutputStreamType = 'stdout' | 'stderr';

export class OutputStreamBatcher {
  private pending = '';
  private pendingType: OutputStreamType | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly send: (data: string, type: OutputStreamType) => void,
    private readonly intervalMs = 16,
    private readonly maxChars = 32 * 1024,
  ) {}

  push(data: string, type: OutputStreamType): void {
    if (!data) return;

    // Preserve stdout/stderr ordering when streams alternate.
    if (this.pendingType && this.pendingType !== type) {
      this.flush();
    }

    this.pendingType = type;
    this.pending += data;

    if (this.pending.length >= this.maxChars) {
      this.flush();
      return;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.intervalMs);
    }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (!this.pending || !this.pendingType) {
      this.pending = '';
      this.pendingType = null;
      return;
    }

    const data = this.pending;
    const type = this.pendingType;
    this.pending = '';
    this.pendingType = null;
    this.send(data, type);
  }

  dispose(): void {
    this.flush();
  }
}
