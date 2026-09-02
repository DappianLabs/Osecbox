/**
 * WSL2 Setup Dialog Component
 * 
 * Provides step-by-step instructions for installing and configuring WSL2
 */

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, Copy, ExternalLink, Terminal, RefreshCw } from 'lucide-react';
import { usePlatform } from '@/hooks/usePlatform';
import { useToast } from '@/components/ui/toast';

interface WSL2SetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WSL2SetupDialog({ open, onOpenChange }: WSL2SetupDialogProps) {
  const { platformInfo, refresh, isLoading } = usePlatform();
  const { showToast } = useToast();
  const [instructions, setInstructions] = useState<string[]>([]);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open && window.electron) {
      window.electron.getWSL2Instructions().then((result) => {
        if (result.success && result.instructions) {
          setInstructions(Array.isArray(result.instructions) ? result.instructions : result.instructions.steps);
        }
      });
    }
  }, [open]);

  const copyCommand = (command: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(command);
      showToast('Command copied to clipboard', 'success');
    }
  };

  const toggleStep = (index: number) => {
    setCompletedSteps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const handleRefresh = async () => {
    await refresh();
    showToast('Platform info refreshed', 'info');
  };

  const isWSL2Available = platformInfo?.wsl2Status === 'available';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            WSL2 Setup Guide
          </DialogTitle>
          <DialogDescription>
            {isWSL2Available ? (
              <span className="text-green-600 dark:text-green-400 font-medium">
                ✓ WSL2 is installed and ready!
              </span>
            ) : (
              'Follow these steps to install WSL2 and enable Linux tools on Windows'
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Current Status */}
            <div className="bg-muted/50 border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Current Status</h3>
                <Button
                  onClick={handleRefresh}
                  variant="ghost"
                  size="sm"
                  disabled={isLoading}
                  className="h-7"
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Platform:</span>
                  <span className="font-mono">{platformInfo?.platform || 'Unknown'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">WSL2 Status:</span>
                  <span className={`font-medium ${isWSL2Available ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {platformInfo?.wsl2Status || 'Checking...'}
                  </span>
                </div>
                {platformInfo?.wsl2Error && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 break-words">
                    {platformInfo.wsl2Error}
                  </p>
                )}
                {platformInfo?.wsl2Version && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Version:</span>
                    <span className="font-mono">{platformInfo.wsl2Version}</span>
                  </div>
                )}
                {platformInfo?.defaultDistro && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Default Distro:</span>
                    <span className="font-mono">{platformInfo.defaultDistro}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Installation Steps */}
            {!isWSL2Available && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Installation Steps</h3>
                {instructions.map((instruction, index) => {
                  const isCompleted = completedSteps.has(index);
                  const commandMatch = instruction.match(/Run: (.+)$/);
                  const command = commandMatch ? commandMatch[1] : null;

                  return (
                    <div
                      key={index}
                      className={`border rounded-lg p-3 transition-colors ${
                        isCompleted
                          ? 'bg-green-500/5 border-green-500/20'
                          : 'bg-card border-border'
                      }`}
                    >
                      <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => toggleStep(index)}
                          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isCompleted
                              ? 'bg-green-500 border-green-500'
                              : 'border-muted-foreground hover:border-primary'
                          }`}
                        >
                          {isCompleted && <CheckCircle className="w-3 h-3 text-white" />}
                        </button>
                        <div className="flex-1">
                          <p className={`text-sm ${isCompleted ? 'line-through text-muted-foreground' : ''}`}>
                            {instruction}
                          </p>
                          {command && (
                            <div className="mt-2 flex items-center gap-2">
                              <code className="flex-1 bg-muted px-3 py-1.5 rounded text-xs font-mono">
                                {command}
                              </code>
                              <Button
                                onClick={() => copyCommand(command)}
                                variant="ghost"
                                size="sm"
                                className="h-7"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Additional Resources */}
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Additional Resources
              </h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a
                    href="https://learn.microsoft.com/en-us/windows/wsl/install"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Official WSL2 Installation Guide
                  </a>
                </li>
                <li>
                  <a
                    href="https://learn.microsoft.com/en-us/windows/wsl/basic-commands"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    WSL2 Basic Commands
                  </a>
                </li>
                <li>
                  <a
                    href="https://learn.microsoft.com/en-us/windows/wsl/troubleshooting"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    WSL2 Troubleshooting
                  </a>
                </li>
              </ul>
            </div>

            {/* Tool Installation */}
            {isWSL2Available && (
              <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
                <h3 className="text-sm font-semibold mb-2">Install Security Tools</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Now that WSL2 is ready, install the required security tools:
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted px-3 py-1.5 rounded text-xs font-mono">
                      sudo apt update && sudo apt install -y nmap nikto
                    </code>
                    <Button
                      onClick={() => copyCommand('sudo apt update && sudo apt install -y nmap nikto')}
                      variant="ghost"
                      size="sm"
                      className="h-7"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted px-3 py-1.5 rounded text-xs font-mono">
                      go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
                    </code>
                    <Button
                      onClick={() => copyCommand('go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest')}
                      variant="ghost"
                      size="sm"
                      className="h-7"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Close
          </Button>
          {isWSL2Available && (
            <Button onClick={() => onOpenChange(false)} className="bg-green-600 hover:bg-green-500">
              <CheckCircle className="w-4 h-4 mr-2" />
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
