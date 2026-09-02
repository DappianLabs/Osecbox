import React from 'react';
import { Search, X, Filter, SortAsc, SortDesc } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type SortField = 'subdomain' | 'ip' | 'status' | 'ports';
type SortOrder = 'asc' | 'desc';

interface SubdomainFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: 'all' | 'active' | 'inactive' | 'unknown';
  onStatusFilterChange: (filter: 'all' | 'active' | 'inactive' | 'unknown') => void;
  sortField: SortField;
  sortOrder: SortOrder;
  onSortChange: (field: SortField) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
}

export const SubdomainFilterBar = React.memo(({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortField,
  sortOrder,
  onSortChange,
  showFilters,
  onToggleFilters,
}: SubdomainFilterBarProps) => {
  return (
    <div className="px-4 py-2 border-b border-border bg-muted/20 flex-shrink-0">
      <div className="flex gap-2 items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            placeholder="Filter results by subdomain, IP, or ports..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-7 pr-8 text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 hover:text-foreground text-muted-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <Button
          onClick={onToggleFilters}
          variant="outline"
          size="sm"
          className="h-8 text-xs"
        >
          <Filter className="w-3 h-3 mr-1" />
          {showFilters ? 'Hide' : 'Show'} Filters
        </Button>
      </div>
      
      {showFilters && (
        <div className="flex items-center gap-2 mt-2 p-2 bg-background rounded-md border border-border">
          <span className="text-xs font-semibold text-muted-foreground">Status:</span>
          <div className="flex gap-1">
            {(['all', 'active', 'inactive', 'unknown'] as const).map((status) => (
              <button
                type="button"
                key={status}
                onClick={() => onStatusFilterChange(status)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  statusFilter === status
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex-1"></div>
          <span className="text-xs font-semibold text-muted-foreground">Sort:</span>
          <div className="flex gap-1">
            {(['subdomain', 'ip', 'status'] as SortField[]).map((field) => (
              <button
                type="button"
                key={field}
                onClick={() => onSortChange(field)}
                className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                  sortField === field
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-accent'
                }`}
              >
                {field.charAt(0).toUpperCase() + field.slice(1)}
                {sortField === field && (
                  sortOrder === 'asc' ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

SubdomainFilterBar.displayName = 'SubdomainFilterBar';
