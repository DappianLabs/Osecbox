import React from 'react';
import { Terminal } from '@/components/terminal/Terminal';
import { Square } from 'lucide-react';

interface SubdomainTerminalPanelProps {
  toolSessions: Array<{
    toolId: string;
    toolName: string;
    domain: string;
    isActive: boolean;
  }>;
  activeSessionId: string;
  activeSession: any;
  selectedTool: string | null;
  domain: string;
  isScanning: boolean;
  tools: Array<{ id: string; name: string }>;
  onCancel?: () => void;
  isActive?: boolean;
  isResizing?: boolean;
}

export const SubdomainTerminalPanel = React.memo(function SubdomainTerminalPanel({
  toolSessions,
  activeSessionId,
  activeSession,
  selectedTool,
  domain,
  isScanning,
  tools,
  onCancel,
  isActive = true,
  isResizing = false,
}: SubdomainTerminalPanelProps) {
  if (toolSessions.length === 0) {
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <div className="text-muted-foreground text-sm">No sessions</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-black relative overflow-hidden">
      {/* Terminal Session Info Bar */}
      {activeSession && (
        <div className="absolute top-0 left-0 right-0 h-10 z-20 bg-blue-500/10 border-b border-blue-500/30 px-3 py-1 flex items-center gap-2 text-xs">
          <span className="text-blue-400 font-mono">Tool:</span>
          <span className="text-blue-300 font-mono font-bold">{selectedTool ? tools.find(t => t.id === selectedTool)?.name || 'None' : 'None'}</span>
          <span className="text-blue-400/60">•</span>
          <span className="text-blue-400/80 font-mono">Domain: {domain || 'No domain'}</span>
          {isScanning && (
            <>
              <span className="text-blue-400/60">•</span>
              <span className="text-green-400 font-mono animate-pulse">● SCANNING</span>
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-2 py-0.5 rounded text-xs font-bold border border-red-500/50 text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-1"
                  aria-label="Stop subdomain scan"
                >
                  <Square className="w-3 h-3" />
                  Stop
                </button>
              </div>
            </>
          )}
        </div>
      )}
      
      {/* Render terminals with EXACT same pattern as scan section */}
      {activeSession && (
        <div
          key={activeSessionId}
          className="absolute inset-0 w-full h-full"
          style={{
            paddingTop: '2.5rem',
            pointerEvents: 'auto',
            zIndex: 10,
          }}
        >
          <Terminal
            sessionId={activeSessionId}
            sessionType="scan"
            className="w-full h-full"
            isActive={isActive}
            disableResize={isResizing}
          />
        </div>
      )}
    </div>
  );
});
