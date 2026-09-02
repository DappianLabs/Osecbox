/**
 * React hook for platform detection and WSL2 status
 * 
 * Provides real-time platform information including WSL2 availability
 * on Windows systems.
 */

import { useState, useEffect, useCallback } from 'react';

export interface PlatformInfo {
  platform: 'windows' | 'linux' | 'darwin' | 'unknown';
  isWindows: boolean;
  isLinux: boolean;
  isMac: boolean;
  wsl2Status: 'available' | 'unavailable' | 'not-installed' | 'not-applicable' | 'checking';
  wsl2Version?: string;
  wsl2Distros?: string[];
  defaultDistro?: string;
  wsl2Error?: string;
}

export interface UsePlatformReturn {
  platformInfo: PlatformInfo | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  checkTool: (toolName: string, requiresLinux?: boolean) => Promise<{
    available: boolean;
    path?: string;
    version?: string;
    usedWSL: boolean;
  }>;
  getWSL2Instructions: () => Promise<string[]>;
}

type PlatformApiResult = {
  success?: boolean;
  platformInfo?: {
    platform?: string;
    isWindows?: boolean;
    isLinux?: boolean;
    isMac?: boolean;
    wsl2Status?: PlatformInfo['wsl2Status'];
    wsl2Version?: string;
    wsl2Distros?: string[];
    defaultDistro?: string;
    wsl2Error?: string;
    // Compatibility with the older platform response shape.
    hasWSL2?: boolean;
  };
  info?: PlatformApiResult['platformInfo'];
  error?: string;
};

// Several always-mounted components use this hook. Share the renderer-side
// request so TitleBar, Settings, and Subdomain do not independently trigger
// the same WSL detection IPC call.
let platformRequest: Promise<PlatformApiResult> | null = null;
let cachedPlatformResult: PlatformApiResult | null = null;
let cachedPlatformAt = 0;
const PLATFORM_CACHE_MS = 60_000;

async function getSharedPlatformInfo(forceRefresh = false): Promise<PlatformApiResult> {
  const now = Date.now();
  if (!forceRefresh && cachedPlatformResult && now - cachedPlatformAt < PLATFORM_CACHE_MS) {
    return cachedPlatformResult;
  }

  if (platformRequest) return platformRequest;
  if (!window.electron) {
    return { success: false, error: 'Electron API not available' };
  }

  platformRequest = window.electron.getPlatformInfo(forceRefresh)
    .then((result) => {
      if (result?.success && (result.platformInfo || result.info)) {
        cachedPlatformResult = result;
        cachedPlatformAt = Date.now();
      }
      return result;
    })
    .finally(() => {
      platformRequest = null;
    });

  return platformRequest;
}

export function usePlatform(): UsePlatformReturn {
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlatformInfo = useCallback(async (forceRefresh = false) => {
    if (!window.electron) {
      setError('Electron API not available');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      const result = await getSharedPlatformInfo(forceRefresh);
      
      if (result.success && (result.platformInfo || result.info)) {
        const pi = result.platformInfo || result.info!;
        const normalizedPlatform = pi.platform === 'win32' || pi.platform === 'windows'
          ? 'windows'
          : pi.platform === 'darwin' || pi.platform === 'mac'
            ? 'darwin'
            : pi.platform === 'linux'
              ? 'linux'
              : 'unknown';
        setPlatformInfo({
          platform: normalizedPlatform,
          isWindows: pi.isWindows ?? normalizedPlatform === 'windows',
          isLinux: pi.isLinux ?? normalizedPlatform === 'linux',
          isMac: pi.isMac ?? normalizedPlatform === 'darwin',
          wsl2Status: pi.wsl2Status ?? (pi.hasWSL2 ? 'available' : normalizedPlatform === 'windows' ? 'not-installed' : 'not-applicable'),
          wsl2Version: pi.wsl2Version,
          wsl2Distros: pi.wsl2Distros,
          defaultDistro: pi.defaultDistro,
          wsl2Error: pi.wsl2Error,
        });
      } else {
        setError(result.error || 'Failed to get platform info');
      }
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadPlatformInfo(true);
  }, [loadPlatformInfo]);

  const checkTool = useCallback(async (toolName: string, requiresLinux = false) => {
    if (!window.electron) {
      throw new Error('Electron API not available');
    }

    const result = await window.electron.checkToolAvailability({
      toolName,
      requiresLinux,
    });

    if (!result.success) {
      throw new Error(result.error || 'Tool check failed');
    }

    return {
      available: result.available || false,
      path: result.path,
      version: result.version,
      usedWSL: result.usedWSL || false,
    };
  }, []);

  const getWSL2Instructions = useCallback(async (): Promise<string[]> => {
    if (!window.electron) {
      throw new Error('Electron API not available');
    }

    const result = await window.electron.getWSL2Instructions();
    if (Array.isArray(result.instructions)) return result.instructions;
    return result.instructions?.steps || [];
  }, []);

  // Load platform info on mount
  useEffect(() => {
    // Platform/WSL detection can invoke external processes. Let the first
    // frame and active terminal become interactive before probing the host.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const start = () => {
        if (!cancelled) void loadPlatformInfo();
      };

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(start, { timeout: 700 });
      } else {
        start();
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadPlatformInfo]);

  // FIX: Auto-retry if WSL2 status is still "checking" after initial load
  useEffect(() => {
    if (platformInfo?.wsl2Status === 'checking' && !isLoading) {
      // WSL2 detection is still in progress, retry after 2 seconds
      const retryTimer = setTimeout(() => {
        console.log('[usePlatform] WSL2 still checking, forcing refresh...');
        loadPlatformInfo(true);
      }, 2000);
      
      return () => clearTimeout(retryTimer);
    }
  }, [platformInfo, isLoading, loadPlatformInfo]);

  // FIX: Force refresh when window becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && platformInfo?.wsl2Status === 'checking') {
        loadPlatformInfo(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [platformInfo, loadPlatformInfo]);

  return {
    platformInfo,
    isLoading,
    error,
    refresh,
    checkTool,
    getWSL2Instructions,
  };
}
