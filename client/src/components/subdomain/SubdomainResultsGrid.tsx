import React, { useRef, useEffect } from 'react';
import { Globe, Copy, ArrowRight, ExternalLink, CheckSquare, Filter } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

interface Subdomain {
  subdomain: string;
  ip: string;
  status: 'active' | 'inactive' | 'unknown';
  ports?: string;
}

type ViewDensity = 'compact' | 'comfortable' | 'line';

interface SubdomainResultsGridProps {
  subdomains: Subdomain[];
  viewDensity: ViewDensity;
  bulkSelectMode: boolean;
  selectedSubdomains: Set<string>;
  selectedSubdomain: string | null;
  onSubdomainClick: (subdomain: string) => void;
  onSubdomainContextMenu: (e: React.MouseEvent, subdomain: Subdomain) => void;
  onToggleSelection: (subdomain: string) => void;
  onSendToScan: (subdomain: Subdomain) => void;
  onCopyIP: (ip: string, e?: React.MouseEvent) => void;
  showRightClickHint: boolean;
  onClearFilters: () => void;
}

export const SubdomainResultsGrid = React.memo(({
  subdomains,
  viewDensity,
  bulkSelectMode,
  selectedSubdomains,
  selectedSubdomain,
  onSubdomainClick,
  onSubdomainContextMenu,
  onToggleSelection,
  onSendToScan,
  onCopyIP,
  showRightClickHint,
  onClearFilters,
}: SubdomainResultsGridProps) => {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // PERFORMANCE: Clean up cardRefs Map to prevent memory leak
  useEffect(() => {
    const currentSubdomains = new Set(subdomains.map(s => s.subdomain));
    const refsToDelete: string[] = [];
    
    cardRefs.current.forEach((_, key) => {
      if (!currentSubdomains.has(key)) {
        refsToDelete.push(key);
      }
    });
    
    refsToDelete.forEach(key => cardRefs.current.delete(key));
  }, [subdomains]);

  // Get card size based on density
  const getCardClasses = () => {
    switch (viewDensity) {
      case 'compact':
        return 'p-3 gap-2';
      case 'line':
        return 'p-3 gap-3 flex-row items-center'; // Line view: horizontal layout with flex-row
      default:
        return 'p-4 gap-3';
    }
  };

  const getGridCols = () => {
    switch (viewDensity) {
      case 'compact':
        return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
      case 'line':
        return ''; // Line view: no grid, use flex instead
      default:
        return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
    }
  };

  const getContainerClasses = () => {
    return viewDensity === 'line' ? 'flex flex-col gap-3' : `grid ${getGridCols()} gap-3`;
  };

  // Empty state
  if (subdomains.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground p-8">
        <Filter className="w-12 h-12 mb-3 opacity-20" />
        <p className="text-sm">No subdomains match your filters</p>
        <Button
          onClick={onClearFilters}
          variant="outline"
          size="sm"
          className="mt-3"
        >
          Clear Filters
        </Button>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 h-full w-full">
      <div className="h-full">
        <div className={`${viewDensity === 'line' ? 'px-2' : 'p-4'} ${getContainerClasses()}`}>
          {subdomains.map((sub, idx) => (
            <div
              key={sub.subdomain}
              ref={(el) => {
                if (el) cardRefs.current.set(sub.subdomain, el);
              }}
              tabIndex={0}
              role="button"
              aria-label={`Subdomain ${sub.subdomain}`}
              className={`group relative bg-card border-2 rounded-lg ${getCardClasses()} ${viewDensity === 'line' ? 'flex' : ''} hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                selectedSubdomain === sub.subdomain 
                  ? 'border-blue-500 bg-blue-500/5 shadow-lg shadow-blue-500/20' 
                  : 'border-border'
              } ${selectedSubdomains.has(sub.subdomain) ? 'ring-2 ring-blue-400' : ''}`}
              onClick={() => {
                if (bulkSelectMode) {
                  onToggleSelection(sub.subdomain);
                } else {
                  onSubdomainClick(sub.subdomain);
                }
              }}
              onContextMenu={(e) => onSubdomainContextMenu(e, sub)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (bulkSelectMode) {
                    onToggleSelection(sub.subdomain);
                  } else {
                    onSubdomainClick(sub.subdomain);
                  }
                }
              }}
            >
              {/* Bulk Select Checkbox */}
              {bulkSelectMode && (
                <div className="absolute top-2 left-2 z-10">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    selectedSubdomains.has(sub.subdomain)
                      ? 'bg-blue-500 border-blue-500'
                      : 'bg-background border-border'
                  }`}>
                    {selectedSubdomains.has(sub.subdomain) && (
                      <CheckSquare className="w-4 h-4 text-white" />
                    )}
                  </div>
                </div>
              )}

              {/* Right-click hint (first card only) */}
              {idx === 0 && showRightClickHint && (
                <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full shadow-lg animate-bounce">
                  Right-click me!
                </div>
              )}

              {/* Subdomain */}
              <div className={viewDensity === 'line' ? 'flex-1 min-w-[200px]' : (viewDensity === 'compact' ? 'mb-2' : 'mb-3')}>
                <div className="flex items-start gap-2 mb-1">
                  <Globe className={`text-blue-500 mt-0.5 flex-shrink-0 ${viewDensity === 'compact' ? 'w-3 h-3' : 'w-4 h-4'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`font-mono font-bold text-foreground ${viewDensity === 'line' ? 'truncate' : 'break-all'} leading-tight ${viewDensity === 'compact' ? 'text-xs' : 'text-sm'}`}>
                      {sub.subdomain}
                    </p>
                  </div>
                </div>
              </div>

              {/* IP Address */}
              <div className={`bg-muted/50 rounded-md ${viewDensity === 'line' ? 'flex-shrink-0 w-[180px] p-2' : (viewDensity === 'compact' ? 'p-1.5 mb-2' : 'p-2 mb-3')}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">IP Address</p>
                    <p className={`font-mono font-semibold text-foreground truncate ${viewDensity === 'compact' ? 'text-xs' : 'text-sm'}`}>
                      {sub.ip}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => onCopyIP(sub.ip, e)}
                    className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-blue-500 transition-all p-1 hover:bg-blue-500/10 rounded"
                    title="Copy IP"
                    aria-label="Copy IP address"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className={`flex gap-2 ${viewDensity === 'line' ? 'flex-shrink-0' : (viewDensity === 'compact' ? 'flex-col pt-2 border-t border-border/50' : 'pt-2 border-t border-border/50')}`}>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendToScan(sub);
                  }}
                  size="sm"
                  variant="outline"
                  className={`flex-1 hover:bg-blue-500 hover:text-white hover:border-blue-500 ${viewDensity === 'compact' ? 'text-xs h-6' : 'text-xs h-7'}`}
                >
                  <ArrowRight className="w-3 h-3 mr-1" />
                  Scan
                </Button>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(`http://${sub.subdomain}`, '_blank');
                  }}
                  size="sm"
                  variant="outline"
                  className={`hover:bg-blue-500 hover:text-white hover:border-blue-500 ${viewDensity === 'compact' ? 'text-xs h-6 px-2 flex-1' : 'text-xs h-7 px-2'}`}
                  title="Open in browser"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-lg"></div>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
});

SubdomainResultsGrid.displayName = 'SubdomainResultsGrid';
