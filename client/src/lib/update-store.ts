import { create } from 'zustand';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

export interface UpdateInfo {
  version: string;
  releaseNotes: string;
  releaseDate?: string;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdateStateSnapshot {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  supported: boolean;
  supportMessage: string | null;
}

interface UpdateState extends UpdateStateSnapshot {
  updateAvailable: boolean;
  setUpdateAvailable: (available: boolean, info?: UpdateInfo) => void;
  setUpdateState: (state: UpdateStateSnapshot) => void;
  clearUpdate: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  updateAvailable: false,
  updateInfo: null,
  status: 'idle',
  progress: null,
  error: null,
  supported: true,
  supportMessage: null,
  setUpdateAvailable: (available, info) => set({ 
    updateAvailable: available, 
    updateInfo: info || null,
    status: available ? 'available' : 'up-to-date',
    error: null,
  }),
  setUpdateState: (state) => set({
    ...state,
    updateAvailable: Boolean(state.updateInfo) && ['available', 'downloading', 'downloaded'].includes(state.status),
  }),
  clearUpdate: () => set({
    updateAvailable: false,
    updateInfo: null,
    status: 'idle',
    progress: null,
    error: null,
  }),
}));
