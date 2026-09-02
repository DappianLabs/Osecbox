import React from 'react';
import { Globe, Search, X, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SubdomainInputSectionProps {
  domain: string;
  onDomainChange: (domain: string) => void;
  customFlags: string;
  onCustomFlagsChange: (flags: string) => void;
  selectedTool: string | null;
  isScanning: boolean;
  onScan: () => void;
  onCancel: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const SubdomainInputSection = React.memo(({
  domain,
  onDomainChange,
  customFlags,
  onCustomFlagsChange,
  selectedTool,
  isScanning,
  onScan,
  onCancel,
  isCollapsed,
  onToggleCollapse,
}: SubdomainInputSectionProps) => {
  if (isCollapsed) {
    return (
      <div className="relative">
        <div 
          onClick={onToggleCollapse}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleCollapse();
            }
          }}
          role="button"
          tabIndex={0}
          className="h-8 bg-muted/30 border-b border-border flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors group"
        >
          <span className="text-xs text-muted-foreground group-hover:text-foreground font-semibold">Subdomain Enumeration</span>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 bg-card border-2 border-border rounded-full flex items-center justify-center hover:bg-accent transition-colors shadow-lg z-10"
          title="Expand input section"
        >
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 relative pb-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Subdomain Enumeration</h3>
      </div>
      
      {/* Input Section */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Input
            placeholder="Enter domain (e.g., example.com)"
            value={domain}
            onChange={(e) => onDomainChange(e.target.value)}
            className="h-9 px-3 bg-background border-2 border-border hover:border-blue-500/70 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-sm font-mono text-foreground placeholder:text-muted-foreground"
            disabled={isScanning}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && domain && !isScanning && selectedTool) {
                onScan();
              }
            }}
          />
          {isScanning ? (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Globe className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          )}
        </div>
        
        {/* Advanced Options - Inline */}
        {selectedTool && (
          <div className="flex-1 relative">
            <Input
              placeholder="Custom flags (e.g., -t 100 -timeout 30)"
              value={customFlags}
              onChange={(e) => onCustomFlagsChange(e.target.value)}
              className="h-9 px-3 bg-background border-2 border-border hover:border-blue-500/70 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-xs font-mono text-foreground placeholder:text-muted-foreground"
              disabled={isScanning}
            />
            <Settings className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
        )}
        
        <Button
          onClick={onScan}
          disabled={!domain || isScanning || !selectedTool}
          loading={isScanning}
          loadingLabel="Scanning..."
          className="h-9 text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white px-4"
        >
          <Search className="w-5 h-5 mr-2" />
          Enumerate
        </Button>
        
        {/* Cancel Button */}
        {isScanning && (
          <Button
            onClick={onCancel}
            variant="outline"
            aria-label="Cancel subdomain scan"
            className="h-9 text-sm font-bold border-red-500 text-red-500 hover:bg-red-500 hover:text-white px-4"
          >
            <X className="w-5 h-5 mr-2" />
            Cancel
          </Button>
        )}
      </div>
      
      {/* Collapse button at bottom center */}
      <button
        type="button"
        onClick={onToggleCollapse}
        className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 bg-card border-2 border-border rounded-full flex items-center justify-center hover:bg-accent transition-colors shadow-lg z-10"
        title="Collapse input section"
      >
        <ChevronUp className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  );
});

SubdomainInputSection.displayName = 'SubdomainInputSection';
