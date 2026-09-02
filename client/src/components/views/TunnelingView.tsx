import React, { useState } from 'react';
import { Cable, Copy, Plus, Play, Square, Trash2, Search, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTunnelingStore, TunnelingTool, TunnelingMode, TunnelingSession } from '@/lib/tunneling-store';
import { Terminal } from '@/components/terminal/Terminal';
import { TerminalSearchBar } from '@/components/terminal/TerminalSearchBar';
import { terminalService } from '@/lib/terminal-service';
import {
  interruptTerminalCommand,
  waitForTerminalReady,
  waitForTerminalInterrupt,
  buildManagedShellCommand,
} from '@/lib/terminal/command-lifecycle';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/utils/logger';
import { ViewWithSidebar } from '@/components/layout/ViewWithSidebar';
import { TabBar } from '@/components/nmap/TabBar';
import { useToast } from '@/components/ui/toast';
import { ToolInstallIndicator } from '@/components/layout/ToolInstallIndicator';
import { preflightPort } from '@/lib/runtime-preflight';
import { getLocalTunnelBind, isSafeRemoteHost, isStrictPort, replaceCommandExecutable } from '@/lib/tunneling-preflight';

const MANAGED_COMMAND_EXIT = /\x1b\]9;osecbox-command-exit;(\d+)\x07/;

const TUNNEL_TOOL_BINARIES: Record<TunnelingTool, string> = {
  chisel: 'chisel',
  'ligolo-ng': 'ligolo-ng',
  ssh: 'ssh',
  sshuttle: 'sshuttle',
  ngrok: 'ngrok',
  socat: 'socat',
};

