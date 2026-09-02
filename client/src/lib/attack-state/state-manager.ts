/**
 * License-aware attack-state manager facade.
 * Uses the protected implementation when available and a bounded local implementation otherwise.
 */

import { loadEncryptedModule, isEncryptedModuleAvailable } from '../encrypted-loader';
import type { WorkingSession as Session } from './types';
import { CommandOutputStore, type CommandContextScope } from './command-output-store';
import { detectLoot, markLootUsed as markLootItemUsed } from './loot-detector';
import { saveSession } from './session-persistence';

export interface CommandMetadata extends CommandContextScope {
  tool?: string;
  /** Renderer-local generation used to reject late reusable-PTY finalizers. */
  evidenceGeneration?: number;
}

const MAX_STORED_EVIDENCE_CHARS = 150_000;

function boundStoredEvidence(value: string): string {
  if (value.length <= MAX_STORED_EVIDENCE_CHARS) return value;

  // Keep the command start/end plus a bounded sample of high-signal middle
  // lines. This keeps session persistence safe without making credentials,
  // ports, CVEs, or container/cloud markers disappear solely because they
  // occurred in the middle of a large tool dump.
  const head = value.slice(0, 24_000);
  const tail = value.slice(-96_000);
  const middle = value.slice(24_000, -96_000);
  const criticalLines: string[] = [];
  for (const line of middle.split(/\r?\n/)) {
    const lower = line.toLowerCase();
    if (
      lower.includes('password') || lower.includes('passwd') ||
      lower.includes('credential') || lower.includes('secret') ||
      lower.includes('token') || lower.includes('api_key') ||
      lower.includes('private key') || lower.includes('access_key') ||
      lower.includes('open') || lower.includes('listen') ||
      lower.includes('vulnerable') || lower.includes('cve-') ||
      lower.includes('docker') || lower.includes('kubernetes') ||
      lower.includes('cloud') || lower.includes('error') ||
      /\b\d{1,5}\/(?:tcp|udp)\b/i.test(line)
    ) {
      criticalLines.push(line);
      if (criticalLines.length >= 320) break;
    }
  }

  const candidate = `${head}\n...[middle output sampled for AI context]...\n${criticalLines.join('\n')}\n...[middle output omitted; full transcript remains in terminal]...\n${tail}`;
  if (candidate.length <= MAX_STORED_EVIDENCE_CHARS) return candidate;
  return `${candidate.slice(0, 52_000)}\n...[bounded evidence]...\n${candidate.slice(-97_000)}`;
}

export function hydrateCommandOutputStore(store: CommandOutputStore, session: Session): void {
  const history = Array.isArray(session.command_history) ? session.command_history : [];
  history.forEach((entry: any, index: number) => {
    if (typeof entry?.output !== 'string' || entry.output.length === 0) return;
    store.addOutput({
      num: index + 1,
      command: entry.command || '',
      output: entry.output,
      stderr: entry.stderr || '',
      exitCode: typeof entry.exit_code === 'number' ? entry.exit_code : (entry.result === 'failure' ? 1 : 0),
      timestamp: entry.timestamp || Date.now(),
      host: entry.host || entry.target || 'localhost',
      duration: entry.duration || 0,
      sessionId: entry.session_id || session.id,
      tabId: entry.tab_id,
      terminalId: entry.terminal_id,
      target: entry.target || entry.host,
      tool: entry.tool,
      runId: entry.run_id || entry.runId,
    });
  });
}

// Lite version interface
interface StateManagerLite {
  processCommand(command: string, exitCode: number, stdout: string, stderr: string, duration: number, metadata?: CommandMetadata): Promise<void>;
  processScannerResults(targetIp: string, results: any): Promise<boolean>;
  addBlocker(hostId: string, blocker: string): Promise<void>;
  removeBlocker(hostId: string, blocker: string): Promise<void>;
  markLootUsed(lootId: string, usedOnHost: string): Promise<void>;
  getSession(): Session;
  deltaEngine: any;
  commandOutputStore: CommandOutputStore;
  save(): Promise<void>;
  destroy(): void;
}

// Lite implementation (basic functionality)
class AttackStateManagerLite implements StateManagerLite {
  private session: Session;
  private autoSave: boolean;
  public deltaEngine: any;
  public commandOutputStore: any;

