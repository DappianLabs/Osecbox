import { create } from 'zustand';

interface NavigationStore {
  navigateToSettings: (section?: string) => void;
  setNavigateToSettings: (fn: (section?: string) => void) => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  navigateToSettings: () => {},
  setNavigateToSettings: (fn) => set({ navigateToSettings: fn }),
}));
