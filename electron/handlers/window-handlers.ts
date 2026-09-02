/**
 * Window Control Handlers
 * Handles window minimize, maximize, close operations
 */

import { BrowserWindow } from 'electron';

let isClosing = false;

export function registerWindowHandlers(
  registerIPCListener: (channel: string, handler: (...args: any[]) => void) => void,
  getMainWindow: () => BrowserWindow | null,
  cleanupProcesses: () => Promise<void>
) {
  // Window minimize
  registerIPCListener('window-minimize', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.minimize();
  });

  // Window maximize/unmaximize toggle
  registerIPCListener('window-maximize', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  // Request a normal BrowserWindow close. The main process close handler owns
  // the unsaved-work check and can ask the renderer to show its save dialog.
  // Calling destroy() here used to bypass that dialog from the custom title
  // bar, so Save & Close was not reliable.
  registerIPCListener('window-close', () => {
    if (isClosing) {
      console.log('[window-close] Close already confirmed, ignoring duplicate request');
      return;
    }

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  // The renderer calls this only after the user chose Save & Close or Don't
  // Save. It is intentionally separate from window-close so the normal close
  // event can still protect unsaved work.
  registerIPCListener('window-confirm-close', async () => {
    if (isClosing) {
      console.log('[window-confirm-close] Already closing, ignoring duplicate request');
      return;
    }
    isClosing = true;

    try {
      await cleanupProcesses();
    } catch (error) {
      console.error('[window-confirm-close] Cleanup error:', error);
    } finally {
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        // destroy() is deliberate here: the renderer has already confirmed
        // the close and this must not re-enter the save prompt.
        mainWindow.destroy();
      }
    }
  });
}
