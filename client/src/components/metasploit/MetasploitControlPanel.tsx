import React, { useState, useEffect } from 'react';
import { Search, Filter, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MetasploitControlPanelProps {
  onSearch: (query: string, filterType?: string) => void;
  isSearching: boolean;
  filterType: 'all' | 'exploit' | 'auxiliary' | 'post';
  onFilterChange: (filterType: 'all' | 'exploit' | 'auxiliary' | 'post') => void;
}

export function MetasploitControlPanel({ onSearch, isSearching, filterType, onFilterChange }: MetasploitControlPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = () => {
    if (searchQuery.trim()) {
      // Pass filter type to search
      const filter = filterType !== 'all' ? filterType : undefined;
      onSearch(searchQuery.trim(), filter);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="h-16 bg-card border-b border-border flex items-center px-4 gap-3">
      {/* Search Input */}
      <div className="flex-1 flex items-center gap-2 bg-background border border-input rounded-lg px-3 py-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Search exploits, payloads, auxiliary modules..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>

      {/* Filter Dropdown */}
      <select
        value={filterType}
        onChange={(e) => onFilterChange(e.target.value as 'all' | 'exploit' | 'auxiliary' | 'post')}
        className="h-10 px-3 bg-background border border-input rounded-lg text-sm text-foreground outline-none cursor-pointer"
      >
        <option value="all">All Modules</option>
        <option value="exploit">Exploits</option>
        <option value="auxiliary">Auxiliary</option>
        <option value="post">Post</option>
      </select>

      {/* Search Button */}
      <Button
        onClick={handleSearch}
        disabled={!searchQuery.trim() || isSearching}
        className="bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        <Zap className="w-4 h-4 mr-2" />
        {isSearching ? 'Searching...' : 'Search'}
      </Button>
    </div>
  );
}
