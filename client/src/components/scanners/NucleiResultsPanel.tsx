import React, { useState, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { NucleiFinding, NucleiResult } from '@/lib/parsers/nuclei-parser';
import type { Severity } from '@/lib/parsers/base-parser';
import { AlertTriangle, Shield, Info, ExternalLink, Copy, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { RawOutputPreview } from './RawOutputPreview';

type NucleiSeverity = Severity;

interface NucleiResultsPanelProps {
  result: NucleiResult | null;
  isScanning: boolean;
  rawOutput?: string;
}

export function NucleiResultsPanel({ result, isScanning, rawOutput = '' }: NucleiResultsPanelProps) {
  const [severityFilter, setSeverityFilter] = useState<NucleiSeverity | 'all'>('all');
  const [urlFilter, setUrlFilter] = useState<string>('all');

  // PERFORMANCE: Memoize filtered findings to avoid recalculation on every render
  const filteredFindings = useMemo(() => {
    if (!result) return [];
    
    let filtered = result.findings;
    if (severityFilter !== 'all') {
      filtered = filtered.filter(f => f.severity === severityFilter);
    }
    if (urlFilter !== 'all') {
      filtered = filtered.filter(f => f.url === urlFilter);
    }
    return filtered;
  }, [result, severityFilter, urlFilter]);

  // Early returns AFTER all hooks
  // FIX: Show scanning state if no findings AND scan hasn't reported completion
  if (!result || result.findings.length === 0) {
    // FIX: Only show the scanning animation while a scan is ACTUALLY running
    // (the progressive parser returns a non-null result even for an idle prompt).
    const showScanning = isScanning;
    
    if (showScanning) {
      return (
        <div className="h-full flex flex-col bg-background">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm select-none">
              <Shield className="w-14 h-14 text-primary/70 mx-auto mb-5" strokeWidth={1.5} />
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
                Nuclei is running vulnerability checks. Results will appear here as they're discovered.
              </p>
            </div>
          </div>
          <RawOutputPreview rawOutput={rawOutput} title="Nuclei terminal output" />
        </div>
      );
    }
    
    // FIX: Only show "No Vulnerabilities Found" when scan actually completed
    if (result && result.findings.length === 0 && result.scanCompleted) {
      return (
        <div className="h-full flex flex-col bg-background">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <Shield className="w-20 h-20 text-green-500/50 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No Nuclei findings reported</h3>
              <p className="text-sm text-muted-foreground">
                Nuclei completed without reporting a vulnerability match for the selected templates and target.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                This is not a guarantee that the target is secure; review the terminal output and scan configuration.
              </p>
            </div>
          </div>
          <RawOutputPreview rawOutput={rawOutput} title="Nuclei terminal output" />
        </div>
      );
    }
    
    if (rawOutput.trim()) {
      return (
        <div className="h-full flex flex-col bg-background">
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <Info className="w-20 h-20 text-muted-foreground/50 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No parsed Nuclei findings</h3>
              <p className="text-sm text-muted-foreground">
                Nuclei produced terminal output, but no vulnerability records were parsed from it. Review the output below for tool diagnostics or informational messages.
              </p>
            </div>
          </div>
          <RawOutputPreview rawOutput={rawOutput} title="Nuclei terminal output" />
        </div>
      );
    }

    // No scan has been run yet
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <Shield className="w-20 h-20 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Scan Results</h3>
            <p className="text-sm text-muted-foreground">
              Enter a target and click Run Scan to check for vulnerabilities with Nuclei templates.
            </p>
          </div>
        </div>
        <RawOutputPreview rawOutput={rawOutput} title="Nuclei terminal output" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header with Summary */}
      <div className="p-3 border-b border-border bg-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-sm font-bold text-foreground">Nuclei Scan Results</h2>
              <p className="text-xs text-muted-foreground">
                {result.templates.length} templates • {result.affectedUrls.length} URLs
              </p>
            </div>
          </div>
          {result.cves.length > 0 && (
            <Badge variant="destructive" className="font-mono text-xs">
              {result.cves.length} CVEs
            </Badge>
          )}
        </div>

        {/* Severity Summary */}
        <div className="grid grid-cols-6 gap-2">
          <SeverityCard
            severity="critical"
            count={result.summary.critical}
            active={severityFilter === 'critical'}
            onClick={() => setSeverityFilter(severityFilter === 'critical' ? 'all' : 'critical')}
          />
          <SeverityCard
            severity="high"
            count={result.summary.high}
            active={severityFilter === 'high'}
            onClick={() => setSeverityFilter(severityFilter === 'high' ? 'all' : 'high')}
          />
          <SeverityCard
            severity="medium"
            count={result.summary.medium}
            active={severityFilter === 'medium'}
            onClick={() => setSeverityFilter(severityFilter === 'medium' ? 'all' : 'medium')}
          />
          <SeverityCard
            severity="low"
            count={result.summary.low}
            active={severityFilter === 'low'}
            onClick={() => setSeverityFilter(severityFilter === 'low' ? 'all' : 'low')}
          />
          <SeverityCard
            severity="info"
            count={result.summary.info}
            active={severityFilter === 'info'}
            onClick={() => setSeverityFilter(severityFilter === 'info' ? 'all' : 'info')}
          />
          <button
            type="button"
            onClick={() => setSeverityFilter('all')}
            className={cn(
              "p-3 rounded-lg border-2 transition-all",
              severityFilter === 'all' ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
            )}
          >
            <div className="text-2xl font-bold mb-1 text-foreground">{result.summary.total}</div>
            <div className="text-xs font-semibold uppercase text-muted-foreground">All</div>
          </button>
        </div>

        {/* URL Filter */}
        {result.affectedUrls.length > 1 && (
          <div className="mt-3 flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <select
              value={urlFilter}
              onChange={(e) => setUrlFilter(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-background border border-border rounded-md text-sm text-foreground"
            >
              <option value="all">All URLs ({result.affectedUrls.length})</option>
              {result.affectedUrls.map(url => (
                <option key={url} value={url}>{url}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Findings List */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {filteredFindings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Info className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No findings match the current filters</p>
            </div>
          ) : (
            filteredFindings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))
          )}
        </div>
      </ScrollArea>
      <RawOutputPreview rawOutput={rawOutput} title="Nuclei terminal output" />
    </div>
  );
}

function SeverityCard({ 
  severity, 
  count, 
  active, 
  onClick 
}: { 
  severity: NucleiSeverity; 
  count: number; 
  active: boolean;
  onClick: () => void;
}) {
  const colors = {
    critical: 'from-purple-500 to-pink-500',
    high: 'from-red-500 to-orange-500',
    medium: 'from-orange-500 to-yellow-500',
    low: 'from-yellow-500 to-green-500',
    info: 'from-blue-500 to-cyan-500',
    unknown: 'from-gray-500 to-gray-600',
  };

  const bgColors = {
    critical: 'bg-purple-500/10 border-purple-500/30',
    high: 'bg-red-500/10 border-red-500/30',
    medium: 'bg-orange-500/10 border-orange-500/30',
    low: 'bg-yellow-500/10 border-yellow-500/30',
    info: 'bg-blue-500/10 border-blue-500/30',
    unknown: 'bg-gray-500/10 border-gray-500/30',
  };

  // Ensure count is always a number
  const displayCount = typeof count === 'number' ? count : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "p-3 rounded-lg border-2 transition-all cursor-pointer",
        active ? bgColors[severity] : "border-border bg-card hover:bg-muted/50"
      )}
    >
      <div className={cn(
        "text-2xl font-bold mb-1",
        active ? `bg-gradient-to-r ${colors[severity]} bg-clip-text text-transparent` : "text-foreground"
      )}>
        {displayCount}
      </div>
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        {severity}
      </div>
    </button>
  );
}

function SeverityBadge({ severity }: { severity: NucleiSeverity }) {
  const config = {
    critical: { icon: AlertTriangle, className: 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30' },
    high: { icon: AlertTriangle, className: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30' },
    medium: { icon: AlertTriangle, className: 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30' },
    low: { icon: Info, className: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30' },
    info: { icon: Info, className: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30' },
    unknown: { icon: Info, className: 'bg-gray-500/20 text-gray-600 dark:text-gray-400 border-gray-500/30' },
  };

  const { icon: Icon, className } = config[severity];

  return (
    <Badge variant="outline" className={cn("text-xs font-bold border", className)}>
      <Icon className="w-3 h-3 mr-1" />
      {severity.toUpperCase()}
    </Badge>
  );
}

function FindingCard({ finding }: { finding: NucleiFinding }) {
  const copyToClipboard = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card hover:shadow-lg transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-bold text-foreground">{finding.name}</h3>
              {finding.cve && (
                <Badge variant="destructive" className="text-xs font-mono">
                  {finding.cve}
                </Badge>
              )}
              {finding.cwe && (
                <Badge variant="outline" className="text-xs font-mono">
                  {finding.cwe}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono mb-2">
              <code className="bg-muted px-2 py-0.5 rounded">{finding.templateId}</code>
            </div>
          </div>
          <SeverityBadge severity={finding.severity} />
        </div>

        {finding.url ? (
          <div className="flex items-center gap-2 mb-3">
            <a
              href={finding.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-sm text-blue-400 hover:text-blue-300 hover:underline font-mono truncate"
            >
              {finding.url}
            </a>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copyToClipboard(finding.url)}
              className="h-6 w-6 p-0"
            >
              <Copy className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.open(finding.url, '_blank')}
              className="h-6 w-6 p-0"
            >
              <ExternalLink className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">
            The full parser transcript is available in the terminal output below.
          </p>
        )}

        {finding.matchedAt && (
          <div className="text-xs text-muted-foreground mb-2">
            <span className="font-semibold">Matched at:</span> <code className="bg-muted px-1 py-0.5 rounded ml-1">{finding.matchedAt}</code>
          </div>
        )}

        {finding.cvss && (
          <div className="text-xs text-muted-foreground mb-2">
            <span className="font-semibold">CVSS Score:</span> 
            <Badge variant="outline" className="text-xs ml-2">
              {finding.cvss}
            </Badge>
          </div>
        )}

        {finding.reference && finding.reference.length > 0 && (
          <div className="text-xs text-muted-foreground mb-2">
            <span className="font-semibold">References:</span>
            <div className="mt-1 space-y-1">
              {finding.reference.map((ref, idx) => (
                <a 
                  key={idx} 
                  href={ref} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="block text-blue-400 hover:text-blue-300 hover:underline truncate"
                >
                  {ref}
                </a>
              ))}
            </div>
          </div>
        )}

        {finding.extractedResults && finding.extractedResults.length > 0 && (
          <div className="mt-3 p-3 bg-muted/50 rounded-md border border-border">
            <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
              <span>📋 Extracted Data</span>
              <Badge variant="secondary" className="text-[10px]">{finding.extractedResults.length} item(s)</Badge>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {finding.extractedResults.map((result, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-[10px] text-muted-foreground mt-0.5">•</span>
                  <code className="block text-xs font-mono text-foreground bg-background px-2 py-1 rounded flex-1 break-all">
                    {result}
                  </code>
                </div>
              ))}
            </div>
          </div>
        )}

        {finding.tags && finding.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {finding.tags.map((tag, idx) => (
              <Badge key={idx} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
