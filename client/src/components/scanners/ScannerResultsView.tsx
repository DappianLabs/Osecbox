// Unified scanner results view with DEDICATED parsers
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { parseUniversalOutput, UniversalResult, ToolType } from '@/lib/universal-parser';
import { UniversalResultsPanel } from './UniversalResultsPanel';
import { NiktoResultsPanel } from './NiktoResultsPanel';
import { NucleiResultsPanel } from './NucleiResultsPanel';
import type { NiktoResult } from '@/lib/parsers/nikto-parser';
import type { NucleiResult } from '@/lib/parsers/nuclei-parser';
import { ErrorSummaryPanel } from './ErrorSummaryPanel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScanner } from '@/lib/scanner-context';
import { getLatestScanTranscript } from '@/lib/scanner/scan-transcript';
import { getScannerHistoryStorageKey, scannerUsesLocalHistory } from '@/lib/scanner/scanner-history';

export type ScannerType = 'nmap' | 'nikto' | 'nuclei' | 'dirbuster' | 'universal';

interface ScanHistory {
  id: string;
  timestamp: Date;
  target: string;
  result: UniversalResult;
  command?: string;
}

const MAX_HISTORY_SIZE = 50;
const MAX_HISTORY_OUTPUT_CHARS = 120_000;
const MAX_HISTORY_FINDINGS = 10_000;
// Live parsing is an enhancement; the terminal buffer remains authoritative
// and completion parses the retained transcript. Keep five simultaneous scans
// from repeatedly reparsing megabytes of output on the renderer thread while
// retaining enough head/tail context for banners, findings, and summaries.
const LIVE_PARSE_MAX_CHARS = 320_000;
const LIVE_PARSE_HEAD_CHARS = 80_000;
const LIVE_PARSE_TAIL_CHARS = LIVE_PARSE_MAX_CHARS - LIVE_PARSE_HEAD_CHARS;

function boundHistoryOutput(value: string): string {
  if (value.length <= MAX_HISTORY_OUTPUT_CHARS) return value;
  return `${value.slice(0, 24_000)}\n...[history output truncated; full transcript remains in terminal]...\n${value.slice(-96_000)}`;
}

function normalizeSavedHistory(value: unknown): ScanHistory[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is Record<string, any> => !!entry && typeof entry === 'object')
    .map((entry, index): ScanHistory | null => {
      const rawResult = entry.result;
      if (!rawResult || typeof rawResult !== 'object' || !Array.isArray(rawResult.findings)) {
        return null;
      }

      const timestampValue = new Date(entry.timestamp);
      const timestamp = Number.isNaN(timestampValue.getTime()) ? new Date() : timestampValue;
      const rawOutput = typeof rawResult.rawOutput === 'string'
        ? boundHistoryOutput(rawResult.rawOutput)
        : '';

      return {
        id: typeof entry.id === 'string' && entry.id.trim()
          ? entry.id
          : `restored-history-${Date.now()}-${index}`,
        timestamp,
        target: typeof entry.target === 'string' ? entry.target.slice(0, 2048) : '',
        command: typeof entry.command === 'string' ? entry.command.slice(0, 16_384) : undefined,
        result: {
          ...rawResult,
          tool: typeof rawResult.tool === 'string' ? rawResult.tool : 'custom',
          command: typeof rawResult.command === 'string' ? rawResult.command : '',
          findings: rawResult.findings.slice(0, MAX_HISTORY_FINDINGS),
          rawOutput,
          summary: rawResult.summary && typeof rawResult.summary === 'object' ? rawResult.summary : {},
          metadata: rawResult.metadata && typeof rawResult.metadata === 'object' ? rawResult.metadata : {},
        } as UniversalResult,
      };
    })
    .filter((entry): entry is ScanHistory => entry !== null)
    .slice(0, MAX_HISTORY_SIZE);
}

interface ScannerResultsViewProps {
  scannerType: ScannerType;
  terminalOutput: string;
  isScanning: boolean;
  sessionId: string;
  isActive?: boolean;
}

