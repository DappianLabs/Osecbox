import React from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SubdomainStatsBarProps {
  totalCount: number;
  filteredCount: number;
  activeCount: number;
  inactiveCount: number;
  bulkSelectMode: boolean;
  selectedCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCopySelected: () => void;
}

export const SubdomainStatsBar = React.memo(({
  totalCount,
  filteredCount,
  activeCount,
  inactiveCount,
  bulkSelectMode,
  selectedCount,
  onSelectAll,
  onDeselectAll,
  onCopySelected,
}: SubdomainStatsBarProps) => {
  return (
    <div className="px-6 py-3 border-b border-border bg-muted/30 flex items-center gap-6 flex-shrink-0">
      <div className="text-sm">
        <span className="text-muted-foreground">Total:</span>{' '}
        <span className="font-semibold text-foreground">{totalCount}</span>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">Filtered:</span>{' '}
        <span className="font-semibold text-foreground">{filteredCount}</span>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">Active:</span>{' '}
        <span className="font-semibold text-green-600 dark:text-green-400">
          {activeCount}
        </span>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">Inactive:</span>{' '}
        <span className="font-semibold text-red-600 dark:text-red-400">
          {inactiveCount}
        </span>
      </div>
      
      {bulkSelectMode && (
        <>
          <div className="flex-1"></div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {selectedCount} selected
            </span>
            <Button onClick={onSelectAll} variant="outline" size="sm" className="h-6 text-xs">
              Select All
            </Button>
            <Button onClick={onDeselectAll} variant="outline" size="sm" className="h-6 text-xs">
              Clear
            </Button>
            <Button onClick={onCopySelected} variant="outline" size="sm" className="h-6 text-xs" disabled={selectedCount === 0}>
              <Copy className="w-3 h-3 mr-1" />
              Copy
            </Button>
          </div>
        </>
      )}
    </div>
  );
});

SubdomainStatsBar.displayName = 'SubdomainStatsBar';
