/**
 * Unified Panel Layout Store
 * 
 * Single source of truth for all panel layouts across all sections.
 * Replaces react-resizable-panels' automatic localStorage with explicit state management.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PanelLayout {
  [panelId: string]: number; // size percentage
}

interface CollapsedState {
  [panelId: string]: boolean; // collapsed state
}

interface LayoutState {
  layouts: {
    [layoutId: string]: PanelLayout;
  };
  collapsed: {
    [layoutId: string]: CollapsedState;
  };
  saveLayout: (layoutId: string, panelId: string, size: number) => void;
  getLayout: (layoutId: string) => PanelLayout;
  getPanelSize: (layoutId: string, panelId: string, defaultSize: number) => number;
  setCollapsed: (layoutId: string, panelId: string, collapsed: boolean) => void;
  isCollapsed: (layoutId: string, panelId: string) => boolean;
}

export const usePanelLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      layouts: {},
      collapsed: {},
      
      saveLayout: (layoutId, panelId, size) => {
        set(state => ({
          layouts: {
            ...state.layouts,
            [layoutId]: {
              ...state.layouts[layoutId],
              [panelId]: size
            }
          }
        }));
      },
      
      getLayout: (layoutId) => get().layouts[layoutId] || {},
      
      getPanelSize: (layoutId, panelId, defaultSize) => {
        const layout = get().layouts[layoutId];
        return layout?.[panelId] ?? defaultSize;
      },
      
      setCollapsed: (layoutId, panelId, collapsed) => {
        set(state => ({
          collapsed: {
            ...state.collapsed,
            [layoutId]: {
              ...state.collapsed[layoutId],
              [panelId]: collapsed
            }
          }
        }));
      },
      
      isCollapsed: (layoutId, panelId) => {
        const collapsedState = get().collapsed[layoutId];
        return collapsedState?.[panelId] ?? false;
      }
    }),
    { 
      name: 'panel-layouts',
      version: 1, // MIGRATION: Version for future schema changes
      migrate: (persistedState: any, version: number) => {
        // MIGRATION: Clear old layouts on version mismatch
        if (version === 0 || !persistedState) {
          console.log('[panel-layout-store] Migrating from v0 to v1 - clearing old layouts');
          return { layouts: {}, collapsed: {} };
        }
        // MIGRATION: Add collapsed state if missing
        if (!persistedState.collapsed) {
          console.log('[panel-layout-store] Adding collapsed state');
          return { ...persistedState, collapsed: {} };
        }
        return persistedState;
      },
      // Use explicit storage to avoid conflicts
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          return str ? JSON.parse(str) : null;
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => localStorage.removeItem(name),
      }
    }
  )
);