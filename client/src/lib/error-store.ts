/**
 * Global Error Store
 * Tracks errors across all views (Subdomain, Foothold, Tunneling, Metasploit, etc.)
 */

import { create } from 'zustand';
import { ERROR_CONSTANTS } from './constants';

export interface ViewError {
  id: string;
  timestamp: number;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  details?: string;
  tool?: string;
  target?: string;
  command?: string;
  view: string; // Which view the error belongs to (subdomain, foothold, tunneling, etc.)
}

interface ErrorState {
  errors: Record<string, ViewError[]>; // Object of view -> errors
  
  addError: (view: string, error: Omit<ViewError, 'id' | 'timestamp' | 'view'>) => void;
  clearErrors: (view: string) => void;
  getErrors: (view: string) => ViewError[];
  clearAll: () => void;
  loadPersistedErrors: () => void;
  persistErrors: () => void;
}

// FIX: Create a stable empty array to prevent infinite re-renders
const EMPTY_ERRORS: ViewError[] = [];
const STORAGE_KEY = 'osecbox-errors';

// Load persisted errors from localStorage
function loadErrorsFromStorage(): Record<string, ViewError[]> {
  try {
    // In development mode, always start fresh
    if (import.meta.env.DEV) {
      console.log('[ErrorStore] Development mode - starting with fresh errors');
      return {};
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Filter out errors older than 24 hours
      const cutoff = Date.now() - ERROR_CONSTANTS.MAX_ERROR_AGE;
      const filtered: Record<string, ViewError[]> = {};
      
      for (const [view, errors] of Object.entries(parsed)) {
        filtered[view] = (errors as ViewError[]).filter(error => error.timestamp > cutoff);
      }
      
      return filtered;
    }
  } catch (error) {
    console.error('[ErrorStore] Failed to load persisted errors:', error);
  }
  return {};
}

// Save errors to localStorage
function saveErrorsToStorage(errors: Record<string, ViewError[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(errors));
  } catch (error) {
    console.error('[ErrorStore] Failed to persist errors:', error);
  }
}

export const useErrorStore = create<ErrorState>((set, get) => ({
  errors: loadErrorsFromStorage(),

  addError: (view, error) => {
    const newError: ViewError = {
      ...error,
      id: `error-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      view,
    };

    set((state) => {
      const newErrors = {
        ...state.errors,
        [view]: [...(state.errors[view] || EMPTY_ERRORS), newError],
      };
      
      // Persist errors to localStorage
      saveErrorsToStorage(newErrors);
      
      return { errors: newErrors };
    });

    // Also show as notification (async, non-blocking)
    import('./notification-store').then(({ useNotificationStore }) => {
      try {
        const { addNotification } = useNotificationStore.getState();
        addNotification({
          title: error.title,
          message: error.message,
          type: error.type,
          duration: error.type === 'error' ? ERROR_CONSTANTS.NOTIFICATION_DURATION_ERROR : ERROR_CONSTANTS.NOTIFICATION_DURATION_DEFAULT,
        });
      } catch (err) {
        console.error('[ErrorStore] Failed to show notification:', err);
      }
    }).catch(err => {
      console.error('[ErrorStore] Failed to import notification-store:', err);
    });
  },

  clearErrors: (view) => {
    set((state) => {
      const newErrors = { ...state.errors };
      delete newErrors[view];
      
      // Persist errors to localStorage
      saveErrorsToStorage(newErrors);
      
      return { errors: newErrors };
    });
  },

  getErrors: (view) => {
    return get().errors[view] || EMPTY_ERRORS;
  },

  clearAll: () => {
    set({ errors: {} });
    // Clear persisted errors
    saveErrorsToStorage({});
  },

  loadPersistedErrors: () => {
    set({ errors: loadErrorsFromStorage() });
  },

  persistErrors: () => {
    const { errors } = get();
    saveErrorsToStorage(errors);
  },
}));
