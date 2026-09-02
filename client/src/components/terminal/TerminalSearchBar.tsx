/**
 * Terminal Search Bar
 * 
 * Search UI for terminals - uses xterm SearchAddon.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { terminalService } from '@/lib/terminal-service';

interface TerminalSearchBarProps {
  sessionId: string;
  onClose: () => void;
}

export function TerminalSearchBar({ sessionId, onClose }: TerminalSearchBarProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchAddonRef = useRef<any>(null);

  // Get SearchAddon from terminalService
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 10;
    
    const tryGetSearchAddon = () => {
      const searchAddon = terminalService.getSearchAddon(sessionId);
      
      if (searchAddon) {
        searchAddonRef.current = searchAddon;
        inputRef.current?.focus();
        return true;
      }
      
      // Retry if not found yet (terminal might still be initializing)
      if (retryCount < maxRetries) {
        retryCount++;
        setTimeout(tryGetSearchAddon, 100);
        return false;
      }
      
      console.error('[TerminalSearchBar] SearchAddon not found after retries:', sessionId);
      return false;
    };
    
    tryGetSearchAddon();
  }, [sessionId]);

  const handleSearch = (direction: 'next' | 'prev') => {
    if (!query) return;

    if (!searchAddonRef.current) {
      console.error('[TerminalSearchBar] SearchAddon not available');
      return;
    }

    const options = {
      caseSensitive,
      wholeWord,
      regex,
      decorations: {
        matchBackground: '#ff0000',
        matchBorder: '#ff0000',
        matchOverviewRuler: '#ff0000',
        activeMatchBackground: '#ff6600',
        activeMatchBorder: '#ff6600',
      }
    };

    try {
      if (direction === 'next') {
        searchAddonRef.current.findNext(query, options);
      } else {
        searchAddonRef.current.findPrevious(query, options);
      }
    } catch (error) {
      console.error('[TerminalSearchBar] Search error:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch(e.shiftKey ? 'prev' : 'next');
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="terminal-search-bar ui-popover-enter absolute top-0 right-0 z-50 bg-card border border-primary/70 shadow-2xl rounded-lg m-2 p-3 flex items-center gap-2">
      {/* Search Icon */}
      <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search terminal output..."
        className="flex-1 bg-background border border-input rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
      />

      {/* Navigation */}
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleSearch('prev')}
          disabled={!query}
          className="h-7 w-7 p-0"
          title="Previous match (Shift+Enter)"
          aria-label="Previous terminal match"
        >
          <ChevronUp className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleSearch('next')}
          disabled={!query}
          className="h-7 w-7 p-0"
          title="Next match (Enter)"
          aria-label="Next terminal match"
        >
          <ChevronDown className="w-4 h-4" />
        </Button>
      </div>

      {/* Options */}
      <div className="flex gap-1 border-l border-border pl-2">
        <Button
          size="sm"
          variant={caseSensitive ? 'default' : 'ghost'}
          onClick={() => setCaseSensitive(!caseSensitive)}
          className="h-7 px-2 text-xs font-mono"
          title="Case sensitive"
          aria-pressed={caseSensitive}
        >
          Aa
        </Button>
        <Button
          size="sm"
          variant={wholeWord ? 'default' : 'ghost'}
          onClick={() => setWholeWord(!wholeWord)}
          className="h-7 px-2 text-xs font-mono"
          title="Whole word"
          aria-pressed={wholeWord}
        >
          |a|
        </Button>
        <Button
          size="sm"
          variant={regex ? 'default' : 'ghost'}
          onClick={() => setRegex(!regex)}
          className="h-7 px-2 text-xs font-mono"
          title="Regular expression"
          aria-pressed={regex}
        >
          .*
        </Button>
      </div>

      {/* Close */}
      <Button
        size="sm"
        variant="ghost"
        onClick={onClose}
        className="h-7 w-7 p-0"
        title="Close (Escape)"
        aria-label="Close terminal search"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
