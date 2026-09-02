import { licenseManager } from '../license-manager';

export function registerLicenseHandlers(registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void) {
  registerIPCHandler('get-license-info', async () => {
    const info = licenseManager.getLicenseInfo();
    return { success: true, ...info };
  });

  registerIPCHandler('activate-license', async (_event, key: string) => {
    return await licenseManager.activateLicense(key);
  });

  registerIPCHandler('deactivate-license', async () => {
    await licenseManager.deactivate();
    return { success: true };
  });

  registerIPCHandler('open-upgrade-url', async () => {
    return { success: true };
  });
}
