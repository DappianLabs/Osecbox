/**
 * Attack State Store
 * Zustand store for managing attack state globally
 */

import { create } from 'zustand';
import { invalidateScanWorkspace } from './scanner/scan-run-registry';
import { terminalService } from './terminal-service';
// import type { Session } from './attack-state/types';
// import { createSession } from './attack-state/session';
// import { AttackStateManager } from './attack-state/state-manager';
// import { loadSession, listSessions } from './attack-state/session-persistence';

// Type imports only (no runtime cost)
type Session = import('./attack-state/types').WorkingSession;
type CommandMetadata = import('./attack-state/state-manager').CommandMetadata;

let lifecycleGeneration = 0;
let pendingEvidenceWrites = 0;
let evidenceRevision = 0;
const evidenceReadyWaiters = new Set<() => void>();

function beginEvidenceWrite(): () => void {
  pendingEvidenceWrites += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pendingEvidenceWrites = Math.max(0, pendingEvidenceWrites - 1);
    if (pendingEvidenceWrites === 0) {
      for (const resolve of evidenceReadyWaiters) resolve();
      evidenceReadyWaiters.clear();
    }
  };
}

/** Wait until all currently running evidence projections have settled. */
export function waitForEvidenceReady(): Promise<void> {
  if (pendingEvidenceWrites === 0) return Promise.resolve();
  return new Promise(resolve => evidenceReadyWaiters.add(() => resolve()));
}

/** Monotonic revision used to prevent AI cache hits across evidence changes. */
export function getEvidenceRevision(): number {
  return evidenceRevision;
}

function invalidateOutputCapture(): void {
  // Scanner runs use reusable PTYs, so invalidate their workspace before a
  // session/provider transition can publish a late result into the new state.
  invalidateScanWorkspace();
  terminalService.invalidateEvidenceProvenance();
  void import('./tool-output-capture')
    .then(({ invalidateToolOutputCapture }) => invalidateToolOutputCapture())
    .catch(() => undefined);
  void import('./live-foothold-context')
    .then(({ invalidateLiveFootholdContext }) => invalidateLiveFootholdContext())
    .catch(() => undefined);
}

/** Invalidate every evidence producer before replacing the working session. */
export function invalidateEvidenceWorkspace(): void {
  lifecycleGeneration += 1;
  invalidateOutputCapture();
}

interface AttackStateStore {
  session: Session | null;
  manager: any | null; // Lazy loaded AttackStateManager
  isLoading: boolean;

  // Actions
  initializeSession: (goal?: string) => Promise<void>;
  loadExistingSession: (sessionId: string) => Promise<void>;
  processCommand: (
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
    duration: number,
    metadata?: CommandMetadata
  ) => Promise<void>;
  processTerminalOutput: (
    command: string,
    output: string,
    context: {
      sessionId: string;
      sessionType: string;
      target?: string;
      tabId?: string;
      terminalId?: string;
      tool?: string;
      timestamp: number;
    }
  ) => Promise<void>;
  processScannerResults: (
    targetIp: string,
    results: any
  ) => Promise<boolean>;
  addBlocker: (hostId: string, blocker: string) => Promise<void>;
  removeBlocker: (hostId: string, blocker: string) => Promise<void>;
  markLootUsed: (lootId: string, usedOnHost: string) => Promise<void>;
  reset: () => Promise<void>;
}

