/**
 * Session Manager - WITH PROPER LIMITS
 * Full functionality when free, 3/day limits when monetization enabled
 * 
 * Saves comprehensive state including:
 * - Attack state (scan results, targets, vulnerabilities)
 * - All store states (foothold, tunneling, subdomain, etc.)
 * - Terminal output snapshots
 * - AI conversation history
 * 
 * Uses Electron's per-user application data directory for durable persistence.
 */

import { useAttackState } from './attack-state-store';
import { useFootholdStore } from './foothold-store';
import { useTunnelingStore } from './tunneling-store';
import { useSubdomainStore } from './subdomain-store';
import { useTerminalTabsStore } from './terminal-tabs-store';
import { useMetasploitStore } from './metasploit-store';
import { useAutomationStore } from './automation-store';
import { useTimelineStore } from './timeline-store';
import { usePanelLayoutStore } from './panel-layout-store';
import { useDiscoveryStore } from './discovery-store';
import { ScanStore } from './scan-store';
import { TopologyStore } from './topology-store';
import { terminalService } from './terminal-service';
import { ProFeatures } from './pro-features';
import { invalidateEvidenceWorkspace } from './attack-state-store';
import * as SessionPersistence from './attack-state/session-persistence';
import {
  flushAiChatHistory,
  loadAiChatHistory,
  serializeAiChatHistory,
} from './ai-chat-history';

export interface SessionMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  size: number;
  tabCount?: number; // FIX: Added missing property
}

interface TerminalSnapshot {
  id: string;
  output: string;
  sessionType: string;
  workingDirectory?: string;
  envVars?: Record<string, string>;
  commandHistory?: string[];
  history?: {
    totalLines: number;
    totalDiskSize: number;
    durable: boolean;
  };
}

interface SessionArtifactReference {
  key: string;
  field: string;
  revision: string;
  bytes: number;
}

class SessionManagerImpl {
  private static STORAGE_KEY = 'osecbox-sessions';
  private static LAST_SESSION_KEY = 'osecbox-last-session';
  private static FORMAT_VERSION = 2;

  private static createSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private static safeFileName(value: string): string {
    return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'session';
  }

