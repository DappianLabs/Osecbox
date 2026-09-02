/**
 * Terminal History Service - Disk-Backed History
 * 
 * Architecture:
 * - PTY output → Memory buffer (recent 1000 lines) → Disk log (everything else)
 * - Chunk-based storage (1MB per chunk)
 * - Load on demand when user scrolls
 * - Search across memory + disk
 * 
 * Benefits:
 * - Unlimited history (disk is cheap)
 * - Minimal memory (only recent in RAM)
 * - Survives app restart
 * - Professional-grade performance
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import { getTerminalHistoryFileStem } from './utils/terminal-history-path';
import { readTextFileWithRecovery, writeTextFileAtomic } from './utils/atomic-json';

const CHUNK_SIZE = 1024 * 1024; // 1MB per chunk
const MAX_MEMORY_LINES = 1000; // Keep recent 1000 lines in memory
// app.getPath('userData') returns:
// - Windows: C:\Users\{user}\AppData\Roaming\{appName}
// - Linux: ~/.config/{appName}
// - Mac: ~/Library/Application Support/{appName}
// All paths are writable by the user, no permission issues
const HISTORY_DIR = path.join(app.getPath('userData'), 'terminal-history');

interface HistoryChunk {
  chunkId: number;
  filePath: string;
  lineCount: number;
  byteSize: number;
  startLine: number; // Global line number where this chunk starts
  endLine: number;   // Global line number where this chunk ends
}

interface HistoryManifest {
  version: 1;
  ptyId: string;
  totalLines: number;
  hasOpenLine: boolean;
  chunks: Array<{
    chunkId: number;
    lineCount: number;
    byteSize: number;
    startLine: number;
    endLine: number;
  }>;
}

interface TerminalHistory {
  ptyId: string;
  chunks: HistoryChunk[];
  currentChunk: HistoryChunk | null;
  currentChunkStream: fs.FileHandle | null;
  totalLines: number;
  memoryBuffer: string[]; // Recent lines in memory
  hasOpenLine: boolean;
  writeChain: Promise<void>;
  // Manifest writes are serialized separately from output writes because
  // export/tail/close can request a flush concurrently with an append.
  manifestWriteChain: Promise<void>;
  closed: boolean;
  durable: boolean;
}

class TerminalHistoryService {
  private histories = new Map<string, TerminalHistory>();
  private initPromises = new Map<string, Promise<void>>();
  private clearPromises = new Map<string, Promise<void>>();
  // Track if cleanup is in progress to prevent race conditions
  private isCleaningUp = false;

  private getManifestPath(ptyId: string): string {
    return path.join(HISTORY_DIR, getTerminalHistoryFileStem(ptyId) + '.manifest.json');
  }

  private getChunkPath(ptyId: string, chunkId: number): string {
    return path.join(
      HISTORY_DIR,
      getTerminalHistoryFileStem(ptyId) + '_chunk_' + chunkId + '.log',
    );
  }

  private validateHistoryPath(filePath: string): string {
    const resolvedPath = path.resolve(filePath);
    const historyDir = path.resolve(HISTORY_DIR);
    if (resolvedPath === historyDir || !resolvedPath.startsWith(historyDir + path.sep)) {
      throw new Error('Invalid terminal history path');
    }
    return resolvedPath;
  }

  private async persistManifest(history: TerminalHistory): Promise<void> {
    const persist = history.manifestWriteChain
      .catch(() => {})
      .then(async () => {
        const manifestPath = this.validateHistoryPath(this.getManifestPath(history.ptyId));
        const manifest: HistoryManifest = {
          version: 1,
          ptyId: history.ptyId,
          totalLines: history.totalLines,
          hasOpenLine: history.hasOpenLine,
          chunks: history.chunks.map(({ chunkId, lineCount, byteSize, startLine, endLine }) => ({
            chunkId,
            lineCount,
            byteSize,
            startLine,
            endLine,
          })),
        };

        await writeTextFileAtomic(manifestPath, JSON.stringify(manifest));
      });

    // Keep the chain usable after a failed commit while still returning the
    // current commit's error to its caller.
    history.manifestWriteChain = persist.catch(() => undefined);
    await persist;
  }

  private async loadManifest(ptyId: string): Promise<HistoryManifest | null> {
    try {
      const manifestPath = this.validateHistoryPath(this.getManifestPath(ptyId));
      const raw = await readTextFileWithRecovery(manifestPath, (data) => {
        try {
          const candidate = JSON.parse(data) as Partial<HistoryManifest>;
          return candidate.version === 1 && candidate.ptyId === ptyId && Array.isArray(candidate.chunks);
        } catch {
          return false;
        }
      });
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as Partial<HistoryManifest>;
      if (
        parsed.version !== 1 ||
        parsed.ptyId !== ptyId ||
        !Array.isArray(parsed.chunks) ||
        typeof parsed.totalLines !== 'number'
      ) {
        return null;
      }

      return {
        version: 1,
        ptyId,
        totalLines: Math.max(0, Math.floor(parsed.totalLines)),
        hasOpenLine: parsed.hasOpenLine === true,
        chunks: parsed.chunks
          .filter((chunk): chunk is HistoryManifest['chunks'][number] => (
            !!chunk &&
            Number.isFinite(chunk.chunkId) &&
            Number.isFinite(chunk.lineCount) &&
            Number.isFinite(chunk.byteSize) &&
            Number.isFinite(chunk.startLine) &&
            Number.isFinite(chunk.endLine)
          ))
          .map(chunk => ({
            chunkId: Math.max(0, Math.floor(chunk.chunkId)),
            lineCount: Math.max(0, Math.floor(chunk.lineCount)),
            byteSize: Math.max(0, Math.floor(chunk.byteSize)),
            startLine: Math.max(0, Math.floor(chunk.startLine)),
            endLine: Math.max(0, Math.floor(chunk.endLine)),
          })),
      };
    } catch {
      return null;
    }
  }

  private async discoverLegacyChunks(ptyId: string): Promise<HistoryChunk[]> {
    try {
      const entries = await fs.readdir(HISTORY_DIR);
      const prefix = getTerminalHistoryFileStem(ptyId) + '_chunk_';
      const chunks: HistoryChunk[] = [];

      for (const entry of entries) {
        if (!entry.startsWith(prefix) || !entry.endsWith('.log')) continue;
        const chunkId = Number(entry.slice(prefix.length, -'.log'.length));
        if (!Number.isSafeInteger(chunkId) || chunkId < 0) continue;

        const filePath = this.validateHistoryPath(path.join(HISTORY_DIR, entry));
        try {
          const stats = await fs.stat(filePath);
          chunks.push({
            chunkId,
            filePath,
            lineCount: 0,
            byteSize: stats.size,
            startLine: 0,
            endLine: 0,
          });
        } catch {
          // A concurrently deleted chunk is simply omitted from recovery.
        }
      }

      return chunks.sort((a, b) => a.chunkId - b.chunkId);
    } catch {
      return [];
    }
  }

  private async inspectChunkLines(filePath: string): Promise<{ lineCount: number; hasOpenLine: boolean }> {
    const content = await fs.readFile(this.validateHistoryPath(filePath));
    let newlineCount = 0;
    for (const byte of content) {
      if (byte === 0x0a) newlineCount += 1;
    }
    return {
      lineCount: content.length === 0
        ? 0
        : newlineCount + (content[content.length - 1] === 0x0a ? 0 : 1),
      hasOpenLine: content.length > 0 && content[content.length - 1] !== 0x0a,
    };
  }

  private appendMemoryLines(history: TerminalHistory, data: string): void {
    if (!data) return;
    const lines = data.split('\n');
    if (lines.length >= MAX_MEMORY_LINES) {
      history.memoryBuffer = lines.slice(-MAX_MEMORY_LINES);
      return;
    }

    const overflow = history.memoryBuffer.length + lines.length - MAX_MEMORY_LINES;
    if (overflow > 0) history.memoryBuffer.splice(0, overflow);
    history.memoryBuffer.push(...lines);
  }

  private countNewlines(data: string): number {
    let count = 0;
    for (let index = 0; index < data.length; index += 1) {
      if (data.charCodeAt(index) === 10) count += 1;
    }
    return count;
  }

  private lineCountDelta(history: TerminalHistory, data: string): number {
    const newlineCount = this.countNewlines(data);
    if (!data) return 0;
    if (history.hasOpenLine) {
      // totalLines includes the currently open line. The first newline in
      // this batch closes that line; only subsequent newlines (and a new
      // trailing partial line) increase the total.
      return Math.max(0, newlineCount - 1) + (data.endsWith('\n') ? 0 : 1);
    }
    return newlineCount + (data.endsWith('\n') ? 0 : 1);
  }

  private async flushHistory(history: TerminalHistory): Promise<void> {
    await history.writeChain;
    if (history.currentChunkStream) {
      await history.currentChunkStream.sync().catch(() => {});
    }
    await this.persistManifest(history).catch(error => {
      history.durable = false;
      console.error('[HistoryService] Failed to persist manifest for ' + history.ptyId + ':', error);
    });
  }

  private async writeAll(handle: fs.FileHandle, buffer: Buffer): Promise<void> {
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.write(buffer, offset, buffer.length - offset, null);
      if (result.bytesWritten <= 0) {
        throw new Error('Terminal history write made no progress');
      }
      offset += result.bytesWritten;
    }
  }
  
  /**
   * Initialize history for a PTY
   * Uses Electron's userData path (works on Windows/Linux/Mac)
   */
  async initHistory(ptyId: string): Promise<void> {
    const existing = this.histories.get(ptyId);
    if (existing && !existing.closed) return;

    const inFlight = this.initPromises.get(ptyId);
    if (inFlight) return inFlight;

    const initialization = this.initHistoryInternal(ptyId);
    this.initPromises.set(ptyId, initialization);
    try {
      await initialization;
    } finally {
      if (this.initPromises.get(ptyId) === initialization) {
        this.initPromises.delete(ptyId);
      }
    }
  }

  private async initHistoryInternal(ptyId: string): Promise<void> {
    console.log('[HistoryService] Initializing history: ' + ptyId);

    const history = this.histories.get(ptyId) || {
      ptyId,
      chunks: [],
      currentChunk: null,
      currentChunkStream: null,
      totalLines: 0,
      memoryBuffer: [],
      hasOpenLine: false,
      writeChain: Promise.resolve(),
      manifestWriteChain: Promise.resolve(),
      closed: false,
      durable: true,
    };

    history.closed = false;
    history.durable = true;

    try {
      await fs.mkdir(HISTORY_DIR, { recursive: true });
      const manifest = await this.loadManifest(ptyId);
      if (manifest) {
        history.totalLines = manifest.totalLines;
        history.hasOpenLine = manifest.hasOpenLine;
        history.chunks = [];
        for (const chunk of manifest.chunks) {
          const filePath = this.getChunkPath(ptyId, chunk.chunkId);
          let byteSize = chunk.byteSize;
          try {
            byteSize = (await fs.stat(filePath)).size;
          } catch {
            // Keep the manifest entry so export can report/skip a missing
            // chunk without shifting the identity of later chunks.
          }
          history.chunks.push({ ...chunk, byteSize, filePath });
        }

        // A process can write a chunk before its atomic manifest rename. On
        // the next launch, recover those files as well instead of treating a
        // stale manifest as the complete transcript. This is normally a
        // one-chunk recovery path and keeps export/tail lossless after a
        // crash, power loss, or profile-folder interruption.
        const knownChunkIds = new Set(history.chunks.map(chunk => chunk.chunkId));
        const orphanChunks = (await this.discoverLegacyChunks(ptyId))
          .filter(chunk => !knownChunkIds.has(chunk.chunkId));
        for (const orphan of orphanChunks) {
          const summary = await this.inspectChunkLines(orphan.filePath).catch(() => ({
            lineCount: 0,
            hasOpenLine: false,
          }));
          const startLine = history.totalLines;
          const recovered: HistoryChunk = {
            ...orphan,
            lineCount: summary.lineCount,
            startLine,
            endLine: summary.lineCount > 0 ? startLine + summary.lineCount - 1 : startLine,
          };
          history.chunks.push(recovered);
          history.totalLines += summary.lineCount;
          history.hasOpenLine = summary.hasOpenLine;
        }
        history.chunks.sort((left, right) => left.chunkId - right.chunkId);
      } else if (history.chunks.length === 0) {
        history.chunks = await this.discoverLegacyChunks(ptyId);
        // Legacy history files remain exportable even when they predate the
        // manifest format. New output will create a manifest immediately.
        history.totalLines = 0;
      }
    } catch (error) {
      history.durable = false;
      console.error('[HistoryService] Failed to recover history for ' + ptyId + ':', error);
    }

    this.histories.set(ptyId, history);

    try {
      await this.createNewChunk(ptyId);
      await this.persistManifest(history);
    } catch (error) {
      history.durable = false;
      console.error('[HistoryService] Failed to create history chunk for ' + ptyId + ':', error);
    }
  }
  
  /**
   * Create a new chunk file
   * Uses path.join for proper path separators
   */
  private async createNewChunk(ptyId: string): Promise<void> {
    const history = this.histories.get(ptyId);
    if (!history) return;
    
    try {
      // Close previous chunk stream
      const previousStream = history.currentChunkStream;
      history.currentChunkStream = null;
      history.currentChunk = null;
      if (previousStream) await previousStream.close();
    } catch (error) {
      console.error('[HistoryService] Failed to close previous chunk:', error);
    }
    
    const chunkId = history.chunks.reduce(
      (highest, chunk) => Math.max(highest, chunk.chunkId),
      -1,
    ) + 1;
    const chunkPath = this.getChunkPath(ptyId, chunkId);
    
    const chunk: HistoryChunk = {
      chunkId,
      filePath: chunkPath,
      lineCount: 0,
      byteSize: 0,
      startLine: Math.max(0, history.totalLines - (history.hasOpenLine ? 1 : 0)),
      endLine: history.totalLines,
    };
    
    try {
      // SECURITY: Validate chunk path to prevent directory traversal
      const resolvedPath = this.validateHistoryPath(chunkPath);
      
      // The user-data directory can be removed while the app is running
      // (cleanup tools and profile resets do this), so make this operation
      // self-healing instead of relying only on initHistory's mkdir call.
      await fs.mkdir(HISTORY_DIR, { recursive: true });

      // Open file handle for appending
      const stream = await fs.open(resolvedPath, 'a');
      history.chunks.push(chunk);
      history.currentChunk = chunk;
      history.currentChunkStream = stream;
      history.durable = true;
      console.log('[HistoryService] Created chunk ' + chunkId + ' for ' + ptyId + ': ' + chunkPath);
    } catch (error) {
      history.durable = false;
      console.error('[HistoryService] Failed to open chunk file:', error);
      // Continue without disk storage - memory-only mode
      history.currentChunk = null;
      history.currentChunkStream = null;
    }
  }
  
  /**
   * Append output to history (called from PTY output handler)
   */
  async appendOutput(ptyId: string, data: string): Promise<void> {
    if (!data) return;

    const clearInFlight = this.clearPromises.get(ptyId);
    if (clearInFlight) await clearInFlight;

    let history = this.histories.get(ptyId);
    if (!history || history.closed) {
      await this.initHistory(ptyId);
      history = this.histories.get(ptyId);
    }
    if (!history) {
      console.warn('[HistoryService] History could not be initialized: ' + ptyId);
      return;
    }

    const write = history.writeChain
      .catch(() => {})
      .then(async () => {
        this.appendMemoryLines(history, data);
        const lineDelta = this.lineCountDelta(history, data);
        const nextHasOpenLine = !data.endsWith('\n');
        const buffer = Buffer.from(data, 'utf8');

        if (!history.currentChunkStream || !history.currentChunk) {
          await this.createNewChunk(ptyId);
        }

        if (history.currentChunkStream && history.currentChunk) {
          try {
            const chunk = history.currentChunk;
            await this.writeAll(history.currentChunkStream, buffer);
            chunk.byteSize += buffer.length;
            chunk.lineCount += lineDelta;
            chunk.endLine = Math.max(
              chunk.endLine,
              history.totalLines + Math.max(0, lineDelta - 1),
            );
            history.durable = true;
          } catch (error) {
            history.durable = false;
            console.error(
              '[HistoryService] Disk write failed for ' + ptyId + '; keeping output in memory:',
              error,
            );
            await history.currentChunkStream.close().catch(() => {});
            history.currentChunkStream = null;
            history.currentChunk = null;
          }
        } else {
          history.durable = false;
        }

        history.totalLines += lineDelta;
        history.hasOpenLine = nextHasOpenLine;
        await this.persistManifest(history).catch(error => {
          history.durable = false;
          console.error('[HistoryService] Manifest write failed for ' + ptyId + ':', error);
        });

        // Never rotate in the middle of a logical line. This keeps paging
        // metadata coherent while still bounding normal tool output chunks.
        if (
          history.currentChunkStream &&
          history.currentChunk &&
          history.currentChunk.byteSize >= CHUNK_SIZE &&
          !history.hasOpenLine
        ) {
          await this.createNewChunk(ptyId);
          await this.persistManifest(history).catch(() => {});
        }
      })
      .catch(error => {
        console.error('[HistoryService] Failed to append output for ' + ptyId + ':', error);
      });

    history.writeChain = write;
    await write;
  }
  
  /**
   * Get recent lines from memory buffer
   */
  getRecentLines(ptyId: string, count: number = MAX_MEMORY_LINES): string[] {
    const history = this.histories.get(ptyId);
    if (!history) return [];
    
    return history.memoryBuffer.slice(-count);
  }
  
  /**
   * Load older lines from disk (for scroll-up)
   */
  async loadOlderLines(ptyId: string, fromLine: number, count: number): Promise<string[]> {
    const history = this.histories.get(ptyId);
    if (!history) return [];
    
    console.log(`[HistoryService] Loading lines ${fromLine} to ${fromLine + count} for ${ptyId}`);
    
    // Find which chunks contain these lines
    const relevantChunks = history.chunks.filter(chunk => 
      chunk.startLine <= fromLine + count && chunk.endLine >= fromLine
    );
    
    if (relevantChunks.length === 0) {
      console.log(`[HistoryService] No chunks found for lines ${fromLine}-${fromLine + count}`);
      return [];
    }
    
    const lines: string[] = [];
    
    for (const chunk of relevantChunks) {
      try {
        const chunkLines = await this.readChunkLines(
          chunk.filePath,
          Math.max(0, fromLine - chunk.startLine),
          count,
        );
        lines.push(...chunkLines);
        
        if (lines.length >= count) break;
      } catch (error) {
        console.error(`[HistoryService] Failed to read chunk ${chunk.chunkId}:`, error);
      }
    }
    
    return lines.slice(0, count);
  }
  
  /**
   * Read specific lines from a chunk file
   */
  private async readChunkLines(filePath: string, skipLines: number, count: number): Promise<string[]> {
    const safePath = this.validateHistoryPath(filePath);
    if (!existsSync(safePath)) {
      console.warn(`[HistoryService] Chunk file not found: ${safePath}`);
      return [];
    }
    
    const lines: string[] = [];
    let currentLine = 0;
    
    const fileStream = createReadStream(safePath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    
    for await (const line of rl) {
      if (currentLine >= skipLines) {
        lines.push(line);
        
        if (lines.length >= count) {
          break;
        }
      }
      currentLine++;
    }
    
    fileStream.close();
    
    return lines;
  }
  
  /**
   * Search across all history (memory + disk)
   * OPTIMIZED: Early exit, limit results, efficient regex
   */
  async search(ptyId: string, query: string, caseSensitive: boolean = false): Promise<Array<{ line: string; lineNumber: number }>> {
    const history = this.histories.get(ptyId);
    if (!history) return [];
    
    console.log(`[HistoryService] Searching for "${query}" in ${ptyId}`);
    
    const results: Array<{ line: string; lineNumber: number }> = [];
    const seen = new Set<string>();
    const MAX_RESULTS = 1000; // Limit results for performance
    
    try {
      // RegExp#test with a global flag carries lastIndex between lines and
      // silently skips alternating matches. Search needs a stateless regex.
      const regex = new RegExp(query, caseSensitive ? '' : 'i');
      
      // Search memory buffer first (fast)
      for (let index = 0; index < history.memoryBuffer.length; index++) {
        const line = history.memoryBuffer[index];
        regex.lastIndex = 0;
        if (regex.test(line)) {
          const lineNumber = history.totalLines - history.memoryBuffer.length + index;
          const key = lineNumber + '\\u0000' + line;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ line, lineNumber });
          
          if (results.length >= MAX_RESULTS) {
            console.log(`[HistoryService] Search limit reached (${MAX_RESULTS} results)`);
            return results;
          }
        }
      }
      
      // Search disk chunks (slower, but still fast with streaming)
      for (const chunk of history.chunks) {
        try {
          const chunkLines = await this.readChunkLines(
            chunk.filePath,
            0,
            chunk.lineCount > 0 ? chunk.lineCount : Number.MAX_SAFE_INTEGER,
          );
          
          for (let index = 0; index < chunkLines.length; index++) {
            const line = chunkLines[index];
            regex.lastIndex = 0;
            if (regex.test(line)) {
              const lineNumber = chunk.startLine + index;
              const key = lineNumber + '\\u0000' + line;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push({ line, lineNumber });
              
              if (results.length >= MAX_RESULTS) {
                console.log(`[HistoryService] Search limit reached (${MAX_RESULTS} results)`);
                return results;
              }
            }
          }
        } catch (error) {
          console.error(`[HistoryService] Failed to search chunk ${chunk.chunkId}:`, error);
          // Continue searching other chunks
        }
      }
    } catch (error) {
      console.error(`[HistoryService] Search failed:`, error);
    }
    
    console.log(`[HistoryService] Found ${results.length} matches for "${query}"`);
    
    return results;
  }
  
  /**
   * Get total line count
   */
  getTotalLines(ptyId: string): number {
    const history = this.histories.get(ptyId);
    return history ? history.totalLines : 0;
  }
  
  /**
   * Get history stats
   */
  getStats(ptyId: string) {
    const history = this.histories.get(ptyId);
    if (!history) return null;
    
    const totalDiskSize = history.chunks.reduce((sum, chunk) => sum + chunk.byteSize, 0);
    
    return {
      ptyId,
      totalLines: history.totalLines,
      memoryLines: history.memoryBuffer.length,
      chunkCount: history.chunks.length,
      durable: history.durable,
      closed: history.closed,
      totalDiskSize,
      totalDiskSizeMB: (totalDiskSize / (1024 * 1024)).toFixed(2),
      chunks: history.chunks.map(chunk => ({
        chunkId: chunk.chunkId,
        lineCount: chunk.lineCount,
        byteSize: chunk.byteSize,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      })),
    };
  }
  
  /**
   * Return a bounded tail for renderer recovery. This is deliberately a view
   * cache operation: the complete transcript stays in chunk files and export
   * never depends on this limit.
   */
  async getTail(
    ptyId: string,
    maxBytes = 4 * 1024 * 1024,
  ): Promise<{ data: string; totalBytes: number; truncated: boolean }> {
    const boundedMaxBytes = Math.max(1, Math.min(16 * 1024 * 1024, Math.floor(maxBytes)));
    let history = this.histories.get(ptyId);
    if (!history) {
      const manifest = await this.loadManifest(ptyId);
      const legacyChunks = manifest ? [] : await this.discoverLegacyChunks(ptyId);
      if (!manifest && legacyChunks.length === 0) {
        return { data: '', totalBytes: 0, truncated: false };
      }
      await this.initHistory(ptyId);
      history = this.histories.get(ptyId);
    }
    if (!history) return { data: '', totalBytes: 0, truncated: false };

    await this.flushHistory(history);
    const totalBytes = history.chunks.reduce((sum, chunk) => sum + chunk.byteSize, 0);
    if (totalBytes === 0) return { data: '', totalBytes: 0, truncated: false };

    const pieces: Buffer[] = [];
    let remaining = boundedMaxBytes;
    for (let index = history.chunks.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const chunk = history.chunks[index];
      try {
        const content = await fs.readFile(this.validateHistoryPath(chunk.filePath));
        const piece = content.length > remaining
          ? content.subarray(content.length - remaining)
          : content;
        pieces.unshift(piece);
        remaining -= piece.length;
      } catch (error) {
        console.warn('[HistoryService] Failed to read tail chunk ' + chunk.chunkId + ':', error);
      }
    }

    const tailBuffer = Buffer.concat(pieces);
    // A bounded byte tail can begin in the middle of a multi-byte UTF-8
    // character. Drop only continuation bytes at the visual boundary; the
    // complete export remains byte-for-byte and this prevents U+FFFD from
    // appearing when a recovered terminal is first mounted.
    let safeStart = 0;
    while (safeStart < tailBuffer.length && (tailBuffer[safeStart] & 0xc0) === 0x80) {
      safeStart += 1;
    }

    return {
      data: tailBuffer.subarray(safeStart).toString('utf8'),
      totalBytes,
      truncated: totalBytes > boundedMaxBytes,
    };
  }

  private async copyChunkToFile(
    chunk: HistoryChunk,
    destination: fs.FileHandle,
  ): Promise<number> {
    const source = await fs.open(this.validateHistoryPath(chunk.filePath), 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    let copied = 0;

    try {
      while (true) {
        const result = await source.read(buffer, 0, buffer.length, position);
        if (result.bytesRead === 0) break;
        const bytes = buffer.subarray(0, result.bytesRead);
        await this.writeAll(destination, bytes);
        position += result.bytesRead;
        copied += result.bytesRead;
      }
      return copied;
    } finally {
      await source.close().catch(() => {});
    }
  }

  /**
   * Stream complete transcript chunks to a user-selected file. It never
   * materializes the full output in renderer or main-process memory.
   */
  async exportToFile(ptyIds: string[], filePath: string): Promise<{ bytes: number; ptyIds: string[] }> {
    const ids = Array.from(new Set(
      ptyIds.filter(id => typeof id === 'string' && id.trim().length > 0),
    )).slice(0, 50);
    if (ids.length === 0) throw new Error('No terminal sessions selected');
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new Error('Invalid export path');
    }

    const resolvedDestination = path.resolve(filePath);
    const resolvedHistoryDir = path.resolve(HISTORY_DIR);
    if (
      resolvedDestination === resolvedHistoryDir ||
      resolvedDestination.startsWith(resolvedHistoryDir + path.sep)
    ) {
      throw new Error('Export destination cannot be inside terminal history storage');
    }

    const destination = await fs.open(resolvedDestination, 'w', 0o600);
    let bytes = 0;
    try {
      for (let index = 0; index < ids.length; index += 1) {
        const id = ids[index];
        let history = this.histories.get(id);
        if (!history) {
          await this.initHistory(id);
          history = this.histories.get(id);
        }
        if (!history) continue;

        await this.flushHistory(history);
        if (index > 0) {
          const separator = Buffer.from('\n', 'utf8');
          await this.writeAll(destination, separator);
          bytes += separator.length;
        }

        const header = Buffer.from('===== ' + id + ' =====\n', 'utf8');
        await this.writeAll(destination, header);
        bytes += header.length;

        for (const chunk of history.chunks) {
          try {
            bytes += await this.copyChunkToFile(chunk, destination);
          } catch (error: any) {
            if (error?.code === 'ENOENT') {
              console.warn('[HistoryService] Skipping missing transcript chunk ' + chunk.chunkId);
            } else {
              throw error;
            }
          }
        }
      }

      await destination.sync();
      return { bytes, ptyIds: ids };
    } finally {
      await destination.close().catch(() => {});
    }
  }

  /**
   * Close handles while retaining every chunk and manifest. Normal PTY stop,
   * navigation, and app shutdown must use this path.
   */
  async close(ptyId: string): Promise<void> {
    const history = this.histories.get(ptyId);
    if (!history) return;

    await this.flushHistory(history);
    if (history.currentChunkStream) {
      await history.currentChunkStream.close().catch(error => {
        console.error('[HistoryService] Failed to close file handle for ' + ptyId + ':', error);
      });
      history.currentChunkStream = null;
      history.currentChunk = null;
    }
    history.closed = true;
    await this.persistManifest(history).catch(() => {});
  }

  async closeAll(): Promise<void> {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;
    try {
      for (const ptyId of Array.from(this.histories.keys())) {
        await this.close(ptyId);
      }
    } finally {
      this.isCleaningUp = false;
    }
  }

  /**
   * Explicit destructive reset. This is only for a user-requested Clear or
   * Reset action; it is never used for routine PTY teardown.
   */
  async clear(ptyId: string): Promise<void> {
    const inFlight = this.clearPromises.get(ptyId);
    if (inFlight) return inFlight;

    const clearing = this.clearInternal(ptyId);
    this.clearPromises.set(ptyId, clearing);
    try {
      await clearing;
    } finally {
      if (this.clearPromises.get(ptyId) === clearing) {
        this.clearPromises.delete(ptyId);
      }
    }
  }

  private async clearInternal(ptyId: string): Promise<void> {
    const existing = this.histories.get(ptyId);
    await this.close(ptyId);
    const chunks = existing?.chunks || await this.discoverLegacyChunks(ptyId);

    for (const chunk of chunks) {
      await fs.unlink(this.validateHistoryPath(chunk.filePath)).catch(() => {});
    }
    await fs.unlink(this.validateHistoryPath(this.getManifestPath(ptyId))).catch(() => {});

    if (existing) {
      this.histories.delete(ptyId);
      await this.initHistory(ptyId);
    }
  }

  /**
   * Backward-compatible alias. Cleanup means close now; it must not erase
   * evidence when a scan or terminal session stops.
   */
  async cleanup(ptyId: string): Promise<void> {
    await this.close(ptyId);
  }

  /**
   * Backward-compatible alias for app shutdown.
   */
  async cleanupAll(): Promise<void> {
    await this.closeAll();
  }
}

// Export singleton
export const terminalHistoryService = new TerminalHistoryService();
