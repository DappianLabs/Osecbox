import { create } from 'zustand';

export interface PrivilegeState {
  level: 'root' | 'sudo' | 'user' | 'admin' | 'unknown';
  isRoot: boolean;
  hasSudo: boolean;
  sudoNoPassword: boolean;
  isAdmin: boolean;
  username: string;
  loading: boolean;
  checkPrivileges: () => Promise<void>;
}

export const usePrivilegeStore = create<PrivilegeState>((set) => ({
  level: 'unknown',
  isRoot: false,
  hasSudo: false,
  sudoNoPassword: false,
  isAdmin: false,
  username: 'unknown',
  loading: true,

  checkPrivileges: async () => {
    set({ loading: true });
    
    try {
      const result = await window.electron?.getPrivilegeInfo();
      
      if (result?.success && result.info) {
        set({
          level: result.info.level,
          isRoot: result.info.isRoot,
          hasSudo: result.info.hasSudo,
          sudoNoPassword: result.info.sudoNoPassword === true,
          isAdmin: result.info.isAdmin,
          username: result.info.username || 'unknown',
          loading: false,
        });
      } else {
        set({ loading: false });
      }
    } catch (error) {
      console.error('[PrivilegeStore] Failed to check privileges:', error);
      set({ loading: false });
    }
  },
}));