  constructor(session: Session, autoSave = true) {
    this.session = session;
    this.autoSave = autoSave;
    
    // Bounded exam config: enough headroom for five scans and many listeners
    // without allowing renderer history hydration to consume hundreds of MB.
    this.commandOutputStore = new CommandOutputStore(1000, 150000, 64 * 1024 * 1024);
    this.hydrateCommandOutputStore();
    
    // Mock delta engine (Pro feature)
    this.deltaEngine = {
      processCommandOutput: () => ({ entities: [], edges: [] }),
      getGraph: () => ({ entities: new Map(), edges: new Map() }),
      getLastDelta: () => null,
      reset: () => {}
    };
  }

  private hydrateCommandOutputStore(): void {
    hydrateCommandOutputStore(this.commandOutputStore, this.session);
  }

  async processCommand(command: string, exitCode: number, stdout: string, stderr: string, duration: number, metadata: CommandMetadata = {}): Promise<void> {
    const now = Date.now();
    const target = metadata.target || this.session.target_ip || 'localhost';
    const fullStdout = typeof stdout === 'string' ? stdout : String(stdout || '');
    const fullStderr = typeof stderr === 'string' ? stderr : String(stderr || '');
    // Loot extraction must see the retained full command transcript, while
    // session history must remain bounded under large file dumps/listeners.
    this.captureLoot(command, target, `${fullStdout}\n${fullStderr}`);
    const storedStdout = boundStoredEvidence(fullStdout);
    const storedStderr = boundStoredEvidence(fullStderr);
    
    // FIX: Store in command output store for AI context
    this.commandOutputStore.addOutput({
      num: this.session.command_history.length + 1,
      command,
      output: storedStdout,
      stderr: storedStderr,
      exitCode,
      timestamp: now,
      host: target,
      duration,
      sessionId: metadata.sessionId || this.session.id,
      tabId: metadata.tabId,
      terminalId: metadata.terminalId,
      target,
      tool: metadata.tool,
      runId: metadata.runId,
    });
    
    // Track in session history
    this.session.command_history.push({
      command,
      timestamp: now,
      host: target,
      scope: 'reconnaissance',
      result: exitCode === 0 ? 'success' : 'failure',
      duration,
      output: storedStdout,
      stderr: storedStderr,
      exit_code: exitCode,
      session_id: metadata.sessionId || this.session.id,
      tab_id: metadata.tabId,
      terminal_id: metadata.terminalId,
      target,
      tool: metadata.tool,
      run_id: metadata.runId,
    });
    
    // Keep last 100 commands in lite version
    if (this.session.command_history.length > 100) {
      this.session.command_history.shift();
    }
  }

  async processScannerResults(targetIp: string, results: any): Promise<boolean> {
    // FREE-TIER FIX: The Pro knowledge-graph isn't available here, but the AI
    // still needs to SEE scan results. Record the scan into the command output
    // store (and command history) so buildAIContext() can surface it. Without
    // this, scanner results never reach the AI and it reports "no scans run yet".
    try {
      const scannerType = results?.scannerType || 'scan';
      const command = results?.command || `${scannerType} ${targetIp}`;
      const rawOutput = typeof results?.output === 'string' ? results.output : '';
      const timestamp = results?.timestamp || Date.now();
      const target = results?.target || targetIp || this.session.target_ip || 'localhost';
      this.session.target_ip = target;

      // Prefer the real tool output; fall back to a readable summary of parsed results.
      const output = rawOutput && rawOutput.trim().length > 0
        ? rawOutput
        : this.summarizeScannerResults(scannerType, results?.results);
      this.captureLoot(command, target, output);
      const storedOutput = boundStoredEvidence(output);

      this.commandOutputStore.addOutput({
        num: this.session.command_history.length + 1,
        command,
        output: storedOutput,
        stderr: '',
        exitCode: 0,
        timestamp,
        host: target,
        duration: 0,
        sessionId: results?.sessionId || this.session.id,
        tabId: results?.tabId,
        terminalId: results?.terminalId,
        target,
        tool: results?.tool || scannerType,
        runId: results?.runId,
      });

      this.session.command_history.push({
        command,
        timestamp,
        host: target,
        scope: 'reconnaissance',
        result: 'success',
        duration: 0,
        output: storedOutput,
        stderr: '',
        exit_code: 0,
        session_id: results?.sessionId || this.session.id,
        tab_id: results?.tabId,
        terminal_id: results?.terminalId,
        target,
        tool: results?.tool || scannerType,
        run_id: results?.runId,
      });

      if (this.session.command_history.length > 100) {
        this.session.command_history.shift();
      }
      return true;
    } catch (e) {
      console.warn('[AttackStateManagerLite] Failed to record scanner results:', e);
      return false;
    }
  }

