import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DiscoveryStore {
  activeCommand: string | null;
  output: string;
  setActiveCommand: (command: string | null) => void;
  setOutput: (output: string) => void;
  clearOutput: () => void;
}

export const useDiscoveryStore = create<DiscoveryStore>()(
  persist(
    (set) => ({
      activeCommand: null,
      output: '',
      setActiveCommand: (command) => set({ activeCommand: command }),
      setOutput: (output) => set({ output }),
      clearOutput: () => set({ output: '', activeCommand: null }),
    }),
    {
      name: 'discovery-store',
      // Don't persist output (can get large)
      partialize: (state) => ({
        activeCommand: state.activeCommand,
        output: '', // Clear output on reload
      }),
    }
  )
);
