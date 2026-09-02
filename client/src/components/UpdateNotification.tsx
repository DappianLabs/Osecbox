import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Download, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { useUpdateStore } from '@/lib/update-store';

export function UpdateNotification() {
  const { updateInfo, setUpdateAvailable, clearUpdate } = useUpdateStore();
  const [showNotification, setShowNotification] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [readyToInstall, setReadyToInstall] = useState(false);

  useEffect(() => {
    if (!window.electron || typeof window.electron.onUpdateAvailable !== 'function') return;

    const cleanups: Array<() => void> = [];
    cleanups.push(window.electron.onUpdateAvailable((data) => {
      setUpdateAvailable(true, { version: data.version, releaseNotes: data.releaseNotes });
      setShowNotification(true);
      toast.info(`Update available: v${data.version}`, {
        description: 'A new version is ready to download',
        duration: 10000,
      });
    }));

    cleanups.push(window.electron.onUpdateNotAvailable(() => {
      toast.success('You\'re up to date!', {
        description: 'No updates available',
      });
    }));

    cleanups.push(window.electron.onUpdateDownloadProgress((data) => {
      setDownloadProgress(data.percent);
    }));

    cleanups.push(window.electron.onUpdateDownloaded((data) => {
      setDownloading(false);
      setReadyToInstall(true);
      toast.success(`Update v${data.version} ready!`, {
        description: 'Restart to install the update',
        duration: Infinity,
      });
    }));

    cleanups.push(window.electron.onUpdateError((data) => {
      setDownloading(false);
      toast.error('Update failed', {
        description: data.message,
      });
    }));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  const handleDownload = async () => {
    if (!window.electron?.downloadUpdate) return;

    setDownloading(true);
    try {
      const result = await window.electron.downloadUpdate();
      if (!result?.success) {
        setDownloading(false);
        toast.error('Download failed', {
          description: result?.error || 'The update could not be downloaded',
        });
      }
    } catch (error: any) {
      setDownloading(false);
      toast.error('Download failed', {
        description: error?.message || 'The update could not be downloaded',
      });
    }
  };

  const handleInstall = async () => {
    if (!window.electron?.installUpdate) return;

    try {
      const result = await window.electron.installUpdate();
      if (result?.success) {
        // Clear the update badge only after the main process accepts the
        // install request. Failed precondition checks keep the update visible.
        clearUpdate();
      } else {
        toast.error('Install failed', {
          description: result?.error || 'No downloaded update is available',
        });
      }
    } catch (error: any) {
      toast.error('Install failed', {
        description: error?.message || 'The update could not be installed',
      });
    }
  };

  const handleDismiss = () => {
    // Only hide notification, keep the badge visible
    setShowNotification(false);
    setReadyToInstall(false);
  };

  if (!showNotification && !readyToInstall) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 bg-card border border-border rounded-lg shadow-lg p-4 animate-in slide-in-from-bottom-5">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {readyToInstall ? (
            <RefreshCw className="h-5 w-5 text-green-500" />
          ) : (
            <Download className="h-5 w-5 text-blue-500" />
          )}
          <h3 className="font-semibold">
            {readyToInstall ? 'Update Ready' : 'Update Available'}
          </h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {updateInfo && (
        <div className="mb-3">
          <p className="text-sm text-muted-foreground mb-1">
            Version {updateInfo.version}
          </p>
          {updateInfo.releaseNotes && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {updateInfo.releaseNotes}
            </p>
          )}
        </div>
      )}

      {downloading && (
        <div className="mb-3">
          <Progress value={downloadProgress} className="h-2" />
          <p className="text-xs text-muted-foreground mt-1">
            Downloading... {Math.round(downloadProgress)}%
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {readyToInstall ? (
          <Button onClick={handleInstall} className="flex-1" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Restart & Install
          </Button>
        ) : (
          <Button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1"
            size="sm"
          >
            <Download className="h-4 w-4 mr-2" />
            {downloading ? 'Downloading...' : 'Download Update'}
          </Button>
        )}
        <Button variant="outline" onClick={handleDismiss} size="sm">
          Later
        </Button>
      </div>
    </div>
  );
}
