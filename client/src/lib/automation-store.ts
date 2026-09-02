import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AutomationStore {
  ipList: string;
  saveLocation: string;
  customFlags: string;
  selectedPreset: string;
  executionMode: 'console' | 'background';
  options: {
    liveOnly: boolean;
    noSummary: boolean;
    separateFolders: boolean;
    autoScan: boolean;
  };
  setIpList: (ipList: string) => void;
  setSaveLocation: (location: string) => void;
  setCustomFlags: (flags: string) => void;
  setSelectedPreset: (preset: string) => void;
  setExecutionMode: (mode: 'console' | 'background') => void;
  setOptions: (options: Partial<AutomationStore['options']>) => void;
  clearAll: () => void;
}

export const useAutomationStore = create<AutomationStore>()(
  persist(
    (set) => ({
      ipList: '',
      saveLocation: '',
      customFlags: '',
      selectedPreset: '',
      executionMode: 'console',
      options: {
        liveOnly: false,
        noSummary: false,
        separateFolders: false,
        autoScan: false,
      },
      setIpList: (ipList) => set({ ipList }),
      setSaveLocation: (location) => set({ saveLocation: location }),
      setCustomFlags: (flags) => set({ customFlags: flags }),
      setSelectedPreset: (preset) => set({ selectedPreset: preset }),
      setExecutionMode: (mode) => set({ executionMode: mode }),
      setOptions: (newOptions) =>
        set((state) => ({ options: { ...state.options, ...newOptions } })),
      clearAll: () =>
        set({
          ipList: '',
          saveLocation: '',
          customFlags: '',
          selectedPreset: '',
          executionMode: 'console',
          options: {
            liveOnly: false,
            noSummary: false,
            separateFolders: false,
            autoScan: false,
          },
        }),
    }),
    {
      name: 'automation-store',
    }
  )
);
