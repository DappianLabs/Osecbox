import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { cleanupTerminalSession, cleanupTerminalSessions } from '@/lib/session-cleanup';

export type ListenerType = 'netcat' | 'pwncat' | 'socat' | 'meterpreter' | 'http-server' | 'sliver' | 'custom';

export interface Listener {
  id: string;
  type: ListenerType;
  port: number;
  status: 'running' | 'stopped';
  command: string;
  name?: string;
}

interface FootholdTab {
  id: string;
  listeners: Listener[];
  selectedListener: string | null;
}

interface FootholdStore {
  tabs: FootholdTab[];
  activeTabId: string;
  _version: number; // Version for cache invalidation
  addTab: () => void;
  closeTab: (tabId: string) => void;
  setActiveTabId: (tabId: string) => void;
  addListener: (listener: Listener) => void;
  updateListener: (listenerId: string, updates: Partial<Listener>) => void;
  removeListener: (listenerId: string) => void;
  setSelectedListener: (listenerId: string | null) => void;
  clearListeners: () => void;
}

const STORE_VERSION = 2;

const DEFAULT_TAB: FootholdTab = {
  id: 'foothold-tab-1',
  listeners: [],
  selectedListener: null,
};

/**
 * Running is a live PTY state, not durable project data. Persisting it makes
 * a fresh app instance render a Stop button for a process that no longer
 * exists. Normalize old snapshots while preserving the user's tabs and
 * listener definitions.
 */
function normalizePersistedState(persistedState: any): {
  tabs: FootholdTab[];
  activeTabId: string;
  _version: number;
} {
  const rawTabs = Array.isArray(persistedState?.tabs) ? persistedState.tabs : [];
  const tabs = rawTabs.map((tab: any, index: number): FootholdTab => {
    const id = typeof tab?.id === 'string' && tab.id.trim()
      ? tab.id
      : `foothold-tab-${index + 1}`;
    const listeners: Listener[] = Array.isArray(tab?.listeners)
      ? tab.listeners
        .filter((listener: any) => listener && typeof listener.id === 'string' && listener.id.trim())
        .map((listener: Listener) => ({ ...listener, status: 'stopped' as const }))
      : [];
    const selectedListener = listeners.some((listener: Listener) => listener.id === tab?.selectedListener)
      ? tab.selectedListener
      : listeners[0]?.id || null;

    return { ...tab, id, listeners, selectedListener };
  });
  const normalizedTabs: FootholdTab[] = tabs.length > 0 ? tabs : [{ ...DEFAULT_TAB }];
  const activeTabId = normalizedTabs.some((tab: FootholdTab) => tab.id === persistedState?.activeTabId)
    ? persistedState.activeTabId
    : normalizedTabs[0].id;

  return { tabs: normalizedTabs, activeTabId, _version: STORE_VERSION };
}

// With persistence middleware
export const useFootholdStore = create<FootholdStore>()(
  persist(
    (set) => ({
  tabs: [{
    id: 'foothold-tab-1',
    listeners: [],
    selectedListener: null,
  }],
  activeTabId: 'foothold-tab-1',
  _version: STORE_VERSION,
  
  addTab: () => set((state) => {
    const newId = `foothold-tab-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    return {
      tabs: [...state.tabs, { id: newId, listeners: [], selectedListener: null }],
      activeTabId: newId,
    };
  }),
  
  closeTab: (tabId: string) => set((state) => {
    const tabToClose = state.tabs.find(t => t.id === tabId);
    if (tabToClose) {
      cleanupTerminalSessions(tabToClose.listeners.map(listener => listener.id));
    }

    const newTabs = state.tabs.filter(t => t.id !== tabId);
    if (newTabs.length === 0) {
      const newId = `foothold-tab-${Date.now()}`;
      return {
        tabs: [{ id: newId, listeners: [], selectedListener: null }],
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
  
  addListener: (listener: Listener) => set((state) => ({
    tabs: state.tabs.map(t => 
      t.id === state.activeTabId
        ? {
            ...t,
            listeners: [...t.listeners, listener],
            selectedListener: listener.id,
          }
        : t
    ),
  })),
  
  updateListener: (listenerId: string, updates: Partial<Listener>) => set((state) => ({
    tabs: state.tabs.map(t => ({
      ...t,
      listeners: t.listeners.map(l =>
        l.id === listenerId ? { ...l, ...updates } : l
      ),
    })),
  })),
  
  removeListener: (listenerId: string) => {
    // Removing an item is a terminal lifecycle event too. Previously only
    // closing an entire tab stopped the underlying listener/PTY.
    cleanupTerminalSession(listenerId);
    set((state) => ({
      tabs: state.tabs.map(t => ({
        ...t,
        listeners: t.listeners.filter(l => l.id !== listenerId),
        selectedListener: t.selectedListener === listenerId
          ? t.listeners.find(l => l.id !== listenerId)?.id || null
          : t.selectedListener,
      })),
    }));
  },
  
  setSelectedListener: (listenerId: string | null) => set((state) => {
    if (listenerId === null) {
      return {
        tabs: state.tabs.map(t => ({ ...t, selectedListener: null })),
      };
    }

    const ownerTab = state.tabs.find(t => t.listeners.some(listener => listener.id === listenerId));
    if (!ownerTab) return state;

    return {
      activeTabId: ownerTab.id,
      tabs: state.tabs.map(t => ({
        ...t,
        selectedListener: t.id === ownerTab.id ? listenerId : null,
      })),
    };
  }),
  
  clearListeners: () => set((state) => {
    cleanupTerminalSessions(state.tabs.flatMap(t => t.listeners.map(listener => listener.id)));
    return {
      tabs: state.tabs.map(t => ({ ...t, listeners: [], selectedListener: null })),
    };
  }),
    }),
    {
      name: 'foothold-store',
      version: STORE_VERSION,
      partialize: (state) => ({
        tabs: state.tabs.map(tab => ({
          ...tab,
          listeners: tab.listeners.map(listener => ({
            ...listener,
            // A PTY is recreated explicitly when the user presses Start.
            status: 'stopped' as const,
          })),
        })),
        activeTabId: state.activeTabId,
        _version: STORE_VERSION,
      }),
      migrate: (persistedState: any, version: number) => {
        if (version !== STORE_VERSION) {
          console.log('[FootholdStore] Migrating persisted listener state', { from: version, to: STORE_VERSION });
        }
        return normalizePersistedState(persistedState);
      },
    }
  )
);
