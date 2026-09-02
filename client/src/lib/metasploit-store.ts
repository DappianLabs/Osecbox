import { create } from 'zustand';

// ==================== TYPE DEFINITIONS ====================

export interface MetasploitModule {
  name: string;
  fullPath: string;
  type: 'exploit' | 'auxiliary' | 'post' | 'payload' | 'encoder' | 'nop';
  platform?: string;
  targets?: string[];
  description?: string;
  references?: string[];
  rank?: string;
  disclosure_date?: string;
  disclosureDate?: string;
  check?: boolean;
}

export interface MetasploitSession {
  id: number;
  type: 'meterpreter' | 'shell' | 'unknown';
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  status: 'active' | 'closed' | 'dead';
  platform?: string;
  arch?: string;
  user?: string;
  computer?: string;
  os?: string;
  timestamp: number;
  lastActivity?: number;
  activityCount?: number;
  lastCommand?: string;
  exploitUsed?: string;
  privilegeLevel?: 'user' | 'admin' | 'system' | 'unknown';
  compromiseTime?: number;
}

export interface MetasploitHandler {
  id: number;
  payload: string;
  /** Raw job description returned by `jobs -l`. */
  jobName?: string;
  port: number;
  status: 'listening' | 'stopped' | 'error';
  options: Record<string, string>;
  createdAt: number;
  sessionsCount: number;
}

export interface CampaignDispatch {
  id: string;
  target: string;
  modulePath: string;
  commands: string[];
  status: 'sent' | 'failed';
  dispatchedAt: number;
  error?: string;
}


export interface ExploitationResult {
  targetIp: string;
  exploit: string;
  payload: string;
  timestamp: number;
  success: boolean;
  sessionId?: number;
  error?: string;
  duration: number;
  evidence: string[];
}

export interface ExploitationCampaign {
  id: string;
  name: string;
  targets: string[];
  exploits: any[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  schedule: 'immediate' | 'staggered' | 'sequential';
  parallelism: number;
  retryFailures: boolean;
  retryCount: number;
  retryDelay: number;
  stopOnSuccess: boolean;
  startedAt?: number;
  completedAt?: number;
  results: ExploitationResult[];
  notes?: string;
  createdAt?: number;
  /** Index of the next module/target pair to prepare in the console. */
  nextStepIndex?: number;
  dispatchHistory?: CampaignDispatch[];
  lastDispatchedAt?: number;
  lastError?: string;
}

export interface RecentTarget {
  ip: string;
  lastUsed: number;
  successCount: number;
  failCount: number;
  os?: string;
  vulnerabilities?: string[];
  compromised?: boolean;
}

export interface ExploitContext {
  modulePath: string;
  config: Record<string, string>;
  targetList: string[];
  currentTargetIndex: number;
}


// ==================== STORE INTERFACE ====================

interface MetasploitStore {
  modules: MetasploitModule[];
  campaigns: ExploitationCampaign[];
  activeCampaignId: string | null;
  sessions: MetasploitSession[];
  handlers: MetasploitHandler[];
  recentTargets: RecentTarget[];
  exploitContext: ExploitContext;
  evidenceFiles: any[];
  credentials: any[];
  