export const useAttackState = create<AttackStateStore>((set, get) => ({
  session: null,
  manager: null,
  isLoading: false,

  initializeSession: async (goal?: string) => {
    invalidateEvidenceWorkspace();
    const generation = lifecycleGeneration;

    // Cleanup old manager before creating new one. AttackStateManager.destroy
    // may await lazy implementation teardown, so do not publish a new manager
    // until the old one has stopped accepting work.
    const { manager: oldManager } = get();
    if (oldManager) {
      await Promise.resolve(oldManager.destroy());
    }
    if (generation !== lifecycleGeneration) return;

    const { createSession } = await import('./attack-state/session');
    const { AttackStateManager } = await import('./attack-state/state-manager');
    if (generation !== lifecycleGeneration) return;

    const session = createSession(goal);
    const manager = new AttackStateManager(session, true);
    if (generation !== lifecycleGeneration) {
      await Promise.resolve(manager.destroy());
      return;
    }
    set({ session, manager, isLoading: false });
  },

  loadExistingSession: async (sessionId: string) => {
    invalidateEvidenceWorkspace();
    const generation = lifecycleGeneration;
    set({ isLoading: true });
    try {
      const { manager: oldManager } = get();
      if (oldManager) {
        await Promise.resolve(oldManager.destroy());
      }
      if (generation !== lifecycleGeneration) return;

      const { loadSession } = await import('./attack-state/session-persistence');
      const { AttackStateManager } = await import('./attack-state/state-manager');
      const session = await loadSession(sessionId);
      if (generation !== lifecycleGeneration) return;

      if (session) {
        const manager = new AttackStateManager(session, true);
        if (generation !== lifecycleGeneration) {
          await Promise.resolve(manager.destroy());
          return;
        }
        set({ session, manager, isLoading: false });
      } else {
        console.error('Session not found:', sessionId);
        console.log('[AttackState] Creating new session as fallback...');
        await get().initializeSession();
      }
    } catch (error) {
      if (generation !== lifecycleGeneration) return;
      console.error('Failed to load session:', error);
      console.log('[AttackState] Creating new session after error...');
      try {
        await get().initializeSession();
      } catch (initError) {
        console.error('Failed to initialize fallback session:', initError);
        if (generation === lifecycleGeneration) set({ isLoading: false });
      }
    }
  },

  processCommand: async (
    command: string,
    exitCode: number,
    stdout: string,
    stderr: string,
    duration: number,
    metadata: CommandMetadata = {},
  ) => {
    const generation = lifecycleGeneration;
    const { manager, session } = get();
    if (!manager || !session) return;
    // Provenance-bearing runs must never be assigned to a later session, and
    // an unowned run (for example a scan started before session creation) is
    // not safe to attach to whatever session happens to be current.
    if (metadata.sessionId && metadata.sessionId !== session.id) return;
    if (metadata.runId && !metadata.sessionId) return;

    const finishEvidenceWrite = beginEvidenceWrite();
    try {
      await manager.processCommand(command, exitCode, stdout, stderr, duration, metadata);
      if (generation === lifecycleGeneration && get().manager === manager && get().session?.id === session.id) {
        evidenceRevision += 1;
        set({ session: manager.getSession() });
      }
    } finally {
      finishEvidenceWrite();
    }
  },

  processTerminalOutput: async (
    command: string,
    output: string,
    context: {
      sessionId: string;
      sessionType: string;
      target?: string;
      tabId?: string;
      terminalId?: string;
      tool?: string;
      timestamp: number;
    }
  ) => {
    const generation = lifecycleGeneration;
    const { manager, session } = get();
    if (!manager || !session || context.sessionId !== session.id) return;

    const finishEvidenceWrite = beginEvidenceWrite();
    try {
      // Parse command to determine exit code (best effort)
      // Look for common error indicators in output
      const hasError = output.includes('command not found') ||
                       output.includes('permission denied') ||
                       output.includes('connection refused') ||
                       output.includes('no such file') ||
                       output.includes('cannot access');
      
      const exitCode = hasError ? 1 : 0;
      
      // Split output into stdout/stderr (best effort)
      // Most errors contain these keywords
      const errorLines: string[] = [];
      const outputLines: string[] = [];
      
      output.split('\n').forEach(line => {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('error') || 
            lowerLine.includes('failed') || 
            lowerLine.includes('denied') ||
            lowerLine.includes('refused')) {
          errorLines.push(line);
        } else {
          outputLines.push(line);
        }
      });
      
      const stdout = outputLines.join('\n');
      const stderr = errorLines.join('\n');
      
      // Preserve the caller's provenance. In particular, do not synthesize a
      // target from the mutable session: a targeted terminal result must remain
      // attributable to the target that produced it.
      await manager.processCommand(command, exitCode, stdout, stderr, 0, {
        sessionId: context.sessionId,
        ...(context.target ? { target: context.target } : {}),
        ...(context.tabId ? { tabId: context.tabId } : {}),
        ...(context.terminalId ? { terminalId: context.terminalId } : {}),
        ...(context.tool ? { tool: context.tool } : {}),
      });
      if (generation === lifecycleGeneration && get().manager === manager && get().session?.id === session.id) {
        evidenceRevision += 1;
        set({ session: manager.getSession() });
      }
    } finally {
      finishEvidenceWrite();
    }
  },

  processScannerResults: async (targetIp: string, results: any): Promise<boolean> => {
    const generation = lifecycleGeneration;
    const { manager, session } = get();
    const resultSessionId = typeof results?.sessionId === 'string' ? results.sessionId : undefined;
    if (!manager || !session || (resultSessionId && resultSessionId !== session.id)) return false;
    const finishEvidenceWrite = beginEvidenceWrite();
    try {
      const committed = await manager.processScannerResults(targetIp, results);
      if (generation !== lifecycleGeneration || get().manager !== manager || get().session?.id !== session.id) {
        return false;
      }
      evidenceRevision += 1;
      set({ session: manager.getSession() });
      // Older/protected managers may not return a status. Reaching this point
      // still means their awaited evidence operation completed.
      return committed !== false;
    } finally {
      finishEvidenceWrite();
    }
  },

  addBlocker: async (hostId: string, blocker: string) => {
    const generation = lifecycleGeneration;
    const { manager, session } = get();
    if (manager && session) {
      await manager.addBlocker(hostId, blocker);
      if (generation === lifecycleGeneration && get().manager === manager && get().session?.id === session.id) {
        set({ session: manager.getSession() });
      }
    }
  },

  removeBlocker: async (hostId: string, blocker: string) => {
    const generation = lifecycleGeneration;
    const { manager, session } = get();
    if (manager && session) {
      await manager.removeBlocker(hostId, blocker);
      if (generation === lifecycleGeneration && get().manager === manager && get().session?.id === session.id) {
        set({ session: manager.getSession() });
      }
    }
  },

  markLootUsed: async (lootId: string, usedOnHost: string) => {
    const generation = lifecycleGeneration;
    const { manager, session } = get();
    if (manager && session) {
      await manager.markLootUsed(lootId, usedOnHost);
      if (generation === lifecycleGeneration && get().manager === manager && get().session?.id === session.id) {
        set({ session: manager.getSession() });
      }
    }
  },

  reset: async () => {
    invalidateEvidenceWorkspace();
    const { manager: oldManager } = get();
    if (oldManager) {
      await Promise.resolve(oldManager.destroy());
    }
    set({ session: null, manager: null, isLoading: false });
  }
}));

