/**
 * Command Output Store
 * Stores detailed command outputs for AI context
 * 
 * This complements the attack state by keeping full outputs
 * while the main state keeps compact summaries
 */

import { redactSensitiveText } from '../ai-data-policy';
import { cleanANSIForDisplay } from '../utils/ansi-cleaner';

export interface DetailedCommandOutput {
  num: number;
  command: string;
  output: string;
  stderr: string;
  exitCode: number;
  timestamp: number;
  host: string;
  duration: number;
  /** True while a long-running foothold/tunnel command is still active. */
  live?: boolean;
  /** Stable key used to replace/remove an active projection. */
  liveKey?: string;
  /** Provenance used to keep AI context scoped to the right target/tab. */
  sessionId?: string;
  tabId?: string;
  terminalId?: string;
  target?: string;
  tool?: string;
  runId?: string;
}

export interface CommandContextScope {
  sessionId?: string;
  tabId?: string;
  terminalId?: string;
  target?: string;
  runId?: string;
}

/**
 * Normalize a user/scanner target to a conservative host identity.
 *
 * URLs frequently arrive with a path while scan records usually retain only
 * the host. Canonicalizing those forms keeps focused AI scope useful without
 * using unsafe substring/suffix matching (which could mix example.com and
 * evil-example.com). CIDR targets remain intact because their prefix is part
 * of the scope identity.
 */
export function normalizeTargetForScope(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const cidr = raw.match(/^(?:\[[^\]]+\]|[^/]+)\/\d{1,3}$/);
  if (cidr) return raw.toLowerCase().replace(/\/$/, '');

  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
    if (!url.hostname) return null;

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const authority = raw
      .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
      .split(/[/?#]/, 1)[0];
    const explicitPort = authority.match(/^(?:\[[^\]]+\]|[^:]+):(\d+)$/)?.[1];
    const port = (explicitPort || url.port) ? `:${explicitPort || url.port}` : '';
    const canonicalHostname = hostname.includes(':') && !hostname.startsWith('[')
      ? `[${hostname}]`
      : hostname;
    return `${canonicalHostname}${port}`;
  } catch {
    const fallback = raw.toLowerCase().replace(/\/+$/, '');
    return /^[0-9a-f:]+$/i.test(fallback) && fallback.includes(':') && !fallback.startsWith('[')
      ? `[${fallback}]`
      : fallback;
  }
}

export function targetsMatch(requested: string | undefined, candidate: string | undefined): boolean {
  const requestedTarget = normalizeTargetForScope(requested);
  const candidateTarget = normalizeTargetForScope(candidate);
  return Boolean(requestedTarget && candidateTarget && requestedTarget === candidateTarget);
}

export class CommandOutputStore {
  private outputs: DetailedCommandOutput[] = [];
  /** Active projections are intentionally separate from finalized evidence. */
  private liveOutputs = new Map<string, DetailedCommandOutput>();
  private nextLiveNum = 1_000_000_000;
  private maxOutputs: number;
  private maxOutputSize: number;
  private maxTotalSize: number;
  private estimatedSize = 0;

  constructor(maxOutputs = 1000, maxOutputSize = 150000, maxTotalSize = 64 * 1024 * 1024) {
    this.maxOutputs = Math.max(1, Math.floor(maxOutputs));
    this.maxOutputSize = Math.max(1000, Math.floor(maxOutputSize));
    this.maxTotalSize = Math.max(this.maxOutputSize, Math.floor(maxTotalSize));
  }

