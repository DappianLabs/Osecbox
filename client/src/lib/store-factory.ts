/**
 * Store Factory - Eliminates boilerplate across 20+ Zustand stores
 * Creates type-safe persisted stores with consistent patterns
 */

import { create, StateCreator } from 'zustand';
import { persist, PersistOptions } from 'zustand/middleware';

export interface StoreConfig<T> {
  name: string;
  version?: number;
  migrate?: (persistedState: unknown, version: number) => T;
  partialize?: (state: T) => Partial<T>;
}

/**
 * Create a persisted Zustand store with consistent configuration
 * 
 * @example
 * ```ts
 * interface UserState {
 *   users: User[];
 *   addUser: (user: User) => void;
 * }
 * 
 * export const useUserStore = createPersistedStore<UserState>(
 *   { name: 'user-store', version: 1 },
 *   (set, get) => ({
 *     users: [],
 *     addUser: (user) => set((state) => ({ users: [...state.users, user] }))
 *   })
 * );
 * ```
 */
export function createPersistedStore<T extends object>(
  config: StoreConfig<T>,
  stateCreator: StateCreator<T, [], []>
) {
  const persistOptions: PersistOptions<T> = {
    name: config.name,
    version: config.version,
    migrate: config.migrate as any,
    partialize: config.partialize as any
  };

  return create<T>()(
    persist(stateCreator, persistOptions)
  );
}

/**
 * Create a non-persisted Zustand store (for ephemeral state)
 * 
 * @example
 * ```ts
 * interface UIState {
 *   isOpen: boolean;
 *   toggle: () => void;
 * }
 * 
 * export const useUIStore = createStore<UIState>((set) => ({
 *   isOpen: false,
 *   toggle: () => set((state) => ({ isOpen: !state.isOpen }))
 * }));
 * ```
 */
export function createStore<T extends object>(
  stateCreator: StateCreator<T, [], []>
) {
  return create<T>()(stateCreator);
}

/**
 * Create a simple key-value store with common operations
 * Useful for feature flags, settings, etc.
 */
export function createKeyValueStore<T extends Record<string, any>>(
  config: StoreConfig<{ data: T }>,
  initialData: T
) {
  return createPersistedStore<{
    data: T;
    get: <K extends keyof T>(key: K) => T[K];
    set: <K extends keyof T>(key: K, value: T[K]) => void;
    update: (updates: Partial<T>) => void;
    reset: () => void;
  }>({
    ...config,
    migrate: config.migrate as any
  } as any, (set, get) => ({
    data: initialData,
    get: (key) => get().data[key],
    set: (key, value) => set((state) => ({
      data: { ...state.data, [key]: value }
    })),
    update: (updates) => set((state) => ({
      data: { ...state.data, ...updates }
    })),
    reset: () => set({ data: initialData })
  }));
}

/**
 * Create a list store with common array operations
 * Useful for managing collections (sessions, scans, etc.)
 */
export function createListStore<T extends { id: string }>(
  config: StoreConfig<{ items: T[] }>,
  initialItems: T[] = []
) {
  return createPersistedStore<{
    items: T[];
    add: (item: T) => void;
    remove: (id: string) => void;
    update: (id: string, updates: Partial<T>) => void;
    clear: () => void;
    getById: (id: string) => T | undefined;
  }>({
    ...config,
    migrate: config.migrate as any
  } as any, (set, get) => ({
    items: initialItems,
    add: (item) => set((state) => ({
      items: [...state.items, item]
    })),
    remove: (id) => set((state) => ({
      items: state.items.filter(item => item.id !== id)
    })),
    update: (id, updates) => set((state) => ({
      items: state.items.map(item =>
        item.id === id ? { ...item, ...updates } : item
      )
    })),
    clear: () => set({ items: [] }),
    getById: (id) => get().items.find(item => item.id === id)
  }));
}

/**
 * Create a tab-based store (common pattern in this codebase)
 * Manages multiple tabs with their own state
 */
export function createTabStore<T extends object>(
  config: StoreConfig<{ tabs: Record<string, T> }>,
  defaultTabState: () => T
) {
  return createPersistedStore<{
    tabs: Record<string, T>;
    getTab: (tabId: string) => T;
    updateTab: (tabId: string, updates: Partial<T>) => void;
    clearTab: (tabId: string) => void;
    clearAll: () => void;
  }>({
    ...config,
    migrate: config.migrate as any
  } as any, (set, get) => ({
    tabs: {},
    getTab: (tabId) => {
      const state = get();
      if (!state.tabs[tabId]) {
        set((state) => ({
          tabs: { ...state.tabs, [tabId]: defaultTabState() }
        }));
        return defaultTabState();
      }
      return state.tabs[tabId];
    },
    updateTab: (tabId, updates) => set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: { ...(state.tabs[tabId] || defaultTabState()), ...updates }
      }
    })),
    clearTab: (tabId) => set((state) => {
      const { [tabId]: _, ...rest } = state.tabs;
      return { tabs: rest };
    }),
    clearAll: () => set({ tabs: {} })
  }));
}
