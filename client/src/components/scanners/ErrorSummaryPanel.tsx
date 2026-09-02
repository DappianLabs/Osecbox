/**
 * Error Summary Panel
 * Shows scan errors and warnings in the results area
 */

import React from 'react';
import { AlertCircle, XCircle, AlertTriangle, RefreshCw, ExternalLink, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { cleanANSIForDisplay } from '@/lib/utils/ansi-cleaner';

export interface ScanError {
  id: string;
  timestamp: number;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  details?: string;
  tool?: string;
  target?: string;
  command?: string;
}

interface ErrorSummaryPanelProps {
  errors: ScanError[];
  onRetry?: () => void;
  onClear?: () => void;
  className?: string;
}

export function ErrorSummaryPanel({ errors, onRetry, onClear, className }: ErrorSummaryPanelProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = React.useState(true); // Start collapsed

  if (errors.length === 0) {
    return null;
  }

  const errorCount = errors.filter(e => e.type === 'error').length;
  const warningCount = errors.filter(e => e.type === 'warning').length;

  return (
    <Card className={cn("border-2 border-red-500/50 bg-red-950/20 max-w-2xl mx-auto", className)}>
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <XCircle className="w-5 h-5 text-red-500" />
            <div>
              <h3 className="font-semibold text-foreground">Scan Issues Detected</h3>
              <div className="flex items-center gap-2 mt-1">
                {errorCount > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {errorCount} {errorCount === 1 ? 'Error' : 'Errors'}
                  </Badge>
                )}
                {warningCount > 0 && (
                  <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-500">
                    {warningCount} {warningCount === 1 ? 'Warning' : 'Warnings'}
                  </Badge>
                )}
              </div>
            </div>
            <ChevronDown className={cn(
              "w-4 h-4 text-muted-foreground transition-transform ml-2",
              !isCollapsed && "rotate-180"
            )} />
          </button>
          <div className="flex items-center gap-2">
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            )}
            {onClear && (
              <Button size="sm" variant="ghost" onClick={onClear}>
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {!isCollapsed && (
        <ScrollArea className="max-h-[300px]">
        <div className="p-4 space-y-3">
          {errors.map((error) => (
            <div
              key={error.id}
              className={cn(
                "p-3 rounded-lg border-2 transition-all",
                error.type === 'error' && "border-red-500/50 bg-red-950/30",
                error.type === 'warning' && "border-yellow-500/50 bg-yellow-950/30",
                error.type === 'info' && "border-blue-500/50 bg-blue-950/30"
              )}
            >
              <div className="flex items-start gap-3">
                {error.type === 'error' && <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />}
                {error.type === 'warning' && <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />}
                {error.type === 'info' && <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />}
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm text-foreground">{error.title}</h4>
                      <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
                      
                      {error.tool && (
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-xs">
                            {error.tool}
                          </Badge>
                          {error.target && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {error.target}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(error.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {(error.details || error.command) && (
                    <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === error.id ? null : error.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        {expandedId === error.id ? 'Hide' : 'Show'} details
                      </button>
                      
                      {expandedId === error.id && (
                        <div className="mt-2 space-y-2">
                          {error.command && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Command:</div>
                              <pre className="p-2 bg-black/50 rounded text-xs text-green-400 overflow-x-auto font-mono">
                                {cleanANSIForDisplay(error.command)}
                              </pre>
                            </div>
                          )}
                          {error.details && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Error Details:</div>
                              <pre className="p-2 bg-black/50 rounded text-xs text-red-400 overflow-x-auto font-mono">
                                {cleanANSIForDisplay(error.details)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* COMPREHENSIVE: Show detailed error solutions */}
                  {error.details && error.details.length > 0 && (
                    <div className="mt-2 p-3 bg-blue-950/30 border border-blue-500/30 rounded text-xs">
                      <div className="font-semibold text-blue-400 mb-2 flex items-center gap-1">
                        💡 How to Fix:
                      </div>
                      <div className="text-muted-foreground whitespace-pre-line leading-relaxed">
                        {cleanANSIForDisplay(error.details)}
                      </div>
                    </div>
                  )}
                  
                  {/* Legacy quick fixes for backward compatibility */}
                  {!error.details && error.message.includes('not found') && (
                    <div className="mt-2 p-2 bg-blue-950/30 border border-blue-500/30 rounded text-xs">
                      <div className="font-semibold text-blue-400 mb-1">💡 Quick Fix:</div>
                      <div className="text-muted-foreground">
                        Install the tool using: <code className="text-green-400">sudo apt install {error.tool || 'tool-name'}</code>
                      </div>
                    </div>
                  )}

                  {!error.details && error.message.includes('permission denied') && (
                    <div className="mt-2 p-2 bg-blue-950/30 border border-blue-500/30 rounded text-xs">
                      <div className="font-semibold text-blue-400 mb-1">💡 Quick Fix:</div>
                      <div className="text-muted-foreground">
                        Run with sudo or check file permissions
                      </div>
                    </div>
                  )}

                  {!error.details && error.message.includes('timeout') && (
                    <div className="mt-2 p-2 bg-blue-950/30 border border-blue-500/30 rounded text-xs">
                      <div className="font-semibold text-blue-400 mb-1">💡 Quick Fix:</div>
                      <div className="text-muted-foreground">
                        Target may be down or blocking scans. Try with different options or verify target is reachable.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      )}
    </Card>
  );
}