  /**
   * Add a command output
   * OPTIMIZED: Memory-first strategy for heavy exam loads
   */
  addOutput(output: DetailedCommandOutput): void {
    output = {
      ...output,
      command: String(output?.command ?? ''),
      output: String(output?.output ?? ''),
      stderr: String(output?.stderr ?? ''),
      exitCode: Number.isFinite(Number(output?.exitCode)) ? Number(output.exitCode) : 0,
      timestamp: Number.isFinite(Number(output?.timestamp)) ? Number(output.timestamp) : Date.now(),
    };

    // DEDUP: Listener capture, PTY tracking, and scanner-result projection can
    // observe the same run through different paths. Search a small recent
    // window rather than only the immediately previous record, while keeping
    // distinct run IDs separate when the same target is scanned again.
    const recentDuplicate = this.outputs.slice(-32).reverse().find((candidate) => {
      const sameProvenance =
        (candidate.sessionId || '') === (output.sessionId || '') &&
        (candidate.tabId || '') === (output.tabId || '') &&
        (candidate.terminalId || '') === (output.terminalId || '') &&
        (candidate.target || candidate.host || '') === (output.target || output.host || '');
      const sameRun = candidate.runId && output.runId
        ? candidate.runId === output.runId
        : !candidate.runId && !output.runId;
      return sameProvenance && sameRun &&
        this.normalizeForDedup(candidate.command) === this.normalizeForDedup(output.command) &&
        this.normalizeForDedup(candidate.output) === this.normalizeForDedup(output.output) &&
        this.normalizeForDedup(candidate.stderr) === this.normalizeForDedup(output.stderr) &&
        Math.abs((output.timestamp || 0) - (candidate.timestamp || 0)) < 10000;
    });
    if (recentDuplicate) {
      console.log(`[CommandOutputStore] ⏭️ Skipping duplicate command: "${redactSensitiveText(output.command).substring(0, 50)}..."`);
      return;
    }

    // Keep diagnostics cheap under listener/scan floods. Detailed state is
    // still available through getStats(); logs are sampled to avoid one line
    // per PTY chunk becoming the performance bottleneck.
    const emitDiagnostics = this.outputs.length === 0 || this.outputs.length % 25 === 0 || output.output.length > 100000;
    if (emitDiagnostics) {
    console.log(`[CommandOutputStore] 📥 Storing command #${output.num}: "${redactSensitiveText(output.command).substring(0, 50)}..." (${output.output.length} bytes)`);
    
    }

    // Truncate output if too large
    const originalOutputSize = output.output.length;
    const originalStderrSize = output.stderr.length;
    const boundedOutput = this.truncateOutput(output.output, this.maxOutputSize);
    const boundedStderr = this.truncateOutput(output.stderr, Math.min(20000, this.maxOutputSize));
    if (boundedOutput !== output.output || boundedStderr !== output.stderr) {
      output = { ...output, output: boundedOutput, stderr: boundedStderr };
      console.log(`[CommandOutputStore] ✂️ Bounded output (${originalOutputSize}+${originalStderrSize} bytes) to ${boundedOutput.length}+${boundedStderr.length} bytes`);
    }

    this.outputs.push(output);
    this.estimatedSize += this.estimateOutputSize(output);

    // OPTIMIZED: Check memory FIRST (faster than JSON.stringify), but enforce
    // the configured ceiling rather than relying on a one-time burst purge.
    let totalSize = this.getSizeFast();
    let purged = 0;
    while (totalSize > this.maxTotalSize && this.outputs.length > 1) {
      const toRemove = Math.min(
        this.outputs.length - 1,
        Math.max(1, Math.floor(this.outputs.length * 0.2)),
      );
      const removed = this.outputs.splice(0, toRemove);
      this.estimatedSize -= removed.reduce((size, item) => size + this.estimateOutputSize(item), 0);
      purged += removed.length;
      totalSize = this.getSizeFast();
    }
    if (purged > 0) {
      console.log(`[CommandOutputStore] Memory limit (${(totalSize / 1024 / 1024).toFixed(1)}MB after purge), purged ${purged} commands`);
    }

    while (this.outputs.length > this.maxOutputs) {
      const removed = this.outputs.shift();
      if (removed) this.estimatedSize -= this.estimateOutputSize(removed);
    }
    this.enforceLiveBudget();
    totalSize = this.getSizeFast();
    
    // VERIFICATION: Log current state
    if (emitDiagnostics) {
      console.log(`[CommandOutputStore] 📊 Total commands stored: ${this.outputs.length}, Total size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
    }
  }

  /**
   * Replace a bounded active command projection without adding durable history.
   * The AI context reads this alongside finalized records, while persistence
   * can explicitly request only completed outputs.
   */
  upsertLiveOutput(liveKey: string, output: DetailedCommandOutput): void {
    const key = String(liveKey || '').trim();
    if (!key) return;

    const normalized: DetailedCommandOutput = {
      ...output,
      num: Number.isFinite(Number(output?.num)) ? Number(output.num) : this.nextLiveNum++,
      command: String(output?.command ?? ''),
      output: this.truncateOutput(String(output?.output ?? ''), this.maxOutputSize),
      stderr: this.truncateOutput(String(output?.stderr ?? ''), Math.min(20000, this.maxOutputSize)),
      exitCode: Number.isFinite(Number(output?.exitCode)) ? Number(output.exitCode) : 0,
      timestamp: Number.isFinite(Number(output?.timestamp)) ? Number(output.timestamp) : Date.now(),
      host: String(output?.host ?? output?.target ?? 'localhost'),
      duration: Number.isFinite(Number(output?.duration)) ? Number(output.duration) : 0,
      live: true,
      liveKey: key,
    };

    this.liveOutputs.set(key, normalized);
    this.enforceLiveBudget();
  }

  removeLiveOutput(liveKey: string): void {
    if (liveKey) this.liveOutputs.delete(liveKey);
  }

  getLiveOutputs(): DetailedCommandOutput[] {
    return Array.from(this.liveOutputs.values());
  }

  /** Completed records only; live projections must not be persisted as history. */
  getPersistedOutputs(): DetailedCommandOutput[] {
    return this.outputs;
  }

  /**
   * Truncate single output intelligently
   * OPTIMIZED: Sampling for extreme outputs
   */
  private truncateOutput(output: string, maxSize = this.maxOutputSize): string {
    if (output.length <= maxSize) return output;

    const lines = output.split('\n');

    if (lines.length < 100) {
      return output.substring(0, maxSize);
    }

    const firstLines = lines.slice(0, 300);
    const lastLines = lines.slice(-300);

    // OPTIMIZED: Sample middle instead of scanning all
    const critical: string[] = [];
    if (lines.length > 1000) {
      const middleLines = lines.slice(300, -300);
      for (let i = 0; i < middleLines.length && critical.length < 160; i += 1) {
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
          critical.push(line);
        }
      }
    }

    const result = [
      ...firstLines,
      critical.length > 0 ? `\n[${lines.length - 600 - critical.length} lines hidden]\n` : '\n[truncated]\n',
      ...critical,
      ...lastLines
    ].join('\n');

    if (result.length <= maxSize) return result;
    const head = Math.max(120, Math.floor(maxSize * 0.58));
    const tail = Math.max(120, Math.floor(maxSize * 0.36));
    return `${result.slice(0, head)}\n...[bounded output; middle omitted]...\n${result.slice(-tail)}`.slice(0, maxSize);
  }

  /**
   * Get recent outputs
   */
  getRecentOutputs(count: number): DetailedCommandOutput[] {
    return this.getAllOutputs().slice(-count);
  }

  /**
   * Get finalized and active outputs in chronological order for AI context.
   */
  getAllOutputs(): DetailedCommandOutput[] {
    return [...this.outputs, ...this.liveOutputs.values()].sort((left, right) =>
      (left.timestamp || 0) - (right.timestamp || 0) || (left.num || 0) - (right.num || 0),
    );
  }

  /**
   * Return only outputs that can be attributed to the requested scope.
   * Legacy records are only retained when their target or terminal metadata
   * can still be matched; unknown records are never mixed into a targeted
   * request.
   */
  getScopedOutputs(scope: CommandContextScope): DetailedCommandOutput[] {
    return this.getAllOutputs().filter(output => this.matchesScope(output, scope));
  }

  /** Remove records belonging to a tab without touching other engagements. */
  clearForScope(scope: CommandContextScope): void {
    const retained: DetailedCommandOutput[] = [];
    let removedSize = 0;

    for (const output of this.outputs) {
      if (this.matchesScope(output, scope)) {
        removedSize += this.estimateOutputSize(output);
      } else {
        retained.push(output);
      }
    }

    this.outputs = retained;
    this.estimatedSize = Math.max(0, this.estimatedSize - removedSize);
    for (const [key, output] of this.liveOutputs) {
      if (this.matchesScope(output, scope)) this.liveOutputs.delete(key);
    }
  }

  /**
   * Get outputs containing specific text
   * IMPROVED: Case-insensitive with better matching
   */
  searchOutputs(searchText: string): DetailedCommandOutput[] {
    const lowerSearch = searchText.toLowerCase();
    return this.getAllOutputs().filter(o => {
      const lowerCommand = o.command.toLowerCase();
      const lowerOutput = o.output.toLowerCase();

      // Match in command or output
      return lowerCommand.includes(lowerSearch) || lowerOutput.includes(lowerSearch);
    });
  }

  /**
   * Get outputs for specific host
   */
  getHostOutputs(hostId: string): DetailedCommandOutput[] {
    return this.getAllOutputs().filter(o => o.host === hostId);
  }

  /**
   * Get outputs by exit code
   */
  getByExitCode(exitCode: number): DetailedCommandOutput[] {
    return this.getAllOutputs().filter(o => o.exitCode === exitCode);
  }

  /**
   * Get outputs in time range
   */
  getByTimeRange(startTime: number, endTime: number): DetailedCommandOutput[] {
    return this.getAllOutputs().filter(o =>
      o.timestamp >= startTime && o.timestamp <= endTime
    );
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalCommands: number;
    successfulCommands: number;
    failedCommands: number;
    totalSize: number;
    avgOutputSize: number;
    oldestTimestamp: number;
    newestTimestamp: number;
  } {
    const all = this.getAllOutputs();
    const successful = all.filter(o => o.exitCode === 0).length;
    const failed = all.length - successful;
    const totalSize = this.getSizeFast();
    const avgSize = all.length > 0 ? totalSize / all.length : 0;

    return {
      totalCommands: all.length,
      successfulCommands: successful,
      failedCommands: failed,
      totalSize,
      avgOutputSize: Math.floor(avgSize),
      oldestTimestamp: all[0]?.timestamp || 0,
      newestTimestamp: all[all.length - 1]?.timestamp || 0,
    };
  }

  /**
   * Build AI context from outputs
   */
  buildAIContext(recentCount = 100): string {
    const recent = this.getRecentOutputs(recentCount);

    return recent.map(o => {
      const status = o.live ? '● ACTIVE' : (o.exitCode === 0 ? '✓' : '✗');
      const outputPreview = redactSensitiveText(cleanANSIForDisplay(o.output)).substring(0, 500);
      return `[${o.live ? 'LIVE' : o.num}] ${status} ${redactSensitiveText(o.command)}\n→ ${outputPreview}`;
    }).join('\n\n');
  }

  /**
   * Get size in bytes (accurate but slow)
   */
  getSize(): number {
    return JSON.stringify(this.getAllOutputs()).length;
  }

  private enforceLiveBudget(): void {
    const oldestLive = (): string | undefined => {
      let candidate: [string, DetailedCommandOutput] | undefined;
      for (const entry of this.liveOutputs) {
        if (!candidate
          || (entry[1].timestamp || 0) < (candidate[1].timestamp || 0)
          || ((entry[1].timestamp || 0) === (candidate[1].timestamp || 0)
            && (entry[1].num || 0) < (candidate[1].num || 0))) {
          candidate = entry;
        }
      }
      return candidate?.[0];
    };

    while (this.liveOutputs.size > this.maxOutputs
      || (this.getSizeFast() > this.maxTotalSize && this.liveOutputs.size > 0)) {
      const key = oldestLive();
      if (!key) break;
      this.liveOutputs.delete(key);
    }
  }

  private getSizeFast(): number {
    const liveSize = Array.from(this.liveOutputs.values())
      .reduce((size, output) => size + this.estimateOutputSize(output), 0);
    return this.estimatedSize + liveSize;
  }

  private estimateOutputSize(output: DetailedCommandOutput): number {
    return output.command.length + output.output.length + output.stderr.length +
      (output.host?.length || 0) + (output.target?.length || 0) +
      (output.tool?.length || 0) + (output.sessionId?.length || 0) +
      (output.tabId?.length || 0) + (output.terminalId?.length || 0) + 100;
  }

  /**
   * PTY tracking and listener capture can observe the same command through
   * different event paths. Compare a stable form so shell prompts, ANSI
   * control sequences, and the managed exit marker do not create duplicates.
   */
  private normalizeForDedup(value: unknown): string {
    return String(value ?? '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
      .replace(/osecbox-command-exit;\d+/gi, '')
      .replace(/(?:^|\n)\s*(?:\$|#|>)(?:\s+[^\n]*)?/g, '\n')
      .replace(/\r/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Clear old outputs
   */
  clear(): void {
    this.outputs = [];
    this.liveOutputs.clear();
    this.nextLiveNum = 1_000_000_000;
    this.estimatedSize = 0;
  }

  private matchesScope(output: DetailedCommandOutput, scope: CommandContextScope): boolean {
    const requestedSession = scope.sessionId?.trim();
    const requestedTab = scope.tabId?.trim();
    const requestedTerminal = scope.terminalId?.trim();
    const requestedTarget = scope.target?.trim();
    const outputSession = output.sessionId?.trim();
    const outputTab = output.tabId?.trim();
    const outputTerminal = output.terminalId?.trim();
    const outputTarget = output.target?.trim();
    const outputHost = output.host?.trim();
    const targetMatches = Boolean(
      requestedTarget && (targetsMatch(requestedTarget, outputTarget) || targetsMatch(requestedTarget, outputHost)),
    );

    // Every supplied dimension is an additional constraint. The previous
    // implementation returned as soon as terminalId/tabId matched, which
    // allowed a reusable scanner terminal's evidence for another target to
    // enter a targeted request.
    if (requestedSession && outputSession !== requestedSession) return false;
    if (scope.runId?.trim() && output.runId !== scope.runId.trim()) return false;
    if (requestedTarget && !targetMatches) return false;

    if (requestedTerminal) {
      if (outputTerminal) {
        if (outputTerminal !== requestedTerminal) return false;
      } else if (!requestedTarget || !targetMatches) {
        // Legacy records without terminal metadata can still be attributed by
        // their target, but never by session alone or by an unknown target.
        return false;
      }
    }

    if (requestedTab) {
      if (outputTab) {
        if (outputTab !== requestedTab) return false;
      } else if (outputTerminal) {
        if (outputTerminal !== requestedTab && !outputTerminal.startsWith(`${requestedTab}::`)) return false;
      } else if (!requestedTarget || !targetMatches) {
        // Preserve the conservative legacy fallback: an unscoped record must
        // carry the requested target before it can match a tab scope.
        return false;
      }
    }

    if (requestedTerminal || requestedTab || requestedTarget) return true;
    return !requestedSession || Boolean(outputSession);
  }
}
