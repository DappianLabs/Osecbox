import React, { useState, useRef, useEffect } from 'react';
import { Terminal, X } from 'lucide-react';
import { useGlobalTerminalStore } from '@/lib/global-terminal-store';

interface GlobalTerminalProps {
  context?: string;
}

export function GlobalTerminal({ context = 'tunneling' }: GlobalTerminalProps) {
  const { getOutput, addLine, addLines, clearOutput } = useGlobalTerminalStore();
  const output = getOutput(context);
  const [input, setInput] = useState('');
  const [currentDir, setCurrentDir] = useState('~');
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUserScrollingRef = useRef(false);

  // Get current directory on mount
  useEffect(() => {
    const fetchCurrentDir = async () => {
      if (!window.electron) return;
      
      const isWindows = window.electron.platform === 'win32';
      const dirCommand = isWindows ? 'cd' : 'pwd';
      
      try {
        const result = await window.electron.executeCommand(dirCommand);
        if (result?.success && result?.output) {
          setCurrentDir(result.output.trim());
        } else {
          setCurrentDir(isWindows ? 'C:\\' : '~');
        }
      } catch {
        setCurrentDir(isWindows ? 'C:\\' : '~');
      }
    };
    
    fetchCurrentDir();
  }, []);

  // FIX: Track user scrolling to prevent auto-scroll interference
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const handleScroll = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Check if user is scrolling up (not at bottom)
      const isAtBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 50;
      isUserScrollingRef.current = !isAtBottom;
      
      // Reset user scrolling flag after 2 seconds
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 2000);
    };

    terminal.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      terminal.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // FIX: Only auto-scroll if user isn't manually scrolling
    if (isUserScrollingRef.current) return;
    
    // FIX: Use requestAnimationFrame for smooth scrolling
    requestAnimationFrame(() => {
      if (terminalRef.current && !isUserScrollingRef.current) {
        terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
      }
    });
  }, [output]);

  const handleCommand = async (cmd: string) => {
    if (!cmd.trim()) return;

    const isWindows = window.electron?.platform === 'win32';
    const prompt = isWindows ? `${currentDir}>` : `${currentDir}$`;
    addLine(context, `${prompt} ${cmd}`);
    setInput('');

    // Handle built-in commands
    if (cmd === 'clear' || cmd === 'cls') {
      clearOutput(context);
      return;
    }

    if (cmd === 'help') {
      addLines(context, [
        'Available commands:',
        '  clear/cls - Clear terminal',
        '  help - Show this help',
        '  Any system command will be executed',
        ''
      ]);
      return;
    }

    // Handle cd command - update current directory
    if (cmd.startsWith('cd ') || cmd === 'cd') {
      if (window.electron) {
        try {
          const changeResult = await window.electron.executeCommand(cmd);
          if (!changeResult?.success) {
            addLines(context, [`Error: ${changeResult?.error || 'Command failed'}`, '']);
            return;
          }

          // Get new directory
          const dirCommand = isWindows ? 'cd' : 'pwd';
          const result = await window.electron.executeCommand(dirCommand);
          if (result?.success && result?.output) {
            setCurrentDir(result.output.trim());
          } else if (!result?.success) {
            addLines(context, [`Error: ${result?.error || 'Unable to read current directory'}`, '']);
          }
        } catch (error: any) {
          addLines(context, [`Error: ${error.message || 'Command failed'}`, '']);
        }
      }
      return;
    }

    // Execute system command
    if (window.electron) {
      try {
        const result = await window.electron.executeCommand(cmd);
        if (result?.output) addLines(context, [result.output]);
        if (!result?.success) {
          addLines(context, [`Error: ${result?.error || 'Command failed'}`, '']);
        } else {
          addLines(context, ['']);
        }
      } catch (error: any) {
        addLines(context, [`Error: ${error.message || 'Command failed'}`, '']);
      }
    } else {
      addLines(context, ['Error: Electron not available', '']);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommand(input);
    }
  };

  return (
    <div className="flex flex-col bg-black border-t border-border h-full">
      {/* Terminal Header */}
      <div className="h-8 bg-black border-b border-green-500/30 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-500" />
          <span className="text-xs font-bold text-green-400">Terminal</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => clearOutput(context)}
            className="p-1 hover:bg-green-500/20 rounded transition-colors"
            title="Clear"
          >
            <X className="w-3.5 h-3.5 text-green-500" />
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-sm bg-black text-green-400"
        onClick={() => inputRef.current?.focus()}
        style={{
          // GPU acceleration for smooth scrolling
          willChange: 'scroll-position',
          transform: 'translateZ(0)',
          // Optimize scrolling
          scrollBehavior: 'auto',
          // FIX: Use word-break instead of break-all to preserve word boundaries
          wordBreak: 'break-word',
        }}
      >
        {output.map((line, idx) => (
          <div key={idx} className="whitespace-pre-wrap" style={{ wordBreak: 'break-word' }}>
            {line}
          </div>
        ))}
        
        {/* Input Line */}
        <div className="flex items-center gap-1">
          <span className="text-green-500 font-bold">
            {window.electron?.platform === 'win32' ? `${currentDir}>` : `${currentDir}$`}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none text-green-400 font-mono ml-1"
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}