export function TunnelingView({ isActive = true }: { isActive?: boolean }) {
  const { tabs, activeTabId, addTab, closeTab, setActiveTabId } = useTunnelingStore();
  const { showToast } = useToast();
  
  // Get active tab data
  const activeTab = tabs.find(t => t.id === activeTabId);
  const sessions = activeTab?.sessions || [];
  const selectedSession = activeTab?.selectedSession || null;
  
  const addSession = React.useCallback((session: TunnelingSession) => useTunnelingStore.getState().addSession(session), []);
  const updateSession = React.useCallback((sessionId: string, updates: Partial<TunnelingSession>) => useTunnelingStore.getState().updateSession(sessionId, updates), []);
  const removeSession = React.useCallback((sessionId: string) => useTunnelingStore.getState().removeSession(sessionId), []);
  const setSelectedSession = React.useCallback((sessionId: string | null) => useTunnelingStore.getState().setSelectedSession(sessionId), []);
  
  const [showAddDialog, setShowAddDialog] = useState(false);
  const currentSession = sessions.find(s => s.id === selectedSession);
  const prefilledRef = React.useRef<Set<string>>(new Set());
  const stopPromisesRef = React.useRef<Map<string, Promise<void>>>(new Map());
  const startingSessionsRef = React.useRef<Set<string>>(new Set());
  const [startingSessionIds, setStartingSessionIds] = React.useState<Set<string>>(new Set());
  const [stoppingSessionIds, setStoppingSessionIds] = React.useState<Set<string>>(new Set());

  // Register tab system with TabBar
  React.useEffect(() => {
    if (!isActive) return;

    const event = new CustomEvent('tunneling-register-tabs', {
      detail: {
        tabs: tabs.map(t => ({
          id: t.id,
          title: `Tab ${tabs.indexOf(t) + 1}`,
          isScanning: t.sessions.some(s => s.status === 'running'),
        })),
        activeTabId,
        onAddTab: () => {
          addTab();
          showToast('New tab created', 'info');
        },
        onCloseTab: (tabId: string) => {
          closeTab(tabId);
        },
        onSwitchTab: (tabId: string) => {
          setActiveTabId(tabId);
        },
      }
    });
    window.dispatchEvent(event);
  }, [tabs, activeTabId, addTab, closeTab, setActiveTabId, showToast, isActive]);

  // Event listener: Handle process stopped events
  React.useEffect(() => {
    const handleListenerStopped = (event: CustomEvent) => {
      const { listenerId } = event.detail;
      updateSession(listenerId, { status: 'idle' });
    };

    window.addEventListener('listener-stopped', handleListenerStopped as EventListener);
    return () => {
      window.removeEventListener('listener-stopped', handleListenerStopped as EventListener);
    };
  }, [updateSession]);
  
  // FIX: Keyboard shortcut for search (Ctrl+F)
  React.useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && selectedSession) {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, selectedSession]);

  // CONNECTION CONTEXT: Handle focus-terminal events
  React.useEffect(() => {
    if (!isActive) return;

    const handleFocusTerminal = (event: CustomEvent) => {
      const { terminalId } = event.detail;
      // Check if this terminal belongs to a session in this view
      const session = sessions.find(s => s.id === terminalId);
      if (session) {
        setSelectedSession(terminalId);
      }
    };

    window.addEventListener('focus-terminal', handleFocusTerminal as EventListener);
    return () => {
      window.removeEventListener('focus-terminal', handleFocusTerminal as EventListener);
    };
  }, [isActive, sessions, setSelectedSession]);

  // Monitor terminal output to detect when tunnel is actually running
  React.useEffect(() => {
    if (!window.electron) return;

    const handleListenerOutput = (data: { listenerId: string; data: string }) => {
      const state = useTunnelingStore.getState();
      const sessionExists = state.tabs.some(tab =>
        tab.sessions.some(session => session.id === data.listenerId)
      );
      // Ignore late chunks while Stop is still waiting for the shell prompt;
      // otherwise a final line from the old command can flip the new state
      // back to running after the user pressed Stop.
      if (sessionExists && !stopPromisesRef.current.has(data.listenerId)) {
        const exitMarker = data.data.match(MANAGED_COMMAND_EXIT);
        if (exitMarker) {
          const exitCode = Number(exitMarker[1]);
          updateSession(data.listenerId, { status: 'idle' });
          prefilledRef.current.delete(data.listenerId);
          if (exitCode !== 0) {
            logger.warn('TunnelingView', `Tunnel command exited with code ${exitCode}`);
          }
          return;
        }

        const output = data.data.toLowerCase();
        
        // Check for errors first (command failed)
        if (
          output.includes('command not found') ||
          output.includes('not found, but can be installed') ||
          output.includes('no such file or directory') ||
          output.includes('permission denied') ||
          output.includes('error:') ||
          output.includes('failed to') ||
          output.includes('cannot') ||
          output.includes('unable to')
        ) {
          logger.warn('TunnelingView', 'Command failed, setting status to idle');
          updateSession(data.listenerId, { status: 'idle' });
          prefilledRef.current.delete(data.listenerId);
          return;
        }
        
        // Start is reflected optimistically when the command is sent. Generic
        // words such as "tunnel" or "started" also occur in echoed commands
        // and banners, so they are not reliable readiness signals. A real
        // process exit is handled by listener-closed.
      }
    };

    const cleanup = window.electron.onListenerOutput(handleListenerOutput);
    const cleanupClosed = window.electron.onListenerClosed((data: { listenerId: string; code: number }) => {
      updateSession(data.listenerId, { status: 'idle' });
      prefilledRef.current.delete(data.listenerId);
    });
    return () => {
      cleanup();
      cleanupClosed();
    };
  }, [updateSession]);

  // Pre-fill command when session is selected or created
  React.useEffect(() => {
    if (!selectedSession || !window.electron) return;
    
    const session = sessions.find(s => s.id === selectedSession);
    if (!session || !session.command) return;
    
    // Skip if running
    if (session.status === 'running') return;
    
    // Skip if already pre-filled this session
    if (prefilledRef.current.has(selectedSession)) return;
    
    // Mark as pre-filled
    prefilledRef.current.add(selectedSession);
    
    // FIX: Pre-fill as soon as the shell prompt is ready (not a fixed 800ms delay).
    // Sending before the shell is ready dropped the first characters of the command,
    // and the fixed delay was why pre-fill felt late.
    logger.debug('TunnelingView', `Pre-filling command when ready: ${session.command}`);
    terminalService.writeWhenReady(selectedSession, session.command);
  }, [selectedSession, sessions]);

  const stopSession = async (id: string) => {
    if (stopPromisesRef.current.has(id)) return;

    if (!window.electron) {
      prefilledRef.current.delete(id);
      updateSession(id, { status: 'idle' });
      return;
    }
    terminalService.cancelPendingWrites(id);
    setStoppingSessionIds(previous => new Set(previous).add(id));

    // Keep the shell alive and serialize the interrupt with a possible fast
    // Stop -> Start sequence. The next Start waits for the prompt to return.
    const stopPromise = interruptTerminalCommand(id)
      .then(() => {
        prefilledRef.current.delete(id);
        updateSession(id, { status: 'idle' });
      })
      .catch((error) => {
        logger.error('TunnelingView', 'Failed to stop session', error);
        updateSession(id, { status: 'idle' });
      });

    stopPromisesRef.current.set(id, stopPromise);
    await stopPromise;
    if (stopPromisesRef.current.get(id) === stopPromise) {
      stopPromisesRef.current.delete(id);
    }
    setStoppingSessionIds(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  };

  // Terminal search state
  const [showSearch, setShowSearch] = React.useState(false);
  
  // Cleanup PTY AND terminal when session is removed
  const handleRemoveSession = React.useCallback((id: string) => {
    prefilledRef.current.delete(id);
    stopPromisesRef.current.delete(id);
    startingSessionsRef.current.delete(id);
    setStartingSessionIds(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    setStoppingSessionIds(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    // The store owns explicit removal cleanup. Keeping the lifecycle in one
    // place prevents double stop/destroy races between the view and store.
    removeSession(id);
  }, [removeSession]);

  const startSession = React.useCallback(async (session: TunnelingSession) => {
    if (!window.electron) return;
    if (startingSessionsRef.current.has(session.id)) return;

    // EDGE CASE: don't send a bare newline if the command is empty.
    if (!session.command || !session.command.trim()) {
      showToast('No command to run for this tunnel', 'error');
      return;
    }

    startingSessionsRef.current.add(session.id);
    setStartingSessionIds(previous => new Set(previous).add(session.id));
    try {
      await waitForTerminalInterrupt(session.id);
      const latestSession = useTunnelingStore.getState().tabs
        .flatMap(tab => tab.sessions)
        .find(candidate => candidate.id === session.id);
      if (!latestSession || latestSession.status === 'running') return;

      // ToolInstallIndicator is informational. Repeat the check at the
      // action boundary so a stale cache, changed WSL distro, or newly closed
      // binary cannot leave a session marked running when no command can run.
      let runtimeCommand = latestSession.command;
      const commandBinary = runtimeCommand.trim().match(/^(?:sudo\s+-n\s+)?([A-Za-z0-9._-]+)\b/i)?.[1];
      const expectedBinary = TUNNEL_TOOL_BINARIES[latestSession.tool];
      const isLigoloBinary = ['ligolo-ng', 'ligolo-proxy', 'proxy', 'agent'].includes(commandBinary?.toLowerCase() || '');
      if (commandBinary && (
        commandBinary.toLowerCase() === expectedBinary.toLowerCase()
        || (latestSession.tool === 'ligolo-ng' && isLigoloBinary)
      )) {
        const toolResult = await window.electron.checkToolAvailability({
          toolName: commandBinary,
          requiresLinux: true,
        });
        if (!toolResult?.success || !toolResult.available) {
          updateSession(session.id, { status: 'idle' });
          showToast(toolResult?.error || `${commandBinary} is unavailable in the selected security-tool runtime.`, 'error');
          return;
        }

        if (latestSession.tool === 'ligolo-ng') {
          const expectedRole = latestSession.mode === 'server' ? 'proxy' : 'agent';
          let selectedBinary = commandBinary;
          let role = toolResult.role;

          if (role !== expectedRole) {
            const alternateBinary = expectedRole === 'proxy' ? 'proxy' : 'agent';
            const alternate = await window.electron.checkToolAvailability({
              toolName: alternateBinary,
              requiresLinux: true,
            });
            if (alternate?.available && (!alternate.role || alternate.role === expectedRole)) {
              selectedBinary = alternateBinary;
              role = alternate.role;
            }
          }

          if (role !== expectedRole) {
            updateSession(session.id, { status: 'idle' });
            showToast(
              latestSession.mode === 'server'
                ? 'Ligolo-ng server mode needs the proxy binary with -selfcert/-laddr. The selected executable is agent-only; install the proxy binary (usually named proxy) in WSL2.'
                : 'Ligolo-ng client mode needs the agent binary with -connect/-ignore-cert. The selected executable is proxy-only; install the agent binary in WSL2.',
              'error',
            );
            return;
          }

          if (selectedBinary !== commandBinary) {
            runtimeCommand = replaceCommandExecutable(runtimeCommand, selectedBinary);
            updateSession(session.id, { command: runtimeCommand });
          }
        }
      }

      const localBind = getLocalTunnelBind({ ...latestSession, command: runtimeCommand });
      if (localBind && window.electron.checkLocalPort) {
        const portResult = await preflightPort(
          localBind.port,
          localBind.host,
          window.electron.checkLocalPort,
          true,
        );
        if (!portResult.ok) {
          updateSession(session.id, { status: 'idle' });
          showToast(portResult.message || `Local port ${localBind.port} is not available.`, 'error');
          return;
        }
      }

      try {
        // Recover a shell that exited unexpectedly before sending the next
        // command into the session.
        await terminalService.getOrCreateTerminal(session.id, 'tunneling');
        const sessionDuringPrepare = useTunnelingStore.getState().tabs
          .flatMap(tab => tab.sessions)
          .find(candidate => candidate.id === session.id);
        if (!sessionDuringPrepare || sessionDuringPrepare.status === 'running') return;
        terminalService.getOrCreatePTY(session.id, 'tunneling');
        terminalService.attachPTY(session.id, session.id);
        const terminalReady = await waitForTerminalReady(session.id, 5000);
        if (!terminalReady) {
          throw new Error('Tunnel terminal did not become ready');
        }
      } catch (error) {
        logger.error('TunnelingView', 'Failed to prepare terminal for start', error);
        updateSession(session.id, { status: 'idle' });
        return;
      }

      const sessionAfterReady = useTunnelingStore.getState().tabs
        .flatMap(tab => tab.sessions)
        .find(candidate => candidate.id === session.id);
      if (
        !sessionAfterReady ||
        sessionAfterReady.status === 'running' ||
        !terminalService.isPTYActive(session.id)
      ) {
        if (sessionAfterReady && !terminalService.isPTYActive(session.id)) {
          updateSession(session.id, { status: 'idle' });
        }
        return;
      }

      // Optimistically mark running so the header flips to "Stop" immediately.
      terminalService.cancelPendingWrites(session.id);
      prefilledRef.current.add(session.id);
      updateSession(session.id, { status: 'running' });

      // Clear any pre-filled text with Ctrl+U, then enter the command.
      terminalService.writeWhenReady(session.id, '\x15' + await buildManagedShellCommand(runtimeCommand));
    } catch (error) {
      logger.error('TunnelingView', 'Failed to start session', error);
      updateSession(session.id, { status: 'idle' });
    } finally {
      startingSessionsRef.current.delete(session.id);
      setStartingSessionIds(previous => {
        const next = new Set(previous);
        next.delete(session.id);
        return next;
      });
    }
  }, [showToast, updateSession]);

  return (
    <ViewWithSidebar sectionId="tunneling" showSidebar={isActive}>
      <div className="h-full flex flex-col bg-background">
      <TabBar currentView="tunneling" viewType="tunneling" />
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="h-full flex flex-col overflow-hidden min-h-0">
              {/* Control Panel */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/80 bg-card/80 backdrop-blur-sm flex-shrink-0 shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary shadow-sm">
                    <Cable className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground truncate">Tunneling & Port Forwarding</h2>
                    <p className="text-[11px] text-muted-foreground truncate">Pivoting and network tunneling tools</p>
                  </div>
                  <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-2 py-1 text-[10px] font-medium text-primary">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    AI context live
                  </span>
                </div>
                <Button
                  onClick={() => setShowAddDialog(true)}
                  size="sm"
                  className="h-8 rounded-md px-3 font-semibold shadow-sm hover:shadow-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Tunnel
                </Button>
              </div>

              {/* Main Content */}
              <div className="flex-1 flex overflow-hidden min-w-0">
                {/* Session List - Fixed width sidebar */}
                <div className="w-60 flex-shrink-0 border-r border-border/80 bg-card/40 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-3 space-y-2">
                      {sessions.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <Cable className="w-16 h-16 mx-auto mb-4 opacity-30" />
                          <p className="text-base font-semibold">No active sessions</p>
                        </div>
                      ) : (
                        sessions.map((session) => (
                          <button
                            type="button"
                            key={session.id}
                            onClick={() => setSelectedSession(session.id)}
                            aria-pressed={selectedSession === session.id}
                            className={`w-full rounded-md border p-3 cursor-pointer transition-[background-color,border-color,box-shadow,transform] text-left ${
                              selectedSession === session.id
                                ? 'border-primary/60 bg-primary/10 shadow-sm ring-1 ring-primary/20'
                                : 'border-border/70 bg-background/70 hover:border-primary/40 hover:bg-accent/40 hover:shadow-sm'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <Cable className="w-4 h-4 text-purple-500 flex-shrink-0" />
                              <span className="text-sm font-bold text-foreground tracking-tight truncate">
                                {session.name || `${session.tool} :${session.port}`}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground font-mono font-semibold truncate max-w-[100px]">
                                {session.command}
                              </span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0 ${
                                session.status === 'running'
                                  ? 'bg-green-500/20 text-green-600 dark:text-green-500'
                                  : 'bg-muted/50 text-muted-foreground'
                              }`}>
                                {session.status}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Terminal Output - Flex grow to fill remaining space */}
                <div className="flex-1 flex flex-col bg-background overflow-hidden min-h-0">
                  {/* Terminal Header */}
                  {currentSession && (
                    <div className="min-h-11 bg-card/80 backdrop-blur-sm border-b border-border/80 flex items-center justify-between px-4 flex-shrink-0 shadow-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono font-bold text-foreground tracking-tight">
                          {currentSession.tool} : {currentSession.port}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                              navigator.clipboard.writeText(currentSession.command);
                            }
                          }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Copy command"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowSearch(!showSearch)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Search terminal (Ctrl+F)"
                        >
                          <Search className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        {currentSession.status === 'running' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => stopSession(currentSession.id)}
                            loading={stoppingSessionIds.has(currentSession.id)}
                            loadingLabel="Stopping"
                            disabled={stoppingSessionIds.has(currentSession.id)}
                            className="border border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:border-destructive/60 font-semibold text-xs h-8 px-3 shadow-sm"
                          >
                            <Square className="w-3 h-3 mr-1" />
                            Stop
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                             onClick={() => void startSession(currentSession)}
                            loading={startingSessionIds.has(currentSession.id)}
                            loadingLabel="Starting"
                            disabled={startingSessionIds.has(currentSession.id)}
                            className="border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/60 font-semibold text-xs h-8 px-3 shadow-sm"
                          >
                            <Play className="w-3 h-3 mr-1" />
                            Start
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRemoveSession(currentSession.id)}
                          disabled={startingSessionIds.has(currentSession.id) || stoppingSessionIds.has(currentSession.id)}
                          className="border border-border/80 bg-background/50 text-muted-foreground hover:bg-accent hover:text-foreground font-semibold text-xs h-8 w-8 p-0 shadow-sm"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Terminal Content - RENDER ALL TERMINALS FROM ALL TABS (never unmount) */}
                  <div className="flex-1 min-h-0 overflow-hidden relative">
                    {tabs.every(tab => tab.sessions.length === 0) ? (
                      <div className="flex items-center justify-center h-full text-muted-foreground bg-muted/30">
                        <div className="text-center">
                          <Cable className="w-20 h-20 mx-auto mb-6 opacity-30" />
                          <p className="text-lg font-semibold">Select a session to view terminal</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        {selectedSession && (
                          <div className="absolute inset-0">
                            <Terminal
                              key={selectedSession}
                              sessionId={selectedSession}
                              sessionType="tunneling"
                              className="w-full h-full"
                              isActive={isActive}
                            />
                          </div>
                        )}
                        
                        {showSearch && selectedSession && (
                          <TerminalSearchBar
                            sessionId={selectedSession}
                            onClose={() => setShowSearch(false)}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      {/* Add Session Dialog */}
      {showAddDialog && (
        <AddSessionDialog
          onClose={() => setShowAddDialog(false)}
          onAdd={async (tool, mode, port, remoteHost, localPort, remotePort, customCommand, customName, startImmediately = false) => {
            const commands: Record<TunnelingTool, string> = {
              chisel: mode === 'server' ? `chisel server --port ${port} --reverse` : `chisel client ${remoteHost}:${port} R:${localPort}:127.0.0.1:${remotePort}`,
              'ligolo-ng': mode === 'server' ? `ligolo-ng -selfcert -laddr 0.0.0.0:${port}` : `ligolo-ng -connect ${remoteHost}:${port} -ignore-cert`,
              ssh: mode === 'server' ? `ssh -N -R ${remotePort}:localhost:${localPort} user@${remoteHost}` : `ssh -N -L ${localPort}:localhost:${remotePort} user@${remoteHost}`,
              sshuttle: `sshuttle -r user@${remoteHost} 0.0.0.0/0`,
              ngrok: `ngrok tcp ${port}`,
              socat: `socat TCP-LISTEN:${port},fork TCP:${remoteHost}:${remotePort}`
            };

            const newSession: TunnelingSession = {
              id: crypto.randomUUID(), // FIX: Use UUID to prevent ID collisions
              tool,
              mode,
              port,
              remoteHost,
              localPort,
              remotePort,
              command: customCommand || commands[tool],
              status: 'idle',
              name: customName || `${tool} :${port}`
            };

            // Pre-create terminal immediately to avoid delay
            try {
              await terminalService.getOrCreateTerminal(newSession.id, 'tunneling');
              logger.debug('TunnelingView', `Pre-created terminal for session: ${newSession.id}`);
            } catch (error) {
              logger.error('TunnelingView', 'Failed to pre-create terminal', error);
            }

            addSession(newSession);
            setSelectedSession(newSession.id);
            setShowAddDialog(false);
            if (startImmediately) {
              showToast('Tunnel is starting in its persistent terminal.', 'info');
              void startSession(newSession);
            } else {
              showToast('Tunnel command queued in its persistent terminal. Review it, then press Start.', 'info');
            }
          }}
        />
      )}
      </div>
    </ViewWithSidebar>
  );
}

interface AddSessionDialogProps {
  onClose: () => void;
  onAdd: (
    tool: TunnelingTool,
    mode: TunnelingMode,
    port: string,
    remoteHost: string,
    localPort: string,
    remotePort: string,
    customCommand: string,
    customName: string,
    startImmediately?: boolean,
  ) => void;
}

function AddSessionDialog({ onClose, onAdd }: AddSessionDialogProps) {
  const [tool, setTool] = useState<TunnelingTool>('chisel');
  const [mode, setMode] = useState<TunnelingMode>('server');
  const [port, setPort] = useState('8080');
  const [remoteHost, setRemoteHost] = useState('');
  const [localPort, setLocalPort] = useState('');
  const [remotePort, setRemotePort] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [customName, setCustomName] = useState('');

  React.useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Generate command preview
  const generateCommand = () => {
    if (customCommand.trim()) return customCommand;
    
    switch (tool) {
      case 'chisel':
        return mode === 'server' 
          ? `chisel server --port ${port} --reverse` 
          : `chisel client ${remoteHost || '10.10.10.10'}:${port} R:${localPort || '3306'}:127.0.0.1:${remotePort || '3306'}`;
      case 'ligolo-ng':
        return mode === 'server' 
          ? `ligolo-ng -selfcert -laddr 0.0.0.0:${port}` 
          : `ligolo-ng -connect ${remoteHost || '10.10.10.10'}:${port} -ignore-cert`;
      case 'ssh':
        return mode === 'server' 
          ? `ssh -N -R ${remotePort || '3306'}:localhost:${localPort || '3306'} user@${remoteHost || '10.10.10.10'}` 
          : `ssh -N -L ${localPort || '3306'}:localhost:${remotePort || '3306'} user@${remoteHost || '10.10.10.10'}`;
      case 'sshuttle':
        return `sshuttle -r user@${remoteHost || '10.10.10.10'} 0.0.0.0/0`;
      case 'ngrok':
        return `ngrok tcp ${port}`;
      case 'socat':
        return `socat TCP-LISTEN:${port},fork TCP:${remoteHost || '10.10.10.10'}:${remotePort || '3306'}`;
      default:
        return '';
    }
  };

  const previewCommand = generateCommand();
  const [error, setError] = useState<string | null>(null);
  const showPortField = ['chisel', 'ligolo-ng', 'ngrok', 'socat'].includes(tool);
  const showRemoteFields = ['ssh', 'sshuttle', 'socat'].includes(tool)
    || (mode === 'client' && ['chisel', 'ligolo-ng'].includes(tool));
  const showForwardPorts = tool === 'ssh'
    || (tool === 'chisel' && mode === 'client');
  const showSocatRemotePort = tool === 'socat';

  // Maps each tunneling tool to the underlying CLI binary so we can verify it's installed.
  const toolToBinary: Record<TunnelingTool, string> = {
    chisel: 'chisel',
    'ligolo-ng': 'ligolo-ng',
    ssh: 'ssh',
    sshuttle: 'sshuttle',
    ngrok: 'ngrok',
    socat: 'socat',
  };

  const tunnelingTools = [
    { 
      id: 'chisel', 
      name: 'Chisel', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
          <path d="M7 19v-2"/>
          <path d="M12 19v-4"/>
          <path d="M17 19v-6"/>
        </svg>
      ), 
      description: 'Fast TCP/UDP tunnel over HTTP' 
    },
    { 
      id: 'ligolo-ng', 
      name: 'Ligolo-ng', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          <circle cx="12" cy="12" r="1" fill="currentColor"/>
        </svg>
      ), 
      description: 'Advanced tunneling tool' 
    },
    { 
      id: 'ssh', 
      name: 'SSH Tunnel', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          <circle cx="12" cy="16" r="1" fill="currentColor"/>
        </svg>
      ), 
      description: 'SSH port forwarding' 
    },
    { 
      id: 'sshuttle', 
      name: 'SSHuttle', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
          <path d="M2 12h20"/>
        </svg>
      ), 
      description: 'VPN over SSH' 
    },
    { 
      id: 'ngrok', 
      name: 'Ngrok', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      ), 
      description: 'Expose local servers' 
    },
    { 
      id: 'socat', 
      name: 'Socat', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="7.5 4.21 12 6.81 16.5 4.21"/>
          <polyline points="7.5 19.79 7.5 14.6 3 12"/>
          <polyline points="21 12 16.5 14.6 16.5 19.79"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
      ), 
      description: 'Multipurpose relay' 
    },
  ];

  const handleAdd = (startImmediately = false) => {
    const usingCustom = customCommand.trim().length > 0;

    if (!usingCustom) {
      // EDGE CASE: client/relay modes need a remote host
      const needsRemoteHost =
        tool === 'sshuttle' ||
        tool === 'ssh' ||
        tool === 'socat' ||
        (mode === 'client' && ['chisel', 'ligolo-ng'].includes(tool));
      if (needsRemoteHost && !remoteHost.trim()) {
        setError('Enter a remote host (e.g. 10.10.10.10).');
        return;
      }
      if (needsRemoteHost && !isSafeRemoteHost(remoteHost)) {
        setError('Remote host may contain only a hostname, IPv4 address, or bracketed IPv6 address.');
        return;
      }

      // EDGE CASE: validate the port for tools that listen/forward on one
      const needsPort = ['chisel', 'ligolo-ng', 'ngrok', 'socat'].includes(tool);
      if (needsPort) {
        if (!isStrictPort(port)) {
          setError('Enter a valid port between 1 and 65535.');
          return;
        }
      }

      const validatePort = (value: string, label: string) => {
        if (!isStrictPort(value)) {
          setError(`Enter a valid ${label} between 1 and 65535.`);
          return false;
        }
        return true;
      };

      if (tool === 'chisel' && mode === 'client') {
        if (!validatePort(localPort, 'local port') || !validatePort(remotePort, 'remote port')) return;
      }

      if (tool === 'ssh') {
        if (!validatePort(localPort, 'local port') || !validatePort(remotePort, 'remote port')) return;
      }

      if (tool === 'socat' && !validatePort(remotePort, 'remote port')) return;
    }

    // FIX: persist exactly what the preview shows (defaults filled in), so the
    // saved/run command matches what the user reviewed.
    const finalCommand = usingCustom ? customCommand.trim() : generateCommand();
    if (!finalCommand.trim()) {
      setError('No command to run. Check your tunnel settings.');
      return;
    }

    setError(null);
    onAdd(tool, mode, port, remoteHost, localPort, remotePort, finalCommand, customName, startImmediately);
  };

  return (
    <div
      className="ui-dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-tunnel-title"
      aria-describedby="new-tunnel-description"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-popover-enter w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-border/80 bg-card/95 shadow-2xl backdrop-blur-xl">
        <div className="border-b border-border/80 bg-gradient-to-r from-primary/10 via-card/80 to-transparent p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="new-tunnel-title" className="text-lg font-semibold tracking-tight text-foreground">New Tunnel</h3>
              <p id="new-tunnel-description" className="mt-0.5 text-xs text-muted-foreground">Configure a persistent tunnel and keep its output available to the AI.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* Tool Selection */}
          <div>
            <label className="text-xs font-bold text-foreground mb-1.5 block">Tunneling Tool</label>
            <div className="grid grid-cols-2 gap-2">
              {tunnelingTools.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => { setTool(t.id as TunnelingTool); setError(null); }}
                  aria-pressed={tool === t.id}
                  className={`p-2 rounded-lg border-2 transition-all text-left ${
                    tool === t.id ? 'border-primary bg-primary/10 shadow-lg' : 'border-border bg-background hover:border-primary/50'
                  }`}
                >
                  <div className="text-lg mb-0.5">{t.icon}</div>
                  <div className="font-bold text-xs text-foreground">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Verify the underlying tool is installed/connected before the user runs it */}
          <ToolInstallIndicator binary={toolToBinary[tool]} label={tool} />

          {/* Name */}
          <div>
            <label className="text-xs font-bold text-foreground mb-1.5 block">Session Name (Optional)</label>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="My Tunnel"
              className="w-full px-3 py-2 bg-background border-2 border-input rounded-lg text-foreground text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
            />
          </div>

          {/* Mode Selection */}
          {['chisel', 'ligolo-ng', 'ssh'].includes(tool) && (
            <div>
              <label className="text-xs font-bold text-foreground mb-1.5 block">Mode</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('server')}
                  aria-pressed={mode === 'server'}
                  className={`flex-1 px-3 py-2 rounded-lg border-2 font-bold text-xs transition-all ${
                    mode === 'server' ? 'border-green-500 bg-green-500/10 text-green-500' : 'border-border bg-background text-foreground'
                  }`}
                >
                  🖥️ Server (Attacker)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('client')}
                  aria-pressed={mode === 'client'}
                  className={`flex-1 px-3 py-2 rounded-lg border-2 font-bold text-xs transition-all ${
                    mode === 'client' ? 'border-blue-500 bg-blue-500/10 text-blue-500' : 'border-border bg-background text-foreground'
                  }`}
                >
                  💻 Client (Target)
                </button>
              </div>
            </div>
          )}

          {/* Listener/relay port. SSH and SSHuttle use their forwarding fields
              below instead of a standalone listen port. */}
          {showPortField && (
            <div>
              <label className="text-xs font-bold text-foreground mb-1.5 block">Port</label>
              <input
                type="text"
                value={port}
                onChange={(e) => { setPort(e.target.value); setError(null); }}
                placeholder="8080"
                className="w-full px-3 py-2 bg-background border-2 border-input rounded-lg text-foreground text-sm font-mono font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
              />
            </div>
          )}

          {/* Remote/forwarding fields. These are shown for SSH, SSHuttle, and
              Socat in every mode; previously validation required them while the
              UI hid them, making those flows impossible to complete. */}
          {showRemoteFields && (
            <>
              <div>
                <label className="text-xs font-bold text-foreground mb-1.5 block">Remote Host</label>
                <input
                  type="text"
                  value={remoteHost}
                  onChange={(e) => { setRemoteHost(e.target.value); setError(null); }}
                  placeholder="10.10.10.10"
                  className="w-full px-3 py-2 bg-background border-2 border-input rounded-lg text-foreground text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
                />
              </div>
              {showForwardPorts && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-bold text-foreground mb-1.5 block">Local Port</label>
                    <input
                      type="text"
                      value={localPort}
                      onChange={(e) => setLocalPort(e.target.value)}
                      placeholder="3306"
                      className="w-full px-3 py-2 bg-background border-2 border-input rounded-lg text-foreground text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-foreground mb-1.5 block">Remote Port</label>
                    <input
                      type="text"
                      value={remotePort}
                      onChange={(e) => setRemotePort(e.target.value)}
                      placeholder="3306"
                      className="w-full px-3 py-2 bg-background border-2 border-input rounded-lg text-foreground text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
                    />
                  </div>
                </div>
              )}
              {showSocatRemotePort && (
                <div>
                  <label className="text-xs font-bold text-foreground mb-1.5 block">Remote Port</label>
                  <input
                    type="text"
                    value={remotePort}
                    onChange={(e) => { setRemotePort(e.target.value); setError(null); }}
                    placeholder="3306"
                    className="w-full px-3 py-2 bg-background border-2 border-input rounded-lg text-foreground text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
                  />
                </div>
              )}
            </>
          )}

          {/* Command Preview - Editable */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-primary">COMMAND PREVIEW <span className="font-normal text-muted-foreground">(editable)</span></label>
            <textarea
              value={customCommand || previewCommand}
              onChange={(e) => { setCustomCommand(e.target.value); setError(null); }}
              placeholder="Command will be generated based on your settings"
              rows={2}
              className="w-full resize-none rounded-md border border-primary/30 bg-muted/50 px-3 py-2 font-mono text-xs text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Auto-generated from settings above. Edit directly to customize.
            </p>
          </div>
        </div>

        {error && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-red-500/10 border-2 border-red-500/30">
            <p className="text-xs text-red-500 font-medium">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border/80 bg-muted/20 p-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="h-9 rounded-md border-border/80 px-4 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => handleAdd(false)}
              className="h-9 rounded-md border border-border/80 bg-secondary px-4 text-xs font-semibold text-secondary-foreground shadow-sm hover:bg-accent hover:text-accent-foreground hover:shadow-md"
            >
              <Plus className="h-3.5 w-3.5" />
              Queue
            </Button>
            <Button
              onClick={() => handleAdd(true)}
              className="h-9 rounded-md border border-primary/80 px-4 text-xs font-semibold shadow-sm hover:shadow-md"
            >
              <Play className="h-3.5 w-3.5" />
              Start
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
