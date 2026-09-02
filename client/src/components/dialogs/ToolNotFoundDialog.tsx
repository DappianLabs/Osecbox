import { useState, useEffect } from 'react';
import { Copy, Terminal, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ToolNotFoundDialogProps {
  tool: string;
  open: boolean;
  onClose: () => void;
}

export function ToolNotFoundDialog({ tool, open, onClose }: ToolNotFoundDialogProps) {
  const [copied, setCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installInfo, setInstallInfo] = useState<any>(null);
  const [installScript, setInstallScript] = useState<string | null>(null);

  useEffect(() => {
    if (open && tool) {
      void loadInstallInfo();
    } else if (!open) {
      setCopied(false);
      setScriptCopied(false);
    }
  }, [open, tool]);

  async function loadInstallInfo() {
    setLoading(true);
    setError(null);
    setInstallInfo(null);
    setInstallScript(null);

    try {
      const [commandResult, scriptResult] = await Promise.all([
        window.electron?.getInstallCommand(tool),
        window.electron?.getInstallScript?.([tool]),
      ]);
      if (commandResult?.success) {
        setInstallInfo(commandResult.info);
      } else if (commandResult?.error) {
        setError(commandResult.error);
      }
      if (scriptResult?.success && scriptResult.script) {
        setInstallScript(scriptResult.script);
      }
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load installation guidance');
    } finally {
      setLoading(false);
    }
  }

  async function copyCommand() {
    if (installInfo?.command && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(installInfo.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function copySetupScript() {
    if (installScript && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(installScript);
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 2000);
    }
  }

  async function runInTerminal() {
    const command = String(installInfo?.command || '').trim();
    if (!command) return;

    // A native Windows fallback may be a download URL rather than a shell
    // command. Keep that visible instead of placing non-executable text into
    // the terminal.
    if (/^(download|#\s*install)\b/i.test(command)) {
      setError('This tool needs a manual installation. Use the guide or copy the command shown above.');
      return;
    }

    const result = await window.electron?.openTerminalWithCommand(command);
    if (result?.success) {
      onClose();
    } else {
      setError(result?.error || 'The OsecBox terminal could not be opened');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            {tool} not found
          </DialogTitle>
          <DialogDescription>
            {tool} is required but was not found in the runtime OsecBox uses.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="text-sm text-muted-foreground">Loading runtime-aware installation guidance…</div>
        )}

        {error && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3 text-sm text-amber-300">
            {error}
          </div>
        )}

        {installInfo && <div className="space-y-4">
          {/* Install command */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Install with {installInfo.packageManager}:
            </label>
            <div className="relative">
              <pre className="bg-muted p-3 rounded-md text-sm overflow-x-auto">
                <code>{installInfo.command}</code>
              </pre>
              <Button
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={copyCommand}
              >
                {copied ? 'Copied!' : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Notes */}
          {installInfo.notes && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3">
              <p className="text-sm text-blue-400">{installInfo.notes}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button onClick={runInTerminal} className="flex-1">
              <Terminal className="w-4 h-4 mr-2" />
              Open in Terminal
            </Button>
            {installScript && (
              <Button onClick={copySetupScript} variant="outline">
                <Copy className="w-4 h-4 mr-2" />
                {scriptCopied ? 'Script copied' : 'Copy script'}
              </Button>
            )}
            <Button onClick={copyCommand} variant="outline">
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
          </div>

          {/* Manual install link */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => window.open(`https://github.com/search?q=${tool}`, '_blank')}
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Manual installation guide
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
