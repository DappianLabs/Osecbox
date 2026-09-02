import React, { useState, useEffect, useRef } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal } from '@/components/terminal/Terminal';
import { 
  Terminal as TerminalIcon, 
  RotateCcw, 
  Settings, 
  Users, 
  Network, 
  Target,
  ArrowLeft,
  Shield,
  AlertCircle,
  CheckCircle,
  Clock
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { usePanelLayoutStore } from '@/lib/panel-layout-store';

interface ConsoleState {
  isReady: boolean;
  currentModule: string | null;
  currentContext: 'main' | 'module' | 'session' | 'auxiliary';
  activeSessionId: number | null;
  moduleOptions: Record<string, any>;
  sessions: any[];
  jobs: any[];
  prompt: string;
  lastCommand: string;
  commandHistory: string[];
}

interface ConsoleOutput {
  id: string;
  timestamp: number;
  command: string;
  output: string;
  success: boolean;
  context: string;
  prompt: string;
}

export function PersistentConsoleView({ isActive = true }: { isActive?: boolean }) {
  const [consoleState, setConsoleState] = useState<ConsoleState | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  // FIX: Use constant terminal ID so terminal persists across remounts
  const terminalSessionId = 'msf-console-persistent';
  const { showToast } = useToast();
  
  // FIX: Track if we've already initialized to prevent re-initialization
  const hasInitialized = useRef(false);
  const initializationPromise = useRef<Promise<void> | null>(null);

  // UNIFIED PERSISTENCE: Use single store for all panel layouts
  const { getPanelSize } = usePanelLayoutStore();
  // Keep the state rail useful without allowing it to crowd the PTY. The
  // Exploit view is intentionally a single split now; clamp any older saved
  // value so a previous wide layout cannot reintroduce the rendering problem.
  const contextPanelSize = Math.min(
    30,
    Math.max(16, getPanelSize('metasploit-console-layout', 'context-panel', 20)),
  );

  // Initialize persistent console as soon as the Exploit/Console view is
  // visible. Calling the idempotent init handler directly removes an extra
  // state round-trip from the cold path; the Electron manager still owns the
  // single shared initialization promise for concurrent callers.
  useEffect(() => {
    if (!isActive) return;

    // FIX: Only initialize once, even if component remounts
    const checkAndInitialize = async () => {
      if (!window.electron) return;
      
      // If already initializing or initialized, skip
      if (hasInitialized.current || initializationPromise.current) {
        console.log('[PersistentConsoleView] Already initialized or initializing, skipping');
        
        // If we have an initialization in progress, wait for it
        if (initializationPromise.current) {
          await initializationPromise.current;
        }
        
        // Try to get current state
        if (window.electron) {
          try {
            const status = await window.electron.msfConsoleState();
            if (status.success && status.state) {
              setConsoleState(status.state);
              setIsInitializing(false);
              await restorePersistentOutput();
            }
            
          } catch (error) {
            console.error('[PersistentConsoleView] Failed to get console state:', error);
          }
        }
        return;
      }
      
      // Mark as initializing
      setIsInitializing(true);
      const initPromise = (async () => {
        if (!window.electron) return;
        
        try {
          // The handler is idempotent and shares the backend manager's
          // initialization promise. This avoids checking state and then
          // immediately issuing a second IPC request on a cold WSL start.
          console.log('[PersistentConsoleView] Requesting console initialization...');
          const result = await window.electron.msfConsoleInit();
          console.log('[PersistentConsoleView] Init result:', result);

          if (!result.success || !result.state) {
            throw new Error(result.error || 'Failed to initialize console');
          }

          setConsoleState(result.state);
          setIsInitializing(false);
          hasInitialized.current = true;
          await restorePersistentOutput();
        } catch (error) {
          console.error('[PersistentConsoleView] Failed to initialize console:', error);
          hasInitialized.current = false;
          showToast(`Failed to initialize console: ${String(error)}`, 'error');
        } finally {
          setIsInitializing(false);
          initializationPromise.current = null;
        }
      })();
      
      initializationPromise.current = initPromise;
      await initPromise;
    };
    
    checkAndInitialize();
  }, [isActive]); // Initialize only when the Exploit view is opened

  // Keep backend event subscriptions alive while the section is hidden. The
  // layout preserves this component specifically so a running console can
  // continue streaming and report an exit/error before the user returns.
  useEffect(() => setupEventListeners(), []);

  const restorePersistentOutput = async () => {
    if (!window.electron) return;

    try {
      const { terminalService } = await import('@/lib/terminal-service');

      // Wait for Terminal's fake PTY bridge to attach. This avoids racing its
      // own buffer replay path during the initial mount.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const terminal = terminalService.getTerminalInstance(terminalSessionId);
        if (terminal?.currentPtyId) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const terminal = terminalService.getTerminalInstance(terminalSessionId);
      if (!terminal?.currentPtyId) return;

      const result = await window.electron.msfConsoleGetBuffer();
      if (!result.success || !result.buffer) return;

      // Output received through listener-output is already in this buffer.
      // Only bridge history across a renderer reload when it is genuinely
      // missing, and append it to the service buffer so later reattachments do
      // not replay it a second time.
      if (!terminalService.getOutput(terminalSessionId)) {
        terminalService.writeExternalOutput(terminalSessionId, result.buffer);
      }
    } catch (error) {
      console.warn('[PersistentConsoleView] Failed to restore console output:', error);
    }
  };
  
  const setupEventListeners = () => {
    if (!window.electron) return () => {};

    const cleanups: Array<() => void> = [];

    // Listen for console state changes
    cleanups.push(window.electron.onMsfConsoleStateChange((state: ConsoleState) => {
      setConsoleState(state);
    }));

    // Listen for console ready
    cleanups.push(window.electron.onMsfConsoleReady((state: ConsoleState) => {
      setConsoleState(state);
      setIsInitializing(false);
      showToast('Metasploit console ready', 'success');
    }));

    // Listen for console errors
    cleanups.push(window.electron.onMsfConsoleError((error: string) => {
      showToast(`Console error: ${error}`, 'error');
      setIsInitializing(false);
    }));

    // Listen for console closed
    cleanups.push(window.electron.onMsfConsoleClosed((code: number) => {
      showToast(`Console closed with code ${code}`, 'warning');
      // Allow the next activation or an explicit retry to initialize a fresh
      // backend instead of treating the dead process as successfully cached.
      hasInitialized.current = false;
      setConsoleState(null);
    }));

    return () => cleanups.forEach(cleanup => cleanup());
  };

  const initializeConsole = async (): Promise<boolean> => {
    if (!window.electron) {
      showToast('Electron API not available', 'error');
      return false;
    }

    setIsInitializing(true);
    console.log('[PersistentConsoleView] Starting console initialization...');
    
    try {
      const result = await window.electron.msfConsoleInit();
      console.log('[PersistentConsoleView] Init result:', result);
      
      if (result.success && result.state) {
        setConsoleState(result.state);
        void restorePersistentOutput();
        return true;
      } else {
        throw new Error(result.error || 'Failed to initialize console');
      }
    } catch (error) {
      console.error('Console initialization failed:', error);
      showToast(`Failed to initialize console: ${String(error)}`, 'error');
      return false;
    } finally {
      setIsInitializing(false);
    }
  };

  const quickCommands = [
    { label: 'Search Exploits', command: 'search type:exploit', icon: Target },
    { label: 'List Sessions', command: 'sessions -l', icon: Users },
    { label: 'List Jobs', command: 'jobs -l', icon: Network },
    { label: 'Show Options', command: 'show options', icon: Settings },
    { label: 'Back to Main', command: 'back', icon: ArrowLeft },
  ];

  const executeQuickCommand = async (command: string) => {
    if (!window.electron || !consoleState?.isReady) return;
    
    try {
      const result = await window.electron.msfConsoleCommand(command);
      if (result.state) {
        setConsoleState(result.state);
      }
      if (!result.success && result.error) {
        showToast(`Command failed: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('Quick command failed:', error);
      showToast(`Command failed: ${String(error)}`, 'error');
    }
  };

  const getContextIcon = (context: string) => {
    switch (context) {
      case 'main': return <TerminalIcon className="w-4 h-4 text-blue-500" />;
      case 'module': return <Target className="w-4 h-4 text-orange-500" />;
      case 'session': return <Shield className="w-4 h-4 text-green-500" />;
      default: return <TerminalIcon className="w-4 h-4 text-gray-500" />;
    }
  };

  const getContextColor = (context: string) => {
    switch (context) {
      case 'main': return 'bg-blue-500/10 text-blue-600 border-blue-500/30';
      case 'module': return 'bg-orange-500/10 text-orange-600 border-orange-500/30';
      case 'session': return 'bg-green-500/10 text-green-600 border-green-500/30';
      default: return 'bg-gray-500/10 text-gray-600 border-gray-500/30';
    }
  };

  const restartConsole = async () => {
    if (!window.electron) return;
    
    setIsInitializing(true);
    try {
      const result = await window.electron.msfConsoleRestart();
      if (result.success && result.state) {
        setConsoleState(result.state);
        showToast('Console restarted successfully', 'success');
      } else {
        throw new Error(result.error || 'Failed to restart console');
      }
    } catch (error) {
      console.error('Console restart failed:', error);
      showToast(`Failed to restart console: ${String(error)}`, 'error');
    } finally {
      setIsInitializing(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-12 bg-muted/30 border-b border-border flex items-center px-4 gap-4">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">Metasploit Console</h3>
        </div>
        
        {consoleState && (
          <div className="flex items-center gap-2">
            {getContextIcon(consoleState.currentContext)}
            <Badge className={`text-xs ${getContextColor(consoleState.currentContext)}`}>
              {consoleState.currentContext}
            </Badge>
            {consoleState.currentModule && (
              <Badge variant="outline" className="text-xs font-mono">
                {consoleState.currentModule.split('/').pop()}
              </Badge>
            )}
          </div>
        )}
        
        <div className="flex items-center gap-2 ml-auto">
          {consoleState?.sessions && consoleState.sessions.length > 0 && (
            <Badge variant="default" className="bg-green-600 text-white">
              <Users className="w-3 h-3 mr-1" />
              {consoleState.sessions.length} {consoleState.sessions.length === 1 ? 'Session' : 'Sessions'}
            </Badge>
          )}
          
          {consoleState?.jobs && consoleState.jobs.length > 0 && (
            <Badge variant="default" className="bg-blue-600 text-white">
              <Network className="w-3 h-3 mr-1" />
              {consoleState.jobs.length} {consoleState.jobs.length === 1 ? 'Job' : 'Jobs'}
            </Badge>
          )}
          
          {consoleState?.isReady ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              <span>Ready</span>
            </div>
          ) : isInitializing ? (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <Clock className="w-4 h-4 animate-spin" />
              <span>Initializing...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4" />
              <span>Not Ready</span>
            </div>
          )}
          
          <Button
            variant="outline"
            size="sm"
            onClick={restartConsole}
            disabled={isInitializing}
            className="flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Restart
          </Button>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 min-w-0">
        {/* Main Console Terminal */}
        <ResizablePanel 
          defaultSize={100 - contextPanelSize}
          minSize={55}
          className="min-h-0 min-w-0 overflow-hidden"
        >
          {/* FIX: Match EXACT structure from scan/subdomain sections */}
          <div className="h-full w-full bg-black relative overflow-hidden">
            {/* Terminal Session Info Bar */}
            <div className="absolute top-0 left-0 right-0 h-10 z-20 bg-blue-500/10 border-b border-blue-500/30 px-3 py-1 flex items-center gap-2 text-xs pointer-events-none">
              <span className="text-blue-400 font-mono">Metasploit:</span>
              <span className="text-blue-300 font-mono font-bold uppercase">msfconsole</span>
              {consoleState?.currentModule && (
                <>
                  <span className="text-blue-400/60">•</span>
                  <span className="text-blue-400/80 font-mono">{consoleState.currentModule}</span>
                </>
              )}
              {consoleState?.isReady ? (
                <>
                  <span className="text-blue-400/60">•</span>
                  <span className="text-green-400 font-mono">● READY</span>
                </>
              ) : isInitializing ? (
                <>
                  <span className="text-blue-400/60">•</span>
                  <span className="text-yellow-400 font-mono animate-pulse">● INITIALIZING</span>
                </>
              ) : null}
            </div>
            
            {/* Terminal - EXACT same pattern as scan section */}
            <div
              className="absolute inset-0 w-full h-full transition-opacity duration-150"
              style={{
                paddingTop: '2.5rem',
                opacity: 1,
                visibility: 'visible',
                pointerEvents: 'auto',
                zIndex: 10,
              }}
            >
              <Terminal 
                sessionId={terminalSessionId}
                sessionType="metasploit"
                className="w-full h-full bg-black"
                isActive={isActive}
              />
            </div>
          </div>
        </ResizablePanel>
        
        <ResizableHandle withHandle className="w-2" />
        
        {/* Context Panel - Shows relevant info based on console state */}
        <ResizablePanel 
          defaultSize={contextPanelSize}
          minSize={16}
          maxSize={30}
          className="min-h-0 min-w-0 overflow-hidden"
        >
          <div className="h-full flex flex-col bg-card">
            {/* Console State Header */}
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-foreground">Console State</h4>
                {consoleState && (
                  <Badge className={`text-xs ${getContextColor(consoleState.currentContext)}`}>
                    {consoleState.currentContext}
                  </Badge>
                )}
              </div>
              
              {!consoleState && !isInitializing && (
                <Button
                  onClick={initializeConsole}
                  className="w-full"
                  size="sm"
                >
                  Initialize Console
                </Button>
              )}
              
              {isInitializing && (
                <div className="text-center text-sm text-muted-foreground py-3">
                  <Clock className="w-4 h-4 animate-spin mx-auto mb-2" />
                  Initializing Metasploit...
                </div>
              )}
            </div>
            
            {/* Context-Aware Content */}
            {consoleState?.isReady && (
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-3">
                  {/* Current Module Info */}
                  {consoleState.currentModule && consoleState.currentContext === 'module' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Target className="w-4 h-4 text-orange-500" />
                        <span>Current Module</span>
                      </div>
                      <div className="bg-muted/50 rounded-md p-3">
                        <p className="text-xs font-mono text-foreground break-all">
                          {consoleState.currentModule}
                        </p>
                      </div>
                      
                      {/* Module Options */}
                      {Object.keys(consoleState.moduleOptions).length > 0 && (
                        <div className="space-y-2 mt-3">
                          <p className="text-xs font-semibold text-muted-foreground">Required Options:</p>
                          <div className="space-y-1">
                            {Object.entries(consoleState.moduleOptions)
                              .filter(([_, opt]: [string, any]) => opt.required && !opt.value)
                              .map(([name, opt]: [string, any]) => (
                                <div key={name} className="flex items-center justify-between text-xs bg-red-500/10 rounded px-2 py-1">
                                  <span className="font-mono text-red-600">{name}</span>
                                  <Badge variant="destructive" className="text-xs">Required</Badge>
                                </div>
                              ))}
                            {Object.entries(consoleState.moduleOptions)
                              .filter(([_, opt]: [string, any]) => opt.required && opt.value)
                              .map(([name, opt]: [string, any]) => (
                                <div key={name} className="flex items-center justify-between text-xs bg-green-500/10 rounded px-2 py-1">
                                  <span className="font-mono text-green-600">{name}</span>
                                  <span className="text-muted-foreground truncate max-w-24" title={opt.value}>{opt.value}</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="flex gap-2 mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => executeQuickCommand('show options')}
                          className="flex-1 text-xs"
                        >
                          <Settings className="w-3 h-3 mr-1" />
                          Options
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => executeQuickCommand('back')}
                          className="flex-1 text-xs"
                        >
                          <ArrowLeft className="w-3 h-3 mr-1" />
                          Back
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {/* Active Sessions */}
                  {consoleState.sessions.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Shield className="w-4 h-4 text-green-500" />
                        <span>Active Sessions ({consoleState.sessions.length})</span>
                      </div>
                      <div className="space-y-2">
                        {consoleState.sessions.map((session: any) => (
                          <div key={session.id} className="bg-muted/50 rounded-md p-2">
                            <div className="flex items-center justify-between mb-1">
                              <Badge variant="default" className="text-xs bg-green-600">
                                Session {session.id}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {session.type}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {session.platform} {session.arch}
                            </p>
                            <p className="text-xs font-mono text-foreground mt-1">
                              {session.tunnel}
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => executeQuickCommand(`sessions -i ${session.id}`)}
                              className="w-full mt-2 text-xs"
                            >
                              <TerminalIcon className="w-3 h-3 mr-1" />
                              Interact
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Active Jobs */}
                  {consoleState.jobs.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Network className="w-4 h-4 text-blue-500" />
                        <span>Active Jobs ({consoleState.jobs.length})</span>
                      </div>
                      <div className="space-y-2">
                        {consoleState.jobs.map((job: any) => (
                          <div key={job.id} className="bg-muted/50 rounded-md p-2">
                            <div className="flex items-center justify-between mb-1">
                              <Badge variant="default" className="text-xs bg-blue-600">
                                Job {job.id}
                              </Badge>
                            </div>
                            <p className="text-xs text-foreground font-mono break-all">
                              {job.name}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Main Context - Show helpful commands */}
                  {consoleState.currentContext === 'main' && consoleState.sessions.length === 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <TerminalIcon className="w-4 h-4 text-blue-500" />
                        <span>Quick Start</span>
                      </div>
                      <div className="space-y-2 text-xs text-muted-foreground">
                        <p>Common commands:</p>
                        <div className="space-y-1 font-mono bg-muted/50 rounded-md p-2">
                          <p className="text-green-400">search type:exploit</p>
                          <p className="text-green-400">use exploit/...</p>
                          <p className="text-green-400">set RHOSTS target</p>
                          <p className="text-green-400">set LHOST your_ip</p>
                          <p className="text-green-400">exploit</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
