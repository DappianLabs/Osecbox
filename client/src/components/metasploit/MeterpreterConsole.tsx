import React, { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Terminal, 
  Camera, 
  Download, 
  Upload, 
  Users, 
  Shield, 
  Cpu, 
  HardDrive,
  Network,
  Key,
  Eye,
  ArrowLeft
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { cleanANSIForDisplay } from '@/lib/utils/ansi-cleaner';

interface MeterpreterConsoleProps {
  sessionId: number;
  onClose: () => void;
}

interface MeterpreterOutput {
  id: string;
  timestamp: number;
  command: string;
  output: string;
  success: boolean;
}

export function MeterpreterConsole({ sessionId, onClose }: MeterpreterConsoleProps) {
  const [output, setOutput] = useState<MeterpreterOutput[]>([]);
  const [currentCommand, setCurrentCommand] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const { showToast } = useToast();
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new output is added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const executeCommand = async (command: string) => {
    if (!window.electron || isExecuting) return;

    setIsExecuting(true);
    const trimmedCommand = command.trim();
    
    // Add to command history
    if (trimmedCommand && !commandHistory.includes(trimmedCommand)) {
      const newHistory = [trimmedCommand, ...commandHistory.slice(0, 49)];
      setCommandHistory(newHistory);
    }
    setHistoryIndex(-1);

    try {
      // First interact with the session
      await window.electron.msfConsoleSessions('interact', sessionId);
      
      // Then send the meterpreter command
      const result = await window.electron.msfConsoleCommand(trimmedCommand);
      
      addOutput(
        Date.now().toString(),
        trimmedCommand,
        result.output || '',
        result.success
      );

      if (!result.success && result.error) {
        showToast(`Command failed: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('Meterpreter command failed:', error);
      showToast(`Command failed: ${String(error)}`, 'error');
      addOutput(
        Date.now().toString(),
        trimmedCommand,
        `Error: ${String(error)}`,
        false
      );
    } finally {
      setIsExecuting(false);
      setCurrentCommand('');
    }
  };

  const addOutput = (id: string, command: string, output: string, success: boolean) => {
    const newOutput: MeterpreterOutput = {
      id,
      timestamp: Date.now(),
      command,
      output,
      success
    };
    
    setOutput(prev => [...prev, newOutput]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentCommand.trim()) {
        executeCommand(currentCommand);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setCurrentCommand(commandHistory[newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCurrentCommand(commandHistory[newIndex] || '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCurrentCommand('');
      }
    }
  };

  const quickCommands = [
    { label: 'System Info', command: 'sysinfo', icon: Cpu },
    { label: 'Get User ID', command: 'getuid', icon: Users },
    { label: 'Get Privileges', command: 'getprivs', icon: Shield },
    { label: 'Process List', command: 'ps', icon: HardDrive },
    { label: 'Screenshot', command: 'screenshot', icon: Camera },
    { label: 'Hash Dump', command: 'hashdump', icon: Key },
    { label: 'Network Config', command: 'ipconfig', icon: Network },
    { label: 'Get System', command: 'getsystem', icon: Shield },
  ];

  const backgroundSession = async () => {
    if (!window.electron) return;
    try {
      await window.electron.msfConsoleBackground();
      showToast(`Session ${sessionId} backgrounded`, 'success');
      onClose();
    } catch (error) {
      console.error('Failed to background session:', error);
      showToast('Failed to background session', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg border border-border shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border bg-gradient-to-r from-green-500/10 to-transparent">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                <Terminal className="w-5 h-5 text-green-500" />
                Meterpreter Session {sessionId}
              </h3>
              <p className="text-sm text-muted-foreground">
                Interactive Meterpreter console
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={backgroundSession}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Background
              </Button>
              <Button variant="ghost" onClick={onClose}>
                ✕
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Console */}
          <div className="flex-1 flex flex-col bg-black text-green-400 font-mono">
            {/* Console Output */}
            <ScrollArea className="flex-1 p-4" ref={outputRef}>
              <div className="space-y-2">
                <div className="text-green-300 text-sm">
                  Meterpreter session {sessionId} opened
                </div>
                
                {output.map((item) => (
                  <div key={item.id} className="space-y-1">
                    {/* Command */}
                    <div className="flex items-center gap-2 text-blue-400">
                      <span className="text-gray-500 text-xs">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-yellow-400">meterpreter &gt;</span>
                      <span className="text-white">{item.command}</span>
                    </div>
                    
                    {/* Output */}
                    {item.output && (
                      <div className={cn(
                        "whitespace-pre-wrap text-sm pl-4 border-l-2",
                        item.success 
                          ? "border-green-500 text-green-300" 
                          : "border-red-500 text-red-300"
                      )}>
                        {cleanANSIForDisplay(item.output)}
                      </div>
                    )}
                  </div>
                ))}
                
                {isExecuting && (
                  <div className="flex items-center gap-2 text-blue-400">
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                    <span>Executing...</span>
                  </div>
                )}
              </div>
            </ScrollArea>
            
            {/* Command Input */}
            <div className="border-t border-gray-700 p-4">
              <div className="flex items-center gap-2">
                <span className="text-yellow-400 flex-shrink-0">
                  meterpreter &gt;
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={currentCommand}
                  onChange={(e) => setCurrentCommand(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isExecuting}
                  className="flex-1 bg-transparent border-none outline-none text-white placeholder-gray-500"
                  placeholder="Enter meterpreter command..."
                />
                {isExecuting && (
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            </div>
          </div>
          
          {/* Quick Commands Panel */}
          <div className="w-80 border-l border-border bg-card">
            <div className="p-4 border-b border-border">
              <h4 className="text-sm font-semibold text-foreground mb-3">Quick Commands</h4>
              <div className="grid grid-cols-2 gap-2">
                {quickCommands.map((cmd, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => executeCommand(cmd.command)}
                    disabled={isExecuting}
                    className="justify-start text-xs h-8"
                  >
                    <cmd.icon className="w-3 h-3 mr-1" />
                    {cmd.label}
                  </Button>
                ))}
              </div>
            </div>
            
            {/* Advanced Commands */}
            <div className="p-4 border-b border-border">
              <h4 className="text-sm font-semibold text-foreground mb-3">Advanced</h4>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => executeCommand('migrate')}
                  disabled={isExecuting}
                  className="w-full justify-start text-xs"
                >
                  <Shield className="w-3 h-3 mr-2" />
                  Process Migration
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => executeCommand('keyscan_start')}
                  disabled={isExecuting}
                  className="w-full justify-start text-xs"
                >
                  <Eye className="w-3 h-3 mr-2" />
                  Start Keylogger
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => executeCommand('webcam_snap')}
                  disabled={isExecuting}
                  className="w-full justify-start text-xs"
                >
                  <Camera className="w-3 h-3 mr-2" />
                  Webcam Snapshot
                </Button>
              </div>
            </div>
            
            {/* File Operations */}
            <div className="p-4">
              <h4 className="text-sm font-semibold text-foreground mb-3">File Operations</h4>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => executeCommand('pwd')}
                  disabled={isExecuting}
                  className="w-full justify-start text-xs"
                >
                  <HardDrive className="w-3 h-3 mr-2" />
                  Current Directory
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => executeCommand('ls')}
                  disabled={isExecuting}
                  className="w-full justify-start text-xs"
                >
                  <HardDrive className="w-3 h-3 mr-2" />
                  List Files
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentCommand('download ')}
                  disabled={isExecuting}
                  className="w-full justify-start text-xs"
                >
                  <Download className="w-3 h-3 mr-2" />
                  Download File
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentCommand('upload ')}
                  disabled={isExecuting}
                  className="w-full justify-start text-xs"
                >
                  <Upload className="w-3 h-3 mr-2" />
                  Upload File
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
