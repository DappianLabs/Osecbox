import React from 'react';
import { Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import { Terminal } from '@/components/terminal/Terminal';
import { terminalService } from '@/lib/terminal-service';
import { Button } from '@/components/ui/button';

interface MetasploitTerminalProps {
  sessionId: string;
}

export const MetasploitTerminal = React.memo(function MetasploitTerminal({ sessionId }: MetasploitTerminalProps) {
  const handleClearTerminal = () => {
    const terminal = terminalService.getTerminal(sessionId);
    if (terminal) {
      terminal.clear();
      terminalService.clearOutput(sessionId);
    }
  };

  return (
    <div className="h-full flex flex-col bg-black/95 text-green-400 font-mono border border-border">
      <div className="px-3 py-1 bg-black/50 border-b border-green-500/30 flex items-center gap-2">
        <TerminalIcon className="w-4 h-4" />
        <span className="text-xs font-bold">Metasploit Terminal</span>
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearTerminal}
            className="h-6 px-2 text-xs text-green-400 hover:text-green-300 hover:bg-green-500/10"
            title="Clear terminal"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear
          </Button>
        </div>
      </div>
      
      <div className="flex-1 overflow-hidden will-change-[width,height] transform-gpu">
        <Terminal
          sessionId={sessionId}
          sessionType="metasploit"
        />
      </div>
    </div>
  );
});
