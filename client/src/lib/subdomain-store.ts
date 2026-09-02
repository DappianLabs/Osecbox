import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Subdomain {
  subdomain: string;
  ip: string;
  status: 'active' | 'inactive' | 'unknown';
  ports?: string;
}

export interface ToolSession {
  toolId: string;
  toolName: string;
  domain: string;
  timestamp: number;
  subdomains: Subdomain[];
  isActive: boolean;
}

interface SubdomainStore {
  domain: string;
  sessions: ToolSession[];
  activeSession: string | null;
  subdomains: Subdomain[];
  selectedSubdomain: string | null;
  _version: number; // Version for cache invalidation
  setDomain: (domain: string) => void;
  addSession: (session: ToolSession) => void;
  updateSession: (toolId: string, updates: Partial<ToolSession>) => void;
  setActiveSession: (toolId: string | null) => void;
  setSubdomains: (subdomains: Subdomain[]) => void;
  setSelectedSubdomain: (subdomain: string | null) => void;
  clearSessions: () => void;
  resetAll: () => void;
}

const STORE_VERSION = 2; // Increment this to invalidate old cache

export const useSubdomainStore = create<SubdomainStore>()(
  persist(
    (set) => ({
      domain: '',
      sessions: [],
      activeSession: null,
      subdomains: [],
      selectedSubdomain: null,
      _version: STORE_VERSION,
      setDomain: (domain) => set({ domain }),
      addSession: (session) =>
        set((state) => ({ sessions: [...state.sessions, session] })),
      updateSession: (toolId, updates) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.toolId === toolId ? { ...s, ...updates } : s
          ),
        })),
      setActiveSession: (toolId) => set({ activeSession: toolId }),
      setSubdomains: (subdomains) => set({ subdomains }),
      setSelectedSubdomain: (subdomain) => set({ selectedSubdomain: subdomain }),
      clearSessions: () => set({ sessions: [], activeSession: null, subdomains: [], selectedSubdomain: null }),
      resetAll: () => set({ domain: '', sessions: [], activeSession: null, subdomains: [], selectedSubdomain: null, _version: STORE_VERSION }),
    }),
    {
      name: 'subdomain-store',
      version: STORE_VERSION,
      migrate: (persistedState: any, version: number) => {
        // In development mode, always start fresh
        if (import.meta.env.DEV) {
          console.log('[SubdomainStore] Development mode - starting fresh');
          return {
            domain: '',
            sessions: [],
            activeSession: null,
            subdomains: [],
            selectedSubdomain: null,
            _version: STORE_VERSION,
          };
        }

        // If version mismatch, clear everything
        if (version !== STORE_VERSION) {
          console.log('[SubdomainStore] Version mismatch, clearing cache');
          return {
            domain: '',
            sessions: [],
            activeSession: null,
            subdomains: [],
            selectedSubdomain: null,
            _version: STORE_VERSION,
          };
        }
        return persistedState;
      },
    }
  )
);
