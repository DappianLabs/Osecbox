/**
 * Keeps process results bounded without affecting the live output stream.
 * Large scans can produce hundreds of megabytes; retaining only the head and
 * tail prevents the Electron main process from growing without limit.
 */
export class BoundedOutput {
  private chunks: string[] = [];
  private size = 0;
  private head = '';
  private tailChunks: string[] = [];
  private tailSize = 0;
  private truncated = false;

  constructor(private readonly maxChars = 8 * 1024 * 1024) {}

  append(data: string): void {
    if (!data) return;

    if (!this.truncated) {
      this.chunks.push(data);
      this.size += data.length;
      if (this.size <= this.maxChars) return;

      const joined = this.chunks.join('');
      const headSize = Math.floor(this.maxChars * 0.6);
      const tailSize = Math.floor(this.maxChars * 0.35);
      this.head = joined.slice(0, headSize);
      this.tailChunks = [joined.slice(-tailSize)];
      this.tailSize = tailSize;
      this.chunks = [];
      this.size = this.maxChars;
      this.truncated = true;
      return;
    }

    this.tailChunks.push(data);
    this.tailSize += data.length;

    // Compact only after the tail has doubled, avoiding a full string copy on
    // every child-process data event while keeping temporary memory bounded.
    if (this.tailSize > Math.floor(this.maxChars * 0.7)) {
      const tail = this.tailChunks.join('');
      const keep = Math.floor(this.maxChars * 0.35);
      this.tailChunks = [tail.slice(-keep)];
      this.tailSize = keep;
    }
  }

  toString(): string {
    if (!this.truncated) return this.chunks.join('');
    return `${this.head}\n...[output truncated for memory safety]...\n${this.tailChunks.join('')}`;
  }

  get length(): number {
    return this.truncated ? this.maxChars : this.size;
  }
}
