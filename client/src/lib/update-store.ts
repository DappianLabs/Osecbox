import { create } from 'zustand';

interface UpdateState {
  updateAvailable: boolean;
  updateInfo: {
    version: string;
    releaseNotes: string;
    releaseDate?: string;
  } | null;
  setUpdateAvailable: (available: boolean, info?: { version: string; releaseNotes: string; releaseDate?: string }) => void;
  clearUpdate: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  updateAvailable: false,
  updateInfo: null,
  setUpdateAvailable: (available, info) => set({ 
    updateAvailable: available, 
    updateInfo: info || null 
  }),
  clearUpdate: () => set({ updateAvailable: false, updateInfo: null }),
}));
