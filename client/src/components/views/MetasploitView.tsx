import React from 'react';
import { PersistentConsoleView } from '@/components/metasploit/PersistentConsoleView';
import { SessionManager } from '@/components/metasploit/SessionManager';
import { HandlerManager } from '@/components/metasploit/HandlerManager';
import { ExploitationCampaignManager } from '@/components/metasploit/ExploitationCampaignManager';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { ResetButton } from '@/components/ui/ResetButton';
import { SaveButton } from '@/components/ui/SaveButton';
import { Users, Network, Terminal, Zap } from 'lucide-react';
import { ViewWithSidebar } from '@/components/layout/ViewWithSidebar';
import { useMetasploitStore } from '@/lib/metasploit-store';
import { syncMetasploitState } from '@/lib/metasploit-state-sync';
import { terminalService } from '@/lib/terminal-service';

export function MetasploitView({ isSectionActive = true }: { isSectionActive?: boolean }) {
  const metasploitStore = useMetasploitStore();
  const { showToast } = useToast();
  const [activeView, setActiveView] = React.useState<'console' | 'sessions' | 'handlers' | 'campaigns'>('console');

  // The Electron MSF manager is the source of truth for live sessions/jobs.
  // Keep the sibling tabs synchronized from its state events instead of
  // leaving them at the empty in-memory defaults or claiming a refresh before
  // the command output has actually been parsed.
  React.useEffect(() => {
    if (!window.electron) return;

    const cleanups = [
      window.electron.onMsfConsoleReady(syncMetasploitState),
      window.electron.onMsfConsoleStateChange(syncMetasploitState),
      window.electron.onMsfConsoleClosed(() => {
        const store = useMetasploitStore.getState();
        store.setSessions([]);
        store.setHandlers([]);
      }),
    ];

    void window.electron.msfConsoleState().then((result) => {
      if (result.success && result.state) syncMetasploitState(result.state);
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  // Session management functions
  const handleSessionInteract = async (sessionId: number) => {
    if (!window.electron) return;
    
    try {
      await window.electron.msfConsoleSessions('interact', sessionId);
      showToast(`Interacting with session ${sessionId}`, 'success');
    } catch (error) {
      console.error('Failed to interact with session:', error);
      showToast(`Failed to interact with session ${sessionId}`, 'error');
    }
  };

  const handleSessionKill = async (sessionId: number) => {
    if (!window.electron) return;
    
    try {
      const result = await window.electron.msfConsoleSessions('kill', sessionId);
      if (!result.success) throw new Error(result.error || 'Metasploit rejected the kill request');
      showToast(`Stop requested for session ${sessionId}; waiting for live state`, 'info');
    } catch (error) {
      console.error('Failed to kill session:', error);
      showToast(`Failed to kill session ${sessionId}: ${String(error)}`, 'error');
    }
  };

  const handleRefreshSessions = async () => {
    if (!window.electron) return;
    
    try {
      const result = await window.electron.msfConsoleSessions('list');
      if (!result.success) throw new Error(result.error || 'Metasploit rejected the refresh request');
      showToast('Session refresh requested; waiting for Metasploit output', 'info');
    } catch (error) {
      console.error('Failed to refresh sessions:', error);
      showToast(`Session refresh failed: ${String(error)}`, 'error');
    }
  };

  // Handler management functions
  const handleCreateHandler = async (payload: string, port: number, options: Record<string, string>) => {
    if (!window.electron) return;
    
    try {
      if (!/^(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+$/.test(payload)) {
        throw new Error('Invalid Metasploit payload path');
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('LPORT must be between 1 and 65535');
      }
      for (const [key, value] of Object.entries(options)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !/^[A-Za-z0-9_.:/-]+$/.test(String(value))) {
          throw new Error(`Unsafe handler option: ${key}`);
        }
      }

      // Use persistent console to create handler
      const useCmd = `use exploit/multi/handler`;
      const setPayloadCmd = `set payload ${payload}`;
      const setPortCmd = `set LPORT ${port}`;
      
      for (const command of [useCmd, setPayloadCmd, setPortCmd]) {
        const result = await window.electron.msfConsoleCommand(command);
        if (!result.success) throw new Error(result.error || `Failed to send ${command}`);
      }
      
      // Set additional options
      for (const [key, value] of Object.entries(options)) {
        if (value && value.trim()) {
          const result = await window.electron.msfConsoleCommand(`set ${key} ${value}`);
          if (!result.success) throw new Error(result.error || `Failed to set ${key}`);
        }
      }
      
      // Start handler as job
      const exploitResult = await window.electron.msfConsoleCommand('exploit -j');
      if (!exploitResult.success) throw new Error(exploitResult.error || 'Failed to start handler job');
      
      showToast(`Handler setup sent to Metasploit on port ${port}; refresh after the job appears`, 'info');
      await handleRefreshHandlers();
    } catch (error) {
      console.error('Failed to create handler:', error);
      showToast(`Failed to create handler: ${String(error)}`, 'error');
    }
  };

  const handleStopHandler = async (handlerId: number) => {
    if (!window.electron) return;
    
    try {
      const result = await window.electron.msfConsoleJobs('kill', handlerId);
      if (!result.success) throw new Error(result.error || 'Metasploit rejected the stop request');
      showToast(`Stop requested for handler job ${handlerId}`, 'info');
      await handleRefreshHandlers();
    } catch (error) {
      console.error('Failed to stop handler:', error);
      showToast(`Failed to stop handler ${handlerId}`, 'error');
    }
  };

  const handleDeleteHandler = async (handlerId: number) => {
    // Same as stop for Metasploit jobs
    await handleStopHandler(handlerId);
  };

  const handleRefreshHandlers = async () => {
    if (!window.electron) return;
    
    try {
      const result = await window.electron.msfConsoleJobs('list');
      if (!result.success) throw new Error(result.error || 'Metasploit rejected the refresh request');
      showToast('Handler refresh requested; waiting for Metasploit output', 'info');
    } catch (error) {
      console.error('Failed to refresh handlers:', error);
      showToast(`Handler refresh failed: ${String(error)}`, 'error');
    }
  };

  const resetMetasploit = () => {
    metasploitStore.reset();
    terminalService.clearOutput('msf-console-persistent');
    setActiveView('console');

    if (window.electron) {
      void Promise.allSettled([
        window.electron.msfConsoleSessions('killall'),
        window.electron.msfConsoleJobs('killall'),
      ]).then(() => showToast('Metasploit sessions and jobs were stopped; console output was cleared', 'success'));
      return;
    }

    showToast('Metasploit state and visible output were cleared', 'success');
  };

  // The Exploit surface already owns a terminal/context split. Mounting the
  // generic AI sidebar here created a second horizontal resizer around the
  // PTY, forcing xterm to reflow while Metasploit was streaming output.
  return (
    <ViewWithSidebar sectionId="exploit" showSidebar={false}>
      <div className="h-full flex flex-col bg-background">
        {/* View Switcher */}
        <div className="flex items-center px-3 py-1 border-b border-border bg-muted/30 gap-2">
          <ResetButton
            sectionName="Metasploit"
            description="This will clear all sessions, handlers, and console output. This action cannot be undone."
            onReset={resetMetasploit}
          />
          <div className="flex-1 flex items-center gap-2" role="tablist" aria-label="Metasploit views">
            <Button
              variant={activeView === 'console' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveView('console')}
              className="flex items-center gap-2 h-6"
              role="tab"
              aria-selected={activeView === 'console'}
              aria-controls="metasploit-console-view"
            >
              <Terminal className="w-3.5 h-3.5" />
              Console
            </Button>
            <Button
              variant={activeView === 'sessions' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveView('sessions')}
            className="flex items-center gap-2 h-6"
            role="tab"
            aria-selected={activeView === 'sessions'}
            aria-controls="metasploit-sessions-view"
          >
            <Users className="w-3.5 h-3.5" />
            Sessions ({metasploitStore.sessions.filter(s => s.status === 'active').length})
          </Button>
          <Button
            variant={activeView === 'handlers' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveView('handlers')}
            className="flex items-center gap-2 h-6"
            role="tab"
            aria-selected={activeView === 'handlers'}
            aria-controls="metasploit-handlers-view"
          >
            <Network className="w-3.5 h-3.5" />
            Handlers ({metasploitStore.handlers.filter(h => h.status === 'listening').length})
          </Button>
          <Button
            variant={activeView === 'campaigns' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveView('campaigns')}
            className="flex items-center gap-2 h-6"
            role="tab"
            aria-selected={activeView === 'campaigns'}
            aria-controls="metasploit-campaigns-view"
          >
            <Zap className="w-3.5 h-3.5" />
            Plans
          </Button>
          </div>
          <SaveButton 
            type="section"
            sectionName="Metasploit"
          />
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="h-full w-full relative bg-background">
            {/* FIX: Use opacity pattern like IdeLayout - keep all views mounted */}
            
            {/* Console View */}
            <div 
              id="metasploit-console-view"
              role="tabpanel"
              aria-hidden={activeView !== 'console'}
              inert={activeView !== 'console'}
              className="ui-view-layer absolute inset-0"
              data-active={activeView === 'console' ? 'true' : 'false'}
              style={{
                opacity: activeView === 'console' ? 1 : 0,
                pointerEvents: activeView === 'console' ? 'auto' : 'none',
                zIndex: activeView === 'console' ? 1 : 0,
              }}
            >
              <PersistentConsoleView isActive={isSectionActive && activeView === 'console'} />
            </div>

            {/* Sessions View */}
            <div 
              id="metasploit-sessions-view"
              role="tabpanel"
              aria-hidden={activeView !== 'sessions'}
              inert={activeView !== 'sessions'}
              className="ui-view-layer absolute inset-0"
              data-active={activeView === 'sessions' ? 'true' : 'false'}
              style={{
                opacity: activeView === 'sessions' ? 1 : 0,
                pointerEvents: activeView === 'sessions' ? 'auto' : 'none',
                zIndex: activeView === 'sessions' ? 1 : 0,
              }}
            >
              <SessionManager
                sessions={metasploitStore.sessions}
                onSessionInteract={handleSessionInteract}
                onSessionKill={handleSessionKill}
                onRefreshSessions={handleRefreshSessions}
                isActive={isSectionActive && activeView === 'sessions'}
              />
            </div>

            {/* Handlers View */}
            <div 
              id="metasploit-handlers-view"
              role="tabpanel"
              aria-hidden={activeView !== 'handlers'}
              inert={activeView !== 'handlers'}
              className="ui-view-layer absolute inset-0"
              data-active={activeView === 'handlers' ? 'true' : 'false'}
              style={{
                opacity: activeView === 'handlers' ? 1 : 0,
                pointerEvents: activeView === 'handlers' ? 'auto' : 'none',
                zIndex: activeView === 'handlers' ? 1 : 0,
              }}
            >
              <HandlerManager
                handlers={metasploitStore.handlers as any}
                onCreateHandler={handleCreateHandler}
                onStopHandler={handleStopHandler}
                onDeleteHandler={handleDeleteHandler}
                onRefreshHandlers={handleRefreshHandlers}
                isActive={isSectionActive && activeView === 'handlers'}
              />
            </div>

            {/* Campaigns View */}
            <div 
              id="metasploit-campaigns-view"
              role="tabpanel"
              aria-hidden={activeView !== 'campaigns'}
              inert={activeView !== 'campaigns'}
              className="ui-view-layer absolute inset-0"
              data-active={activeView === 'campaigns' ? 'true' : 'false'}
              style={{
                opacity: activeView === 'campaigns' ? 1 : 0,
                pointerEvents: activeView === 'campaigns' ? 'auto' : 'none',
                zIndex: activeView === 'campaigns' ? 1 : 0,
              }}
            >
              <ExploitationCampaignManager />
            </div>
          </div>
        </div>
      </div>
    </ViewWithSidebar>
  );
}
