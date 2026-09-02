import { platformService } from '../platform-service';
import { privilegeDetector } from '../privilege-detector';

export function registerPlatformHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void,
  onPlatformCacheCleared?: () => void,
) {
  registerIPCHandler('get-platform-info', async (_event, forceRefresh = false) => {
    try {
      if (forceRefresh) {
        platformService.clearCache();
        onPlatformCacheCleared?.();
      }
      const info = await platformService.getPlatformInfo(forceRefresh);
      // Keep the IPC contract aligned with the renderer and preload typings.
      // `info` was an older field name and caused platform detection to stay
      // in its loading state in some packaged builds.
      return { success: true, platformInfo: info };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('check-tool-availability', async (_event, { toolName, requiresLinux = false }) => {
    try {
      const result = await platformService.checkToolAvailability(toolName, requiresLinux);
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('check-local-port', async (_event, args: { port: number; host?: string; requiresLinux?: boolean }) => {
    try {
      const port = args && typeof args.port === 'number' ? args.port : Number(args?.port);
      const host = args && typeof args.host === 'string' ? args.host : undefined;
      const requiresLinux = Boolean(args?.requiresLinux);
      const result = await platformService.checkLocalPortAvailability(port, host, requiresLinux);
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Local port preflight failed' };
    }
  });

  registerIPCHandler('get-wsl2-instructions', async () => {
    const instructions = platformService.getWSL2SetupInstructions();
    return { success: true, instructions };
  });

  registerIPCHandler('diagnose-dns', async (_event, args: { target?: string } = {}) => {
    try {
      const target = args && typeof args.target === 'string' ? args.target : undefined;
      const diagnostic = await platformService.diagnoseDns(target);
      return {
        success: true,
        diagnostic,
        message: diagnostic.ok
          ? diagnostic.message
          : platformService.formatDnsFailure(diagnostic),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'DNS preflight could not be completed',
      };
    }
  });

  registerIPCHandler('refresh-platform-info', async () => {
    try {
      platformService.clearCache();
      onPlatformCacheCleared?.();
      const info = await platformService.getPlatformInfo(true);
      return { success: true, platformInfo: info };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('get-privilege-info', async () => {
    try {
      const info = await privilegeDetector.detect();
      return { success: true, ...info };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
