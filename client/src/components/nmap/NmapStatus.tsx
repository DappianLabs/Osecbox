import { useEffect } from 'react';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useNmapStatusStore } from '@/lib/nmap-status-store';

export function NmapStatus() {
  const { installed, version, error, checking, checkNmapStatus } = useNmapStatusStore();

  useEffect(() => {
    // Nmap discovery may cross into WSL. Defer it until after the first
    // interactive frame so it cannot compete with terminal startup.
    const timer = window.setTimeout(() => {
      checkNmapStatus();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [checkNmapStatus]);

  if (checking) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertCircle className="w-3 h-3 animate-pulse" />
        <span>Checking nmap...</span>
      </div>
    );
  }

  if (!installed) {
    const wslUnavailable = error?.toLowerCase().includes('wsl2 unavailable');
    return (
      <div className={`flex items-center gap-2 text-xs ${wslUnavailable ? 'text-orange-500' : 'text-red-500'}`} title={error}>
        {wslUnavailable ? <AlertCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
        <span>{wslUnavailable ? 'WSL2 unavailable' : 'Nmap not found'}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-green-500">
      <CheckCircle2 className="w-3 h-3" />
      <span>Nmap {version}</span>
    </div>
  );
}
