/**
 * Auto-Update Handlers
 * Handles application updates via electron-updater
 */

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

// `NODE_ENV` is inherited from launchers and enterprise shells. Use Electron's
// authoritative packaging state so an installed build never accidentally
// disables update checks because of an environment variable.
const isDev = !app.isPackaged;

let hasDownloadedUpdate = false;
let installInProgress = false;
let updaterStateListenersRegistered = false;

function registerUpdaterStateListeners() {
  if (updaterStateListenersRegistered) {
    return;
  }

  autoUpdater.on('update-available', () => {
    hasDownloadedUpdate = false;
  });
  autoUpdater.on('update-not-available', () => {
    hasDownloadedUpdate = false;
  });
  autoUpdater.on('update-downloaded', () => {
    hasDownloadedUpdate = true;
    installInProgress = false;
  });
  updaterStateListenersRegistered = true;
}

export function registerUpdateHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void
) {
  registerUpdaterStateListeners();

  // Check for updates
  registerIPCHandler('check-for-updates', async () => {
    if (isDev) {
      return { success: false, error: 'Updates not available in development mode' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result?.updateInfo };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Download update
  registerIPCHandler('download-update', async () => {
    if (isDev) {
      return { success: false, error: 'Updates not available in development mode' };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Install update and restart
  registerIPCHandler('install-update', () => {
    if (isDev) {
      return { success: false, error: 'Updates not available in development mode' };
    }
    if (installInProgress) {
      return { success: false, error: 'Update installation is already in progress' };
    }
    if (!hasDownloadedUpdate) {
      return { success: false, error: 'No downloaded update is available' };
    }

    try {
      installInProgress = true;
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error: any) {
      installInProgress = false;
      return { success: false, error: error?.message || String(error) };
    }
  });

  // Get app version
  registerIPCHandler('get-app-version', () => {
    return { version: app.getVersion() };
  });
}
