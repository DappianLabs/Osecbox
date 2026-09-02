import React, { useState, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { NiktoFinding, NiktoResult } from '@/lib/parsers/nikto-parser';
import type { Severity } from '@/lib/parsers/base-parser';
import { AlertTriangle, Shield, Info, ChevronDown, ChevronRight, Server, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RawOutputPreview } from './RawOutputPreview';

type NiktoSeverity = Severity;

interface NiktoResultsPanelProps {
  result: NiktoResult | null;
  isScanning: boolean;
  rawOutput?: string;
}

export function NiktoResultsPanel({ result, isScanning, rawOutput = '' }: NiktoResultsPanelProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<NiktoSeverity | 'all'>('all');

  // PERFORMANCE: Memoize categorized findings to avoid recalculation on every render
  const categorizedFindings = useMemo(() => {
    if (!result) return null;  // FIX: Return null instead of empty object to prevent React error #310
    
    return result.findings.reduce((acc, finding) => {
      if (!acc[finding.category]) {
        acc[finding.category] = [];
      }
      acc[finding.category].push(finding);
      return acc;
    }, {} as Record<string, NiktoFinding[]>);
  }, [result]);

  // PERFORMANCE: Memoize filtered findings
  const filteredFindings = useMemo(() => {
    if (!result) return [];
    return severityFilter === 'all' 
      ? result.findings 
      : result.findings.filter(f => f.severity === severityFilter);
  }, [result, severityFilter]);

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  // Early returns AFTER all hooks
  // FIX: Only show the scanning animation while a scan is ACTUALLY running.
  // The progressive parser returns a non-null result for ANY terminal output
  // (even an idle shell prompt), so keying off a non-null result made the
  // animation appear when no scan was running.
  const showScanning = isScanning;
  
  if (showScanning && (!result || result.findings.length === 0)) {
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
              Nikto is analyzing the web server. Results will appear here as they're discovered.
            </p>
          </div>
        </div>
        <RawOutputPreview rawOutput={rawOutput} title="Nikto terminal output" />
      </div>
    );
  }

  if (!result || result.findings.length === 0) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <Shield className="w-20 h-20 text-muted-foreground/50 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Findings</h3>
            <p className="text-sm text-muted-foreground">
              {result?.scanCompleted
                ? 'Nikto completed without reporting findings.'
                : rawOutput.trim()
                  ? 'Nikto produced terminal output, but no findings were parsed. Review the output below for diagnostics or informational messages.'
                  : 'Run a Nikto scan to discover web server vulnerabilities'}
            </p>
          </div>
        </div>
        <RawOutputPreview rawOutput={rawOutput} title="Nikto terminal output" />
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
              <h2 className="text-sm font-bold text-foreground">Nikto Scan Results</h2>
              <p className="text-xs text-muted-foreground">{result.target}</p>
            </div>
          </div>
          {result.server && (
            <Badge variant="outline" className="font-mono text-xs">
              <Server className="w-3 h-3 mr-1" />
              {result.server}
            </Badge>
          )}
        </div>

        {/* Severity Summary */}
        <div className="grid grid-cols-5 gap-2">
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
        </div>

        {result.scanDuration && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Scan completed in {result.scanDuration}</span>
          </div>
        )}
      </div>

      {/* Findings List */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {categorizedFindings && Object.entries(categorizedFindings).map(([category, findings]) => {
            const categoryFindings = severityFilter === 'all' 
              ? findings 
              : findings.filter(f => f.severity === severityFilter);
            
            if (categoryFindings.length === 0) return null;

            const isExpanded = expandedCategories.has(category);
            const highestSeverity = categoryFindings.reduce((max, f) => {
              const severities: NiktoSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
              const maxIdx = severities.indexOf(max);
              const fIdx = severities.indexOf(f.severity);
              return fIdx > maxIdx ? f.severity : max;
            }, 'info' as NiktoSeverity);

            return (
              <div key={category} className="border border-border rounded-lg overflow-hidden bg-card">
                 <button
                   type="button"
                   onClick={() => toggleCategory(category)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="font-semibold text-sm text-foreground">{category}</span>
                    <Badge variant="secondary" className="text-xs">
                      {categoryFindings.length}
                    </Badge>
                  </div>
                  <SeverityBadge severity={highestSeverity} />
                </button>

                {isExpanded && (
                  <div className="border-t border-border">
                    {categoryFindings.map((finding, idx) => (
                      <FindingCard key={finding.id} finding={finding} isLast={idx === categoryFindings.length - 1} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <RawOutputPreview rawOutput={rawOutput} title="Nikto terminal output" />
    </div>
  );
}

function SeverityCard({ 
  severity, 
  count, 
  active, 
  onClick 
}: { 
  severity: NiktoSeverity; 
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
    unknown: 'from-gray-500 to-gray-400',
  };

  const bgColors = {
    critical: 'bg-purple-500/10 border-purple-500/30',
    high: 'bg-red-500/10 border-red-500/30',
    medium: 'bg-orange-500/10 border-orange-500/30',
    low: 'bg-yellow-500/10 border-yellow-500/30',
    info: 'bg-blue-500/10 border-blue-500/30',
    unknown: 'bg-gray-500/10 border-gray-500/30',
  };

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
        {count}
      </div>
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        {severity}
      </div>
    </button>
  );
}

function SeverityBadge({ severity }: { severity: NiktoSeverity }) {
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

function FindingCard({ finding, isLast }: { finding: NiktoFinding; isLast: boolean }) {
  return (
    <div className={cn(
      "px-4 py-3 hover:bg-muted/30 transition-colors",
      !isLast && "border-b border-border"
    )}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-primary font-semibold">
              {finding.path}
            </code>
            {finding.osvdbId && (
              <Badge variant="outline" className="text-[10px] font-mono">
                {finding.osvdbId}
              </Badge>
            )}
            {finding.cveId && (
              <Badge variant="destructive" className="text-[10px] font-mono">
                {finding.cveId}
              </Badge>
            )}
          </div>
          <p className="text-sm text-foreground">{finding.description}</p>
        </div>
        <SeverityBadge severity={finding.severity} />
      </div>
    </div>
  );
}
