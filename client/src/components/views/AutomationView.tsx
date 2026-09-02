import React, { useEffect, useState, useRef } from 'react';
import { Play, Upload, FolderOpen, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useScanner } from '@/lib/scanner-context';
import { useToast } from '@/components/ui/toast';
import { AutomationManager } from '@/lib/automation-manager';
import { useAutomationStore } from '@/lib/automation-store';
import { parseAutomationTargets, splitAutomationTarget } from '@/lib/automation-targets';

export function AutomationView() {
  const { addTab, runScan, updateTabOptions } = useScanner();
  const { showToast } = useToast();
  const {
    ipList,
    saveLocation,
    customFlags,
    selectedPreset,
    executionMode,
    options,
    setIpList,
    setSaveLocation,
    setCustomFlags,
    setSelectedPreset,
    setExecutionMode,
    setOptions,
  } = useAutomationStore();
  const [targetCustomFlags, setTargetCustomFlags] = useState<Record<number, string>>({});
  const [showPathDialog, setShowPathDialog] = useState(false);
  const pendingAutoScan = useRef<string | null>(null);
  const isWindows = window.electron?.platform === 'win32';
  const [tempPath, setTempPath] = useState(isWindows ? 'C:\\Scans\\Results' : '~/scans/results');
  // executionMode and options are persisted by useAutomationStore.
  const [scansCompleted, setScansCompleted] = useState(0); // FIX: Track real stats
  const [liveHostsFound, setLiveHostsFound] = useState(0); // FIX: Track real stats

  useEffect(() => {
    if (!showPathDialog) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowPathDialog(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showPathDialog]);
  // Throttle toast notifications to prevent spam
  const lastToastTime = useRef<Record<string, number>>({});
  const throttledToast = (message: string, type: 'success' | 'error' | 'info', key: string = message) => {
    const now = Date.now();
    const lastTime = lastToastTime.current[key] || 0;
    
    // Only show toast if 1 second has passed since last toast with same key
    if (now - lastTime > 1000) {
      showToast(message, type);
      lastToastTime.current[key] = now;
    }
  };

  const targetStats = parseAutomationTargets(ipList);

  const handleApplyPreset = (flags: string, presetName: string) => {
    setCustomFlags(flags);
    setSelectedPreset(presetName);
    
    // Append flags to each IP in the textarea
    if (ipList.trim()) {
      const lines = ipList.split('\n');
      const updatedLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        
        // Remove any existing flags (anything after the IP/hostname)
        const ipMatch = trimmed.match(/^([^\s]+)/);
        if (ipMatch) {
          return `${ipMatch[1]} ${flags}`;
        }
        return line;
      });
      setIpList(updatedLines.join('\n'));
    }
    
    throttledToast(`${presetName} preset applied`, 'success', `preset-${presetName}`);
  };

  const handleStartBatchScan = async (inputOverride?: string) => {
    const stats = parseAutomationTargets(inputOverride ?? ipList);
    if (stats.valid.length === 0) {
      showToast('Please enter at least one valid IP address or hostname', 'error');
      return;
    }

    // This is a desktop workflow. Do not create tabs or count an automation
    // job as started in the browser preview where no process can be launched.
    if (!window.electron) {
      showToast(`${executionMode === 'background' ? 'Background' : 'Console'} scans require the desktop app runtime`, 'error');
      return;
    }

    // 🔒 SECURITY: Check automation limits before proceeding
    try {
      await AutomationManager.validateAutomationAdd();
    } catch (error: any) {
      showToast(error.message, 'error');
      return;
    }

    showToast(`Starting batch scan of ${stats.valid.length} targets...`, 'info');

    // Record automation creation for limits tracking
    AutomationManager.recordAutomationCreated();
    
    // FIX: Reset stats for new batch
    setScansCompleted(0);
    setLiveHostsFound(0);

    // FIX: Handle background mode differently
    if (executionMode === 'background') {
      showToast('Background scans started without opening terminals', 'info');
      await runBackgroundBatch(stats.valid);
      return;
    }

    // Create a tab for each target and start scanning
    for (const target of stats.valid) {
      // Parse target to extract IP and flags
      const { target: targetIP, flags } = splitAutomationTarget(target);
      
      const newTabId = addTab(targetIP);
      // addTab returns the id immediately; React does not need a delay here.
      
      // Find the newly created tab
      if (newTabId) {
        // Apply custom flags if present
        if (flags.length > 0) {
          await updateTabOptions(newTabId, flags);
        }
        
        // Preserve custom flags that are not represented by the visual Nmap
        // option catalogue. The command builder quotes and forwards them.
        void runScan(newTabId, targetIP, false, flags);
        
        // FIX: Increment completed counter (optimistic)
        setScansCompleted(prev => prev + 1);
      }
    }

    showToast(`Batch scan started - ${stats.valid.length} scans running`, 'success');
  };

  useEffect(() => {
    const importedTargets = pendingAutoScan.current;
    if (!importedTargets || !options.autoScan) return;

    // Consume the request before starting so a state update cannot retrigger it.
    pendingAutoScan.current = null;
    void handleStartBatchScan(importedTargets);
  }, [ipList, options.autoScan, executionMode, saveLocation, customFlags, selectedPreset]);

  const sanitizeFileName = (value: string) =>
    value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 90) || 'target';

  const downloadResult = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 250);
  };

  const saveBackgroundResult = async (target: string, output: string, index: number) => {
    if (!output.trim()) return;
    const isLive = /host is up|open\/(tcp|udp)|accessible|live/i.test(output);
    if (options.liveOnly && !isLive) return;

    const safeTarget = sanitizeFileName(target.split(/\s+/)[0]);
    const filename = `${safeTarget}-${Date.now()}-${index + 1}.txt`;
    const content = options.noSummary
      ? output
      : `OsecBox Automation Result\nTarget: ${target}\nCaptured: ${new Date().toISOString()}\nLive evidence: ${isLive ? 'yes' : 'not detected'}\n\n${output}`;
    const pathSeparator = window.electron?.platform === 'win32' ? '\\' : '/';
    const directory = options.separateFolders && saveLocation
      ? `${saveLocation.replace(/[\\/]$/, '')}${pathSeparator}${safeTarget}`
      : saveLocation;

    if (directory && window.electron?.saveAutomationResult) {
      const saved = await window.electron.saveAutomationResult({ directory, filename, content });
      if (saved.success) return;
      showToast(`Could not save ${safeTarget}: ${saved.error || 'unknown error'}`, 'error');
    }

    downloadResult(filename, content);
  };

  const executeBackgroundScan = async (target: string, flags: string[]) => {
    if (!window.electron) throw new Error('Electron API not available');
    const scanId = `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cleanTarget = target.split(/\s+/)[0];
    const result = await window.electron.executeNmap({ target: cleanTarget, flags, scanId });
    if (!result.success) throw new Error(result.error || 'Scan failed');
    return result.output || 'Scan completed with no textual output.';
  };

  const runBackgroundBatch = async (targets: string[]) => {
    let nextIndex = 0;
    let successful = 0;
    let failed = 0;
    const worker = async () => {
      while (nextIndex < targets.length) {
        const index = nextIndex++;
        const target = targets[index];
        const { target: targetIP, flags } = splitAutomationTarget(target);
        try {
          const output = await executeBackgroundScan(targetIP, flags);
          await saveBackgroundResult(target, output, index);
          successful += 1;
          setScansCompleted(prev => prev + 1);
          if (/host is up|open\/(tcp|udp)|accessible|live/i.test(output)) {
            setLiveHostsFound(prev => prev + 1);
          }
        } catch (error: any) {
          failed += 1;
          showToast(`${targetIP} failed: ${error?.message || 'scan failed'}`, 'error');
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()));
    if (failed === 0) {
      showToast(`Background batch finished: ${successful} scan${successful === 1 ? '' : 's'} completed`, 'success');
    } else if (successful > 0) {
      showToast(`Background batch finished: ${successful} completed, ${failed} failed`, 'info');
    } else {
      showToast(`Background batch failed: ${failed} scan${failed === 1 ? '' : 's'} failed`, 'error');
    }
    return { successful, failed };
  };

  const handleImportIPs = () => {
    // Trigger file picker
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.csv,.json';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = String(event.target?.result || '');
        if (file.name.toLowerCase().endsWith('.json')) {
          try {
            const template = JSON.parse(text);
            if (typeof template.ipList !== 'string') throw new Error('Template has no target list');
            setIpList(template.ipList);
            if (typeof template.saveLocation === 'string') setSaveLocation(template.saveLocation);
            if (typeof template.customFlags === 'string') setCustomFlags(template.customFlags);
            if (typeof template.selectedPreset === 'string') setSelectedPreset(template.selectedPreset);
            let importedAutoScan = options.autoScan;
            if (template.options && typeof template.options === 'object') {
              const importedOptions = template.options as Partial<typeof options>;
              setOptions(importedOptions);
              importedAutoScan = importedOptions.autoScan === true;
            }
            if (template.executionMode === 'console' || template.executionMode === 'background') {
              setExecutionMode(template.executionMode);
            }
            if (importedAutoScan) pendingAutoScan.current = template.ipList;
            showToast('Automation template imported', 'success');
            return;
          } catch (error: any) {
            showToast(`Invalid automation template: ${error?.message || 'invalid JSON'}`, 'error');
            return;
          }
        }
        setIpList(text);
        if (options.autoScan) pendingAutoScan.current = text;
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleSelectFolder = () => {
    setShowPathDialog(true);
  };

  const handleSavePath = () => {
    if (tempPath) {
      setSaveLocation(tempPath);
      setShowPathDialog(false);
      throttledToast(`Save location: ${tempPath}`, 'success', 'save-path');
    }
  };

  const handleSaveTemplate = () => {
    const template = {
      version: 1,
      createdAt: new Date().toISOString(),
      ipList,
      saveLocation,
      customFlags,
      selectedPreset,
      executionMode,
      options,
    };
    downloadResult(`osecbox-automation-template-${Date.now()}.json`, JSON.stringify(template, null, 2));
    throttledToast('Automation template exported', 'success', 'save-template');
  };

  const handleScanSingleTarget = async (target: string, flags: string, scanType: string) => {
    if (!window.electron) {
      showToast('Individual scans require the desktop app runtime', 'error');
      return;
    }

    // 🔒 SECURITY: Check automation limits for single scans too
    try {
      await AutomationManager.validateAutomationAdd();
    } catch (error: any) {
      showToast(error.message, 'error');
      return;
    }

    // Parse target to extract IP and any existing flags
    const { target: targetIP, flags: existingFlags } = splitAutomationTarget(target);
    
    // Combine with provided flags
    const allFlags = flags ? flags.split(/\s+/).filter(f => f.trim()) : existingFlags;
    
    const newTabId = addTab(targetIP);
    if (newTabId) {
      // Apply custom flags to the tab before scanning
      if (allFlags.length > 0) {
        await updateTabOptions(newTabId, allFlags);
      }
      
      // Record automation creation for limits tracking
      AutomationManager.recordAutomationCreated();
      
      // Run scan with applied flags
      void runScan(newTabId, targetIP, false, allFlags);
      
      const flagsStr = allFlags.length > 0 ? ` with flags: ${allFlags.join(' ')}` : '';
      throttledToast(`${scanType} scan started: ${targetIP}${flagsStr}`, 'success', `scan-${targetIP}`);
    }
  };

  return (
    <div className="flex h-full bg-background">
      {/* Main Content */}
      <div className="flex flex-col overflow-hidden w-full">
        {/* Header */}
        <div className="px-6 py-3 border-b border-border bg-secondary/30">
          <h2 className="text-lg font-semibold">Automation & Batch Scanning</h2>
          <p className="text-xs text-muted-foreground">
            Scan multiple targets, filter results, and auto-save to custom locations
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-2xl font-bold text-primary">{scansCompleted}</div>
              <div className="text-sm text-muted-foreground">Scans Started</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-2xl font-bold text-green-500">{liveHostsFound}</div>
              <div className="text-sm text-muted-foreground">Live Hosts Found</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="text-2xl font-bold text-yellow-500">{targetStats.valid.length}</div>
              <div className="text-sm text-muted-foreground">Targets Ready</div>
            </div>
          </div>

          {/* IP List Input */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-lg">Target IP List</h3>
                <p className="text-sm text-muted-foreground">
                  Enter IPs manually or import from file (one per line)
                </p>
              </div>
              <Button 
                onClick={handleImportIPs} 
                variant="outline" 
                size="sm"
                className="shadow-[0_4px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import File
              </Button>
            </div>

            {/* Scan Type Presets - Apply to All */}
            <div className="mb-3 p-3 bg-secondary/30 rounded-lg border border-border">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Quick Scan Presets (Apply to All):</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button 
                  variant={selectedPreset === 'quick' ? 'default' : 'outline'} 
                  size="sm" 
                  className="text-xs shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
                  onClick={() => handleApplyPreset('-T4 -F', 'quick')}
                >
                  🚀 Quick Scan (-T4 -F)
                </Button>
                <Button 
                  variant={selectedPreset === 'full' ? 'default' : 'outline'} 
                  size="sm" 
                  className="text-xs shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
                  onClick={() => handleApplyPreset('-sS -sV -O -p-', 'full')}
                >
                  🔍 Full Scan (-sS -sV -O -p-)
                </Button>
                <Button 
                  variant={selectedPreset === 'stealth' ? 'default' : 'outline'} 
                  size="sm" 
                  className="text-xs shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
                  onClick={() => handleApplyPreset('-sS -T2', 'stealth')}
                >
                  🥷 Stealth (-sS -T2)
                </Button>
                <Button 
                  variant={selectedPreset === 'vuln' ? 'default' : 'outline'} 
                  size="sm" 
                  className="text-xs shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
                  onClick={() => handleApplyPreset('--script vuln', 'vuln')}
                >
                  🛡️ Vuln Scan (--script vuln)
                </Button>
                <Button 
                  variant={selectedPreset === 'service' ? 'default' : 'outline'} 
                  size="sm" 
                  className="text-xs shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
                  onClick={() => handleApplyPreset('-sV', 'service')}
                >
                  🌐 Service Detection (-sV)
                </Button>
                <Button 
                  variant={selectedPreset === 'os' ? 'default' : 'outline'} 
                  size="sm" 
                  className="text-xs shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
                  onClick={() => handleApplyPreset('-O', 'os')}
                >
                  🖥️ OS Detection (-O)
                </Button>
                <Input
                  placeholder="Custom flags for all..."
                  className="h-8 w-48 text-xs border-2 border-border/80 focus:border-primary bg-background"
                  value={customFlags}
                  onChange={(e) => setCustomFlags(e.target.value)}
                />
                <Button 
                  variant="default" 
                  size="sm" 
                  className="text-xs shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
                  onClick={() => {
                    if (customFlags) {
                      setSelectedPreset('custom');
                      throttledToast(`Custom flags: ${customFlags}`, 'success', 'custom-flags');
                    }
                  }}
                >
                  Apply to All
                </Button>
              </div>
            </div>

            <textarea
              value={ipList}
              onChange={(e) => setIpList(e.target.value)}
              placeholder="192.168.1.1&#10;192.168.1.2&#10;10.0.0.0/24&#10;scanme.nmap.org"
              className="w-full h-48 px-3 py-2 bg-background border border-input rounded font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />

            <div className="mt-3 flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Total:</span>
                <span className="font-bold text-lg text-primary">
                  {targetStats.total}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Valid:</span>
                <span className="font-semibold text-green-500">
                  {targetStats.valid.length}
                </span>
              </div>
              {targetStats.invalid.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Invalid:</span>
                  <span className="font-semibold text-red-500">
                    {targetStats.invalid.length}
                  </span>
                </div>
              )}
            </div>
            
            {/* Show invalid targets */}
            {targetStats.invalid.length > 0 && (
              <div className="mt-3 p-3 bg-destructive/10 border border-destructive/30 rounded text-sm">
                <div className="font-semibold text-destructive mb-1">Invalid targets:</div>
                <div className="text-muted-foreground font-mono text-xs">
                  {targetStats.invalid.join(', ')}
                </div>
              </div>
            )}
          </div>

          {/* Scan Configuration */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-semibold text-lg mb-3">Scan Configuration</h3>
            <p className="text-sm text-muted-foreground mb-4">
              See real-time scans in Console mode or run silently in Background
            </p>
            {!window.electron && (
              <p className="text-xs text-yellow-400 mb-4 bg-yellow-500/10 p-2 rounded border border-yellow-500/30">
                Browser preview only: scan execution is disabled here. Use the packaged Electron app to run Nmap and save evidence.
              </p>
            )}

            {/* Execution Mode Selection */}
            <div className="mb-4">
              <Label className="text-xs font-semibold text-muted-foreground mb-2 block">EXECUTION MODE</Label>
              <p className="text-xs text-muted-foreground mb-2 bg-muted/40 p-2 rounded border border-border">
                Console mode opens a terminal per target. Background mode runs up to three jobs at a time without opening terminals.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setExecutionMode('console')}
                  className={`win7-button flex-1 px-4 py-2.5 flex items-center gap-2 justify-center border-2 transition-all ${
                    executionMode === 'console'
                      ? 'active ring-2 ring-blue-500/50 border-blue-500 bg-blue-500/20 text-blue-400 font-bold'
                      : 'border-border bg-card/50 text-muted-foreground hover:bg-card hover:text-foreground'
                  }`}
                >
                  <span className="text-base">🖥️</span>
                  <span className="text-sm">Console</span>
                </button>

                <button
                  type="button"
                  onClick={() => setExecutionMode('background')}
                  className={`win7-button flex-1 px-4 py-2.5 flex items-center gap-2 justify-center border-2 transition-all ${
                    executionMode === 'background'
                      ? 'active ring-2 ring-green-500/50 border-green-500 bg-green-500/20 text-green-400 font-bold'
                      : 'border-border bg-card/50 text-muted-foreground hover:bg-card hover:text-foreground'
                  }`}
                >
                  <span className="text-base">📁</span>
                  <span className="text-sm">Background</span>
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <Button 
                className="flex-1 shadow-[0_5px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[3px] active:translate-y-[4px] transition-all" 
                size="lg"
                onClick={() => void handleStartBatchScan()}
                disabled={targetStats.valid.length === 0}
              >
                <Play className="w-4 h-4 mr-2" />
                {executionMode === 'console' ? 'Start Batch Scan' : 'Start Background Scan'} ({targetStats.valid.length})
              </Button>
              <Button 
                variant="outline" 
                size="lg"
                onClick={handleSaveTemplate}
                className="shadow-[0_5px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[3px] active:translate-y-[4px] transition-all"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Template
              </Button>
            </div>
          </div>

          {/* Save Options */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="font-semibold text-lg mb-3">Save Options</h3>
            <p className="text-xs text-muted-foreground mb-3 bg-muted/40 p-2 rounded border border-border">
              Background results are saved to this directory when it is writable; otherwise OsecBox downloads the result so it is never lost.
            </p>

            <div className="space-y-4">
              {/* Save Location */}
              <div>
                <Label htmlFor="save-location">Save Location</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="save-location"
                    value={saveLocation}
                    onChange={(e) => setSaveLocation(e.target.value)}
                    placeholder={isWindows ? 'C:\\Scans\\Results' : '~/scans/results'}
                    className="flex-1 font-mono text-sm"
                  />
                  <Button 
                    onClick={handleSelectFolder} 
                    variant="outline"
                    className="shadow-[0_4px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    Browse
                  </Button>
                </div>
              </div>

              {/* Checkboxes */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="live-only"
                    checked={options.liveOnly}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, liveOnly: checked as boolean })
                    }
                  />
                  <label
                    htmlFor="live-only"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Save live IPs only (filter out offline hosts)
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="no-summary"
                    checked={options.noSummary}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, noSummary: checked as boolean })
                    }
                  />
                  <label
                    htmlFor="no-summary"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Save raw output only (no summary/analysis)
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="separate-folders"
                    checked={options.separateFolders}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, separateFolders: checked as boolean })
                    }
                  />
                  <label
                    htmlFor="separate-folders"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Create separate folder for each IP
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="auto-scan"
                    checked={options.autoScan}
                    onCheckedChange={(checked) =>
                      setOptions({ ...options, autoScan: checked as boolean })
                    }
                  />
                  <label
                    htmlFor="auto-scan"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Auto-scan on import (start immediately)
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Parsed Targets Preview with Scan Types */}
          {targetStats.valid.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-semibold text-lg mb-3">Parsed Targets ({targetStats.valid.length})</h3>
              <div className="max-h-96 overflow-y-auto space-y-2">
                {targetStats.valid.map((target, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 px-3 py-2 bg-secondary/30 rounded border border-border/50 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                      {idx + 1}
                    </div>
                    <span className="font-mono text-sm flex-1">{target}</span>
                    
                    {/* Scan Type Buttons */}
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs shadow-[0_2px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[1px] active:translate-y-[2px] transition-all"
                        title="Quick Scan (-T4 -F)"
                        onClick={() => handleScanSingleTarget(target, '-T4 -F', 'Quick')}
                      >
                        Quick
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs shadow-[0_2px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[1px] active:translate-y-[2px] transition-all"
                        title="Full Scan (-sS -sV -O -p-)"
                        onClick={() => handleScanSingleTarget(target, '-sS -sV -O -p-', 'Full')}
                      >
                        Full
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs shadow-[0_2px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[1px] active:translate-y-[2px] transition-all"
                        title="Stealth Scan (-sS -T2)"
                        onClick={() => handleScanSingleTarget(target, '-sS -T2', 'Stealth')}
                      >
                        Stealth
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs shadow-[0_2px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[1px] active:translate-y-[2px] transition-all"
                        title="Vuln Scan (--script vuln)"
                        onClick={() => handleScanSingleTarget(target, '--script vuln', 'Vuln')}
                      >
                        Vuln
                      </Button>
                      <Input
                        placeholder="Custom flags..."
                        className="h-7 w-32 text-xs"
                        title="Enter custom nmap flags"
                        value={targetCustomFlags[idx] || ''}
                        onChange={(e) => setTargetCustomFlags({ ...targetCustomFlags, [idx]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && targetCustomFlags[idx]) {
                            handleScanSingleTarget(target, targetCustomFlags[idx], 'Custom');
                          }
                        }}
                      />
                    </div>
                    
                    <div className="ml-2">
                      <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-500 border border-green-500/30">
                        Ready
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Path Input Dialog */}
      {showPathDialog && (
        <div
          className="ui-dialog-overlay fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-location-title"
          aria-describedby="save-location-description"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowPathDialog(false);
            }
          }}
        >
          <div className="ui-popover-enter bg-card rounded-lg border border-border shadow-2xl w-full max-w-md">
            <div className="p-5 border-b border-border">
              <h3 id="save-location-title" className="text-lg font-semibold text-foreground">Set Save Location</h3>
              <p id="save-location-description" className="text-sm text-muted-foreground mt-1">Enter the path where scan results will be saved</p>
            </div>
            <div className="p-5">
              <Input
                value={tempPath}
                onChange={(e) => setTempPath(e.target.value)}
                placeholder={isWindows ? 'C:\\Scans\\Results' : '~/scans/results'}
                className="font-mono"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSavePath();
                  } else if (e.key === 'Escape') {
                    setShowPathDialog(false);
                  }
                }}
              />
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowPathDialog(false)}
                className="shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSavePath}
                className="shadow-[0_3px_0_0_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.3)] active:shadow-[0_0px_0_0_rgba(0,0,0,0.3)] hover:translate-y-[2px] active:translate-y-[3px] transition-all"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
