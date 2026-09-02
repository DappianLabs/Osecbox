import { create } from 'zustand';

interface NmapStatusState {
  installed: boolean;
  version: string | null;
  path: string | null;
  checking: boolean;
  error?: string;
  lastChecked: number | null;
  checkNmapStatus: (force?: boolean) => Promise<void>;
}

let nmapCheckInFlight: Promise<void> | null = null;

export const useNmapStatusStore = create<NmapStatusState>((set, get) => ({
  installed: false,
  version: null,
  path: null,
  checking: false,
  error: undefined,
  lastChecked: null,

  checkNmapStatus: async (force = false) => {
    if (nmapCheckInFlight) return nmapCheckInFlight;

    // Cache for five minutes. The title bar is not a manual refresh action.
    const now = Date.now();
    const lastChecked = get().lastChecked;
    if (!force && lastChecked && now - lastChecked < 5 * 60 * 1000) {
      return; // Use cached value
    }

    const electron = window.electron;
    if (!electron) return;

    set({ checking: true });
    nmapCheckInFlight = (async () => {
      try {
        const result = await electron.checkNmap();
        console.log('[NmapStatus] Check result:', result);
        set({
          installed: result.installed,
          version: result.version,
          path: result.path,
          error: result.error,
          checking: false,
          lastChecked: Date.now(),
        });
      } catch (error) {
        console.error('[NmapStatus] Check failed:', error);
        set({ checking: false, error: error instanceof Error ? error.message : 'Nmap check failed' });
      } finally {
        nmapCheckInFlight = null;
      }
    })();

    return nmapCheckInFlight;
  },
}));
