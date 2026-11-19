/**
 * Auto-update handlers.
 *
 * Updates are opt-in: the app checks for a release, but never downloads or
 * installs one without an explicit user action. State is kept in the main
 * process so a renderer that starts after the first update event can recover
 * the current status instead of silently missing it.
 */

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

// `NODE_ENV` is inherited from launchers and enterprise shells. Use Electron's
// authoritative packaging state so an installed build never accidentally
// disables update checks because of an environment variable.
const isDev = !app.isPackaged;

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error';

export interface UpdateInfoSnapshot {
  version: string;
  releaseNotes: string;
  releaseDate?: string;
}

export interface UpdateProgressSnapshot {
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdateStateSnapshot {
  status: UpdateStatus;
  updateInfo: UpdateInfoSnapshot | null;
  progress: UpdateProgressSnapshot | null;
  error: string | null;
  supported: boolean;
  supportMessage: string | null;
}

type IPCHandler = (channel: string, handler: (...args: any[]) => any) => void;
type UpdateEventSender = (channel: string, ...args: any[]) => void;

let updateState: UpdateStateSnapshot;
let hasDownloadedUpdate = false;
let installInProgress = false;
let updaterStateListenersRegistered = false;
let checkInProgress: Promise<CheckUpdateResult> | null = null;
let downloadInProgress: Promise<UpdateOperationResult> | null = null;
let sendUpdateEvent: UpdateEventSender = () => undefined;

interface CheckUpdateResult {
  success: boolean;
  updateInfo?: UpdateInfoSnapshot;
  state: UpdateStateSnapshot;
  error?: string;
}

interface UpdateOperationResult {
  success: boolean;
  state: UpdateStateSnapshot;
  error?: string;
}

function getUnsupportedMessage(): string | null {
  if (isDev) {
    return 'Updates are only available in an installed production build.';
  }
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) {
    return 'Portable Windows builds are updated manually. Download the latest portable EXE from the official GitHub Release.';
  }
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    return 'Automatic updates are supported for the AppImage build. Debian and tar.gz installations are updated manually from the official GitHub Release.';
  }
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return 'Automatic updates are not enabled for this platform yet. Download the latest package from the official GitHub Release.';
  }
  return null;
}

export function isAutomaticUpdateSupported(): boolean {
  return getUnsupportedMessage() === null;
}

function createInitialState(): UpdateStateSnapshot {
  const supportMessage = getUnsupportedMessage();
  return {
    status: 'idle',
    updateInfo: null,
    progress: null,
    error: null,
    supported: supportMessage === null,
    supportMessage,
  };
}

function normalizeReleaseNotes(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && 'note' in entry) {
          return String((entry as { note?: unknown }).note || '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

function toUpdateInfoSnapshot(info: any): UpdateInfoSnapshot | undefined {
  if (!info || typeof info.version !== 'string') return undefined;
  return {
    version: info.version,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    ...(typeof info.releaseDate === 'string' ? { releaseDate: info.releaseDate } : {}),
  };
}

function getUpdateState(): UpdateStateSnapshot {
  return {
    ...updateState,
    updateInfo: updateState.updateInfo ? { ...updateState.updateInfo } : null,
    progress: updateState.progress ? { ...updateState.progress } : null,
  };
}

function setUpdateState(patch: Partial<UpdateStateSnapshot>): UpdateStateSnapshot {
  updateState = { ...updateState, ...patch };
  sendUpdateEvent('update-state-changed', getUpdateState());
  return getUpdateState();
}

function setUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Unknown update error');
  setUpdateState({ status: 'error', error: message });
  sendUpdateEvent('update-error', { message });
  return message;
}

updateState = createInitialState();

function registerUpdaterStateListeners() {
  if (updaterStateListenersRegistered) return;

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', error: null, progress: null });
    console.log('[Updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    const updateInfo = toUpdateInfoSnapshot(info);
    hasDownloadedUpdate = false;
    setUpdateState({ status: 'available', updateInfo: updateInfo || null, progress: null, error: null });
    console.log('[Updater] Update available:', info.version);
    sendUpdateEvent('update-available', updateInfo || { version: String(info.version), releaseNotes: '' });
  });

  autoUpdater.on('update-not-available', () => {
    hasDownloadedUpdate = false;
    setUpdateState({ status: 'up-to-date', updateInfo: null, progress: null, error: null });
    console.log('[Updater] No updates available');
    sendUpdateEvent('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    const snapshot: UpdateProgressSnapshot = {
      percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      transferred: Number(progress.transferred) || 0,
      total: Number(progress.total) || 0,
    };
    setUpdateState({ status: 'downloading', progress: snapshot, error: null });
    sendUpdateEvent('update-download-progress', snapshot);
  });

  autoUpdater.on('update-downloaded', (info) => {
    const updateInfo = toUpdateInfoSnapshot(info);
    hasDownloadedUpdate = true;
    installInProgress = false;
    downloadInProgress = null;
    setUpdateState({
      status: 'downloaded',
      updateInfo: updateInfo || updateState.updateInfo,
      progress: { percent: 100, transferred: 0, total: 0 },
      error: null,
    });
    console.log('[Updater] Update downloaded:', info.version);
    sendUpdateEvent('update-downloaded', { version: String(info.version) });
  });

  autoUpdater.on('update-cancelled', () => {
    hasDownloadedUpdate = false;
    setUpdateState({ status: 'idle', progress: null, error: null });
  });

  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('no published versions')) {
      console.warn('[Updater] No published release available yet');
    } else {
      console.error('[Updater] Error:', error);
    }
    setUpdateError(message);
  });

  updaterStateListenersRegistered = true;
}

