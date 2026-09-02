/**
 * Timeline Store - WITH PROPER LIMITS
 * Full functionality when free, 3/day access when monetization enabled
 */

import { create } from 'zustand';
import { ProFeatures } from './pro-features';

interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'scan' | 'exploit' | 'discovery' | 'session';
  title: string;
  description: string;
  metadata?: any;
}

interface TimelineState {
  events: TimelineEvent[];
  isLoading: boolean;
  error: string | null;
  canAccess: boolean;
  limitMessage: string | null;
}

interface TimelineActions {
  addEvent: (event: Omit<TimelineEvent, 'id'>) => void;
  removeEvent: (id: string) => void;
  clearEvents: () => void;
  checkAccess: () => Promise<void>;
  recordAccess: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useTimelineStore = create<TimelineState & TimelineActions>((set, get) => ({
  // State
  events: [],
  isLoading: false,
  error: null,
  canAccess: true,
  limitMessage: null,

  // Actions
  addEvent: (event) => {
    const newEvent: TimelineEvent = {
      ...event,
      id: Date.now().toString(),
    };
    
    set((state) => ({
      events: [newEvent, ...state.events].sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
    }));
  },

  removeEvent: (id) => {
    set((state) => ({
      events: state.events.filter(event => event.id !== id)
    }));
  },

  clearEvents: () => {
    set({ events: [] });
  },

  checkAccess: async () => {
    try {
      const result = await ProFeatures.canAccessTimeline();
      set({
        canAccess: result.allowed,
        limitMessage: result.message || null,
        error: null
      });
    } catch (error) {
      set({
        canAccess: false,
        error: error instanceof Error ? error.message : 'Failed to check timeline access',
        limitMessage: null
      });
    }
  },

  recordAccess: () => {
    ProFeatures.recordTimelineAccess();
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setError: (error) => {
    set({ error });
  },
}));

// Helper functions
export const timelineHelpers = {
  /**
   * Add scan event to timeline
   */
  addScanEvent: (target: string, scanType: string, results: any) => {
    const { addEvent } = useTimelineStore.getState();
    addEvent({
      timestamp: new Date().toISOString(),
      type: 'scan',
      title: `${scanType} scan completed`,
      description: `Scanned ${target}`,
      metadata: { target, scanType, results }
    });
  },

  /**
   * Add exploit event to timeline
   */
  addExploitEvent: (target: string, exploit: string, success: boolean) => {
    const { addEvent } = useTimelineStore.getState();
    addEvent({
      timestamp: new Date().toISOString(),
      type: 'exploit',
      title: `Exploit ${success ? 'successful' : 'failed'}`,
      description: `${exploit} against ${target}`,
      metadata: { target, exploit, success }
    });
  },

  /**
   * Add discovery event to timeline
   */
  addDiscoveryEvent: (discovery: string, details: string) => {
    const { addEvent } = useTimelineStore.getState();
    addEvent({
      timestamp: new Date().toISOString(),
      type: 'discovery',
      title: 'New discovery',
      description: discovery,
      metadata: { details }
    });
  },

  /**
   * Add session event to timeline
   */
  addSessionEvent: (action: string, sessionName: string) => {
    const { addEvent } = useTimelineStore.getState();
    addEvent({
      timestamp: new Date().toISOString(),
      type: 'session',
      title: `Session ${action}`,
      description: sessionName,
      metadata: { action, sessionName }
    });
  }
};