const TOOL_ICONS: Record<ToolType, string> = {
  // Network
  nmap: '🗺️', masscan: '⚡', zmap: '🌐', unicornscan: '🦄',
  // Web
  nikto: '🛡️', nuclei: '🔍', wpscan: '📝', joomscan: '🎯', droopescan: '💧',
  // Directory
  gobuster: '📁', dirbuster: '📂', feroxbuster: '🦀', ffuf: '⚡', dirb: '📋', dirsearch: '🔎', wfuzz: '🌀',
  // Subdomain
  subfinder: '🔍', assetfinder: '💎', amass: '🌊', sublist3r: '📜',
  // DNS
  dnsenum: '🌐', dnsrecon: '🔍', fierce: '🦁', dig: '⛏️', nslookup: '👀', host: '🏠',
  // Exploitation
  metasploit: '💥', sqlmap: '💉', xsstrike: '⚔️', commix: '🎯', beef: '🥩',
  // Wireless
  'aircrack-ng': '📡', reaver: '📶', wifite: '📡', kismet: '💋', bettercap: '🎩',
  // Password
  hydra: '🐉', medusa: '🐍', ncrack: '🔓', john: '🔨', hashcat: '😺', crunch: '🔢',
  // SSL
  sslscan: '🔒', sslyze: '🔐', testssl: '🛡️', tlssled: '🔑',
  // Port
  nc: '🔌', netcat: '🐱', telnet: '📞', ncat: '🐈',
  // Proxy
  burpsuite: '🔥', zaproxy: '⚡', mitmproxy: '🔀',
  // Recon
  whois: '❓', theHarvester: '🌾', 'recon-ng': '🔍', maltego: '🕸️', shodan: '👁️',
  // Sniffer
  wireshark: '🦈', tcpdump: '📦', tshark: '🦈', ettercap: '🕷️',
  // Custom
  custom: '⚙️',
};

