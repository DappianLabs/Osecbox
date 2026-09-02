import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TerminalContext = 'tunneling' | 'foothold' | 'subdomain' | 'metasploit' | 'scan' | string;

interface TerminalState {
  // Map of context -> terminal output lines
  outputs: Record<string, string[]>;
  
  // Get output for a specific context
  getOutput: (context: string) => string[];
  
  // Add line to a specific context
  addLine: (context: string, line: string) => void;
  
  // Add multiple lines to a specific context
  addLines: (context: string, lines: string[]) => void;
  
  // Clear output for a specific context
  clearOutput: (context: string) => void;
  
  // Clear all outputs
  clearAll: () => void;
}

export const useGlobalTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      outputs: {
        tunneling: ['Welcome to OsecBox Terminal', ''],
        foothold: ['Welcome to OsecBox Terminal', ''],
        subdomain: ['Welcome to OsecBox Terminal', ''],
        metasploit: ['Welcome to OsecBox Terminal', ''],
        scan: ['Welcome to OsecBox Terminal', ''],
      },
      
      getOutput: (context) => {
        const state = get();
        // Initialize context if it doesn't exist
        if (!state.outputs[context]) {
          set((state) => ({
            outputs: {
              ...state.outputs,
              [context]: ['Welcome to OsecBox Terminal', ''],
            },
          }));
          return ['Welcome to OsecBox Terminal', ''];
        }
        return state.outputs[context];
      },
      
      addLine: (context, line) => {
        set((state) => ({
          outputs: {
            ...state.outputs,
            [context]: [...(state.outputs[context] || ['Welcome to OsecBox Terminal', '']), line],
          },
        }));
      },
      
      addLines: (context, lines) => {
        set((state) => ({
          outputs: {
            ...state.outputs,
            [context]: [...(state.outputs[context] || ['Welcome to OsecBox Terminal', '']), ...lines],
          },
        }));
      },
      
      clearOutput: (context) => {
        set((state) => ({
          outputs: {
            ...state.outputs,
            [context]: [''],
          },
        }));
      },
      
      clearAll: () => {
        set({
          outputs: {
            tunneling: [''],
            foothold: [''],
            subdomain: [''],
            metasploit: [''],
            scan: [''],
          },
        });
      },
    }),
    {
      name: 'global-terminal-storage',
      version: 1, // MIGRATION: Version for future schema changes
      // Don't persist outputs - they can get huge
      partialize: (state) => ({}),
    }
  )
);
