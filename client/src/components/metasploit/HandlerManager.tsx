import React, { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Pause, 
  Trash2, 
  Plus, 
  RefreshCw, 
  Network, 
  Shield, 
  Eye,
  Settings,
  Zap,
  AlertCircle,
  CheckCircle
} from 'lucide-react';

export interface MetasploitHandler {
  id: number;
  port: number;
  payload: string;
  jobName?: string;
  status: 'listening' | 'stopped' | 'error';
  connections?: number;
  sessionsCount?: number;
  startTime?: number;
  createdAt?: number;
  lastConnection?: number;
  localIp?: string;
}

interface HandlerManagerProps {
  handlers: MetasploitHandler[];
  onCreateHandler: (payload: string, port: number, options: Record<string, string>) => void;
  onStopHandler: (handlerId: number) => void;
  onDeleteHandler: (handlerId: number) => void;
  onRefreshHandlers: () => void;
  isLoading?: boolean;
  isActive?: boolean;
}

export function HandlerManager({
  handlers,
  onCreateHandler,
  onStopHandler,
  onDeleteHandler,
  onRefreshHandlers,
  isLoading = false,
  isActive = true,
}: HandlerManagerProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newHandler, setNewHandler] = useState({
    payload: 'windows/x64/meterpreter/reverse_tcp',
    port: 4444,
    lhost: '',
    options: {} as Record<string, string>
  });

  // Refresh is explicit. Sending `jobs -l` on an interval writes into the
  // user's persistent MSF console and can race with commands typed by hand.

  // Auto-detect local IP
  useEffect(() => {
    if (!isActive) return;
    detectLocalIP();
  }, [isActive]);

  const detectLocalIP = async () => {
    if (!window.electron) return;

    try {
      // executeCommand is shell-free; run platform-specific probes in
      // sequence instead of relying on shell fallback operators.
      const isWindows = window.electron.platform === 'win32';
      const commands = isWindows
        ? ['ipconfig']
        : ['hostname -I', 'ip addr show', 'ifconfig'];
      let output = '';
      for (const command of commands) {
        const result = await window.electron.executeCommand(command);
        output += `${result?.output || ''}\n`;
        if (result?.success && result.output) break;
      }
      const ipMatch = output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      if (ipMatch) {
        setNewHandler(prev => ({ ...prev, lhost: ipMatch[0] }));
      }
    } catch (error) {
      console.error('Failed to detect local IP:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'listening':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'stopped':
        return <Pause className="w-4 h-4 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Network className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'listening':
        return 'bg-green-500/10 text-green-600 border-green-500/30';
      case 'stopped':
        return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30';
      case 'error':
        return 'bg-red-500/10 text-red-600 border-red-500/30';
      default:
        return 'bg-gray-500/10 text-gray-600 border-gray-500/30';
    }
  };

  const formatUptime = (startTime?: number, createdAt?: number) => {
    const started = startTime || createdAt;
    if (!started) return 'N/A';
    const uptime = Date.now() - started;
    const hours = Math.floor(uptime / 3600000);
    const minutes = Math.floor((uptime % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  };

  const handleCreateHandler = () => {
    const options = {
      LHOST: newHandler.lhost,
      LPORT: newHandler.port.toString(),
      ...newHandler.options
    };
    
    onCreateHandler(newHandler.payload, newHandler.port, options);
    setShowCreateDialog(false);
    
    // Reset form
    setNewHandler({
      payload: 'windows/x64/meterpreter/reverse_tcp',
      port: 4444,
      lhost: newHandler.lhost, // Keep detected IP
      options: {}
    });
  };

  const commonPayloads = [
    'windows/x64/meterpreter/reverse_tcp',
    'windows/meterpreter/reverse_tcp',
    'linux/x64/meterpreter/reverse_tcp',
    'linux/x86/meterpreter/reverse_tcp',
    'windows/x64/shell/reverse_tcp',
    'linux/x64/shell/reverse_tcp',
    'generic/shell_reverse_tcp'
  ];

  const listeningHandlers = handlers.filter(h => h.status === 'listening');
  const stoppedHandlers = handlers.filter(h => h.status !== 'listening');

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="p-4 border-b border-border bg-gradient-to-r from-blue-500/10 to-transparent">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Network className="w-5 h-5 text-blue-500" />
              Handler Manager
            </h3>
            <p className="text-sm text-muted-foreground">
              {listeningHandlers.length} listening, {stoppedHandlers.length} stopped
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefreshHandlers}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreateDialog(true)}
              className="bg-primary hover:bg-primary/90"
            >
              <Plus className="w-4 h-4 mr-1" />
              New Handler
            </Button>
          </div>
        </div>
      </div>

      {/* Handler List */}
      <div className="flex-1 overflow-hidden">
        {handlers.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Network className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
              <h4 className="text-lg font-medium text-foreground mb-2">No Handlers</h4>
              <p className="text-sm text-muted-foreground max-w-md mb-4">
                Create handlers to catch reverse shells from exploits
              </p>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Handler
              </Button>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {/* Listening Handlers */}
              {listeningHandlers.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-green-600 mb-3 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Listening Handlers ({listeningHandlers.length})
                  </h4>
                  <div className="space-y-2">
                    {listeningHandlers.map((handler) => (
                      <div
                        key={handler.id}
                        className="p-4 border border-green-500/30 rounded-lg bg-green-500/5"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              {getStatusIcon(handler.status)}
                              <span className="font-semibold text-foreground">
                                Job {handler.id}
                              </span>
                              <Badge className={`text-xs ${getStatusColor(handler.status)}`}>
                                {handler.status}
                              </Badge>
                              {handler.port > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  Port {handler.port}
                                </Badge>
                              )}
                            </div>
                            
                            <div className="text-sm text-muted-foreground mb-2 font-mono break-all">
                              {handler.jobName || handler.payload}
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                              <div>
                                <span className="font-medium">Sessions:</span> {handler.connections ?? handler.sessionsCount ?? 0}
                              </div>
                              <div>
                                <span className="font-medium">Started:</span> {formatUptime(handler.startTime, handler.createdAt)}
                              </div>
                              {handler.localIp && (
                                <div>
                                  <span className="font-medium">Local IP:</span> {handler.localIp}
                                </div>
                              )}
                              {handler.lastConnection && (
                                <div>
                                  <span className="font-medium">Last Connection:</span> {new Date(handler.lastConnection).toLocaleTimeString()}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onStopHandler(handler.id)}
                          >
                            <Pause className="w-3 h-3 mr-1" />
                            Stop
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => onDeleteHandler(handler.id)}
                            className="ml-auto"
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Stopped Handlers */}
              {stoppedHandlers.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-yellow-600 mb-3 flex items-center gap-2">
                    <Pause className="w-4 h-4" />
                    Stopped Handlers ({stoppedHandlers.length})
                  </h4>
                  <div className="space-y-2">
                    {stoppedHandlers.map((handler) => (
                      <div
                        key={handler.id}
                        className="p-4 border rounded-lg bg-card"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              {getStatusIcon(handler.status)}
                              <span className="font-semibold text-foreground">
                                Job {handler.id}
                              </span>
                              <Badge className={`text-xs ${getStatusColor(handler.status)}`}>
                                {handler.status}
                              </Badge>
                              {handler.port > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  Port {handler.port}
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground font-mono break-all">
                              {handler.jobName || handler.payload}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground max-w-44 text-right">
                              Stopped jobs cannot be resumed; create a new handler.
                            </span>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => onDeleteHandler(handler.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Create Handler Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg border border-border shadow-2xl max-w-md w-full">
            <div className="p-4 border-b border-border">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" />
                Create New Handler
              </h3>
            </div>
            
            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Payload
                </label>
                <select
                  value={newHandler.payload}
                  onChange={(e) => setNewHandler(prev => ({ ...prev, payload: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-input rounded text-sm"
                >
                  {commonPayloads.map(payload => (
                    <option key={payload} value={payload}>{payload}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Local Host (LHOST)
                </label>
                <input
                  type="text"
                  value={newHandler.lhost}
                  onChange={(e) => setNewHandler(prev => ({ ...prev, lhost: e.target.value }))}
                  placeholder="192.168.1.100"
                  className="w-full px-3 py-2 bg-background border border-input rounded text-sm font-mono"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Local Port (LPORT)
                </label>
                <input
                  type="number"
                  value={newHandler.port}
                  onChange={(e) => setNewHandler(prev => ({ ...prev, port: parseInt(e.target.value) || 4444 }))}
                  min="1"
                  max="65535"
                  className="w-full px-3 py-2 bg-background border border-input rounded text-sm font-mono"
                />
              </div>
            </div>
            
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateHandler}
                disabled={!newHandler.lhost || !newHandler.port}
                className="bg-primary hover:bg-primary/90"
              >
                <Zap className="w-4 h-4 mr-1" />
                Create Handler
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