export function ScannerResultsView({ 
  scannerType, 
  terminalOutput, 
  isScanning,
  sessionId,
  isActive = true,
}: ScannerResultsViewProps) {
  const { tabs, activeTabId, runScan, stopScan, clearErrors, resetCurrentTab } = useScanner();
  const activeTab = tabs.find(t => t.id === activeTabId);
  
  const historyStorageKey = getScannerHistoryStorageKey(scannerType);
  const supportsHistory = scannerUsesLocalHistory(scannerType);
  const [scannerHistory, setScannerHistory] = useState<ScanHistory[]>([]);
  const [loadedHistoryKey, setLoadedHistoryKey] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  
  // Track scan state for better UI feedback
  const [scanState, setScanState] = useState<'idle' | 'starting' | 'running' | 'completed' | 'error'>('idle');
  const [scanProgress, setScanProgress] = useState<string>('');

  // Load history from localStorage on mount
  useEffect(() => {
    setLoadedHistoryKey(null);
    setScannerHistory([]);
    setSelectedHistoryId(null);

    try {
      const saved = localStorage.getItem(historyStorageKey);
      
      setScannerHistory(saved ? normalizeSavedHistory(JSON.parse(saved)) : []);
    } catch (error) {
      console.error('Failed to load history from localStorage:', error);
      setScannerHistory([]);
    }
    setLoadedHistoryKey(historyStorageKey);
  }, [historyStorageKey]);
  
  // CRITICAL PERFORMANCE: Reduced polling frequency and skip when hidden
  useEffect(() => {
    if (!isActive || !isScanning) {
      setScanState('idle');
      setScanProgress('');
      return;
    }
    
    // Skip polling if tab/window is hidden (major CPU savings)
    if (document.hidden) {
      return;
    }
    
    // ResultsPanel passes the scanner-specific terminal ID. Reading the tab
    // ID here loses output when Nmap/Nikto/Nuclei share one scan tab.
    const terminalId = sessionId;
    
    const checkState = async () => {
      // Double-check visibility before expensive operations
      if (document.hidden) return;
      
      try {
        const { terminalService } = await import('@/lib/terminal-service');
        const output = terminalService.getOutput(terminalId);
        
        if (!output || output.length < 5) {
          setScanState('starting');
          setScanProgress('Initializing scan...');
          return;
        }
        
        setScanState('running');
        
        // PERFORMANCE: Only check last 5KB of output for progress (not entire buffer)
        const recentOutput = output.slice(-5120);
        const lowerOutput = recentOutput.toLowerCase();
        
        if (scannerType === 'nmap') {
          const progressMatch = recentOutput.match(/Completed\s+([^a]+?)\s+at/i);
          if (progressMatch) {
            setScanProgress(`Running: ${progressMatch[1]}`);
          } else if (lowerOutput.includes('initiating')) {
            const initMatch = recentOutput.match(/Initiating\s+([^a]+?)\s+at/i);
            if (initMatch) {
              setScanProgress(`Starting: ${initMatch[1]}`);
            }
          } else {
            setScanProgress('Scanning ports...');
          }
        } else if (scannerType === 'nikto') {
          if (lowerOutput.includes('target ip:') || lowerOutput.includes('target hostname:')) {
            setScanProgress('Scanning web server...');
          } else if (lowerOutput.includes('testing:')) {
            setScanProgress('Running tests...');
          } else {
            setScanProgress('Analyzing target...');
          }
        } else if (scannerType === 'nuclei') {
          const templateMatch = recentOutput.match(/Executing\s+(\d+)\s+templates/i);
          if (templateMatch) {
            setScanProgress(`Running ${templateMatch[1]} templates...`);
          } else if (lowerOutput.includes('loading templates')) {
            setScanProgress('Loading templates...');
          } else {
            setScanProgress('Scanning for vulnerabilities...');
          }
        } else if (scannerType === 'dirbuster') {
          const progressMatch = recentOutput.match(/Progress:\s*(\d+)\s*\/\s*(\d+)\s*\(([^)]+)\)/i);
          if (progressMatch) {
            setScanProgress(`Progress: ${progressMatch[3]}`);
          } else {
            setScanProgress('Enumerating directories...');
          }
        } else {
          setScanProgress('Scan in progress...');
        }
      } catch (err) {
        console.error('[ScannerResultsView] State check error:', err);
      }
    };
    
    // Further reduced from 2000ms to 3000ms for better performance
    const interval = setInterval(checkState, 3000);
    checkState(); // Initial check
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive, isScanning, scannerType, sessionId]);

  // Save history to localStorage when it changes (with size limit)
  useEffect(() => {
    if (!supportsHistory || loadedHistoryKey !== historyStorageKey) return;
    try {
      const limitedHistory = scannerHistory.slice(0, MAX_HISTORY_SIZE);
      localStorage.setItem(historyStorageKey, JSON.stringify(limitedHistory));
    } catch (error: any) {
      const isQuotaError = error?.name === 'QuotaExceededError' || error?.code === 22;
      if (isQuotaError) {
        // Storage full - keep only recent 10 scans
        const recentHistory = scannerHistory.slice(0, 10);
        try {
          localStorage.setItem(historyStorageKey, JSON.stringify(recentHistory));
          setScannerHistory(current => current.length > recentHistory.length ? recentHistory : current);
          console.warn(scannerType + ' history trimmed due to storage limit');
        } catch (e) {
          console.error('Failed to save even trimmed history:', e);
        }
      } else {
        console.error('Failed to save scanner history:', error);
      }
    }
  }, [historyStorageKey, loadedHistoryKey, scannerHistory, scannerType, supportsHistory]);

  // DRASTIC FIX: Real-time parsing with proper ID extraction
  const [progressiveNiktoResult, setProgressiveNiktoResult] = useState<NiktoResult | null>(null);
  const [progressiveNucleiResult, setProgressiveNucleiResult] = useState<NucleiResult | null>(null);
  const [progressiveUniversalResult, setProgressiveUniversalResult] = useState<UniversalResult | null>(null);
  const [liveTerminalOutput, setLiveTerminalOutput] = useState<string>(terminalOutput);
  const recordedUniversalHistoryKey = useRef<string | null>(null);

  useEffect(() => {
    setLiveTerminalOutput(terminalOutput);
  }, [terminalOutput]);
  
  // Get terminal output for progressive parsing
  useEffect(() => {
    if (!isActive || (scannerType !== 'nikto' && scannerType !== 'nuclei' && scannerType !== 'nmap')) {
      return;
    }
    
    const terminalId = sessionId;
    setProgressiveNiktoResult(null);
    setProgressiveNucleiResult(null);
    
    // PERFORMANCE: Only log once on setup, not every poll
    let disposed = false;
    // PERF FIX: Skip re-parsing when the terminal buffer hasn't grown.
    // Previously this re-parsed the ENTIRE buffer every second even when idle,
    // which is O(n) per tick and the main cause of scan-time lag.
    let lastParsedLength = -1;
    
    const pollAndParse = async () => {
      try {
        const { terminalService } = await import('@/lib/terminal-service');
        const output = terminalService.getOutput(terminalId) || terminalOutput || '';
        
        if (!output || disposed) {
          return;
        }
        
        // PERF FIX: Nothing new since last parse — skip the O(n) re-parse.
        // A shrink (buffer cleared/trimmed) also changes the length and re-parses.
        if (output.length === lastParsedLength) {
          return;
        }
        lastParsedLength = output.length;
        
        // Dedicated parsers receive a bounded live window. The complete
        // transcript remains in the terminal and is parsed once on completion.
        const currentRunOutput = getLatestScanTranscript(output);
        const liveOutput = currentRunOutput.length > LIVE_PARSE_MAX_CHARS
          ? `${currentRunOutput.slice(0, LIVE_PARSE_HEAD_CHARS)}\n...[live parse window truncated]...\n${currentRunOutput.slice(-LIVE_PARSE_TAIL_CHARS)}`
          : currentRunOutput;
        if (disposed) return;
        setLiveTerminalOutput(output);

        if (scannerType === 'nikto') {
          const { parseNiktoOutput } = await import('@/lib/parsers/nikto-parser');
          if (!disposed) setProgressiveNiktoResult(parseNiktoOutput(liveOutput));
        } else if (scannerType === 'nuclei') {
          const { parseNucleiOutput } = await import('@/lib/parsers/nuclei-parser');
          if (!disposed) setProgressiveNucleiResult(parseNucleiOutput(liveOutput));
        }
      } catch (err) {
        console.error('[ScannerResultsView] Parse error:', err);
      }
    };
    
    // Poll continuously, not just while scanning
    const interval = setInterval(pollAndParse, 1000);
    pollAndParse(); // Initial parse
    
    return () => {
      disposed = true;
      if (interval) clearInterval(interval);
    };
  }, [isActive, scannerType, sessionId, terminalOutput]); // Poll only while visible; buffer reads are bounded.

  // Universal and directory scans use the same live transcript contract as the
  // dedicated panels. Previously this component imported parseUniversalOutput
  // but never called it, so these scanners always rendered an empty history
  // view even while their terminal had valid output.
  useEffect(() => {
    if (!isActive || (scannerType !== 'universal' && scannerType !== 'dirbuster')) {
      setProgressiveUniversalResult(null);
      return;
    }

    let lastParsedLength = -1;
    let disposed = false;

    const pollAndParse = async () => {
      try {
        const { terminalService } = await import('@/lib/terminal-service');
        const output = terminalService.getOutput(sessionId) || terminalOutput || '';
        if (!output || output.length === lastParsedLength || disposed) return;
        lastParsedLength = output.length;

        const currentRunOutput = getLatestScanTranscript(output);
        const liveOutput = currentRunOutput.length > LIVE_PARSE_MAX_CHARS
          ? `${currentRunOutput.slice(0, LIVE_PARSE_HEAD_CHARS)}\n...[live parse window truncated]...\n${currentRunOutput.slice(-LIVE_PARSE_TAIL_CHARS)}`
          : currentRunOutput;
        if (disposed) return;
        setLiveTerminalOutput(output);

        const command = scannerType === 'universal'
          ? activeTab?.target || ''
          : `gobuster ${activeTab?.target || ''}`;
        if (!disposed) setProgressiveUniversalResult(parseUniversalOutput(command, liveOutput));
      } catch (error) {
        console.error('[ScannerResultsView] Universal parse error:', error);
      }
    };

    const interval = setInterval(() => { void pollAndParse(); }, 1000);
    void pollAndParse();
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [isActive, scannerType, sessionId, terminalOutput, activeTab?.target]);
  
  const niktoResult = useMemo(() => {
    if (scannerType !== 'nikto') return null;

    const completedResult = activeTab?.structuredResultsByScanner?.nikto as NiktoResult | null | undefined;
    // Use the live parser while running, then prefer the full completed
    // transcript snapshot so remounts and terminal-buffer gaps cannot erase it.
    return isScanning
      ? progressiveNiktoResult || completedResult || null
      : completedResult || progressiveNiktoResult;
  }, [activeTab?.structuredResultsByScanner, isScanning, progressiveNiktoResult, scannerType]);

  const nucleiResult = useMemo(() => {
    if (scannerType !== 'nuclei') return null;

    const completedResult = activeTab?.structuredResultsByScanner?.nuclei as NucleiResult | null | undefined;
    return isScanning
      ? progressiveNucleiResult || completedResult || null
      : completedResult || progressiveNucleiResult;
  }, [activeTab?.structuredResultsByScanner, isScanning, progressiveNucleiResult, scannerType]);

  // Keep history scoped to the selected tool. Custom output must never appear
  // as Nuclei/Nikto/DirBuster history when the user switches scanner tabs.
  const currentHistory = supportsHistory && loadedHistoryKey === historyStorageKey ? scannerHistory : [];
  const selectedResult = currentHistory.find(h => h.id === selectedHistoryId);
  const liveUniversalResult = progressiveUniversalResult;

  // Keep a bounded completed snapshot for local history without placing an
  // entire multi-megabyte terminal transcript into localStorage.
  useEffect(() => {
    if ((scannerType !== 'universal' && scannerType !== 'dirbuster') || isScanning || !liveUniversalResult?.rawOutput) {
      return;
    }

    const raw = liveUniversalResult.rawOutput;
    const historyKey = `${sessionId}:${raw.length}:${raw.slice(-160)}`;
    if (recordedUniversalHistoryKey.current === historyKey) return;
    recordedUniversalHistoryKey.current = historyKey;

    const maxHistoryOutput = 120_000;
    const historyOutput = raw.length <= maxHistoryOutput
      ? raw
      : `${raw.slice(0, 24_000)}\n...[history output truncated; full transcript remains in terminal]...\n${raw.slice(-96_000)}`;
    const historyResult: UniversalResult = {
      ...liveUniversalResult,
      rawOutput: historyOutput,
      metadata: {
        ...liveUniversalResult.metadata,
        rawOutputTruncated: liveUniversalResult.metadata.rawOutputTruncated || raw.length > maxHistoryOutput,
      },
    };
    const historyId = `universal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setScannerHistory(prev => [
      { id: historyId, timestamp: new Date(), target: activeTab?.target || '', result: historyResult, command: historyResult.command },
      ...prev.filter(item => !(item.target === (activeTab?.target || '') && item.result.command === historyResult.command)),
    ].slice(0, MAX_HISTORY_SIZE));
    setSelectedHistoryId(historyId);
  }, [scannerType, isScanning, liveUniversalResult, sessionId, activeTab?.target]);

  const deleteScan = (id: string) => {
    setScannerHistory(prev => prev.filter(h => h.id !== id));
    
    if (selectedHistoryId === id) {
      setSelectedHistoryId(currentHistory[0]?.id || null);
    }
  };

  const clearAllHistory = () => {
    setScannerHistory([]);
    setSelectedHistoryId(null);
  };

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  // For nmap, don't show this view (it has its own ResultsPanel)
  if (scannerType === 'nmap') {
    return null;
  }

  return (
    <div className="h-full flex bg-background">
      {/* History Sidebar */}
      {currentHistory.length > 0 && (
        <div className="w-64 border-r border-border bg-card flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm text-foreground">Scan History</h3>
              <p className="text-xs text-muted-foreground">{currentHistory.length} scans</p>
            </div>
            <div className="flex items-center gap-1">
              {activeTab && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resetCurrentTab(activeTab.id)}
                  className="h-7 text-xs"
                >
                  New Scan
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={clearAllHistory}
                className="h-7 text-xs"
              >
                Clear All
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-2">
              {currentHistory.map((scan) => (
                <div
                  key={scan.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedHistoryId === scan.id}
                  onClick={() => setSelectedHistoryId(scan.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    setSelectedHistoryId(scan.id);
                  }}
                  className={cn(
                    "w-full p-3 rounded-lg border text-left transition-all relative group cursor-pointer",
                    selectedHistoryId === scan.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs text-foreground truncate">
                        {TOOL_ICONS[(scan.result as UniversalResult).tool] || '⚙️'} {(scan.result as UniversalResult).tool}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{scan.target}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteScan(scan.id);
                      }}
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{formatTimeAgo(scan.timestamp)}</span>
                  </div>
                  <div className="mt-2">
                    <Badge variant="secondary" className="text-xs">
                      {(scan.result as UniversalResult).findings.length} findings
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Error Summary - Show at top if there are errors */}
        {activeTab && activeTab.errors && activeTab.errors.length > 0 && (
          <div className="p-2">
            <ErrorSummaryPanel
              errors={activeTab.errors}
              onRetry={() => {
                if (activeTab) {
                  clearErrors(activeTab.id);
                  runScan(activeTab.id, activeTab.target, false, []);
                }
              }}
              onClear={() => {
                if (activeTab) {
                  clearErrors(activeTab.id);
                }
              }}
            />
          </div>
        )}
        
        {/* Results Panel - Use dedicated panels for nikto/nuclei */}
        <div className="flex-1 overflow-hidden">
          {scannerType === 'nikto' ? (
            <NiktoResultsPanel result={niktoResult} isScanning={isScanning} rawOutput={liveTerminalOutput} />
          ) : scannerType === 'nuclei' ? (
            <NucleiResultsPanel result={nucleiResult} isScanning={isScanning} rawOutput={liveTerminalOutput} />
          ) : (
            <UniversalResultsPanel
              result={liveUniversalResult || selectedResult?.result as UniversalResult || null}
              isScanning={isScanning}
            />
          )}
        </div>
      </div>
    </div>
  );
}
