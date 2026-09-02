import React, { useState } from 'react';
import { Plus, Radio, Server, Terminal as TerminalIcon, Play, Square, Trash2, Copy, Search, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFootholdStore, ListenerType, Listener } from '@/lib/foothold-store';
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
import { usePlatform } from '@/hooks/usePlatform';
import { preflightPort, preflightTool } from '@/lib/runtime-preflight';
import { getLocalListenerBind } from '@/lib/listener-preflight';

const MANAGED_COMMAND_EXIT = /\x1b\]9;osecbox-command-exit;(\d+)\x07/;
const NETCAT_ALTERNATIVES = ['ncat'] as const;

function listenerBinary(type: ListenerType, linuxRuntime: boolean): string | null {
  switch (type) {
    case 'netcat': return linuxRuntime ? 'nc' : 'ncat';
    case 'pwncat': return 'pwncat-cs';
    case 'socat': return 'socat';
    case 'meterpreter': return 'msfconsole';
    case 'http-server': return linuxRuntime ? 'python3' : 'python';
    case 'sliver': return 'sliver-server';
    default: return null;
  }
}

function commandStartsWithBinary(command: string, binary: string): boolean {
  const first = command.trim().match(/^([A-Za-z0-9._/-]+)/)?.[1];
  return Boolean(first && first.split('/').pop()?.toLowerCase() === binary.toLowerCase());
}

async function resolveListenerBinary(
  type: ListenerType,
  linuxRuntime: boolean,
): Promise<{ binary: string | null; message?: string }> {
  const preferred = listenerBinary(type, linuxRuntime);
  if (!preferred || !window.electron?.checkToolAvailability) {
    return { binary: preferred };
  }

  const primary = await preflightTool(preferred, window.electron.checkToolAvailability, true);
  if (primary.ok) return { binary: preferred };

  // Debian/Kali normally provide nc, while Fedora and some minimal images
  // expose the same capability as ncat. Keep both names valid without making
  // the user edit the generated listener command.
  if (type === 'netcat' && linuxRuntime && preferred === 'nc') {
    const fallback = await preflightTool('ncat', window.electron.checkToolAvailability, true);
    if (fallback.ok) return { binary: 'ncat' };
  }

  return { binary: preferred, message: primary.message };
}

