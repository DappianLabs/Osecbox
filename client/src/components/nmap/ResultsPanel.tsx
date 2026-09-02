
import React, { useState, useEffect } from 'react';
import { useScanner } from '@/lib/scanner-context';
import { ChevronDown, ChevronRight, Globe, Server, Shield, Activity, ExternalLink, Clock, X, Trash2 } from 'lucide-react';
import { parseCommandOutput } from '@/lib/command-parser';
import { parseUniversalOutput } from '@/lib/universal-parser';
import { CommandResultCard } from './CommandResultCard';
import { NmapResultsCard } from './NmapResultsCard';
import { UniversalResultsPanel } from '@/components/scanners/UniversalResultsPanel';
import { ErrorSummaryPanel } from '@/components/scanners/ErrorSummaryPanel';
import { RawOutputPreview } from '@/components/scanners/RawOutputPreview';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScannerResultsView } from '@/components/scanners/ScannerResultsView';
import { getLatestScanTranscript } from '@/lib/scanner/scan-transcript';

interface CommandHistory {
  id: string;
  timestamp: Date;
  command: string;
  result: any; // Can be CommandResult or UniversalResult
  type: 'command' | 'universal';
}

export function ResultsPanel({ isSectionActive = true }: { isSectionActive?: boolean } = {}) {
  const { tabs, activeTabId, runScan, clearErrors, resetCurrentTab } = useScanner();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  
  const [commandHistory, setCommandHistory] = useState<CommandHistory[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [lastProcessedOutput, setLastProcessedOutput] = useState<string>('');
  const [liveNmapOutput, setLiveNmapOutput] = useState<string>('');

  // History is a view-local convenience, not engagement state. Reset it when
  // moving between scan tabs so a previous target cannot look like the
  // current scan's recent result.
  useEffect(() => {
    setCommandHistory([]);
    setSelectedHistoryId(null);
    setLastProcessedOutput('');
    setLiveNmapOutput('');
  }, [activeTabId]);

  // Keep the results surface honest even when a parser returns zero findings
  // or the tool exits before producing its normal completion banner. The
  // terminal remains the source of truth; this bounded poll only mirrors its
  // current transcript into the result panel and never stores a second copy
  // in scanner React state.
  useEffect(() => {
    if (!isSectionActive || !activeTab || activeTab.scannerType !== 'nmap') {
      setLiveNmapOutput('');
      return;
    }

    let disposed = false;
    let lastSignature = '';

    const readOutput = async () => {
      try {
        const { terminalService } = await import('@/lib/terminal-service');
        const output = terminalService.getOutput(`${activeTab.id}::nmap`) || activeTab.terminalOutput.join('\n');
        const signature = `${output.length}:${output.slice(-160)}`;
        if (disposed || signature === lastSignature) return;
        lastSignature = signature;
        setLiveNmapOutput(output);
      } catch (error) {
        if (!disposed) console.warn('[ResultsPanel] Failed to mirror Nmap terminal output:', error);
      }
    };

    void readOutput();
    const interval = window.setInterval(() => { void readOutput(); }, 1000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [isSectionActive, activeTabId, activeTab?.id, activeTab?.scannerType, activeTab?.isScanning]);

  // Parse terminal output and ADD to history (don't replace)
  useEffect(() => {
    if (!isSectionActive || !activeTab || activeTab.scannerType !== 'nmap' || activeTab.results.length > 0) {
      return;
    }

    // FIX: Get output from terminal buffer instead of React state
    let output = '';
    try {
      const { terminalService } = require('@/lib/terminal-service');
      output = terminalService.getOutput(`${activeTab.id}::nmap`) || '';
    } catch (error) {
      // Fallback to React state
      output = activeTab.terminalOutput.join('\n');
    }

    const lastCommand = activeTab.target || '';
    const currentRunOutput = getLatestScanTranscript(output);
    
    // Only process if output changed and we have a command
    if (!currentRunOutput || !lastCommand || output === lastProcessedOutput) {
      return;
    }

    // Check if scan just completed (was scanning, now not)
    if (!activeTab.isScanning && output.length > 100) {
      setLastProcessedOutput(output);
      
      // For nmap, use the dedicated nmap parser, not universal parser
      const parsed = parseCommandOutput(lastCommand, currentRunOutput);
      if (parsed) {
        const newId = `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setCommandHistory(prev => [{
          id: newId,
          timestamp: new Date(),
          command: lastCommand,
          result: parsed,
          type: 'command'
        }, ...prev]);
        setSelectedHistoryId(newId);
      }
      // DON'T fall back to universal parser for nmap - it creates confusing UI
      // The nmap context will handle parsing and setting activeTab.results
    }
  }, [isSectionActive, activeTab?.target, activeTab?.isScanning, activeTab?.results, activeTab?.scannerType, lastProcessedOutput]);

  // NOW safe to do early returns - all hooks have been called
  if (activeTab?.scannerType && activeTab.scannerType !== 'nmap') {
    // FIX: Get terminal output from buffer for non-nmap scanners
    let terminalOutputString = '';
    try {
      const { terminalService } = require('@/lib/terminal-service');
      terminalOutputString = terminalService.getOutput(`${activeTab.id}::${activeTab.scannerType || 'nmap'}`) || '';
    } catch (error) {
      // Fallback to React state
      terminalOutputString = activeTab.terminalOutput.join('\n');
    }

    return (
      <ScannerResultsView
        key={activeTab.scannerType}
        scannerType={activeTab.scannerType}
        terminalOutput={terminalOutputString}
        isScanning={!!activeTab.scanningByScanner?.[activeTab.scannerType || 'nmap']}
        sessionId={`${activeTab.id}::${activeTab.scannerType || 'nmap'}`}
        isActive={isSectionActive}
        />
    );
  }

  if (!activeTab) return null;

  const selectedHistory = commandHistory.find(h => h.id === selectedHistoryId);

  const deleteHistory = (id: string) => {
    setCommandHistory(prev => prev.filter(h => h.id !== id));
    if (selectedHistoryId === id) {
      setSelectedHistoryId(commandHistory[0]?.id || null);
    }
  };

  const clearAllHistory = () => {
    setCommandHistory([]);
    setSelectedHistoryId(null);
    setLastProcessedOutput('');
  };

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  // Show command history with sidebar (like Nikto/Nuclei) - ONLY if no results in activeTab
  if (commandHistory.length > 0 && activeTab.results.length === 0 && !activeTab.isScanning) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-background">
        {/* History Sidebar */}
        <div className="w-64 border-r border-border bg-card flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm text-foreground">Command History</h3>
              <p className="text-xs text-muted-foreground">{commandHistory.length} commands</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => resetCurrentTab(activeTab.id)}
                className="h-7 text-xs"
              >
                New Scan
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearAllHistory}
                className="h-7 text-xs"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Clear All
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-2">
              {commandHistory.map((history) => (
                <div
                  key={history.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedHistoryId === history.id}
                  onClick={() => setSelectedHistoryId(history.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    setSelectedHistoryId(history.id);
                  }}
                  className={cn(
                    "w-full p-3 rounded-lg border text-left transition-all relative group cursor-pointer",
                    selectedHistoryId === history.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <code className="text-xs font-mono text-foreground truncate block">
                        {history.command}
                      </code>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteHistory(history.id);
                      }}
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{formatTimeAgo(history.timestamp)}</span>
                  </div>
                  <div className="mt-2">
                    <Badge variant="secondary" className="text-xs">
                      {history.type === 'command' ? history.result.type : 'scan'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Error Summary */}
          {activeTab.errors && activeTab.errors.length > 0 && (
            <div className="p-2">
              <ErrorSummaryPanel
                errors={activeTab.errors}
                onRetry={() => {
                  clearErrors(activeTab.id);
                  runScan(activeTab.id, activeTab.target, false, []);
                }}
                onClear={() => clearErrors(activeTab.id)}
              />
            </div>
          )}

          {/* Selected Result */}
          <div className="flex-1 overflow-hidden">
            {selectedHistory ? (
              <div className="h-full overflow-y-auto">
                {selectedHistory.type === 'command' ? (
                  <div className="p-2">
                    <CommandResultCard result={selectedHistory.result} />
                  </div>
                ) : (
                  <UniversalResultsPanel result={selectedHistory.result} isScanning={false} />
                )}
                <RawOutputPreview rawOutput={liveNmapOutput} title="Nmap terminal output" />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <p>Select a command from history</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (activeTab.results.length === 0 && !activeTab.isScanning) {
    if (liveNmapOutput.trim()) {
      return (
        <div className="flex-1 flex flex-col overflow-y-auto min-h-0 bg-background">
          {activeTab.errors && activeTab.errors.length > 0 && (
            <div className="p-2">
              <ErrorSummaryPanel
                errors={activeTab.errors}
                onRetry={() => {
                  clearErrors(activeTab.id);
                  runScan(activeTab.id, activeTab.target, false, []);
                }}
                onClear={() => clearErrors(activeTab.id)}
              />
            </div>
          )}
          <div className="flex-1 flex flex-col items-center justify-center min-h-[180px] text-muted-foreground">
            <Server className="w-12 h-12 mb-3 stroke-1" />
            <p className="text-base font-medium">No structured Nmap findings</p>
            <p className="text-xs text-center max-w-md px-4">The command produced output, but no host/port records were parsed. Review the raw transcript below.</p>
          </div>
          <RawOutputPreview rawOutput={liveNmapOutput} title="Nmap terminal output" />
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-0 text-muted-foreground opacity-40">
        <Server className="w-16 h-16 mb-4 stroke-1" />
        <p className="text-lg font-medium">No scan results yet</p>
        <p className="text-sm">Enter a target and click SCAN to begin</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => resetCurrentTab(activeTab.id)}
        >
          Start New Scan
        </Button>
      </div>
    );
  }

  // Show results when they exist, even if still scanning
  if (activeTab.results.length > 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3 bg-background/50 smooth-scroll">
          {/* ERROR SUMMARY: Show errors at top */}
          {activeTab.errors && activeTab.errors.length > 0 && (
            <div>
              <ErrorSummaryPanel
                errors={activeTab.errors}
                onRetry={() => {
                  clearErrors(activeTab.id);
                  runScan(activeTab.id, activeTab.target, false, []);
                }}
                onClear={() => clearErrors(activeTab.id)}
              />
            </div>
          )}

          {/* NMAP RESULTS: Use dedicated card component */}
          <NmapResultsCard results={activeTab.results} target={activeTab.target} />
          <RawOutputPreview rawOutput={liveNmapOutput} title="Nmap terminal output" />
        </div>
      </div>
    );
  }

  // Show scanning state
  if (activeTab.isScanning) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-0 bg-background overflow-y-auto">
        <div className="text-center max-w-sm select-none">
          <Server className="w-14 h-14 text-primary/70 mx-auto mb-5" strokeWidth={1.5} />
          
          <p className="text-base font-semibold text-foreground mb-4">Scanning in Progress</p>
          
          <div className="flex items-end justify-center gap-[5px] h-[18px] overflow-hidden">
            {[0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84].map((delay, i) => (
              <span
                key={i}
                className="block w-[7px] h-[7px] rounded-full bg-primary animate-bounce-dot"
                style={{ animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          
          <p className="text-xs text-muted-foreground mt-5">
            Nmap is scanning {activeTab.target}. Results will appear here as they're discovered.
          </p>
        </div>
        <RawOutputPreview rawOutput={liveNmapOutput} title="Nmap terminal output" className="w-full max-w-3xl" />
      </div>
    );
  }
}
const ResultCard = React.memo(function ResultCard({ result, onOpenNewTab }: { result: any, onOpenNewTab: (ip: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div 
          className={cn(
            "bg-card border-2 border-border rounded-lg overflow-hidden smooth-colors hover-lift shadow-lg",
            expanded ? "ring-2 ring-primary/20 shadow-xl border-primary/30" : "hover:border-primary/50 hover:shadow-xl"
          )}
        >
          {/* Card Header */}
          <div
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} results for ${result.ip}`}
            className="flex items-center justify-between px-3 py-2.5 cursor-pointer bg-card hover:bg-muted/30 transition-colors"
            onClick={() => setExpanded(!expanded)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              setExpanded((current) => !current);
            }}
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                 {expanded ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
                 <div className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]" />
                 <span className="font-mono text-sm font-semibold text-foreground tracking-tight">{result.ip}</span>
              </div>
              <div className="h-3 w-px bg-border" />
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                 <span className="text-green-600 dark:text-green-400 font-medium text-[11px]">{result.ports.length} ports</span>
                 {result.hostname && <span className="text-[9px] opacity-50">({result.hostname})</span>}
              </div>
            </div>
            
            <div className="flex items-center gap-1.5">
               {result.os && (
                   <Badge variant="outline" className="bg-muted/20 border-border text-xs font-semibold text-muted-foreground px-2 py-0.5">
                      {result.os.includes('Windows') ? <MonitorIcon className="w-3 h-3 mr-1" /> : <Server className="w-3 h-3 mr-1" />}
                      {result.os}
                   </Badge>
               )}
               <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0">{result.latency}</Badge>
            </div>
          </div>

          {/* Expanded Content */}
          {expanded && (
            <div className="border-t border-border bg-muted/10 animate-in slide-in-from-top-2 duration-200 relative">
              <div className="max-h-[400px] overflow-y-auto overflow-x-hidden">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2 p-2">
                  {/* Metadata Column */}
                  <div className="space-y-2">
                     <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 sticky top-0 bg-muted/90 py-1 z-20 backdrop-blur-md -mx-2 px-2 border-b border-border/50">Target Metadata</h4>
                   <div className="space-y-2 text-base">
                      <div className="flex justify-between py-2 border-b border-border/50">
                        <span className="text-muted-foreground font-semibold">Hostname</span>
                        <span className="font-mono text-foreground font-bold">{result.hostname || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-border/50">
                        <span className="text-muted-foreground font-semibold">MAC Address</span>
                        <span className="font-mono text-foreground font-bold">{result.mac || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-border/50">
                        <span className="text-muted-foreground font-semibold">Vendor</span>
                        <span className="text-foreground font-bold">{result.vendor || 'Unknown'}</span>
                      </div>
                   </div>
                </div>

                  {/* AI Insights Column */}
                  <div className="space-y-1.5">
                     <h4 className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1.5 flex items-center gap-1.5 sticky top-0 bg-muted/90 py-2 z-20 backdrop-blur-md -mx-3 px-3 border-b border-border/50">
                        <SparklesIcon className="w-2.5 h-2.5" /> AI Insights
                     </h4>
                   <div className="bg-card border border-border rounded-md p-4 space-y-3 shadow-sm">
                      {result.aiInsights?.map((insight: string, i: number) => (
                          <div key={i} className="flex gap-3 text-base text-foreground leading-relaxed">
                              <span className="text-lg">{insight.startsWith('💡') ? '💡' : insight.startsWith('⚠️') ? '⚠️' : '•'}</span>
                              <span className="font-semibold">{insight.substring(2)}</span>
                          </div>
                      ))}
                   </div>
                </div>
              </div>

                {/* Ports Table */}
                <div className="px-3 pb-3">
                  <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 sticky top-0 bg-muted/90 py-2 z-20 backdrop-blur-md -mx-3 px-3 border-b border-border/50">Detected Services</h4>
                  <div className="rounded-md border border-border overflow-hidden shadow-sm">
                      <table className="w-full text-base text-left">
                          <thead className="bg-muted text-xs uppercase text-muted-foreground sticky top-[46px] z-10">
                              <tr>
                                  <th className="px-4 py-3 font-bold bg-muted">Port</th>
                                  <th className="px-4 py-3 font-bold bg-muted">State</th>
                                  <th className="px-4 py-3 font-bold bg-muted">Service</th>
                                  <th className="px-4 py-3 font-bold bg-muted">Version</th>
                              </tr>
                          </thead>
                        <tbody className="divide-y divide-border bg-card">
                            {result.ports.map((port: any) => (
                                <tr key={port.port} className="hover:bg-muted/50 group">
                                    <td className="px-4 py-3 font-mono text-primary font-bold text-base">{port.port}/{port.protocol}</td>
                                    <td className="px-4 py-3 text-green-600 dark:text-green-500 font-bold">{port.state}</td>
                                    <td className="px-4 py-3 text-foreground font-semibold">{port.service}</td>
                                    <td className="px-4 py-3 text-muted-foreground font-mono text-sm">{port.version || '-'}</td>
                                </tr>
                            ))}
                          </tbody>
                      </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      
      <ContextMenuContent className="w-64 bg-popover border-border text-popover-foreground">
        <ContextMenuItem onClick={() => onOpenNewTab(result.ip)}>
          <ExternalLink className="w-4 h-4 mr-2" />
          Open in New Tab
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-border" />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Scan Type</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48 bg-popover border-border">
            <ContextMenuItem onClick={() => onOpenNewTab(result.ip)}>Intense Scan</ContextMenuItem>
            <ContextMenuItem onClick={() => onOpenNewTab(result.ip)}>Quick Scan</ContextMenuItem>
            <ContextMenuItem onClick={() => onOpenNewTab(result.ip)}>Ping Scan</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onClick={() => onOpenNewTab(result.ip)}>
          <Shield className="w-4 h-4 mr-2" />
          Run Vulnerability Scripts
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onOpenNewTab(result.ip)}>
           <Globe className="w-4 h-4 mr-2" />
           OS Detection
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-border" />
        <ContextMenuItem>Copy IP Address</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}, (prevProps, nextProps) => {
  // Only re-render if result IP changes
  return prevProps.result.ip === nextProps.result.ip && 
         prevProps.result.ports.length === nextProps.result.ports.length;
});

function SparklesIcon({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
            <path d="M5 3v4" />
            <path d="M9 5H5" />
        </svg>
    )
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
  )
}
