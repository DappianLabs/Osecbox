import React, { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Terminal, 
  Send, 
  Download, 
  Upload, 
  Camera, 
  Folder, 
  FileText, 
  Cpu, 
  Users, 
  Shield,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  ChevronRight,
  Home,
  ArrowUp
} from 'lucide-react';
import { cleanANSIForDisplay } from '@/lib/utils/ansi-cleaner';

interface MeterpreterCommand {
  id: string;
  command: string;
  output: string;
  timestamp: number;
  type: 'command' | 'info' | 'error' | 'success';
}

interface FileSystemItem {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  permissions?: string;
}

interface MeterpreterInterfaceProps {
  sessionId: number;
  onClose: () => void;
}

export function MeterpreterInterface({ sessionId, onClose }: MeterpreterInterfaceProps) {
  const [commands, setCommands] = useState<MeterpreterCommand[]>([]);
  const [currentCommand, setCurrentCommand] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentPath, setCurrentPath] = useState('C:\\');
  const [fileSystem, setFileSystem] = useState<FileSystemItem[]>([]);
  const [showFileSystem, setShowFileSystem] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const commandInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new commands are added
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [commands]);

  // Load session info on mount
  useEffect(() => {
    loadSessionInfo();
    executeCommand('pwd', false);
  }, [sessionId]);

  const loadSessionInfo = async () => {
    try {
      const result = await executeCommand('sysinfo', false);
      if (result) {
        setSessionInfo(result);
      }
    } catch (error) {
      console.error('Failed to load session info:', error);
    }
  };

  const executeCommand = async (cmd: string, addToHistory = true) => {
    if (!window.electron || !cmd.trim()) return;

    const commandId = Date.now().toString();
    const newCommand: MeterpreterCommand = {
      id: commandId,
      command: cmd,
      output: '',
      timestamp: Date.now(),
      type: 'command'
    };

    setCommands(prev => [...prev, newCommand]);
    setIsExecuting(true);

    if (addToHistory) {
      setCommandHistory(prev => [...prev, cmd]);
      setHistoryIndex(-1);
    }

    try {
      const result = await window.electron.msfSessionCommand(String(sessionId), cmd);
      
      setCommands(prev => prev.map(c => 
        c.id === commandId 
          ? { 
              ...c, 
              output: result.output || result.error || 'Command executed',
              type: result.success ? 'success' : 'error'
            }
          : c
      ));

      // Update current path if it's a navigation command
      if (cmd.startsWith('cd ') && result.success) {
        const newPath = cmd.substring(3).trim();
        setCurrentPath(newPath);
        loadFileSystem(newPath);
      }

      // Load file system if it's a directory listing
      if ((cmd === 'ls' || cmd === 'dir') && result.success) {
        parseFileSystemOutput(result.output || '');
      }

      return result;
    } catch (error) {
      setCommands(prev => prev.map(c => 
        c.id === commandId 
          ? { 
              ...c, 
              output: `Error: ${error}`,
              type: 'error'
            }
          : c
      ));
    } finally {
      setIsExecuting(false);
    }
  };

  const loadFileSystem = async (path?: string) => {
    const targetPath = path || currentPath;
    try {
      const result = await executeCommand(`ls "${targetPath}"`, false);
      if (result && result.success) {
        parseFileSystemOutput(result.output || '');
      }
    } catch (error) {
      console.error('Failed to load file system:', error);
    }
  };

  const parseFileSystemOutput = (output: string) => {
    const lines = cleanANSIForDisplay(output).split('\n').filter(line => line.trim());
    const items: FileSystemItem[] = [];

    lines.forEach(line => {
      // Parse different file listing formats
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[parts.length - 1];
        const isDirectory = line.includes('<DIR>') || line.startsWith('d');
        
        items.push({
          name,
          type: isDirectory ? 'directory' : 'file',
          size: isDirectory ? undefined : parseInt(parts[parts.length - 2]) || 0,
          permissions: parts[0],
        });
      }
    });

    setFileSystem(items);
  };

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentCommand.trim() && !isExecuting) {
      executeCommand(currentCommand.trim());
      setCurrentCommand('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setCurrentCommand(commandHistory[commandHistory.length - 1 - newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCurrentCommand(commandHistory[commandHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCurrentCommand('');
      }
    }
  };

  const quickCommands = [
    { label: 'System Info', cmd: 'sysinfo', icon: Cpu },
    { label: 'Current User', cmd: 'getuid', icon: Users },
    { label: 'Processes', cmd: 'ps', icon: Terminal },
    { label: 'Screenshot', cmd: 'screenshot', icon: Camera },
    { label: 'List Files', cmd: 'ls', icon: Folder },
    { label: 'Network Config', cmd: 'ipconfig', icon: Shield },
  ];

  const navigateToDirectory = (dirName: string) => {
    const newPath = currentPath.endsWith('/') || currentPath.endsWith('\\') 
      ? `${currentPath}${dirName}`
      : `${currentPath}/${dirName}`;
    executeCommand(`cd "${newPath}"`);
  };

  const navigateUp = () => {
    executeCommand('cd ..');
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg border border-border shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border bg-gradient-to-r from-green-500/10 to-transparent">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Shield className="w-5 h-5 text-green-500" />
                Meterpreter Session {sessionId}
              </h3>
              <p className="text-sm text-muted-foreground">
                Interactive shell - {currentPath}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFileSystem(!showFileSystem)}
              >
                {showFileSystem ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showFileSystem ? 'Hide' : 'Show'} Files
              </Button>
              <Button variant="ghost" onClick={onClose}>
                ✕
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Terminal */}
          <div className="flex-1 flex flex-col">
            {/* Quick Commands */}
            <div className="p-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground mr-2">Quick:</span>
                {quickCommands.map((cmd, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => executeCommand(cmd.cmd)}
                    disabled={isExecuting}
                    className="h-7 text-xs"
                  >
                    <cmd.icon className="w-3 h-3 mr-1" />
                    {cmd.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Command Output */}
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div ref={outputRef} className="p-4 font-mono text-sm space-y-2">
                  {commands.map((cmd) => (
                    <div key={cmd.id} className="space-y-1">
                      <div className="flex items-center gap-2 text-blue-400">
                        <ChevronRight className="w-3 h-3" />
                        <span className="font-semibold">meterpreter &gt;</span>
                        <span>{cmd.command}</span>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            cmd.type === 'success' ? 'text-green-500' :
                            cmd.type === 'error' ? 'text-red-500' : 'text-blue-500'
                          }`}
                        >
                          {new Date(cmd.timestamp).toLocaleTimeString()}
                        </Badge>
                      </div>
                      {cmd.output && (
                        <pre className={`text-xs whitespace-pre-wrap pl-6 ${
                          cmd.type === 'error' ? 'text-red-400' : 'text-green-400'
                        }`}>
                          {cleanANSIForDisplay(cmd.output)}
                        </pre>
                      )}
                    </div>
                  ))}
                  
                  {isExecuting && (
                    <div className="flex items-center gap-2 text-yellow-400 pl-6">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span className="text-xs">Executing command...</span>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Command Input */}
            <div className="p-4 border-t border-border bg-muted/30">
              <form onSubmit={handleCommandSubmit} className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-blue-400 font-mono text-sm">
                  <Terminal className="w-4 h-4" />
                  <span>meterpreter &gt;</span>
                </div>
                <input
                  ref={commandInputRef}
                  type="text"
                  value={currentCommand}
                  onChange={(e) => setCurrentCommand(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter meterpreter command..."
                  disabled={isExecuting}
                  className="flex-1 bg-background border border-input rounded px-3 py-2 text-sm font-mono focus:border-primary focus:ring-1 focus:ring-primary/50 focus:outline-none"
                />
                <Button 
                  type="submit" 
                  disabled={!currentCommand.trim() || isExecuting}
                  size="sm"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </form>
              <div className="mt-2 text-xs text-muted-foreground">
                Use ↑/↓ arrows for command history • Tab for autocomplete • Ctrl+C to interrupt
              </div>
            </div>
          </div>

          {/* File System Panel */}
          {showFileSystem && (
            <div className="w-80 border-l border-border bg-muted/30">
              <div className="p-3 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-foreground">File System</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadFileSystem()}
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => executeCommand('cd /')}
                    className="h-6 px-2"
                  >
                    <Home className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={navigateUp}
                    className="h-6 px-2"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </Button>
                  <span className="font-mono text-muted-foreground truncate">
                    {currentPath}
                  </span>
                </div>
              </div>
              
              <ScrollArea className="h-96">
                <div className="p-2 space-y-1">
                  {fileSystem.map((item, idx) => (
                    <div
                      key={idx}
                      role={item.type === 'directory' ? 'button' : undefined}
                      tabIndex={item.type === 'directory' ? 0 : undefined}
                      aria-label={item.type === 'directory' ? `Open directory ${item.name}` : undefined}
                      onClick={() => item.type === 'directory' && navigateToDirectory(item.name)}
                      onKeyDown={(event) => {
                        if (item.type !== 'directory' || (event.key !== 'Enter' && event.key !== ' ')) return;
                        event.preventDefault();
                        navigateToDirectory(item.name);
                      }}
                      className={`flex items-center gap-2 p-2 rounded text-xs hover:bg-accent ${
                        item.type === 'directory' ? 'cursor-pointer' : ''
                      }`}
                    >
                      {item.type === 'directory' ? (
                        <Folder className="w-4 h-4 text-blue-500" />
                      ) : (
                        <FileText className="w-4 h-4 text-gray-500" />
                      )}
                      <span className="flex-1 truncate font-mono">{item.name}</span>
                      {item.size !== undefined && (
                        <span className="text-muted-foreground">
                          {item.size < 1024 ? `${item.size}B` : `${Math.round(item.size/1024)}KB`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
