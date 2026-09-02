import { settingsService } from '../services/settings-service';
import { rateLimiters } from './rate-limiter';
import { logSecurityEvent } from '../utils/security-logger';

export function registerSettingsHandlers(registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void) {
  registerIPCHandler('get-settings', async () => {
    try {
      await settingsService.waitUntilReady();
      const settings = settingsService.getSettings();
      // Settings cross the Electron renderer boundary. Keep the credential in
      // the main-process SettingsService, but never return its plaintext value.
      return {
        success: true,
        hasApiKey: Boolean(settings.aiApiKey?.trim()),
        settings: {
          ...settings,
          aiApiKey: '',
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('update-setting', async (_event, key: string, value: any) => {
    try {
      if (typeof key !== 'string' || !key.trim() || key.length > 128) {
        return { success: false, error: 'Invalid setting key' };
      }

      // SECURITY: Rate limiting
      const rateLimitCheck = rateLimiters.settingsUpdate.check('settings-update');
      if (!rateLimitCheck.allowed) {
        return { success: false, error: `Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.` };
      }
      
      await settingsService.updateSetting(key as any, value);
      logSecurityEvent.settingsChange(key, true);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('update-settings', async (_event, updates: any) => {
    try {
      if (updates === null || typeof updates !== 'object' || Array.isArray(updates)) {
        return { success: false, error: 'Settings update must be a plain object' };
      }

      // SECURITY: Rate limiting
      const rateLimitCheck = rateLimiters.settingsUpdate.check('settings-update');
      if (!rateLimitCheck.allowed) {
        return { success: false, error: `Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.` };
      }
      
      await settingsService.updateSettings(updates);
      logSecurityEvent.settingsChange('bulk-update', true);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('validate-tool-path', async (_event, toolPath: string) => {
    try {
      if (typeof toolPath !== 'string' || !toolPath.trim() || toolPath.length > 4096) {
        return { success: false, error: 'Invalid tool path' };
      }
      const result = await settingsService.validateToolPath(toolPath);
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('reset-settings', async () => {
    try {
      // SECURITY: Rate limiting
      const rateLimitCheck = rateLimiters.settingsUpdate.check('settings-reset');
      if (!rateLimitCheck.allowed) {
        return { success: false, error: `Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.` };
      }
      
      await settingsService.resetToDefaults();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('export-settings', async (_event, filePath: string) => {
    try {
      await settingsService.exportSettings(filePath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('import-settings', async (_event, filePath: string) => {
    try {
      // SECURITY: Rate limiting (strict for imports)
      const rateLimitCheck = rateLimiters.settingsImport.check('settings-import');
      if (!rateLimitCheck.allowed) {
        return { success: false, error: `Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.` };
      }
      
      await settingsService.importSettings(filePath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
