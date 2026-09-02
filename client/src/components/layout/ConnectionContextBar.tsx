import React, { useState, useEffect, useRef } from 'react';
import { useConnectionStore, ConnectionNode } from '@/lib/connection-store';
import { 
  Network, 
  Shield, 
  Radio, 
  GitBranch, 
  Wifi, 
  Monitor,
  ChevronDown,
  ChevronUp,
  X,
  Focus
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Icon mapping for connection roles
const ROLE_ICONS = {
  local: Monitor,
  vpn: Shield,
  foothold: Radio,
  pivot: GitBranch,
  listener: Wifi,
};

const ROLE_COLORS = {
  local: 'text-gray-400',
  vpn: 'text-blue-400',
  foothold: 'text-green-400',
  pivot: 'text-purple-400',
  listener: 'text-orange-400',
};

const ROLE_LABELS = {
  local: 'Local',
  vpn: 'VPN',
  foothold: 'Foothold',
  pivot: 'Pivot',
  listener: 'Listener',
};

interface ConnectionRowProps {
  connection: ConnectionNode;
  onFocus: () => void;
  onClose: () => void;
}

function ConnectionRow({ connection, onFocus, onClose }: ConnectionRowProps) {
  const Icon = ROLE_ICONS[connection.role];
  const colorClass = ROLE_COLORS[connection.role];
  
  const displayText = connection.ip 
    ? `${connection.ip}${connection.port ? `:${connection.port}` : ''}`
    : connection.port 
    ? `:${connection.port}`
    : ROLE_LABELS[connection.role];
  
  const methodText = connection.method ? `[${connection.method}]` : '';
  const timeAgo = formatTimeAgo(connection.createdAt);
  
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-accent/50 rounded group">
      <Icon className={cn('w-3.5 h-3.5', colorClass)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-foreground truncate">
            {displayText}
          </span>
          {methodText && (
            <span className="text-[10px] text-muted-foreground">
              {methodText}
            </span>
          )}
        </div>
        {connection.metadata?.hostname && (
          <div className="text-[10px] text-muted-foreground truncate">
            {connection.metadata.hostname}
          </div>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground">
        {timeAgo}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onFocus}
          className="p-0.5 hover:bg-accent rounded"
          title="Focus Terminal"
          aria-label="Focus terminal"
        >
          <Focus className="w-3 h-3 text-muted-foreground hover:text-foreground" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 hover:bg-destructive/20 rounded"
          title="Remove"
          aria-label="Remove connection"
        >
          <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function ConnectionContextBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // FIX: Use connections object directly and derive active connections
  // This prevents infinite re-renders from getAllActiveConnections() returning new arrays
  const connections = useConnectionStore((state) => state.connections);
  const removeConnection = useConnectionStore((state) => state.removeConnection);
  
  // Derive active connections from connections object
  const activeConnections = React.useMemo(() => {
    const active: ConnectionNode[] = [];
    Object.values(connections).forEach((terminalConnections) => {
      if (terminalConnections.length > 0) {
        active.push(terminalConnections[terminalConnections.length - 1]);
      }
    });
    return active.sort((a, b) => b.createdAt - a.createdAt);
  }, [connections]);
  
  // Auto-collapse when connections reduce
  useEffect(() => {
    if (activeConnections.length <= 3) {
      setIsExpanded(false);
    }
  }, [activeConnections.length]);
  
  // Handle hover with delay to prevent flicker
  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(true);
  };
  
  const handleMouseLeave = () => {
    // Delay closing to allow moving between button and popover
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 200);
  };
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);
  
  // Always show the indicator
  const badgeText = activeConnections.length === 0
    ? `0 Active Connections`
    : activeConnections.length === 1
    ? `1 Active Connection`
    : `${activeConnections.length} Active Connections`;
  
  const isActive = activeConnections.length > 0;
  
  const handleFocusTerminal = (terminalId: string) => {
    // Dispatch custom event to focus terminal
    window.dispatchEvent(new CustomEvent('focus-terminal', { 
      detail: { terminalId }
    }));
    setIsOpen(false);
  };
  
  const handleRemoveConnection = (connection: ConnectionNode) => {
    removeConnection(connection.terminalId, connection.id);
  };
  
  // Clear stale connections on mount (older than 1 hour)
  React.useEffect(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    Object.values(connections).forEach((terminalConnections) => {
      terminalConnections.forEach((conn) => {
        if (conn.createdAt < oneHourAgo) {
          console.log(`[ConnectionContextBar] Removing stale connection: ${conn.id}`);
          removeConnection(conn.terminalId, conn.id);
        }
      });
    });
  }, []); // Run once on mount
  
  const visibleConnections = isExpanded 
    ? activeConnections 
    : activeConnections.slice(0, 3);
  
  const hasMore = activeConnections.length > 3;
  
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-accent/80 rounded transition-colors"
          title="Active Connections"
          aria-label={badgeText}
          aria-expanded={isOpen}
        >
          {isActive && <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />}
          <Network className={`w-3.5 h-3.5 ${isActive ? 'text-green-400' : 'text-muted-foreground'}`} />
          <span className={`text-[11px] font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
            {badgeText}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-2" 
        align="start"
        side="bottom"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 pb-1 border-b border-border">
            <div className="flex items-center gap-2">
              <Network className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-foreground">
                Active Connections ({activeConnections.length})
              </span>
            </div>
            {hasMore && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-accent rounded text-[10px] text-muted-foreground"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Collapse connections' : `Show ${activeConnections.length - 3} more connections`}
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    Collapse
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    +{activeConnections.length - 3} more
                  </>
                )}
              </button>
            )}
          </div>
          
          <div className="max-h-[400px] overflow-y-auto space-y-0.5">
            {visibleConnections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                onFocus={() => handleFocusTerminal(connection.terminalId)}
                onClose={() => handleRemoveConnection(connection)}
              />
            ))}
          </div>
          
          {activeConnections.length === 0 && (
            <div className="text-center py-4 text-[11px] text-muted-foreground">
              No active connections
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