// Initialize session on first load (immediate, no delay)
if (typeof window !== 'undefined') {
  // IMPROVED: Use setTimeout as fallback if requestIdleCallback not available
  const initializeAsync = async () => {
    try {
      // A full workspace restore is opt-in. The marker is written only after a
      // durable session save/load, so boot can recover the last pentest without
      // scanning every session file or rebuilding unnecessary state.
      let persistWorkspace = false;
      try {
        const localSettings = JSON.parse(localStorage.getItem('app-settings') || '{}');
        persistWorkspace = Boolean(localSettings?.state?.settings?.persistWorkspace);
        if (window.electron?.invoke) {
          const backendSettings = await window.electron.invoke('get-settings');
          if (backendSettings?.success) {
            persistWorkspace = Boolean(backendSettings.settings?.persistWorkspace ?? persistWorkspace);
          }
        }
      } catch (settingsError) {
        console.warn('[AttackState] Could not read workspace persistence setting:', settingsError);
      }

      const lastSessionId = localStorage.getItem('osecbox-last-session');
      if (persistWorkspace && lastSessionId) {
        try {
          const { SessionManager } = await import('./session-manager');
          await SessionManager.loadSession(lastSessionId);
          console.log('[AttackState] Restored last full workspace session:', lastSessionId);
          return;
        } catch (restoreError) {
          console.warn('[AttackState] Last workspace restore failed; falling back to attack state:', restoreError);
          localStorage.removeItem('osecbox-last-session');
        }
      }

      const { listSessions } = await import('./attack-state/session-persistence');
      const sessions = await listSessions();
      
      if (sessions.length > 0) {
        // Load most recent session
        console.log('[AttackState] Loading existing session:', sessions[0]);
        await useAttackState.getState().loadExistingSession(sessions[0]);
      } else {
        // Create new session
        console.log('[AttackState] No existing sessions, creating new one');
        await useAttackState.getState().initializeSession();
      }
    } catch (error) {
      console.error('Failed to initialize attack state:', error);
      // Fallback: create new session
      try {
        await useAttackState.getState().initializeSession();
      } catch (initError) {
        console.error('Failed to create fallback session:', initError);
      }
    }
  };
  
  // Use requestIdleCallback if available, otherwise setTimeout
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => initializeAsync());
  } else {
    setTimeout(() => initializeAsync(), 100);
  }
}