export function registerUpdateHandlers(
  registerIPCHandler: IPCHandler,
  sendEvent: UpdateEventSender,
) {
  sendUpdateEvent = sendEvent;
  registerUpdaterStateListeners();

  // Check for updates
  registerIPCHandler('check-for-updates', async (): Promise<CheckUpdateResult> => {
    const supportMessage = getUnsupportedMessage();
    if (supportMessage) {
      setUpdateState({ error: supportMessage });
      return { success: false, error: supportMessage, state: getUpdateState() };
    }
    if (checkInProgress) return checkInProgress;
    if (!autoUpdater.isUpdaterActive()) {
      const error = 'The automatic updater is not active for this installation. Download the latest package from the official GitHub Release.';
      return { success: false, error: setUpdateError(error), state: getUpdateState() };
    }

    const operation = autoUpdater.checkForUpdates()
      .then((result) => {
        const updateInfo = toUpdateInfoSnapshot(result?.updateInfo);
        if (result?.isUpdateAvailable && updateInfo && updateState.status === 'checking') {
          setUpdateState({ status: 'available', updateInfo, progress: null, error: null });
        } else if (result && !result.isUpdateAvailable && updateState.status === 'checking') {
          setUpdateState({ status: 'up-to-date', updateInfo: null, progress: null, error: null });
        }
        return {
          success: true,
          ...(updateInfo ? { updateInfo } : {}),
          state: getUpdateState(),
        };
      })
      .catch((error): CheckUpdateResult => ({
        success: false,
        error: setUpdateError(error),
        state: getUpdateState(),
      }))
      .finally(() => {
        checkInProgress = null;
      });

    checkInProgress = operation;
    return operation;
  });

  // Renderer startup can miss an event emitted before its listeners mount.
  // This query is the recovery path for that race.
  registerIPCHandler('get-update-state', () => ({
    success: true,
    state: getUpdateState(),
  }));

  // Download update
  registerIPCHandler('download-update', async (): Promise<UpdateOperationResult> => {
    const supportMessage = getUnsupportedMessage();
    if (supportMessage) {
      setUpdateState({ error: supportMessage });
      return { success: false, error: supportMessage, state: getUpdateState() };
    }
    if (hasDownloadedUpdate) return { success: true, state: getUpdateState() };
    if (downloadInProgress) return downloadInProgress;
    if (!updateState.updateInfo) {
      const error = 'Check for updates before downloading an update.';
      return { success: false, error, state: getUpdateState() };
    }

    setUpdateState({
      status: 'downloading',
      progress: updateState.progress || { percent: 0, transferred: 0, total: 0 },
      error: null,
    });

    const operation = autoUpdater.downloadUpdate()
      .then(() => ({ success: true, state: getUpdateState() }))
      .catch((error): UpdateOperationResult => ({
        success: false,
        error: setUpdateError(error),
        state: getUpdateState(),
      }))
      .finally(() => {
        downloadInProgress = null;
      });

    downloadInProgress = operation;
    return operation;
  });

  // Install update and restart
  registerIPCHandler('install-update', () => {
    const supportMessage = getUnsupportedMessage();
    if (supportMessage) {
      setUpdateState({ error: supportMessage });
      return { success: false, error: supportMessage, state: getUpdateState() };
    }
    if (installInProgress) {
      return { success: false, error: 'Update installation is already in progress', state: getUpdateState() };
    }
    if (!hasDownloadedUpdate) {
      return { success: false, error: 'No downloaded update is available', state: getUpdateState() };
    }

    try {
      installInProgress = true;
      autoUpdater.quitAndInstall(false, true);
      return { success: true, state: getUpdateState() };
    } catch (error: any) {
      installInProgress = false;
      return { success: false, error: error?.message || String(error), state: getUpdateState() };
    }
  });

  // Get app version
  registerIPCHandler('get-app-version', () => {
    return { version: app.getVersion() };
  });
}