  /**
   * Build a readable text summary from parsed scanner results.
   * Used as a fallback when raw tool output isn't supplied.
   */
  private summarizeScannerResults(scannerType: string, results: any): string {
    if (!Array.isArray(results) || results.length === 0) {
      return `${scannerType} scan completed (no structured results)`;
    }
    try {
      return `${scannerType} scan results:\n${JSON.stringify(results, null, 2)}`;
    } catch {
      return `${scannerType} scan completed with ${results.length} result(s)`;
    }
  }

  /** Feed command/scanner evidence into the shared loot model once. */
  private captureLoot(command: string, host: string, output: string): void {
    if (!output) return;

    try {
      const discovered = detectLoot(host, command, output, this.session.loot_cache);
      for (const item of discovered) {
        this.session.loot.set(item.id, item);
      }
      if (discovered.length > 0) {
        console.log(`[AttackStateManagerLite] Captured ${discovered.length} loot item(s) from ${command.slice(0, 80)}`);
      }
    } catch (error) {
      // Loot extraction is enrichment; never make a terminal command fail.
      console.warn('[AttackStateManagerLite] Loot extraction failed:', error);
    }
  }

  async addBlocker(hostId: string, blocker: string): Promise<void> {
    const host = this.session.hosts.get(hostId);
    const normalizedBlocker = blocker.trim();
    if (!host || !normalizedBlocker) return;

    if (!host.blockers.includes(normalizedBlocker)) {
      host.blockers.push(normalizedBlocker);
      host.constraints[normalizedBlocker] = {
        ...(host.constraints[normalizedBlocker] || {}),
        blocked: true,
        attempts: host.constraints[normalizedBlocker]?.attempts || 0,
        last_try: Date.now(),
      };
      await this.persistIfEnabled();
    }
  }

  async removeBlocker(hostId: string, blocker: string): Promise<void> {
    const host = this.session.hosts.get(hostId);
    const normalizedBlocker = blocker.trim();
    if (!host || !normalizedBlocker) return;

    const previousLength = host.blockers.length;
    host.blockers = host.blockers.filter((entry) => entry !== normalizedBlocker);
    if (host.blockers.length !== previousLength) {
      if (host.constraints[normalizedBlocker]) {
        host.constraints[normalizedBlocker].blocked = false;
      }
      await this.persistIfEnabled();
    }
  }

  async markLootUsed(lootId: string, usedOnHost: string): Promise<void> {
    const loot = this.session.loot.get(lootId);
    const normalizedHost = usedOnHost.trim();
    if (!loot || !normalizedHost) return;

    markLootItemUsed(loot, normalizedHost);
    await this.persistIfEnabled();
  }

  getSession(): Session {
    // Return session synchronously from the lite implementation
    // Pro version will be awaited internally when needed
    return this.session;
  }

  async save(): Promise<void> {
    await saveSession(this.session);
  }

  destroy(): void {
    // The local implementation owns no subscriptions or child processes.
  }

  private async persistIfEnabled(): Promise<void> {
    if (!this.autoSave) return;

    try {
      await saveSession(this.session);
    } catch (error) {
      console.warn('[AttackStateManager] Failed to persist local session:', error);
    }
  }
}

// Factory function that loads appropriate version
async function createAttackStateManager(session: Session, autoSave = true): Promise<StateManagerLite> {
  try {
    const encryptedModulesAvailable = await isEncryptedModuleAvailable();
    
    if (encryptedModulesAvailable) {
      // Load encrypted Pro version
      console.log('[AttackStateManager] Loading encrypted Pro version');
      const encryptedModule = await loadEncryptedModule('state-manager');
      const AttackStateManagerClass = encryptedModule.AttackStateManager || encryptedModule.default;
      return new AttackStateManagerClass(session, autoSave);
    } else {
      // Use the local implementation when no encrypted module is available.
      console.log('[AttackStateManager] Using local attack-state implementation');
      return new AttackStateManagerLite(session, autoSave);
    }
  } catch (error) {
    console.warn('[AttackStateManager] Failed to load Pro version, using lite:', error);
    return new AttackStateManagerLite(session, autoSave);
  }
}

