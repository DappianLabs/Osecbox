import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TerminalTab {
  id: string;
  title: string;
  sessionType: 'scan' | 'foothold' | 'tunneling' | 'metasploit' | 'general';
  target?: string;
  workingDirectory: string;
  createdAt: number;
  lastActiveAt: number;
  isRestored?: boolean; // Flag to indicate this terminal was restored from a session
}

interface TerminalTabsState {
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  nextTerminalNumber: number;
}

interface TerminalTabsActions {
  addTerminal: (options?: Partial<TerminalTab>) => TerminalTab;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  updateTerminalTitle: (id: string, title: string) => void;
  updateTerminalTarget: (id: string, target: string) => void;
  updateTerminalWorkingDirectory: (id: string, workingDirectory: string) => void;
  clearAllTerminals: () => void;
}

type TerminalTabsStore = TerminalTabsState & TerminalTabsActions;

const generateTerminalId = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return 'terminal_' + timestamp + '_' + random;
};

export const useTerminalTabsStore = create<TerminalTabsStore>()(
  persist(
    (set, get) => ({
      terminals: [],
      activeTerminalId: null,
      nextTerminalNumber: 1,

      addTerminal: (options = {}) => {
        const state = get();
        const id = generateTerminalId();
        
        // Calculate the next terminal number based on existing terminals
        // This ensures proper numbering even if terminals are deleted
        const existingNumbers = state.terminals
          .map(t => {
            const match = t.title.match(/^Terminal (\d+)$/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(n => n > 0);
        
        const terminalNumber = existingNumbers.length > 0 
          ? Math.max(...existingNumbers) + 1 
          : state.nextTerminalNumber;
        
        const newTerminal: TerminalTab = {
          id,
          title: options.title || `Terminal ${terminalNumber}`,
          sessionType: options.sessionType || 'general',
          target: options.target || '',
          workingDirectory: options.workingDirectory || '~',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          ...options,
        };

        set((state) => ({
          terminals: [...state.terminals, newTerminal],
          activeTerminalId: id,
          nextTerminalNumber: Math.max(terminalNumber + 1, state.nextTerminalNumber),
        }));

        return newTerminal;
      },

      removeTerminal: (id: string) => {
        set((state) => {
          const newTerminals = state.terminals.filter(t => t.id !== id);
          let newActiveId = state.activeTerminalId;

          if (state.activeTerminalId === id) {
            if (newTerminals.length > 0) {
              const sortedTerminals = newTerminals.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
              newActiveId = sortedTerminals[0].id;
            } else {
              newActiveId = null;
            }
          }

          return {
            terminals: newTerminals,
            activeTerminalId: newActiveId,
          };
        });
      },

      setActiveTerminal: (id: string) => {
        // PERFORMANCE: Only update if different
        const state = get();
        if (state.activeTerminalId === id) return;
        
        set((state) => ({
          terminals: state.terminals.map(t => 
            t.id === id ? { ...t, lastActiveAt: Date.now() } : t
          ),
          activeTerminalId: id,
        }));
      },

      updateTerminalTitle: (id: string, title: string) => {
        // PERFORMANCE: Only update if different
        const state = get();
        const terminal = state.terminals.find(t => t.id === id);
        if (terminal?.title === title) return;
        
        set((state) => ({
          terminals: state.terminals.map(t => 
            t.id === id ? { ...t, title } : t
          ),
        }));
      },

      updateTerminalTarget: (id: string, target: string) => {
        set((state) => ({
          terminals: state.terminals.map(t => 
            t.id === id ? { ...t, target } : t
          ),
        }));
      },

      updateTerminalWorkingDirectory: (id: string, workingDirectory: string) => {
        set((state) => ({
          terminals: state.terminals.map(t => 
            t.id === id ? { ...t, workingDirectory } : t
          ),
        }));
      },

      clearAllTerminals: () => {
        set({
          terminals: [],
          activeTerminalId: null,
          nextTerminalNumber: 1,
        });
      },
    }),
    {
      name: 'terminal-tabs-store',
      version: 1,
      migrate: (persistedState: any, version: number) => {
        // MIGRATION: Clear old data on version mismatch
        if (version === 0 || !persistedState) {
          console.log('[terminal-tabs-store] Migrating from v0 to v1 - clearing old data');
          return {
            terminals: [],
            activeTerminalId: null,
            nextTerminalNumber: 1,
          };
        }
        return persistedState;
      },
      partialize: (state) => ({
        terminals: state.terminals,
        activeTerminalId: state.activeTerminalId, // FIX: Also persist active terminal ID
        nextTerminalNumber: state.nextTerminalNumber,
      }),
      // Migration to fix any terminals with incorrect names
      onRehydrateStorage: () => (state) => {
        if (state) {
          // A restored-session marker only belongs to the current load. Clear
          // it when hydrating Zustand from disk so persistWorkspace=false does
          // not keep stale terminals alive across app restarts.
          state.terminals = state.terminals.map((terminal) => ({
            ...terminal,
            isRestored: false,
          }));

          // Fix any terminals that don't have proper "Terminal N" naming
          const fixedTerminals = state.terminals.map((terminal, index) => {
            // If the terminal name doesn't match "Terminal N" pattern, fix it
            if (!/^Terminal \d+$/.test(terminal.title)) {
              return {
                ...terminal,
                title: `Terminal ${index + 1}`,
              };
            }
            return terminal;
          });
          
          // Update the state if any terminals were fixed
          if (JSON.stringify(fixedTerminals) !== JSON.stringify(state.terminals)) {
            state.terminals = fixedTerminals;
          }
        }
      },
    }
  )
);