  setModules: (modules: MetasploitModule[]) => void;
  clearModules: () => void;
  addModule: (module: MetasploitModule) => void;
  createCampaign: (campaign: Omit<ExploitationCampaign, 'id' | 'results'>) => string;
  updateCampaign: (id: string, updates: Partial<ExploitationCampaign>) => void;
  deleteCampaign: (id: string) => void;
  setActiveCampaign: (id: string | null) => void;
  addCampaignResult: (campaignId: string, result: ExploitationResult) => void;
  addCampaignDispatch: (campaignId: string, dispatch: CampaignDispatch) => void;
  exportCampaignResults: (campaignId: string) => ExploitationResult[];
  generateReport: (campaignId: string) => any;
  setSessions: (sessions: MetasploitSession[]) => void;
  addSession: (session: MetasploitSession) => void;
  removeSession: (sessionId: number) => void;
  updateSession: (sessionId: number, updates: Partial<MetasploitSession>) => void;
  updateSessionPrivileges: (sessionId: number, level: string) => void;
  addSessionActivity: (sessionId: number, activity?: { command?: string }) => void;
  setHandlers: (handlers: MetasploitHandler[]) => void;
  addHandler: (handler: MetasploitHandler) => void;
  removeHandler: (handlerId: number) => void;
  updateHandler: (handlerId: number, updates: Partial<MetasploitHandler>) => void;
  addRecentTarget: (target: RecentTarget) => void;
  getCompromisedTargets: () => RecentTarget[];
  setExploitContext: (context: Partial<ExploitContext>) => void;
  nextTarget: () => string | null;
  previousTarget: () => string | null;
  addEvidence: (evidence: any) => void;
  addCredential: (credential: any) => void;
  reset: () => void;
}

const initialState = {
  modules: [],
  campaigns: [],
  activeCampaignId: null,
  sessions: [],
  handlers: [],
  recentTargets: [],
  exploitContext: {
    modulePath: '',
    config: {},
    targetList: [],
    currentTargetIndex: 0,
  },
  evidenceFiles: [],
  credentials: [],
};


// ==================== STORE IMPLEMENTATION ====================

export const useMetasploitStore = create<MetasploitStore>((set, get) => ({
  ...initialState,
  
  setModules: (modules) => {
    if (!Array.isArray(modules)) return;
    set({ modules });
  },
  
  // Module search results are a cache. Clearing them must not silently delete
  // live session records or saved campaign plans.
  clearModules: () => set({ modules: [] }),
  
  addModule: (module) => {
    if (!module || !module.fullPath) return;
    set((state) => {
      const exists = state.modules.some(m => m.fullPath === module.fullPath);
      if (exists) return state;
      return { modules: [...state.modules, module] };
    });
  },
  
  createCampaign: (campaign) => {
    const id = `campaign-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newCampaign: ExploitationCampaign = {
      ...campaign,
      id,
      results: [],
      createdAt: campaign.createdAt || Date.now(),
      nextStepIndex: Number.isInteger(campaign.nextStepIndex) ? campaign.nextStepIndex : 0,
      dispatchHistory: Array.isArray(campaign.dispatchHistory) ? campaign.dispatchHistory : [],
    };
    set((state) => ({ campaigns: [...state.campaigns, newCampaign] }));
    return id;
  },
  
  updateCampaign: (id, updates) => {
    if (!id) return;
    set((state) => ({
      campaigns: state.campaigns.map((c) => c.id === id ? { ...c, ...updates } : c),
    }));
  },
  
  deleteCampaign: (id) => set((state) => ({
    campaigns: state.campaigns.filter((c) => c.id !== id),
    activeCampaignId: state.activeCampaignId === id ? null : state.activeCampaignId,
  })),
  
  setActiveCampaign: (id) => set({ activeCampaignId: id }),
  
  addCampaignResult: (campaignId, result) => {
    if (!campaignId || !result) return;
    set((state) => ({
      campaigns: state.campaigns.map((c) => 
        c.id === campaignId ? { ...c, results: [...c.results, result] } : c
      ),
    }));
  },

  addCampaignDispatch: (campaignId, dispatch) => {
    if (!campaignId || !dispatch || !dispatch.id) return;
    set((state) => ({
      campaigns: state.campaigns.map((campaign) => {
        if (campaign.id !== campaignId) return campaign;
        const history = Array.isArray(campaign.dispatchHistory)
          ? [...campaign.dispatchHistory, dispatch].slice(-500)
          : [dispatch];
        return {
          ...campaign,
          dispatchHistory: history,
          nextStepIndex: (campaign.nextStepIndex || 0) + (dispatch.status === 'sent' ? 1 : 0),
          lastDispatchedAt: dispatch.dispatchedAt,
          lastError: dispatch.status === 'failed' ? dispatch.error : undefined,
        };
      }),
    }));
  },
  
  exportCampaignResults: (campaignId) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId);
    return campaign?.results || [];
  },
  
  generateReport: (campaignId) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId);
    if (!campaign) return null;
    return {
      campaignName: campaign.name,
      totalTargets: campaign.targets.length,
      successfulExploits: campaign.results.filter((r) => r.success).length,
      failedExploits: campaign.results.filter((r) => !r.success).length,
      results: campaign.results,
    };
  },


  setSessions: (sessions) => {
    if (!Array.isArray(sessions)) return;
    set({ sessions });
  },
  
  addSession: (session) => {
    if (!session || typeof session.id !== 'number') return;
    set((state) => {
      const exists = state.sessions.some(s => s.id === session.id);
      if (exists) {
        return { sessions: state.sessions.map(s => s.id === session.id ? { ...s, ...session } : s) };
      }
      return { sessions: [...state.sessions, session] };
    });
  },
  
  removeSession: (sessionId) => {
    if (typeof sessionId !== 'number') return;
    set((state) => ({ sessions: state.sessions.filter((s) => s.id !== sessionId) }));
  },
  
  updateSession: (sessionId, updates) => {
    if (typeof sessionId !== 'number') return;
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === sessionId ? { ...s, ...updates } : s),
    }));
  },
  
  updateSessionPrivileges: (sessionId, level) => {
    if (typeof sessionId !== 'number') return;
    set((state) => ({
      sessions: state.sessions.map((s) => 
        s.id === sessionId ? { ...s, privilegeLevel: level as any } : s
      ),
    }));
  },
  
  addSessionActivity: (sessionId, activity) => {
    if (typeof sessionId !== 'number') return;
    set((state) => ({
      sessions: state.sessions.map((s) => 
        s.id === sessionId ? {
          ...s,
          lastActivity: Date.now(),
          activityCount: (s.activityCount || 0) + 1,
          ...(activity?.command ? { lastCommand: activity.command } : {}),
        } : s
      ),
    }));
  },
  
  setHandlers: (handlers) => {
    if (!Array.isArray(handlers)) return;
    set({ handlers });
  },
  
  addHandler: (handler) => {
    if (!handler || typeof handler.id !== 'number') return;
    set((state) => {
      const exists = state.handlers.some(h => h.id === handler.id);
      if (exists) {
        return { handlers: state.handlers.map(h => h.id === handler.id ? { ...h, ...handler } : h) };
      }
      return { handlers: [...state.handlers, handler] };
    });
  },
  
  removeHandler: (handlerId) => {
    if (typeof handlerId !== 'number') return;
    set((state) => ({ handlers: state.handlers.filter((h) => h.id !== handlerId) }));
  },
  
  updateHandler: (handlerId, updates) => {
    if (typeof handlerId !== 'number') return;
    set((state) => ({
      handlers: state.handlers.map((h) => h.id === handlerId ? { ...h, ...updates } : h),
    }));
  },


  addRecentTarget: (target) => {
    if (!target || !target.ip) return;
    set((state) => {
      const existing = state.recentTargets.find((t) => t.ip === target.ip);
      if (existing) {
        return {
          recentTargets: state.recentTargets.map((t) => 
            t.ip === target.ip ? { ...t, ...target, lastUsed: Date.now() } : t
          ),
        };
      }
      return { recentTargets: [...state.recentTargets, { ...target, lastUsed: Date.now() }] };
    });
  },
  
  getCompromisedTargets: () => get().recentTargets.filter((t) => t.compromised),
  
  setExploitContext: (context) => {
    if (!context || typeof context !== 'object') return;
    set((state) => ({ exploitContext: { ...state.exploitContext, ...context } }));
  },
  
  nextTarget: () => {
    const { exploitContext } = get();
    const nextIndex = exploitContext.currentTargetIndex + 1;
    if (nextIndex < exploitContext.targetList.length) {
      set((state) => ({
        exploitContext: { ...state.exploitContext, currentTargetIndex: nextIndex },
      }));
      return exploitContext.targetList[nextIndex];
    }
    return null;
  },
  
  previousTarget: () => {
    const { exploitContext } = get();
    const prevIndex = exploitContext.currentTargetIndex - 1;
    if (prevIndex >= 0) {
      set((state) => ({
        exploitContext: { ...state.exploitContext, currentTargetIndex: prevIndex },
      }));
      return exploitContext.targetList[prevIndex];
    }
    return null;
  },
  
  addEvidence: (evidence) => {
    if (!evidence) return;
    set((state) => ({ evidenceFiles: [...state.evidenceFiles, evidence] }));
  },
  
  addCredential: (credential) => {
    if (!credential) return;
    set((state) => ({ credentials: [...state.credentials, credential] }));
  },
  
  reset: () => set(initialState),
}));
