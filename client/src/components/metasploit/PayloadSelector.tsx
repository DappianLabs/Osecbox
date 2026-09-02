import React, { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Zap, Settings, ChevronRight, Shield, Target } from 'lucide-react';

export interface MetasploitPayload {
  name: string;
  fullPath: string;
  platform: string;
  arch: string;
  type: 'staged' | 'stageless' | 'single';
  size: number;
  description?: string;
  options: PayloadOption[];
}

export interface PayloadOption {
  name: string;
  required: boolean;
  default?: string;
  description?: string;
  type?: string;
}

interface PayloadSelectorProps {
  moduleType: string;
  modulePlatform?: string;
  onPayloadSelect: (payload: MetasploitPayload) => void;
  onClose: () => void;
  selectedPayload?: MetasploitPayload;
}

export function PayloadSelector({ 
  moduleType, 
  modulePlatform, 
  onPayloadSelect, 
  onClose,
  selectedPayload 
}: PayloadSelectorProps) {
  const [payloads, setPayloads] = useState<MetasploitPayload[]>([]);
  const [filteredPayloads, setFilteredPayloads] = useState<MetasploitPayload[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Load compatible payloads
  useEffect(() => {
    loadPayloads();
  }, [moduleType, modulePlatform]);

  // Filter payloads based on search and filters
  useEffect(() => {
    let filtered = payloads;

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.fullPath.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Platform filter
    if (platformFilter !== 'all') {
      filtered = filtered.filter(p => p.platform === platformFilter);
    }

    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter(p => p.type === typeFilter);
    }

    setFilteredPayloads(filtered);
  }, [payloads, searchQuery, platformFilter, typeFilter]);

  const loadPayloads = async () => {
    if (!window.electron) return;

    setIsLoading(true);
    try {
      // Get compatible payloads for this module
      const result = await window.electron.msfGetPayloads(moduleType);
      if (result.success && result.payloads) {
        setPayloads(result.payloads);
        
        // Auto-select recommended payload
        const recommended = result.payloads.find(p => p.name.includes('meterpreter/reverse_tcp'));
        if (recommended && !selectedPayload) {
          onPayloadSelect(recommended);
        }
      }
    } catch (error) {
      console.error('Failed to load payloads:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getPayloadIcon = (type: string) => {
    switch (type) {
      case 'staged': return <ChevronRight className="w-4 h-4 text-blue-500" />;
      case 'stageless': return <Zap className="w-4 h-4 text-green-500" />;
      default: return <Shield className="w-4 h-4 text-gray-500" />;
    }
  };

  const getPlatformColor = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'windows': return 'bg-blue-500/10 text-blue-600 border-blue-500/30';
      case 'linux': return 'bg-green-500/10 text-green-600 border-green-500/30';
      case 'osx': return 'bg-gray-500/10 text-gray-600 border-gray-500/30';
      case 'android': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30';
      default: return 'bg-purple-500/10 text-purple-600 border-purple-500/30';
    }
  };

  const uniquePlatforms = [...new Set(payloads.map(p => p.platform))];
  const uniqueTypes = [...new Set(payloads.map(p => p.type))];

  return (
    <div className="ui-dialog-overlay fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="payload-selector-title">
      <div className="ui-popover-enter bg-card rounded-lg border border-border shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border bg-gradient-to-r from-primary/10 to-transparent">
          <div className="flex items-center justify-between">
            <div>
              <h3 id="payload-selector-title" className="text-xl font-bold text-foreground flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                Select Payload
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Choose payload for {moduleType} module
                {modulePlatform && ` (${modulePlatform})`}
              </p>
            </div>
            <Button variant="ghost" onClick={onClose} aria-label="Close payload selector">
              ✕
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search payloads..."
                className="w-full pl-10 pr-4 py-2 bg-background border border-input rounded-lg text-sm"
              />
            </div>

            {/* Platform Filter */}
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="px-3 py-2 bg-background border border-input rounded-lg text-sm"
            >
              <option value="all">All Platforms</option>
              {uniquePlatforms.map(platform => (
                <option key={platform} value={platform}>{platform}</option>
              ))}
            </select>

            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 bg-background border border-input rounded-lg text-sm"
            >
              <option value="all">All Types</option>
              {uniqueTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Payload List */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-muted-foreground">Loading payloads...</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-4 space-y-2">
                {filteredPayloads.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Target className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">No Payloads Found</p>
                    <p className="text-sm">Try adjusting your search or filters</p>
                  </div>
                ) : (
                  filteredPayloads.map((payload, idx) => (
                    <div
                      key={idx}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selectedPayload?.fullPath === payload.fullPath}
                      aria-label={`Select payload ${payload.name}`}
                      onClick={() => onPayloadSelect(payload)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        onPayloadSelect(payload);
                      }}
                      className={`p-4 border rounded-lg cursor-pointer transition-all hover:border-primary/50 hover:shadow-md ${
                        selectedPayload?.fullPath === payload.fullPath
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            {getPayloadIcon(payload.type)}
                            <h4 className="font-semibold text-foreground truncate">
                              {payload.name}
                            </h4>
                            <Badge className={`text-xs ${getPlatformColor(payload.platform)}`}>
                              {payload.platform}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {payload.type}
                            </Badge>
                          </div>
                          
                          <p className="text-xs text-muted-foreground font-mono mb-2 truncate">
                            {payload.fullPath}
                          </p>
                          
                          {payload.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {payload.description}
                            </p>
                          )}
                          
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span>Size: {payload.size} bytes</span>
                            <span>Arch: {payload.arch}</span>
                            <span>Options: {payload.options.length}</span>
                          </div>
                        </div>
                        
                        {selectedPayload?.fullPath === payload.fullPath && (
                          <div className="ml-4 text-primary">
                            <Settings className="w-5 h-5" />
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {filteredPayloads.length} payload{filteredPayloads.length !== 1 ? 's' : ''} available
              {selectedPayload && (
                <span className="ml-4 text-primary font-medium">
                  Selected: {selectedPayload.name}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                onClick={onClose}
                disabled={!selectedPayload}
                className="bg-primary hover:bg-primary/90"
              >
                Use Payload
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
