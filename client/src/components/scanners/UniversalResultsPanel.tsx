// Universal results panel for ALL pentesting tools
import React, { useMemo, useState } from 'react';
import { UniversalResult, UniversalFinding, ToolType } from '@/lib/universal-parser';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, Copy, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cleanANSIForDisplay } from '@/lib/utils/ansi-cleaner';

interface UniversalResultsPanelProps {
  result: UniversalResult | null;
  isScanning: boolean;
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

const SEVERITY_COLORS = {
  critical: 'bg-red-500/10 text-red-500 border-red-500/30',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
  low: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  info: 'bg-gray-500/10 text-gray-500 border-gray-500/30',
  unknown: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
};

export function UniversalResultsPanel({ result, isScanning }: UniversalResultsPanelProps) {
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  const rawOutput = typeof result?.rawOutput === 'string' ? result.rawOutput : '';
  const displayOutput = useMemo(() => cleanANSIForDisplay(rawOutput), [rawOutput]);

  const filteredFindings = useMemo(() => {
    if (!result) return [];
    
    return findings.filter(f => {
      if (typeFilter !== 'all' && f.type !== typeFilter) return false;
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
      return true;
    });
  }, [result, findings, typeFilter, severityFilter]);

  const toggleExpanded = (id: string) => {
    setExpandedFindings(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (isScanning && !result) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-lg font-semibold text-foreground">
            Scanning in progress
            <span className="inline-flex ml-2 gap-1.5 items-center">
              <span className="w-2.5 h-2.5 bg-primary rounded-full animate-wave"></span>
              <span className="w-2.5 h-2.5 bg-primary rounded-full animate-wave-delay-1"></span>
              <span className="w-2.5 h-2.5 bg-primary rounded-full animate-wave-delay-2"></span>
              <span className="w-2.5 h-2.5 bg-primary rounded-full animate-wave-delay-3"></span>
              <span className="w-2.5 h-2.5 bg-primary rounded-full animate-wave-delay-4"></span>
            </span>
          </p>
          <p className="text-sm text-muted-foreground">Parsing output in real-time</p>
        </div>
      </div>
    );
  }

  if (!result || (findings.length === 0 && displayOutput.length === 0)) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <p className="text-lg font-semibold text-foreground mb-2">No results yet</p>
          <p className="text-sm text-muted-foreground">Run a scan to see parsed results here</p>
        </div>
      </div>
    );
  }

  const toolIcon = TOOL_ICONS[result.tool] || '⚙️';
  const byType = result.summary?.byType || {};
  const bySeverity = result.summary?.bySeverity || {};
  const types = Object.keys(byType);
  const severities = Object.keys(bySeverity);
  const rawPreview = displayOutput.length > 120_000
    ? `${displayOutput.slice(0, 24_000)}\n...[raw preview truncated; complete output remains in the terminal]...\n${displayOutput.slice(-96_000)}`
    : displayOutput;
  const copyRawOutput = async () => {
    try {
      await navigator.clipboard?.writeText(displayOutput);
    } catch {
      // Clipboard permissions are optional; the terminal remains the source.
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="p-3 border-b border-border bg-card">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">{toolIcon}</span>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-foreground capitalize">{result.tool}</h2>
            <p className="text-sm text-muted-foreground font-mono">{result.command}</p>
          </div>
          <Badge variant="secondary" className="text-lg px-3 py-1">
            {findings.length} findings
          </Badge>
          {isScanning && (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
              live
            </Badge>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type Filter */}
          {types.length > 1 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Type:</span>
              <Button
                size="sm"
                variant={typeFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setTypeFilter('all')}
                className="h-7 text-xs"
              >
                All ({findings.length})
              </Button>
              {types.map(type => (
                <Button
                  key={type}
                  size="sm"
                  variant={typeFilter === type ? 'default' : 'outline'}
                  onClick={() => setTypeFilter(type)}
                  className="h-7 text-xs"
                >
                  {type.replace(/_/g, ' ')} ({byType[type]})
                </Button>
              ))}
            </div>
          )}

          {/* Severity Filter */}
          {severities.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Severity:</span>
              <Button
                size="sm"
                variant={severityFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setSeverityFilter('all')}
                className="h-7 text-xs"
              >
                All
              </Button>
              {severities.map(sev => (
                <Button
                  key={sev}
                  size="sm"
                  variant={severityFilter === sev ? 'default' : 'outline'}
                  onClick={() => setSeverityFilter(sev)}
                  className="h-7 text-xs"
                >
                  {sev} ({bySeverity[sev]})
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Findings */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {filteredFindings.map((finding) => {
            const isExpanded = expandedFindings.has(finding.id);
            const hasDetails = Object.keys(finding.data || {}).length > 0;

            return (
              <Card
                key={finding.id}
                className={cn(
                  "p-3 border-2 transition-all",
                  finding.severity && (SEVERITY_COLORS[finding.severity] || SEVERITY_COLORS.unknown)
                )}
              >
                <div className="flex items-start gap-3">
                  {hasDetails && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(finding.id)}
                      className="mt-1 text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{finding.title}</h3>
                      <div className="flex items-center gap-1">
                        {finding.severity && (
                          <Badge variant="outline" className="text-xs">
                            {finding.severity}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          {finding.type.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    </div>

                    {finding.description && (
                      <p className="text-sm text-muted-foreground mb-2">{finding.description}</p>
                    )}

                    {isExpanded && hasDetails && (
                      <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                        <div className="space-y-1">
                          {Object.entries(finding.data || {}).map(([key, value]) => (
                            <div key={key} className="flex items-start gap-2 text-xs">
                              <span className="font-semibold text-foreground min-w-[100px]">
                                {key.replace(/_/g, ' ')}:
                              </span>
                              <span className="text-muted-foreground font-mono flex-1 break-all">
                                {(() => {
                                  try {
                                    const rendered = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
                                    return rendered.length > 8000 ? `${rendered.slice(0, 8000)}...` : rendered;
                                  } catch {
                                    return '[unrenderable value]';
                                  }
                                })()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
          {displayOutput && (
            <Card className="border-border/70 bg-card/60">
              <details>
                <summary className="cursor-pointer list-none p-3 flex items-center justify-between gap-3 text-sm font-medium text-foreground">
                  <span>Raw output preview</span>
                  <Button type="button" size="sm" variant="ghost" className="h-7" onClick={(event) => { event.preventDefault(); void copyRawOutput(); }}>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy
                  </Button>
                </summary>
                <pre className="max-h-96 overflow-auto border-t border-border p-3 text-xs leading-5 text-muted-foreground font-mono whitespace-pre-wrap break-words">{rawPreview}</pre>
              </details>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
