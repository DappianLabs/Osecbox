import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cleanupTerminalSession, cleanupTerminalSessions } from '@/lib/session-cleanup';

// FIX: Add version for future migrations

export type TunnelingTool = 'chisel' | 'ligolo-ng' | 'ssh' | 'sshuttle' | 'ngrok' | 'socat';
export type TunnelingMode = 'server' | 'client';

export interface TunnelingSession {
  id: string;
  tool: TunnelingTool;
  mode: TunnelingMode;
  port: string;
  remoteHost?: string;
  localPort?: string;
  remotePort?: string;
  command: string;
  status: 'idle' | 'running' | 'stopped';
  name?: string;
}

interface TunnelingTab {
  id: string;
  sessions: TunnelingSession[];
  selectedSession: string | null;
}

interface TunnelingStore {
  tabs: TunnelingTab[];
  activeTabId: string;
  _version: number; // Version for cache invalidation
  addTab: () => void;
  closeTab: (tabId: string) => void;
  setActiveTabId: (tabId: string) => void;
  addSession: (session: TunnelingSession) => void;
  updateSession: (sessionId: string, updates: Partial<TunnelingSession>) => void;
  removeSession: (sessionId: string) => void;
  setSelectedSession: (sessionId: string | null) => void;
  clearSessions: () => void;
}

const STORE_VERSION = 2;

const DEFAULT_TAB: TunnelingTab = {
  id: 'tunneling-tab-1',
  sessions: [],
  selectedSession: null,
};

/** Running/idle is live PTY state and must not survive an app restart. */
function normalizePersistedState(persistedState: any): {
  tabs: TunnelingTab[];
  activeTabId: string;
  _version: number;
} {
  const rawTabs = Array.isArray(persistedState?.tabs) ? persistedState.tabs : [];
  const tabs = rawTabs.map((tab: any, index: number): TunnelingTab => {
    const id = typeof tab?.id === 'string' && tab.id.trim()
      ? tab.id
      : `tunneling-tab-${index + 1}`;
    const sessions: TunnelingSession[] = Array.isArray(tab?.sessions)
      ? tab.sessions
        .filter((session: any) => session && typeof session.id === 'string' && session.id.trim())
        .map((session: TunnelingSession) => ({ ...session, status: 'idle' as const }))
      : [];
    const selectedSession = sessions.some((session: TunnelingSession) => session.id === tab?.selectedSession)
      ? tab.selectedSession
      : sessions[0]?.id || null;

    return { ...tab, id, sessions, selectedSession };
  });
  const normalizedTabs: TunnelingTab[] = tabs.length > 0 ? tabs : [{ ...DEFAULT_TAB }];
  const activeTabId = normalizedTabs.some((tab: TunnelingTab) => tab.id === persistedState?.activeTabId)
    ? persistedState.activeTabId
    : normalizedTabs[0].id;

  return { tabs: normalizedTabs, activeTabId, _version: STORE_VERSION };
}

// With persistence middleware
export const useTunnelingStore = create<TunnelingStore>()(
  persist(
    (set) => ({
  tabs: [{
    id: 'tunneling-tab-1',
    sessions: [],
    selectedSession: null,
  }],
  activeTabId: 'tunneling-tab-1',
  _version: STORE_VERSION,
  
  addTab: () => set((state) => {
    const newId = `tunneling-tab-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    return {
      tabs: [...state.tabs, { id: newId, sessions: [], selectedSession: null }],
      activeTabId: newId,
    };
  }),
  
  closeTab: (tabId: string) => set((state) => {
    const tabToClose = state.tabs.find(t => t.id === tabId);
    if (tabToClose) {
      cleanupTerminalSessions(tabToClose.sessions.map(session => session.id));
    }

    const newTabs = state.tabs.filter(t => t.id !== tabId);
    if (newTabs.length === 0) {
      const newId = `tunneling-tab-${Date.now()}`;
      return {
        tabs: [{ id: newId, sessions: [], selectedSession: null }],
        activeTabId: newId,
      };
    }
    
    let newActiveId = state.activeTabId;
    if (tabId === state.activeTabId) {
      const index = state.tabs.findIndex(t => t.id === tabId);
      const nextTab = state.tabs[index + 1] || state.tabs[index - 1];
      newActiveId = nextTab.id;
    }
    
    return { tabs: newTabs, activeTabId: newActiveId };
  }),
  
  setActiveTabId: (tabId: string) => set({ activeTabId: tabId }),
  
  addSession: (session: TunnelingSession) => set((state) => ({
    tabs: state.tabs.map(t =>
      t.id === state.activeTabId
        ? { ...t, sessions: [...t.sessions, session], selectedSession: session.id }
        : t
    ),
  })),
  
  updateSession: (sessionId: string, updates: Partial<TunnelingSession>) => set((state) => ({
    tabs: state.tabs.map(t => ({
      ...t,
      sessions: t.sessions.map(s =>
        s.id === sessionId ? { ...s, ...updates } : s
      ),
    })),
  })),
  
  removeSession: (sessionId: string) => {
    // Removing an item is a terminal lifecycle event too. Previously only
    // closing an entire tab stopped the underlying tunnel/PTY.
    cleanupTerminalSession(sessionId);
    set((state) => ({
      tabs: state.tabs.map(t => ({
        ...t,
        sessions: t.sessions.filter(s => s.id !== sessionId),
        selectedSession: t.selectedSession === sessionId
          ? t.sessions.find(s => s.id !== sessionId)?.id || null
          : t.selectedSession,
      })),
    }));
  },
  
  setSelectedSession: (sessionId: string | null) => set((state) => {
    if (sessionId === null) {
      return {
        tabs: state.tabs.map(t => ({ ...t, selectedSession: null })),
      };
    }

    const ownerTab = state.tabs.find(t => t.sessions.some(session => session.id === sessionId));
    if (!ownerTab) return state;

    return {
      activeTabId: ownerTab.id,
      tabs: state.tabs.map(t => ({
        ...t,
        selectedSession: t.id === ownerTab.id ? sessionId : null,
      })),
    };
  }),
  
  clearSessions: () => set((state) => {
    cleanupTerminalSessions(state.tabs.flatMap(t => t.sessions.map(session => session.id)));
    return {
      tabs: state.tabs.map(t => ({ ...t, sessions: [], selectedSession: null })),
    };
  }),
    }),
    {
      name: 'tunneling-store',
      version: STORE_VERSION,
      partialize: (state) => ({
        tabs: state.tabs.map(tab => ({
          ...tab,
          sessions: tab.sessions.map(session => ({
            ...session,
            // The terminal is recreated explicitly when the user presses
            // Start; never hydrate a stale running state.
            status: 'idle' as const,
          })),
        })),
        activeTabId: state.activeTabId,
        _version: STORE_VERSION,
      }),
      migrate: (persistedState: any, version: number) => {
        if (version !== STORE_VERSION) {
          console.log('[TunnelingStore] Migrating persisted tunnel state', { from: version, to: STORE_VERSION });
        }
        return normalizePersistedState(persistedState);
      },
    }
  )
);