export function FootholdView({ isActive = true }: { isActive?: boolean }) {
  const { tabs, activeTabId, addTab, closeTab, setActiveTabId } = useFootholdStore();
  const { showToast } = useToast();
  const { platformInfo } = usePlatform();
  
  // Get active tab data
  const activeTab = tabs.find(t => t.id === activeTabId);
  const listeners = activeTab?.listeners || [];
  const selectedListener = activeTab?.selectedListener || null;
  
  const addListenerToStore = React.useCallback((listener: Listener) => useFootholdStore.getState().addListener(listener), []);
  const updateListener = React.useCallback((id: string, updates: Partial<Listener>) => useFootholdStore.getState().updateListener(id, updates), []);
  const removeListenerFromStore = React.useCallback((id: string) => useFootholdStore.getState().removeListener(id), []);
  const setSelectedListener = React.useCallback((id: string | null) => useFootholdStore.getState().setSelectedListener(id), []);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const prefilledRef = React.useRef<Set<string>>(new Set());
  const stopPromisesRef = React.useRef<Map<string, Promise<void>>>(new Map());
  const startingListenersRef = React.useRef<Set<string>>(new Set());
  const [startingListenerIds, setStartingListenerIds] = React.useState<Set<string>>(new Set());
  const [stoppingListenerIds, setStoppingListenerIds] = React.useState<Set<string>>(new Set());
  const isWindows = window.electron?.platform === 'win32';
  // Listener commands execute in the selected runtime, not necessarily the
  // host OS. On Windows with WSL2 available, use Linux command names and
  // shell syntax so the preview, tool indicator, and PTY agree.
  const useLinuxExecution = platformInfo
    ? platformInfo.isLinux || platformInfo.isMac || platformInfo.wsl2Status === 'available'
    : !isWindows;

  async function resolveLinuxExecution(fallback: boolean): Promise<boolean> {
    if (!window.electron?.getPlatformInfo) return fallback;

    try {
      const result = await window.electron.getPlatformInfo();
      const info = result?.platformInfo || result?.info;
      if (!info) return fallback;
      return Boolean(info.isLinux || info.isMac || info.wsl2Status === 'available');
    } catch {
      return fallback;
    }
  }

  function adaptListenerCommand(command: string, type: ListenerType, linuxRuntime: boolean): string {
    if (!command) return command;

    if (type === 'http-server') {
      return command.replace(
        /(^|\s)python(?:3)?(?=\s+-m\s+http\.server\b)/i,
        `$1${linuxRuntime ? 'python3' : 'python'}`,
      );
    }

    if (type === 'socat') {
      return linuxRuntime
        ? command.replace(/EXEC:(?:cmd\.exe|cmd)\b/i, 'EXEC:/bin/bash')
        : command.replace(/EXEC:\/bin\/bash\b/i, 'EXEC:cmd.exe');
    }

    if (type === 'netcat') {
      return linuxRuntime
        ? command.replace(/^(\s*)ncat\b/i, '$1nc')
        : command.replace(/^(\s*)nc\b/i, '$1ncat');
    }

    return command;
  }

  // Event listener: Handle process stopped events
  React.useEffect(() => {
    const handleListenerStopped = (event: CustomEvent) => {
      const { listenerId } = event.detail;
      updateListener(listenerId, { status: 'stopped' });
    };

    window.addEventListener('listener-stopped', handleListenerStopped as EventListener);
    return () => {
      window.removeEventListener('listener-stopped', handleListenerStopped as EventListener);
    };
  }, [updateListener]);
  
  // FIX: Keyboard shortcut for search (Ctrl+F)
  React.useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && selectedListener) {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, selectedListener]);

  // CONNECTION CONTEXT: Handle focus-terminal events
  React.useEffect(() => {
    if (!isActive) return;

    const handleFocusTerminal = (event: CustomEvent) => {
      const { terminalId } = event.detail;
      // Check if this terminal belongs to a listener in this view
      const listener = listeners.find(l => l.id === terminalId);
      if (listener) {
        setSelectedListener(terminalId);
      }
    };

    window.addEventListener('focus-terminal', handleFocusTerminal as EventListener);
    return () => {
      window.removeEventListener('focus-terminal', handleFocusTerminal as EventListener);
    };
  }, [isActive, listeners, setSelectedListener]);

  // Monitor terminal output to detect when listener is actually running
  React.useEffect(() => {
    if (!window.electron) return;

    const handleListenerOutput = (data: { listenerId: string; data: string }) => {
      const listenerExists = useFootholdStore.getState().tabs.some(tab =>
        tab.listeners.some(listener => listener.id === data.listenerId)
      );
      // Ignore late chunks while Stop is still waiting for the shell prompt;
      // otherwise a final line from the old command can flip the new state
      // back to running after the user pressed Stop.
      if (listenerExists && !stopPromisesRef.current.has(data.listenerId)) {
        const exitMarker = data.data.match(MANAGED_COMMAND_EXIT);
        if (exitMarker) {
          const exitCode = Number(exitMarker[1]);
          updateListener(data.listenerId, { status: 'stopped' });
          prefilledRef.current.delete(data.listenerId);
          if (exitCode !== 0) {
            logger.warn('FootholdView', `Listener command exited with code ${exitCode}`);
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
          logger.warn('FootholdView', 'Command failed, setting status to stopped');
          updateListener(data.listenerId, { status: 'stopped' });
          prefilledRef.current.delete(data.listenerId);
          return;
        }
        
        // Start is already reflected optimistically when the command is sent.
        // Do not infer readiness from generic words such as "started" in an
        // echoed command or tool banner; only explicit failures may change the
        // state here. A real process exit is handled by listener-closed.
      }
    };

    const cleanup = window.electron.onListenerOutput(handleListenerOutput);
    const cleanupClosed = window.electron.onListenerClosed((data: { listenerId: string; code: number }) => {
      updateListener(data.listenerId, { status: 'stopped' });
      prefilledRef.current.delete(data.listenerId);
    });
    return () => {
      cleanup();
      cleanupClosed();
    };
  }, [updateListener]);

  // Terminal search state
  const [showSearch, setShowSearch] = React.useState(false);
  
  // Pre-fill command when listener is created
  React.useEffect(() => {
    if (!selectedListener || !window.electron) return;
    
    const listener = listeners.find(l => l.id === selectedListener);
    if (!listener || !listener.command) return;
    
    // Skip if already running
    if (listener.status === 'running') return;
    
    // Skip if already pre-filled this listener
    if (prefilledRef.current.has(selectedListener)) return;
    
    // Mark as pre-filled
    prefilledRef.current.add(selectedListener);
    
    // FIX: Pre-fill as soon as the shell prompt is ready (not a fixed 800ms delay).
    // Sending before the shell is ready dropped the first characters (e.g. "socat"
    // → "ocat"), and the fixed delay was why pre-fill felt late.
    logger.debug('FootholdView', `Pre-filling command when ready: ${listener.command}`);
    terminalService.writeWhenReady(selectedListener, listener.command);
  }, [selectedListener, listeners]);

  const addListener = async (type: ListenerType, port: number, customCommand?: string, customName?: string, startImmediately: boolean = true) => {
    // Platform detection can finish after the dialog opens. Resolve it again
    // at creation time so a Windows/WSL command is not frozen to the first
    // renderer frame's fallback choice.
    const resolvedLinuxExecution = await resolveLinuxExecution(useLinuxExecution);

    // Windows-compatible commands
    const commands: Record<ListenerType, string> = {
      netcat: `${resolvedLinuxExecution ? 'nc' : 'ncat'} -lvnp ${port}`,
      pwncat: `pwncat-cs -lp ${port}`,
      socat: `socat TCP-LISTEN:${port},reuseaddr,fork EXEC:${resolvedLinuxExecution ? '/bin/bash' : 'cmd.exe'}`,
      meterpreter: `msfconsole -q -x "use exploit/multi/handler; set PAYLOAD windows/meterpreter/reverse_tcp; set LHOST 0.0.0.0; set LPORT ${port}; exploit"`,
      'http-server': `${resolvedLinuxExecution ? 'python3' : 'python'} -m http.server ${port}`,
      sliver: `sliver-server -l ${port}`,
      custom: customCommand || ''
    };

    let command = commands[type];

    // EDGE CASE: never create a listener with an empty command (e.g. custom with no input)
    if (!command || !command.trim()) {
      showToast('Cannot create listener: command is empty', 'error');
      return;
    }

    if (startImmediately && type !== 'custom' && window.electron?.checkToolAvailability) {
      const resolvedBinary = await resolveListenerBinary(type, resolvedLinuxExecution);
      if (resolvedBinary.message) {
        showToast(resolvedBinary.message, 'error');
        return;
      }
      if (resolvedBinary.binary && resolvedBinary.binary !== listenerBinary(type, resolvedLinuxExecution)) {
        command = command.replace(/^(\s*)nc\b/i, `$1${resolvedBinary.binary}`);
      }

      if (window.electron.checkLocalPort) {
        const portResult = await preflightPort(
          port,
          '0.0.0.0',
          window.electron.checkLocalPort,
          true,
        );
        if (!portResult.ok) {
          showToast(portResult.message || `Local port ${port} is not available.`, 'error');
          return;
        }
      }
    }

    const newListener: Listener = {
      id: crypto.randomUUID(), // FIX: Use UUID to prevent ID collisions
      type,
      port,
      status: 'stopped',
      command,
      name: customName
    };

    // Pre-create terminal immediately to avoid delay
    try {
      await terminalService.getOrCreateTerminal(newListener.id, 'foothold');
      logger.debug('FootholdView', `Pre-created terminal for listener: ${newListener.id}`);
    } catch (error) {
      logger.error('FootholdView', 'Failed to pre-create terminal', error);
    }

    // Register this before the store update so the selection effect cannot
    // prefill the plain command and then let the Start path append a second
    // managed command in the same fresh terminal.
    if (startImmediately) {
      prefilledRef.current.add(newListener.id);
    }
    addListenerToStore(newListener);
    setSelectedListener(newListener.id);
    setShowAddDialog(false);
    showToast(
      startImmediately
        ? 'Listener started in its terminal.'
        : 'Listener command prepared in its terminal. Review it, then press Start.',
      'info'
    );

    if (startImmediately) {
      // FIX: "Start" runs the command. Mark prefilled so the prefill effect doesn't
      // also inject it. A fresh listener has an EMPTY prompt line, so we send the
      // command directly — the old '\x03\x15' prefix fired a Ctrl+C/SIGINT redraw that
      // dropped the first character ("socat" → "ocat") and printed an extra '^C' line.
      // writeWhenReady waits for the shell prompt so nothing is lost and it's not late.
      terminalService.cancelPendingWrites(newListener.id);
      let terminalReady = false;
      try {
        terminalService.getOrCreatePTY(newListener.id, 'foothold');
        terminalService.attachPTY(newListener.id, newListener.id);
        terminalReady = await waitForTerminalReady(newListener.id, 5000);
      } catch (error) {
        logger.error('FootholdView', 'Failed to start listener terminal', error);
      }
      const stillExists = useFootholdStore.getState().tabs.some(tab =>
        tab.listeners.some(listener => listener.id === newListener.id)
      );
      if (!terminalReady || !stillExists) {
        prefilledRef.current.delete(newListener.id);
        if (stillExists) {
          updateListener(newListener.id, { status: 'stopped' });
          showToast('Listener terminal could not be started. Check WSL/tool availability and try again.', 'error');
        }
        return;
      }

      prefilledRef.current.add(newListener.id);
      updateListener(newListener.id, { status: 'running' });
      terminalService.writeWhenReady(newListener.id, await buildManagedShellCommand(command));
    }
    // When queued (startImmediately === false) the command is pre-filled in the
    // terminal by the prefill effect for the user to review and run manually.
  };

  const stopListener = React.useCallback(async (id: string) => {
    if (stopPromisesRef.current.has(id)) return;

    if (!window.electron) {
      prefilledRef.current.delete(id);
      updateListener(id, { status: 'stopped' });
      return;
    }

    terminalService.cancelPendingWrites(id);
    setStoppingListenerIds(previous => new Set(previous).add(id));

    // Keep the shell alive, wait for its prompt, and serialize Stop -> Start.
    // This gives listeners the same lifecycle guarantees as tunnels.
    const stopPromise = interruptTerminalCommand(id)
      .then(() => {
        prefilledRef.current.delete(id);
        updateListener(id, { status: 'stopped' });
      })
      .catch((error) => {
        logger.error('FootholdView', 'Failed to stop listener', error);
        updateListener(id, { status: 'stopped' });
      });

    stopPromisesRef.current.set(id, stopPromise);
    await stopPromise;
    if (stopPromisesRef.current.get(id) === stopPromise) {
      stopPromisesRef.current.delete(id);
    }
    setStoppingListenerIds(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, [updateListener]);

  const startListener = React.useCallback(async (id: string) => {
    if (!window.electron || startingListenersRef.current.has(id)) return;

    const listener = useFootholdStore.getState().tabs
      .flatMap(tab => tab.listeners)
      .find(candidate => candidate.id === id);
    if (!listener || !listener.command?.trim() || listener.status === 'running') {
      if (listener && !listener.command?.trim()) {
        showToast('No command to run for this listener', 'error');
      }
      return;
    }

    startingListenersRef.current.add(id);
    setStartingListenerIds(previous => new Set(previous).add(id));
    try {
      await waitForTerminalInterrupt(id);
      const latestListener = useFootholdStore.getState().tabs
        .flatMap(tab => tab.listeners)
        .find(candidate => candidate.id === id);
      if (!latestListener || latestListener.status === 'running') return;

      const resolvedLinuxExecution = await resolveLinuxExecution(useLinuxExecution);
      let runtimeCommand = adaptListenerCommand(
        latestListener.command,
        latestListener.type,
        resolvedLinuxExecution,
      );
      if (runtimeCommand !== latestListener.command) {
        updateListener(id, { command: runtimeCommand });
      }

      if (latestListener.type !== 'custom') {
        const preferredBinary = listenerBinary(latestListener.type, resolvedLinuxExecution);
        const commandUsesKnownBinary = preferredBinary
          && (commandStartsWithBinary(runtimeCommand, preferredBinary)
            || (latestListener.type === 'netcat' && commandStartsWithBinary(runtimeCommand, 'ncat')));
        if (preferredBinary && commandUsesKnownBinary) {
          const resolvedBinary = await resolveListenerBinary(latestListener.type, resolvedLinuxExecution);
          if (resolvedBinary.message) {
            showToast(resolvedBinary.message, 'error');
            return;
          }
          if (resolvedBinary.binary && resolvedBinary.binary !== preferredBinary) {
            runtimeCommand = runtimeCommand.replace(/^(\s*)(?:nc|ncat)\b/i, `$1${resolvedBinary.binary}`);
            updateListener(id, { command: runtimeCommand });
          }
        }
      }

      const localBind = getLocalListenerBind({ ...latestListener, command: runtimeCommand });
      if (localBind && window.electron.checkLocalPort) {
        const portResult = await preflightPort(
          localBind.port,
          localBind.host,
          window.electron.checkLocalPort,
          true,
        );
        if (!portResult.ok) {
          showToast(portResult.message || `Local port ${localBind.port} is not available.`, 'error');
          return;
        }
      }

      terminalService.getOrCreatePTY(id, 'foothold');
      terminalService.attachPTY(id, id);
      const terminalReady = await waitForTerminalReady(id, 5000);
      const stillExists = useFootholdStore.getState().tabs.some(tab =>
        tab.listeners.some(candidate => candidate.id === id)
      );
      if (!terminalReady || !stillExists) {
        if (stillExists) {
          updateListener(id, { status: 'stopped' });
          showToast('Listener terminal is not ready. Check WSL/tool availability and try again.', 'error');
        }
        return;
      }

      terminalService.cancelPendingWrites(id);
      prefilledRef.current.add(id);
      updateListener(id, { status: 'running' });
      terminalService.writeWhenReady(id, '\x15' + await buildManagedShellCommand(runtimeCommand));
    } catch (error) {
      logger.error('FootholdView', 'Failed to start listener', error);
      updateListener(id, { status: 'stopped' });
      showToast('Listener failed to start. Check the terminal for details.', 'error');
    } finally {
      startingListenersRef.current.delete(id);
      setStartingListenerIds(previous => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }, [showToast, updateListener, useLinuxExecution]);

  const currentListener = listeners.find(l => l.id === selectedListener);

  // Register tab system with TabBar
  React.useEffect(() => {
    if (!isActive) return;

    const event = new CustomEvent('foothold-register-tabs', {
      detail: {
        tabs: tabs.map(t => ({
          id: t.id,
          title: `Tab ${tabs.indexOf(t) + 1}`,
          isScanning: t.listeners.some(l => l.status === 'running'),
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
  }, [isActive, tabs, activeTabId, addTab, closeTab, setActiveTabId]);

  React.useEffect(() => {
    logger.debug('FootholdView', 'State update', {
      activeTabId,
      listenersCount: listeners.length,
      selectedListener,
      currentListener: currentListener?.id
    });
  }, [activeTabId, listeners, selectedListener, currentListener]);

  React.useEffect(() => {
    if (listeners.length > 0 && !selectedListener) {
      logger.debug('FootholdView', `Auto-selecting first listener: ${listeners[0].id}`);
      setSelectedListener(listeners[0].id);
    }
  }, [listeners, selectedListener, setSelectedListener]);

  // Cleanup PTY AND terminal when listener is removed
  const handleRemoveListener = React.useCallback((id: string) => {
    prefilledRef.current.delete(id);
    stopPromisesRef.current.delete(id);
    startingListenersRef.current.delete(id);
    setStartingListenerIds(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    setStoppingListenerIds(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    // The store owns explicit removal cleanup. Keeping the lifecycle in one
    // place prevents double stop/destroy races between the view and store.
    removeListenerFromStore(id);
  }, [removeListenerFromStore]);

  return (
    <ViewWithSidebar sectionId="foothold" showSidebar={isActive}>
      <div className="h-full flex flex-col bg-background">
      <TabBar currentView="foothold" viewType="foothold" />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        {/* Main Content */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="h-full min-h-0 flex flex-col overflow-hidden">
            {/* Control Panel - Compact */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/80 bg-card/80 backdrop-blur-sm flex-shrink-0 shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary shadow-sm">
                  <Radio className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground truncate">Foothold Management</h2>
                  <p className="text-[11px] text-muted-foreground truncate">Listeners & HTTP Servers</p>
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
                New Listener
              </Button>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {/* Listener List */}
                <div className="w-60 flex-shrink-0 border-r border-border/80 bg-card/40">
                  <ScrollArea className="h-full">
                    <div className="p-3 space-y-2">
                      {listeners.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <Radio className="w-16 h-16 mx-auto mb-4 opacity-30" />
                          <p className="text-base font-semibold">No active listeners</p>
                        </div>
                      ) : (
                        listeners.map((listener) => (
                          <button
                            type="button"
                            key={listener.id}
                            onClick={() => setSelectedListener(listener.id)}
                            aria-pressed={selectedListener === listener.id}
                            className={`w-full rounded-md border p-3 cursor-pointer transition-[background-color,border-color,box-shadow,transform] text-left overflow-hidden ${
                              selectedListener === listener.id
                                ? 'border-primary/60 bg-primary/10 shadow-sm ring-1 ring-primary/20'
                                : 'border-border/70 bg-background/70 hover:border-primary/40 hover:bg-accent/40 hover:shadow-sm'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1.5 min-w-0">
                              {listener.type === 'http-server' ? (
                                <Server className="w-4 h-4 text-blue-500 flex-shrink-0" />
                              ) : (
                                <TerminalIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                              )}
                              <span className="text-sm font-bold text-foreground tracking-tight truncate min-w-0">
                                {listener.name || 
                                 (listener.type === 'netcat' ? 'Netcat' : 
                                  listener.type === 'pwncat' ? 'Pwncat' :
                                  listener.type === 'socat' ? 'Socat' :
                                  listener.type === 'meterpreter' ? 'Meterpreter' : 
                                  listener.type === 'sliver' ? 'Sliver' :
                                  listener.type === 'custom' ? 'Custom' :
                                  'HTTP Server')}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <span className="text-xs text-muted-foreground font-mono font-semibold truncate break-all min-w-0 max-w-[140px]">
                                Port {listener.port}
                              </span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap flex-shrink-0 ${
                                listener.status === 'running'
                                  ? 'bg-green-500/20 text-green-600 dark:text-green-500'
                                  : 'bg-muted/50 text-muted-foreground'
                              }`}>
                                {listener.status}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Terminal Output */}
                <div className="flex-1 min-h-0 flex flex-col bg-background">
                  {/* Terminal Header - Compact */}
                  {currentListener && (
                    <div className="min-h-11 bg-card/80 backdrop-blur-sm border-b border-border/80 flex items-center justify-between px-4 flex-shrink-0 shadow-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono font-bold text-foreground tracking-tight">
                          {currentListener.type} : {currentListener.port}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                              navigator.clipboard.writeText(currentListener.command);
                            }
                          }}
                          className="text-muted-foreground hover:text-foreground transition-colors duration-150"
                          title="Copy command"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowSearch(!showSearch)}
                          className="text-muted-foreground hover:text-foreground transition-colors duration-150"
                          title="Search terminal (Ctrl+F)"
                        >
                          <Search className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        {currentListener.status === 'running' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => stopListener(currentListener.id)}
                            loading={stoppingListenerIds.has(currentListener.id)}
                            loadingLabel="Stopping"
                            disabled={stoppingListenerIds.has(currentListener.id)}
                            className="border border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:border-destructive/60 font-semibold text-xs h-8 px-3 shadow-sm"
                          >
                            <Square className="w-3 h-3 mr-1" />
                            Stop
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void startListener(currentListener.id)}
                            loading={startingListenerIds.has(currentListener.id)}
                            loadingLabel="Starting"
                            disabled={startingListenerIds.has(currentListener.id)}
                            className="border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/60 font-semibold text-xs h-8 px-3 shadow-sm"
                          >
                            <Play className="w-3 h-3 mr-1" />
                            Start
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRemoveListener(currentListener.id)}
                          disabled={startingListenerIds.has(currentListener.id) || stoppingListenerIds.has(currentListener.id)}
                          className="border border-border/80 bg-background/50 text-muted-foreground hover:bg-accent hover:text-foreground font-semibold text-xs h-8 w-8 p-0 shadow-sm"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Terminal Content - RENDER ALL TERMINALS FROM ALL TABS (never unmount) */}
                  <div className="flex-1 min-h-0 overflow-hidden relative">
                    {tabs.every(tab => tab.listeners.length === 0) ? (
                      <div className="flex items-center justify-center h-full text-muted-foreground bg-muted/30">
                        <div className="text-center">
                          <TerminalIcon className="w-20 h-20 mx-auto mb-6 opacity-30" />
                          <p className="text-lg font-semibold">Select a listener to view output</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        {currentListener && (
                          <div className="absolute inset-0">
                            <Terminal
                              key={currentListener.id}
                              sessionId={currentListener.id}
                              sessionType="foothold"
                              className="w-full h-full"
                              isActive={isActive}
                            />
                          </div>
                        )}
                        
                        {showSearch && selectedListener && (
                          <TerminalSearchBar
                            sessionId={selectedListener}
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

      {/* Add Listener Dialog */}
      {showAddDialog && (
        <AddListenerDialog
          onClose={() => setShowAddDialog(false)}
          onAdd={addListener}
          useLinuxExecution={useLinuxExecution}
        />
      )}
      </div>
    </ViewWithSidebar>
  );
}

interface AddListenerDialogProps {
  onClose: () => void;
  onAdd: (type: ListenerType, port: number, customCommand?: string, customName?: string, startImmediately?: boolean) => void;
  useLinuxExecution: boolean;
}

function AddListenerDialog({ onClose, onAdd, useLinuxExecution }: AddListenerDialogProps) {
  const [type, setType] = useState<ListenerType>('netcat');
  const [port, setPort] = useState('4444');
  const [customCommand, setCustomCommand] = useState('');
  const [customName, setCustomName] = useState('');
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Maps each listener type to the underlying CLI binary so we can verify it's installed.
  const typeToBinary: Record<ListenerType, string | null> = {
    netcat: useLinuxExecution ? 'nc' : 'ncat',
    pwncat: 'pwncat-cs',
    socat: 'socat',
    meterpreter: 'msfconsole',
    'http-server': useLinuxExecution ? 'python3' : 'python',
    sliver: 'sliver-server',
    custom: null,
  };

  const handleAdd = (startImmediately: boolean = true) => {
    // EDGE CASE: custom listeners must have a command
    if (type === 'custom') {
      if (!customCommand.trim()) {
        setError('Enter a command for the custom listener.');
        return;
      }
    } else {
      // EDGE CASE: validate the port for tool-based listeners
      if (!/^\d{1,5}$/.test(port.trim()) || Number(port) < 1 || Number(port) > 65535) {
        setError('Enter a valid port between 1 and 65535.');
        return;
      }
    }

    setError(null);
    const parsedPort = parseInt(port, 10);
    // Custom commands do not necessarily listen on a single known port. Keep
    // the store numeric and deterministic instead of persisting NaN when the
    // optional field is cleared.
    onAdd(
      type,
      Number.isFinite(parsedPort) ? parsedPort : 0,
      customCommand,
      customName,
      startImmediately,
    );
  };

  const selectedBinary = typeToBinary[type];

  return (
    <div
      className="ui-dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-listener-title"
      aria-describedby="new-listener-description"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-popover-enter w-full max-w-md overflow-hidden rounded-lg border border-border/80 bg-card/95 shadow-2xl backdrop-blur-xl">
        <div className="border-b border-border/80 bg-gradient-to-r from-primary/10 via-card/80 to-transparent p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="new-listener-title" className="text-lg font-semibold tracking-tight text-foreground">New Listener</h3>
              <p id="new-listener-description" className="mt-1 text-xs text-muted-foreground">Start a listener or HTTP server and keep it available across views.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-sm font-bold text-foreground mb-2 block">Type</label>
            <select
              autoFocus
              value={type}
              onChange={(e) => { setType(e.target.value as ListenerType); setError(null); }}
              className="w-full px-4 py-3 bg-background border-2 border-input rounded-lg text-foreground text-base font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-[border-color,box-shadow] duration-150 shadow-sm"
            >
              <optgroup label="Shell Listeners">
                <option value="netcat">Netcat (nc -lvnp)</option>
                <option value="pwncat">Pwncat (auto-upgrade TTY)</option>
                <option value="socat">Socat (encrypted)</option>
              </optgroup>
              <optgroup label="C2 Frameworks">
                <option value="meterpreter">Meterpreter Handler</option>
                <option value="sliver">Sliver C2</option>
              </optgroup>
              <optgroup label="Servers">
                <option value="http-server">HTTP Server (Python)</option>
              </optgroup>
              <optgroup label="Advanced">
                <option value="custom">Custom Command</option>
              </optgroup>
            </select>
          </div>

          {/* Verify the underlying tool is installed/connected before the user runs it */}
          {selectedBinary && (
            <ToolInstallIndicator
              binary={selectedBinary}
              alternativeBinaries={type === 'netcat' ? NETCAT_ALTERNATIVES : undefined}
              label={type}
            />
          )}

          {type === 'custom' && (
            <>
              <div>
                <label className="text-sm font-bold text-foreground mb-2 block">Name</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="My Custom Listener"
                  className="w-full px-4 py-3 bg-background border-2 border-input rounded-lg text-foreground text-base font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-[border-color,box-shadow] duration-150 shadow-sm"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-foreground mb-2 block">Command</label>
                <textarea
                  value={customCommand}
                  onChange={(e) => { setCustomCommand(e.target.value); setError(null); }}
                  placeholder="Enter your custom command..."
                  rows={3}
                  className="w-full px-4 py-3 bg-background border-2 border-input rounded-lg text-foreground text-base font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-[border-color,box-shadow] duration-150 resize-none shadow-sm"
                />
              </div>
            </>
          )}

          <div>
            <label className="text-sm font-bold text-foreground mb-2 block">Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => { setPort(e.target.value); setError(null); }}
              className="w-full px-4 py-3 bg-background border-2 border-input rounded-lg text-foreground text-base font-mono font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-[border-color,box-shadow] duration-150 shadow-sm"
            />
          </div>

          {type !== 'custom' && type !== 'http-server' && (
            <div className="rounded-md border border-border/80 bg-accent/40 p-3">
              <p className="text-xs text-muted-foreground">
                <strong className="font-semibold text-foreground">Tool note:</strong> {type} must be installed in the selected runtime.
                {type === 'pwncat' && <span className="mt-1 block font-mono text-[11px]">pip3 install pwncat-cs</span>}
                {type === 'socat' && <span className="mt-1 block font-mono text-[11px]">apt install socat</span>}
                {type === 'sliver' && <span className="mt-1 block font-mono text-[11px]">Install from github.com/BishopFox/sliver</span>}
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-6 mb-2 px-4 py-2.5 rounded-lg bg-red-500/10 border-2 border-red-500/30">
            <p className="text-sm text-red-500 font-medium">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border/80 bg-muted/20 p-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="h-9 rounded-md border-border/80 px-4 font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => handleAdd(false)}
              className="h-9 rounded-md border border-border/80 bg-secondary px-4 font-semibold text-secondary-foreground shadow-sm hover:bg-accent hover:text-accent-foreground hover:shadow-md"
            >
              <Plus className="h-4 w-4" />
              Queue
            </Button>
            <Button
              onClick={() => handleAdd(true)}
              className="h-9 rounded-md border border-primary/80 px-4 font-semibold shadow-sm hover:shadow-md"
            >
              <Play className="h-4 w-4" />
              Start
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

