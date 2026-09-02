import React from 'react';
import { CheckCircle2, AlertTriangle, Loader2, Copy } from 'lucide-react';
import { logger } from '@/lib/utils/logger';

type CheckState = 'checking' | 'installed' | 'missing' | 'blocked' | 'unknown';
const EMPTY_ALTERNATIVES: readonly string[] = [];

interface ToolInstallIndicatorProps {
  /** The binary name to check on the system, e.g. "ncat", "chisel". */
  binary: string;
  /** Equivalent binary names accepted by the runtime preflight (for example nc/ncat). */
  alternativeBinaries?: readonly string[];
  /** Friendly label shown to the user, e.g. "Netcat". Defaults to the binary name. */
  label?: string;
  className?: string;
}

/**
 * Compact inline indicator that verifies whether a CLI tool is installed/connected
 * via window.electron.checkToolInstalled, and offers a one-click copy of the install
 * command (from window.electron.getInstallCommand) when the tool is missing.
 *
 * Used by the Foothold and Tunneling "new session" dialogs so users know up-front
 * whether the selected tool is available before they try to Start it.
 */
export function ToolInstallIndicator({ binary, alternativeBinaries = EMPTY_ALTERNATIVES, label, className }: ToolInstallIndicatorProps) {
  const [state, setState] = React.useState<CheckState>('checking');
  const [version, setVersion] = React.useState<string | undefined>();
  const [copied, setCopied] = React.useState(false);
  const displayName = label || binary;

  React.useEffect(() => {
    let cancelled = false;
    setState('checking');
    setVersion(undefined);
    setCopied(false);

    if (!binary) {
      setState('unknown');
      return;
    }

    if (!window.electron?.checkToolInstalled) {
      setState('unknown');
      return;
    }

    const checkToolInstalled = window.electron.checkToolInstalled;
    const candidates = Array.from(new Set([binary, ...alternativeBinaries].filter(Boolean)));
    Promise.all(candidates.map(candidate => checkToolInstalled(candidate)))
      .then((results) => {
        if (cancelled) return;
        const installed = results.find(result => result?.installed);
        const blocked = results.some(result => result?.error?.toLowerCase().includes('wsl2 unavailable'));
        if (installed) {
          setState('installed');
          setVersion(installed.version);
        } else if (blocked) {
          setState('blocked');
        } else {
          setState('missing');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        logger.error('ToolInstallIndicator', `Failed to check ${binary}`, error);
        setState('unknown');
      });

    return () => {
      cancelled = true;
    };
  }, [binary, alternativeBinaries]);

  const handleCopyInstall = async () => {
    try {
      const info = await window.electron?.getInstallCommand?.(binary);
      const command = info?.info?.command;
      if (command && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (error) {
      logger.error('ToolInstallIndicator', `Failed to get install command for ${binary}`, error);
    }
  };

  if (state === 'unknown') return null;

  return (
    <div className={`flex items-center gap-2 text-xs ${className || ''}`}>
      {state === 'checking' && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Checking {displayName}...
        </span>
      )}

      {state === 'installed' && (
        <span className="flex items-center gap-1.5 text-green-500 font-medium" title={version}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          {displayName} installed{version && version !== 'Installed' ? ` (${version})` : ''}
        </span>
      )}

      {state === 'missing' && (
        <span className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400 font-medium">
          <AlertTriangle className="w-3.5 h-3.5" />
          {displayName} not found
          <button
            type="button"
            onClick={handleCopyInstall}
            className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-yellow-500/40 hover:bg-yellow-500/10 transition-colors"
            title={`Copy command to install ${displayName}`}
          >
            <Copy className="w-3 h-3" />
            {copied ? 'Copied!' : 'Copy install'}
          </button>
        </span>
      )}

      {state === 'blocked' && (
        <span className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 font-medium">
          <AlertTriangle className="w-3.5 h-3.5" />
          WSL2 unavailable; {displayName} was not checked
        </span>
      )}
    </div>
  );
}
