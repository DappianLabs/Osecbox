/**
 * Tab Store Factory - Eliminates 300+ lines of duplicate tab management code
 * Used by FootholdView, TunnelingView, and other tab-based features
 */

import { create } from 'zustand';

export interface TabItem {
  id: string;
}

export interface TabState<T extends TabItem> {
  tabs: Array<{ id: string; items: T[]; selectedItem: string | null }>;
  activeTabId: string;
}

export interface TabActions<T extends TabItem> {
  addTab: () => void;
  closeTab: (tabId: string) => void;
  setActiveTabId: (tabId: string) => void;
  addItem: (item: T) => void;
  updateItem: (itemId: string, updates: Partial<T>) => void;
  removeItem: (itemId: string) => void;
  setSelectedItem: (itemId: string | null) => void;
  clearItems: () => void;
}

export type TabStore<T extends TabItem> = TabState<T> & TabActions<T>;

/**
 * Create a tab-based store with consistent behavior
 * Eliminates duplicate code in foothold-store, tunneling-store, etc.
 */
export function createTabStore<T extends TabItem>(
  storeName: string,
  generateTabId: () => string = () => `${storeName}-tab-${Date.now()}-${Math.random().toString(36).substring(7)}`
) {
  return create<TabStore<T>>((set, get) => ({
    tabs: [{
      id: `${storeName}-tab-1`,
      items: [],
      selectedItem: null,
    }],
    activeTabId: `${storeName}-tab-1`,
    
    addTab: () => {
      const newId = generateTabId();
      set((state) => ({
        tabs: [...state.tabs, {
          id: newId,
          items: [],
          selectedItem: null,
        }],
        activeTabId: newId,
      }));
    },
    
    closeTab: (tabId: string) => {
      set((state) => {
        const newTabs = state.tabs.filter(t => t.id !== tabId);
        if (newTabs.length === 0) {
          const newId = `${storeName}-tab-${Date.now()}`;
          return {
            tabs: [{
              id: newId,
              items: [],
              selectedItem: null,
            }],
            activeTabId: newId,
          };
        }
        
        let newActiveId = state.activeTabId;
        if (tabId === state.activeTabId) {
          const index = state.tabs.findIndex(t => t.id === tabId);
          const nextTab = state.tabs[index + 1] || state.tabs[index - 1];
          newActiveId = nextTab.id;
        }
        
        return {
          tabs: newTabs,
          activeTabId: newActiveId,
        };
      });
    },
    
    setActiveTabId: (tabId: string) => {
      set({ activeTabId: tabId });
    },
    
    addItem: (item: T) =>
      set((state) => ({
        tabs: state.tabs.map(t => 
          t.id === state.activeTabId
            ? { ...t, items: [...t.items, item] }
            : t
        ),
      })),
      
    updateItem: (itemId: string, updates: Partial<T>) =>
      set((state) => ({
        tabs: state.tabs.map(t =>
          t.id === state.activeTabId
            ? {
                ...t,
                items: t.items.map(item =>
                  item.id === itemId ? { ...item, ...updates } : item
                ),
              }
            : t
        ),
      })),
      
    removeItem: (itemId: string) =>
      set((state) => ({
        tabs: state.tabs.map(t =>
          t.id === state.activeTabId
            ? {
                ...t,
                items: t.items.filter(item => item.id !== itemId),
                selectedItem: t.selectedItem === itemId ? null : t.selectedItem,
              }
            : t
        ),
      })),
      
    setSelectedItem: (itemId: string | null) =>
      set((state) => ({
        tabs: state.tabs.map(t =>
          t.id === state.activeTabId
            ? { ...t, selectedItem: itemId }
            : t
        ),
      })),
      
    clearItems: () =>
      set((state) => ({
        tabs: state.tabs.map(t =>
          t.id === state.activeTabId
            ? { ...t, items: [], selectedItem: null }
            : t
        ),
      })),
  }));
}