// Export class that creates appropriate version
export class AttackStateManager implements StateManagerLite {
  private instance: Promise<StateManagerLite>;
  private session: Session; // Keep a synchronous reference
  public deltaEngine: any;
  public commandOutputStore: CommandOutputStore;

  constructor(session: Session, autoSave = true) {
    // Store session synchronously
    this.session = session;
    
    // Initialize commandOutputStore IMMEDIATELY and SYNCHRONOUSLY
    this.commandOutputStore = new CommandOutputStore(1000, 150000, 64 * 1024 * 1024);
    hydrateCommandOutputStore(this.commandOutputStore, session);
    
    this.instance = createAttackStateManager(session, autoSave);
    
    // Keep session reference synced with Pro version if loaded
    this.instance.then(manager => {
      // Sync command store
      if (manager.commandOutputStore && manager.commandOutputStore !== this.commandOutputStore) {
        const earlyCommands = this.commandOutputStore.getAllOutputs();
        if (earlyCommands.length > 0) {
          console.log(`[AttackStateManager] Migrating ${earlyCommands.length} early command records to Pro store`);
          earlyCommands.forEach(cmd => {
            try {
              if (cmd.live && cmd.liveKey && typeof manager.commandOutputStore.upsertLiveOutput === 'function') {
                manager.commandOutputStore.upsertLiveOutput(cmd.liveKey, cmd);
              } else if (!cmd.live) {
                manager.commandOutputStore.addOutput(cmd);
              }
            } catch (e) {
              console.warn('[AttackStateManager] Failed to migrate command:', e);
            }
          });
        }
        this.commandOutputStore = manager.commandOutputStore;
      }
      
      // Sync session reference
      this.session = manager.getSession();
    }).catch(() => {
      // Keep using the lite store and session if Pro fails to load
    });
    
    this.deltaEngine = {
      processCommandOutput: async (...args: any[]) => {
        const manager = await this.instance;
        return manager.deltaEngine.processCommandOutput(...args);
      },
      getGraph: async () => {
        const manager = await this.instance;
        return manager.deltaEngine.getGraph();
      },
      getLastDelta: async () => {
        const manager = await this.instance;
        return manager.deltaEngine.getLastDelta();
      },
      reset: async () => {
        const manager = await this.instance;
        return manager.deltaEngine.reset();
      }
    };
  }

  async processCommand(command: string, exitCode: number, stdout: string, stderr: string, duration: number, metadata: CommandMetadata = {}): Promise<void> {
    const manager = await this.instance;
    await manager.processCommand(command, exitCode, stdout, stderr, duration, metadata);
    // Keep session reference synced
    this.session = manager.getSession();
  }

  async processScannerResults(targetIp: string, results: any): Promise<boolean> {
    this.session.target_ip = targetIp || this.session.target_ip;
    const manager = await this.instance;
    const committed = await manager.processScannerResults(targetIp, results);
    // Keep session reference synced
    this.session = manager.getSession();
    return committed !== false;
  }

  async addBlocker(hostId: string, blocker: string): Promise<void> {
    const manager = await this.instance;
    await manager.addBlocker(hostId, blocker);
    // Keep session reference synced
    this.session = manager.getSession();
  }

  async removeBlocker(hostId: string, blocker: string): Promise<void> {
    const manager = await this.instance;
    await manager.removeBlocker(hostId, blocker);
    // Keep session reference synced
    this.session = manager.getSession();
  }

  async markLootUsed(lootId: string, usedOnHost: string): Promise<void> {
    const manager = await this.instance;
    await manager.markLootUsed(lootId, usedOnHost);
    // Keep session reference synced
    this.session = manager.getSession();
  }

  getSession(): Session {
    // Return synchronously — this is kept in sync by all mutation methods
    return this.session;
  }

  async save(): Promise<void> {
    const manager = await this.instance;
    return manager.save();
  }

  async destroy(): Promise<void> {
    const manager = await this.instance;
    return manager.destroy();
  }
}
