import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Network, Wifi, Server, RefreshCw, Copy, Terminal } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cleanANSIForDisplay } from '@/lib/utils/ansi-cleaner';

export function DiscoveryView() {
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [output, setOutput] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);

  const isWindows = window.electron?.platform === 'win32';

  const discoveryCommands = [
    {
      id: 'ipconfig',
      name: 'IP Configuration',
      icon: Network,
      description: 'Show network adapter configuration',
      command: isWindows ? 'ipconfig /all' : 'ip a',
      color: 'bg-blue-500',
    },
    {
      id: 'arp',
      name: 'ARP Table',
      icon: Wifi,
      description: 'Display IP to MAC address mappings',
      command: 'arp -a',
      color: 'bg-purple-500',
    },
    {
      id: 'netstat',
      name: 'Network Connections',
      icon: Server,
      description: 'Show active network connections',
      command: isWindows ? 'netstat -ano' : 'netstat -tuln',
      color: 'bg-green-500',
    },
    {
      id: 'route',
      name: 'Routing Table',
      icon: Network,
      description: 'Display network routing table',
      command: isWindows ? 'route print' : 'ip route',
      color: 'bg-orange-500',
    },
    {
      id: 'nslookup',
      name: 'DNS Lookup',
      icon: Server,
      description: 'Query DNS servers',
      command: 'nslookup example.com',
      color: 'bg-cyan-500',
    },
    {
      id: 'ping-gateway',
      name: 'Ping Gateway',
      icon: Wifi,
      description: 'Test connectivity to default gateway',
      command: isWindows ? 'ping -n 4 192.168.1.1' : 'ping -c 4 192.168.1.1',
      color: 'bg-pink-500',
    },
  ];

  const runCommand = async (cmd: string, id: string) => {
    setActiveCommand(id);
    setIsRunning(true);
    setOutput('Running command...\n');

    try {
      if (window.electron) {
        const result = await window.electron.executeCommand(cmd);
        const commandOutput = [result.output, result.error]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join('\n');
        const status = result.success ? '' : `\n\nCommand exited with code ${result.exitCode ?? 'unknown'}.`;
        setOutput(`$ ${cmd}\n\n${commandOutput || 'Command completed with no output.'}${status}`);
      } else {
        setOutput(`$ ${cmd}\n\n[Running in browser mode - command execution not available]`);
      }
    } catch (error: any) {
      setOutput(`Error: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const copyOutput = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(cleanANSIForDisplay(output));
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="p-6 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Network Discovery</h2>
            <p className="text-sm text-muted-foreground">
              Discover devices and network information on your local network
            </p>
          </div>
          <Button
            onClick={() => {
              setOutput('');
              setActiveCommand(null);
            }}
            variant="outline"
            size="sm"
            disabled={!output}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Command Cards */}
        <div className="w-80 border-r border-border bg-card p-4 overflow-y-auto">
          <h3 className="text-sm font-semibold text-foreground mb-3 pb-2 border-b border-border">Discovery Tools</h3>
          <div className="space-y-3">
            {discoveryCommands.map((cmd) => {
              const Icon = cmd.icon;
              const isActive = activeCommand === cmd.id;
              
              return (
              <button
                type="button"
                key={cmd.id}
                  onClick={() => runCommand(cmd.command, cmd.id)}
                  disabled={isRunning}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-all shadow-sm hover:shadow-md ${
                    isActive
                      ? 'border-primary bg-primary/10 shadow-primary/20'
                      : 'border-border bg-card hover:bg-accent hover:border-primary/30'
                  } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`${cmd.color} p-2 rounded-md flex-shrink-0`}>
                      <Icon className="w-4 h-4 text-white dark:text-white" />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="font-medium text-sm text-foreground">{cmd.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{cmd.description}</div>
                      <div className="text-xs font-mono text-muted-foreground/70 mt-1 truncate">
                        {cmd.command}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quick Actions */}
          <div className="mt-6 pt-4 border-t border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3 pb-2 border-b border-border">Quick Actions</h3>
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start border-2 hover:border-primary/50 hover:shadow-md transition-all"
                onClick={() => runCommand('nmap -sn 192.168.1.0/24', 'quick-scan')}
                disabled={isRunning}
              >
                <Network className="w-4 h-4 mr-2" />
                Quick Network Scan
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start border-2 hover:border-primary/50 hover:shadow-md transition-all"
                onClick={() => runCommand('nmap -sP 192.168.1.0/24', 'ping-scan')}
                disabled={isRunning}
              >
                <Wifi className="w-4 h-4 mr-2" />
                Ping Sweep
              </Button>
            </div>
          </div>
        </div>

        {/* Output Panel */}
        <div className="flex-1 flex flex-col bg-background">
          {output ? (
            <>
              <div className="p-3 border-b border-border bg-card flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Command Output</span>
                  {isRunning && (
                    <span className="text-xs text-muted-foreground animate-pulse">Running...</span>
                  )}
                </div>
                <Button
                  onClick={copyOutput}
                  variant="ghost"
                  size="sm"
                  className="h-7"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
              </div>
              <ScrollArea className="flex-1 p-4">
                <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">
                  {cleanANSIForDisplay(output)}
                </pre>
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Terminal className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p className="text-sm">Select a discovery tool to get started</p>
                <p className="text-xs mt-2">Run network commands to discover devices and information</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