  private static createArtifactRevision(): string {
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2);
    return `${Date.now()}-${random}`;
  }

  private static async loadSessionArtifacts(session: any): Promise<any> {
    const references = session?.data?.artifacts;
    if (!references || typeof references !== 'object') return session;
    if (!window.electron?.loadSessionArtifact) {
      throw new Error('This session contains large evidence files; update OsecBox before loading it.');
    }

    const hydrated = { ...session, data: { ...session.data } };
    for (const reference of Object.values(references) as SessionArtifactReference[]) {
      if (!reference || typeof reference.field !== 'string' || typeof reference.key !== 'string') continue;
      const raw = await window.electron.loadSessionArtifact({
        sessionId: session.id,
        key: reference.key,
        revision: reference.revision,
      });
      if (!raw) {
        throw new Error(`Saved session artifact is missing: ${reference.key}`);
      }
      try {
        hydrated.data[reference.field] = JSON.parse(raw);
      } catch {
        throw new Error(`Saved session artifact is corrupt: ${reference.key}`);
      }
    }
    return hydrated;
  }

  private static readLocalSession(sessionId: string): any | null {
    const session = this.getAllSessions().find((item) => item?.id === sessionId);
    return session || null;
  }

  private static async readSession(sessionId: string): Promise<any | null> {
    let diskError: unknown = null;

    if (window.electron?.loadSessionState) {
      try {
        const json = await window.electron.loadSessionState(sessionId);
        if (json) {
          const parsed = JSON.parse(json);
          if (parsed && typeof parsed === 'object') return await this.loadSessionArtifacts(parsed);
        }
      } catch (error) {
        diskError = error;
        console.warn('[SessionManager] Disk session unavailable or corrupt; trying local fallback:', error);
      }
    }

    const fallback = this.readLocalSession(sessionId);
    if (!fallback && diskError) throw new Error('Saved session is unavailable or corrupt');
    return fallback;
  }

  static async initialize(): Promise<void> {
    console.log('[SessionManager] Initialized with comprehensive state persistence');
  }

  static async saveSession(name: string, description?: string): Promise<void> {
    const normalizedName = String(name || '').trim().slice(0, 120);
    if (!normalizedName) throw new Error('A session name is required');

    // Check limits first
    const canSave = await ProFeatures.canSaveSession();
    if (!canSave.allowed) {
      throw new Error(canSave.message || 'Session save limit reached');
    }

    try {
      const existingSessions = this.getAllSessions();
      const existing = existingSessions.find((item) =>
        typeof item?.name === 'string' && item.name.trim().toLowerCase() === normalizedName.toLowerCase()
      );
      const sessionId = existing?.id || this.createSessionId();
      const createdAt = existing?.createdAt || new Date().toISOString();
      
      // Capture terminal outputs
      const terminalSnapshots: TerminalSnapshot[] = [];
      const terminalTabs = useTerminalTabsStore.getState().terminals;
      
      for (const tab of terminalTabs) {
        try {
          const output = terminalService.getOutput(tab.id);
          if (output) {
            let history: TerminalSnapshot['history'];
            if (window.electron?.terminalHistoryGetStats) {
              const historyResult = await window.electron.terminalHistoryGetStats({ ptyId: tab.id });
              const stats = historyResult?.success ? historyResult.stats : null;
              if (!stats || stats.durable !== true) {
                throw new Error(`Terminal history for ${tab.id} is not durable; refusing a partial session save`);
              }
              history = {
                totalLines: Number(stats.totalLines) || 0,
                totalDiskSize: Number(stats.totalDiskSize) || 0,
                durable: true,
              };
            }

            // Capture working directory from terminal tab
            const workingDirectory = tab.workingDirectory || '~';
            
            // Extract command history from output (last 50 commands)
            const commandHistory = this.extractCommandHistory(output);
            
            // Detect shell type from output
            const isWindowsPowerShell = output.includes('PS ') || 
                                       output.includes('Windows PowerShell') ||
                                       output.includes('Set-Location');
            
            // Capture basic environment variables (we can't get all, but save what we know)
            const envVars: Record<string, string> = {
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor',
              SHELL_TYPE: isWindowsPowerShell ? 'powershell' : 'bash',
            };
            
            terminalSnapshots.push({
              id: tab.id,
              // Keep session files bounded even when a terminal has a large
              // scrollback buffer. The live terminal remains untouched.
              output: output.slice(-200000),
              sessionType: tab.sessionType || 'general',
              workingDirectory,
              envVars,
              commandHistory,
              history,
            });
          }
        } catch (error) {
          console.warn(`[SessionManager] Failed to capture terminal ${tab.id}:`, error);
        }
      }

      // The attack state stores hosts/loot in Map/Set and a live
      // class instance (manager). JSON.stringify turns Maps into "{}" and strips
      // all methods — so the old `attackState: useAttackState.getState()` silently
      // lost every host, port, credential and the command store. Serialize properly.
      const attackStateRaw = useAttackState.getState();
      let attackSession: any = null;
      let commandOutputs: any[] = [];
      try {
        if (attackStateRaw.session) {
          attackSession = SessionPersistence.serializeSession(attackStateRaw.session as any);
        }
        commandOutputs = this.collectCommandOutputs(attackStateRaw.manager?.commandOutputStore);
      } catch (e) {
        console.warn('[SessionManager] Failed to serialize attack state:', e);
      }

      const discoveryState = {
        activeCommand: useDiscoveryStore.getState().activeCommand,
        // Keep a useful renderer fallback in the primary record. The complete
        // value is also placed in the workspace artifact below.
        output: useDiscoveryStore.getState().output.slice(-250000),
      };
      const scanStoreData = ScanStore.getAll();
      const topologyState = {
        diagrams: TopologyStore.getAllDiagrams(),
        activeDiagramId: TopologyStore.getActiveDiagram()?.id || null,
      };
      const scannerState = (() => {
        const state = (window as any).__nmapContextState;
        if (!state || !Array.isArray(state.tabs)) return null;
        const tabs = state.tabs.filter((tab: any) => tab && typeof tab.id === 'string').map((tab: any) => ({
          ...tab,
          // A scan cannot resume its child process after restart.
          isScanning: false,
          scanningByScanner: tab.scanningByScanner
            ? Object.fromEntries(Object.keys(tab.scanningByScanner).map((key) => [key, false]))
            : {},
          terminalOutput: Array.isArray(tab.terminalOutput)
            ? tab.terminalOutput.map((line: any) => String(line))
            : [],
          aiConversation: Array.isArray(tab.aiConversation)
            ? tab.aiConversation.map((message: any) => ({
                role: message.role === 'assistant' ? 'assistant' : 'user',
                content: String(message.content || ''),
              }))
            : [],
          errors: Array.isArray(tab.errors)
            ? tab.errors.map((error: any) => ({
                ...error,
                details: error.details,
                message: typeof error.message === 'string' ? error.message : String(error.message || ''),
              }))
            : [],
        }));
        const activeTabId = tabs.some((tab: any) => tab.id === state.activeTabId)
          ? state.activeTabId
          : tabs[0]?.id || '';
        return { tabs, activeTabId };
      })();
      await flushAiChatHistory();
      const aiHistory = serializeAiChatHistory(await loadAiChatHistory());

      const electronArtifacts = !!window.electron?.saveSessionArtifact;
      const artifactRevision = this.createArtifactRevision();
      const artifacts: Record<string, SessionArtifactReference> = {};
      const saveArtifact = async (key: string, field: string, value: unknown): Promise<void> => {
        if (!electronArtifacts || !window.electron?.saveSessionArtifact) return;
        const data = JSON.stringify(value);
        if (typeof data !== 'string') throw new Error(`Could not serialize session artifact ${key}`);
        const result = await window.electron.saveSessionArtifact({
          sessionId,
          key,
          revision: artifactRevision,
          data,
        });
        if (!result?.success) {
          throw new Error(result?.error || `Could not save session artifact ${key}`);
        }
        artifacts[key] = {
          key,
          field,
          revision: artifactRevision,
          bytes: Number(result.bytes) || new TextEncoder().encode(data).byteLength,
        };
      };

      if (electronArtifacts) {
        // These collections can be much larger than a reliable browser/IPC
        // session record. They are committed first under a unique revision;
        // the primary session JSON is committed only after every artifact is
        // complete and references the same revision.
        await saveArtifact('command-outputs', 'commandOutputs', commandOutputs);
        await saveArtifact('ai-history', 'aiHistory', aiHistory);
        await saveArtifact('scan-store', 'scanStoreData', scanStoreData);
        await saveArtifact('scanner-state', 'scannerState', scannerState);
        await saveArtifact('discovery-state', 'discoveryState', {
          ...discoveryState,
          output: useDiscoveryStore.getState().output,
        });
        await saveArtifact('topology-state', 'topologyState', topologyState);
      }

      const session = {
        id: sessionId,
         name: normalizedName,
         description: typeof description === 'string' ? description.trim().slice(0, 500) || undefined : undefined,
        createdAt,
        updatedAt: new Date().toISOString(),
        formatVersion: this.FORMAT_VERSION,
        data: {
          // Properly serialized attack state (Maps/Sets → JSON-safe)
          attackSession,

          // Full command outputs are in a revisioned artifact in Electron;
          // retaining the array here keeps old/web sessions compatible.
          commandOutputs: electronArtifacts ? [] : commandOutputs,
          artifacts: electronArtifacts ? artifacts : undefined,

          // All store states (plain objects — safe to clone via getState)
          footholdState: useFootholdStore.getState(),
          tunnelingState: useTunnelingStore.getState(),
          subdomainState: useSubdomainStore.getState(),
          terminalTabsState: useTerminalTabsStore.getState(),
          metasploitState: useMetasploitStore.getState(),
          automationState: useAutomationStore.getState(),
          timelineState: {
            events: useTimelineStore.getState().events,
          },
          panelLayoutState: {
            layouts: usePanelLayoutStore.getState().layouts,
            collapsed: usePanelLayoutStore.getState().collapsed,
          },
          discoveryState: electronArtifacts
            ? { activeCommand: discoveryState.activeCommand, output: '' }
            : discoveryState,
          scanStoreData: electronArtifacts ? null : scanStoreData,
          topologyState: electronArtifacts
            ? { diagrams: [], activeDiagramId: topologyState.activeDiagramId }
            : topologyState,
          scannerState: electronArtifacts ? null : scannerState,
          
          // Terminal snapshots
          terminalSnapshots,
          
          // Legacy support
          scanResults: (localStorage.getItem('scanner-results') || '{}').slice(-250000),
          
          // AI conversation history (if exists)
          aiHistory: electronArtifacts ? '[]' : aiHistory,
        }
      };

      // Persist the compact primary record after all revisioned artifacts have
      // been committed. A failed artifact or primary write therefore leaves
      // the last known-good session loadable.
      const json = JSON.stringify(session, null, 2);
      const jsonBytes = new TextEncoder().encode(json).byteLength;
      const artifactBytes = Object.values(artifacts).reduce((sum, artifact) => sum + artifact.bytes, 0);
      const persistedBytes = jsonBytes + artifactBytes;
      const maxSessionBytes = window.electron?.saveSessionState ? 15 * 1024 * 1024 : 4 * 1024 * 1024;
      if (jsonBytes > maxSessionBytes) {
        throw new Error('Session metadata is too large to save safely. Close duplicate tabs or export the affected workspace data.');
      }
      if (window.electron?.saveSessionState) {
        const saved = await window.electron.saveSessionState(sessionId, json);
        if (!saved) throw new Error('The operating system rejected the session save');
        console.log(`[SessionManager] Session saved to Electron userData: ${sessionId}.json`);
      } else {
        console.warn('[SessionManager] Electron backend not available, session only in localStorage');
      }

      // Update the local fallback only after the durable write succeeds. Replace
      // same-name saves instead of growing duplicate full snapshots forever.
      const sessions = existingSessions.filter((item) => item?.id !== sessionId);
      sessions.push({
        ...session,
        // Electron disk is the durable source of truth. Keep only metadata in
        // localStorage so 50 large terminal sessions cannot exhaust the 5MB
        // browser quota. Web mode still keeps the complete fallback snapshot.
        ...(window.electron?.saveSessionState
          ? { data: undefined, size: persistedBytes, tabCount: terminalTabs.length }
          : {}),
      });
      this.writeLocalIndex(sessions);
      try {
        localStorage.setItem(this.LAST_SESSION_KEY, sessionId);
      } catch (error) {
        console.warn('[SessionManager] Could not update last-session marker:', error);
      }
      
      // Record usage
      ProFeatures.recordSessionSave();
      
      console.log('[SessionManager] Session saved successfully with comprehensive state');
    } catch (error) {
      console.error('[SessionManager] Failed to save session:', error);
      throw error;
    }
  }

  static async loadSession(sessionId: string): Promise<void> {
    // Check limits first
    const canLoad = await ProFeatures.canLoadSession();
    if (!canLoad.allowed) {
      throw new Error(canLoad.message || 'Session load limit reached');
    }

    try {
      const session = await this.readSession(sessionId);
      
      if (!session) {
        throw new Error('Session not found');
      }
      if (!session.data || typeof session.data !== 'object') {
        throw new Error('Saved session has no usable workspace data');
      }
      try {
        localStorage.setItem(this.LAST_SESSION_KEY, sessionId);
      } catch {
        // The session itself remains loadable from disk.
      }

      // A restored workspace replaces the live manager and scanner terminals.
      // Invalidate all evidence ownership before any async hydration so late
      // PTY/process writes cannot land in the restored session.
      invalidateEvidenceWorkspace();
      const oldManager = useAttackState.getState().manager;
      if (oldManager) {
        await Promise.resolve(oldManager.destroy());
      }
      useAttackState.setState({ session: null, manager: null, isLoading: true });

      // Rebuild a LIVE attack state manager from serialized data.
      let restoredAttackState = false;
      // The old code did `useAttackState.setState(session.data.attackState)` which
      // overwrote the working manager (class instance + commandOutputStore) with a
      // dead JSON blob, breaking processCommand() and the AI cross-terminal context.
      if (session.data.attackSession) {
        try {
          const [{ deserializeSession }, { AttackStateManager }] = await Promise.all([
            import('./attack-state/session-persistence'),
            import('./attack-state/state-manager'),
          ]);

          const restoredSession = deserializeSession(session.data.attackSession);
          const manager = new AttackStateManager(restoredSession as any, true);

          // Replay saved command outputs into the (fresh) command store so the AI
          // can still see every command from all terminals after a reload.
          if (Array.isArray(session.data.commandOutputs) && manager.commandOutputStore) {
            for (const out of session.data.commandOutputs) {
              try {
                manager.commandOutputStore.addOutput(out);
              } catch { /* skip malformed entry */ }
            }
          }

          useAttackState.setState({ session: restoredSession as any, manager, isLoading: false });
          restoredAttackState = true;
          console.log('[SessionManager] Attack state restored with live manager');
        } catch (e) {
          console.error('[SessionManager] Failed to restore attack state:', e);
        }
      } else if (session.data.attackState) {
        // ⚠️ Legacy session (pre-fix) — structured findings were not recoverable,
        // but restore whatever plain fields exist so the load doesn't hard-fail.
        console.warn('[SessionManager] Loading legacy session format (limited attack-state recovery)');
      }
      
      if (!restoredAttackState) {
        useAttackState.setState({ isLoading: false });
      }

      if (session.data.footholdState && Array.isArray(session.data.footholdState.tabs)) {
        // Processes do not survive an app restart. Never restore a stale
        // running flag that would make the UI claim a dead listener is live.
        useFootholdStore.setState({
          ...session.data.footholdState,
          tabs: session.data.footholdState.tabs.map((tab: any) => ({
            ...tab,
            listeners: Array.isArray(tab.listeners)
              ? tab.listeners.map((listener: any) => ({ ...listener, status: 'stopped' }))
              : [],
          })),
        });
      }
      
      if (session.data.tunnelingState && Array.isArray(session.data.tunnelingState.tabs)) {
        useTunnelingStore.setState({
          ...session.data.tunnelingState,
          tabs: session.data.tunnelingState.tabs.map((tab: any) => ({
            ...tab,
            sessions: Array.isArray(tab.sessions)
              ? tab.sessions.map((tunnel: any) => ({ ...tunnel, status: 'stopped' }))
              : [],
          })),
        });
      }
      
      if (session.data.subdomainState) {
        useSubdomainStore.setState({
          ...session.data.subdomainState,
          sessions: Array.isArray(session.data.subdomainState.sessions)
            ? session.data.subdomainState.sessions.map((toolSession: any) => ({ ...toolSession, isActive: false }))
            : [],
          activeSession: null,
        });
      }
      
      if (session.data.terminalTabsState && Array.isArray(session.data.terminalTabsState.terminals)) {
        // Mark all terminals as restored
        const restoredState = {
          ...session.data.terminalTabsState,
          terminals: session.data.terminalTabsState.terminals.filter((t: any) => t && typeof t.id === 'string').map((t: any) => ({
            ...t,
            isRestored: true,
          })),
        };
        useTerminalTabsStore.setState(restoredState);
      }
      
      if (session.data.metasploitState) {
        useMetasploitStore.setState(session.data.metasploitState);
      }

      if (session.data.automationState) {
        useAutomationStore.setState(session.data.automationState);
      }

      if (session.data.timelineState?.events && Array.isArray(session.data.timelineState.events)) {
        useTimelineStore.setState({
          events: session.data.timelineState.events.filter((event: any) =>
            event && typeof event.id === 'string' && typeof event.timestamp === 'string' &&
            typeof event.title === 'string' && typeof event.description === 'string'
          ),
          isLoading: false,
          error: null,
        });
      }

      if (session.data.panelLayoutState) {
        usePanelLayoutStore.setState({
          layouts: session.data.panelLayoutState.layouts || {},
          collapsed: session.data.panelLayoutState.collapsed || {},
        });
      }

      if (session.data.discoveryState) {
        useDiscoveryStore.setState({
          activeCommand: typeof session.data.discoveryState.activeCommand === 'string'
            ? session.data.discoveryState.activeCommand
            : null,
          output: typeof session.data.discoveryState.output === 'string'
            ? session.data.discoveryState.output.slice(-250000)
            : '',
        });
      }

      if (session.data.scanStoreData) {
        ScanStore.restore(session.data.scanStoreData);
      }

      if (session.data.topologyState) {
        TopologyStore.restore(session.data.topologyState.diagrams, session.data.topologyState.activeDiagramId);
      }

      if (session.data.scannerState?.tabs && Array.isArray(session.data.scannerState.tabs)) {
        const scannerBridge = (window as any).__nmapContextState;
        const restoredTabs = session.data.scannerState.tabs
          .filter((tab: any) => tab && typeof tab.id === 'string')
          .map((tab: any) => ({
            ...tab,
            isScanning: false,
            scanningByScanner: tab.scanningByScanner
              ? Object.fromEntries(Object.keys(tab.scanningByScanner).map((key) => [key, false]))
              : {},
          }));
        if (scannerBridge?.setTabs) {
          scannerBridge.setTabs(restoredTabs);
        } else {
          try {
            localStorage.setItem('pending-scanner-restore', JSON.stringify({
              tabs: restoredTabs,
              activeTabId: session.data.scannerState.activeTabId,
            }));
          } catch (error) {
            console.warn('[SessionManager] Could not queue scanner-tab restore:', error);
          }
        }
        const activeTabId = restoredTabs.some((tab: any) => tab.id === session.data.scannerState.activeTabId)
          ? session.data.scannerState.activeTabId
          : restoredTabs[0]?.id;
        if (scannerBridge?.setActiveTabId && activeTabId) {
          scannerBridge.setActiveTabId(activeTabId);
        }
      }
      
      // Store terminal snapshots as a hand-off for Terminal components that
      // mount after this load. No page reload is required; existing views will
      // react to the store update above.
      const legacyTerminalSnapshots = Array.isArray(session.data.terminalSnapshots)
        ? session.data.terminalSnapshots.filter((snapshot: TerminalSnapshot) => snapshot?.history?.durable !== true)
        : [];
      if (legacyTerminalSnapshots.length > 0) {
        try {
          localStorage.setItem('pending-terminal-restore', JSON.stringify(legacyTerminalSnapshots));
          console.log(`[SessionManager] Stored ${legacyTerminalSnapshots.length} legacy terminal snapshots for post-reload restoration`);
        } catch (error) {
          console.warn('[SessionManager] Terminal snapshots exceed localStorage quota; live tabs will restore without output:', error);
          try { localStorage.removeItem('pending-terminal-restore'); } catch { /* private mode */ }
        }
      }
      
      // Legacy support
      if (session.data.scanResults) {
        localStorage.setItem('scanner-results', session.data.scanResults);
      }
      
      // Restore AI history
      if (session.data.aiHistory) {
        localStorage.setItem('ai-conversation-history', session.data.aiHistory);
      }

      // Record usage
      ProFeatures.recordSessionLoad();

      console.log('[SessionManager] Session loaded successfully with comprehensive state');
    } catch (error) {
      console.error('[SessionManager] Failed to load session:', error);
      throw error;
    }
  }

  static async exportSession(sessionId: string): Promise<void> {
    try {
      const session = await this.readSession(sessionId);
      
      if (!session) {
        throw new Error('Session not found');
      }

      // Create export data
      const { artifacts: _artifacts, ...exportDataSession } = session.data || {};
      const exportData = {
        ...session,
        data: exportDataSession,
        exportedAt: new Date().toISOString(),
        version: this.FORMAT_VERSION,
      };

      // Download as JSON
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `osecbox-session-${this.safeFileName(session.name)}-${sessionId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('[SessionManager] Session exported successfully');
    } catch (error) {
      console.error('[SessionManager] Failed to export session:', error);
      throw error;
    }
  }

  static async getSessionMetadata(): Promise<SessionMetadata[]> {
    let sessions = this.getAllSessions();

    // Recover a save whose process ended after the disk rename but before the
    // local index update. This is a cheap single-file check and avoids hiding
    // the user's most recent pentest after a crash.
    let lastSessionId: string | null = null;
    try { lastSessionId = localStorage.getItem(this.LAST_SESSION_KEY); } catch { /* private mode */ }
    if (lastSessionId && !sessions.some((session) => session?.id === lastSessionId)) {
      try {
        const lastSession = await this.readSession(lastSessionId);
        if (lastSession) sessions = [...sessions, lastSession];
      } catch {
        // A missing marker is harmless; normal disk enumeration below still
        // recovers sessions when the local index is empty.
      }
    }

    // The localStorage index is only a fast UI cache. If it was cleared or
    // damaged, enumerate the durable Electron sessions so a user can still
    // discover and load their work.
    if (sessions.length === 0 && window.electron?.listSessions) {
      const listedIds = await window.electron.listSessions();
      const ids = Array.isArray(listedIds) ? listedIds : [];
      const restored: any[] = [];
      for (const id of ids.slice(0, 50)) {
        try {
          const session = await this.readSession(id);
          if (session) restored.push(session);
        } catch {
          // Ignore one corrupt file; the remaining sessions should remain usable.
        }
      }
      sessions = restored;
    }

    return sessions.map(session => ({
      id: session.id,
      name: session.name,
      description: session.description,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      size: Number(session.size) || JSON.stringify(session).length,
      tabCount: Number(session.tabCount) || session.data?.terminalTabsState?.terminals?.length || 0
    }));
  }

  static async deleteSession(sessionId: string): Promise<void> {
    // Delete the durable copy first. If the OS rejects the delete, leave the
    // local index untouched so the session is still discoverable.
    if (window.electron?.deleteSession) {
      const deleted = await window.electron.deleteSession(sessionId);
      if (!deleted) throw new Error('The saved session could not be deleted from disk');
        console.log(`[SessionManager] Session deleted from Electron userData: ${sessionId}.json`);
    }

    const sessions = this.getAllSessions();
    const filtered = sessions.filter(s => s.id !== sessionId);
    this.writeLocalIndex(filtered);
    try {
      if (localStorage.getItem(this.LAST_SESSION_KEY) === sessionId) {
        const replacement = filtered[filtered.length - 1];
        if (replacement?.id) localStorage.setItem(this.LAST_SESSION_KEY, replacement.id);
        else localStorage.removeItem(this.LAST_SESSION_KEY);
      }
    } catch { /* private mode */ }
    
    console.log('[SessionManager] Session deleted successfully');
  }

  static async importSession(file: File): Promise<void> {
    try {
      if (!file || file.size > 10 * 1024 * 1024) {
        throw new Error('Session file is missing or larger than 10 MB');
      }
      const text = await file.text();
      const importedSession = JSON.parse(text);
      
      // Validate session structure
      if (!importedSession || typeof importedSession !== 'object' ||
          typeof importedSession.name !== 'string' || !importedSession.data ||
          typeof importedSession.data !== 'object') {
        throw new Error('Invalid session file format');
      }
      
      // Generate new ID to avoid conflicts
      const newSessionId = this.createSessionId();
      importedSession.id = newSessionId;
      importedSession.name = importedSession.name.trim().slice(0, 120) || 'Imported session';
      importedSession.updatedAt = new Date().toISOString();
      // An exported file contains hydrated evidence, not references to the
      // original profile's sidecar files.
      if (importedSession.data && typeof importedSession.data === 'object') {
        delete importedSession.data.artifacts;
      }
      
      // Save to disk via electron backend
      const json = JSON.stringify(importedSession, null, 2);
      if (window.electron?.saveSessionState) {
        const saved = await window.electron.saveSessionState(newSessionId, json);
        if (!saved) throw new Error('The operating system rejected the imported session');
        console.log(`[SessionManager] Imported session saved to Electron userData: ${newSessionId}.json`);
      }

      const sessions = this.getAllSessions().filter((item) => item?.id !== newSessionId);
      sessions.push(window.electron?.saveSessionState
        ? { ...importedSession, data: undefined, size: json.length, tabCount: importedSession.data?.terminalTabsState?.terminals?.length || 0 }
        : importedSession);
      this.writeLocalIndex(sessions);
      try {
        localStorage.setItem(this.LAST_SESSION_KEY, newSessionId);
      } catch { /* disk import remains usable */ }
      
      console.log('[SessionManager] Session imported successfully');
    } catch (error) {
      console.error('[SessionManager] Failed to import session:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to import session');
    }
  }

  private static getAllSessions(): any[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('[SessionManager] Failed to load sessions:', error);
      return [];
    }
  }

  private static writeLocalIndex(sessions: any[]): void {
    const index = sessions.slice(-50).map((session) => {
      if (!window.electron?.saveSessionState) return session;
      const { data: _data, ...metadata } = session || {};
      return {
        ...metadata,
        size: Number(metadata.size) || 0,
        tabCount: Number(metadata.tabCount) || 0,
      };
    });
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(index));
    } catch (error) {
      // Saving to disk already succeeded. A full local cache must never turn a
      // successful save into a user-visible failure.
      console.warn('[SessionManager] Local session index could not be written:', error);
    }
  }

  /**
   * Collect every retained command output for persistence. The command store
   * already owns a bounded 64 MB evidence budget; Electron sessions place the
   * complete retained collection in a sidecar artifact instead of silently
   * dropping older commands to fit the primary session JSON.
   */
  private static collectCommandOutputs(store: any): any[] {
    try {
      if (!store || typeof store.getAllOutputs !== 'function') return [];
      const all = typeof store.getPersistedOutputs === 'function'
        ? store.getPersistedOutputs()
        : store.getAllOutputs();
      if (!Array.isArray(all) || all.length === 0) return [];

      const total = all.reduce((sum, out) => sum + (out?.command?.length || 0) + (out?.output?.length || 0) + (out?.stderr?.length || 0) + 128, 0);
      console.log(`[SessionManager] Captured ${all.length} finalized command outputs (${(total / 1024 / 1024).toFixed(2)}MB)`);
      return all;
    } catch (e) {
      console.warn('[SessionManager] Failed to collect command outputs:', e);
      return [];
    }
  }

  /**
   * Extract command history from terminal output
   * Looks for lines that start with $ or # (bash) or PS (PowerShell)
   */
  private static extractCommandHistory(output: string): string[] {
    const lines = output.split('\n');
    const commands: string[] = [];
    
    for (const line of lines) {
      // Match bash/zsh prompts: $ command or user@host:~$ command
      const bashMatch = line.match(/^(?:\$|#|>|\w+@\w+.*?[\$#])\s+(.+)$/);
      if (bashMatch && bashMatch[1]) {
        const cmd = bashMatch[1].trim();
        if (this.isValidCommand(cmd)) {
          commands.push(cmd);
        }
        continue;
      }
      
      // Match PowerShell prompts: PS C:\> command
      const psMatch = line.match(/^PS\s+[A-Z]:\\.*?>\s+(.+)$/);
      if (psMatch && psMatch[1]) {
        const cmd = psMatch[1].trim();
        if (this.isValidCommand(cmd)) {
          commands.push(cmd);
        }
      }
    }
    
    // Return last 50 unique commands
    const uniqueCommands = [...new Set(commands)];
    return uniqueCommands.slice(-50);
  }
  
  /**
   * Check if a command is valid and should be saved
   */
  private static isValidCommand(cmd: string): boolean {
    if (!cmd) return false;
    
    // Skip common noise commands
    const skipCommands = ['clear', 'exit', 'cls', 'history'];
    if (skipCommands.includes(cmd.toLowerCase())) return false;
    
    // Skip echo commands used for restoration
    if (cmd.startsWith('echo "') || cmd.startsWith('printf ')) return false;
    
    // Skip cd to home
    if (cmd === 'cd' || cmd === 'cd ~') return false;
    
    return true;
  }
}

export const SessionManager = SessionManagerImpl;
