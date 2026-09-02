import React, { useState, useRef, useEffect } from 'react';
import { Layers } from 'lucide-react';
import { useScanner } from '@/lib/scanner-context';
import { useFootholdStore } from '@/lib/foothold-store';
import { useSubdomainStore } from '@/lib/subdomain-store';
import { useTunnelingStore } from '@/lib/tunneling-store';

export function WorkingTabsIndicator() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  // Use try-catch to handle context not being available yet
  let nmapTabs: any[] = [];
  try {
    const nmapContext = useScanner();
    nmapTabs = nmapContext.tabs;
  } catch (e) {
    // Context not available yet, use empty array
    nmapTabs = [];
  }
  
  const footholdStore = useFootholdStore();
  const tunnelingStore = useTunnelingStore();
  const { sessions: subdomainSessions } = useSubdomainStore();

  // Count ONLY actively running/working tabs from each section
  const nmapRunning = nmapTabs.filter(t => t.isScanning);
  
  // Count running listeners across all tabs
  const footholdRunning = Object.values(footholdStore.tabs).flatMap(tabData => 
    tabData.listeners.filter((l: any) => l.status === 'running')
  );
  
  // Count running tunneling sessions across all tabs
  const tunnelingRunning = Object.values(tunnelingStore.tabs).flatMap(tabData => 
    tabData.sessions.filter((s: any) => s.status === 'running')
  );
  
  const subdomainRunning = subdomainSessions.filter(s => s.isActive);
  
  const nmapCount = nmapRunning.length;
  const footholdCount = footholdRunning.length;
  const tunnelingCount = tunnelingRunning.length;
  const subdomainCount = subdomainRunning.length;
  
  const totalWorking = nmapCount + footholdCount + tunnelingCount + subdomainCount;

  // Count ALL tabs/items (for display when nothing is running)
  const totalListeners = Object.values(footholdStore.tabs).reduce((sum, tabData) => sum + tabData.listeners.length, 0);
  const totalTunnelingSessions = Object.values(tunnelingStore.tabs).reduce((sum, tabData) => sum + tabData.sessions.length, 0);
  const totalAllTabs = nmapTabs.length + totalListeners + totalTunnelingSessions + subdomainSessions.length;

  // Debug logging
  console.log('[WorkingTabsIndicator]', {
    nmapTabs: nmapTabs.length,
    nmapRunning: nmapRunning.length,
    totalListeners,
    footholdRunning: footholdRunning.length,
    totalTunnelingSessions,
    tunnelingRunning: tunnelingRunning.length,
    subdomainSessions: subdomainSessions.length,
    subdomainRunning: subdomainRunning.length,
    totalAllTabs,
    totalWorking
  });

  // Close dropdown when clicking outside - MUST be before early return
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        buttonRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Don't render if there are no tabs at all
  if (totalAllTabs === 0) {
    return null;
  }

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        ref={buttonRef}
        onMouseEnter={() => setIsOpen(true)}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2 py-0 rounded-md transition-all ${
          totalWorking > 0
            ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30 border border-green-500/50 hover:border-green-500/70 shadow-md shadow-green-500/20'
            : 'bg-muted/40 hover:bg-muted/60 border border-transparent'
        }`}
      >
        <Layers className={`w-3.5 h-3.5 ${totalWorking > 0 ? 'text-green-500 animate-pulse' : 'text-muted-foreground'}`} />
        <span className={`text-xs font-semibold ${totalWorking > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
          {totalWorking > 0 ? `${totalWorking} Working` : totalAllTabs > 0 ? `${totalAllTabs} Idle` : 'No Tasks'}
        </span>
        {totalWorking > 0 && (
          <span className="text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-500/20 px-1.5 py-0.5 rounded-full">
            Active
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          onMouseLeave={() => setIsOpen(false)}
          className="absolute top-full right-0 mt-2 bg-card border-2 border-border rounded-xl shadow-2xl z-50 min-w-[280px] overflow-hidden"
        >
          <div className="space-y-2">
            {/* Empty State - Show when nothing is running */}
            {totalWorking === 0 && (
              <div className="px-4 py-5 text-center">
                <Layers className="w-8 h-8 mx-auto mb-2 opacity-20 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground">No active tasks</p>
              </div>
            )}

            {/* Nmap/Console Tabs - Only show if there are running scans */}
            {nmapCount > 0 && (
              <div className="px-3 py-2.5 rounded-lg border transition-colors bg-green-500/5 border-green-500/20 hover:bg-green-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-foreground">Console (Nmap)</span>
                  <span className="text-xs font-bold text-green-600 dark:text-green-400 bg-green-500/20 px-2 py-1 rounded-full">
                    {nmapCount} scanning
                  </span>
                </div>
                <div className="text-xs text-foreground font-medium space-y-1.5">
                  {nmapRunning.slice(0, 3).map((tab) => (
                    <div key={tab.id} className="truncate flex items-center gap-2">
                      <span className="text-yellow-500 text-base animate-pulse">⚡</span>
                      <span className="text-foreground">
                        {tab.title || 'Untitled'}
                      </span>
                    </div>
                  ))}
                  {nmapCount > 3 && (
                    <div className="text-muted-foreground font-semibold text-xs">
                      +{nmapCount - 3} more scanning...
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Foothold Listeners - Only show if there are running listeners */}
            {footholdCount > 0 && (
              <div className="px-3 py-2.5 rounded-lg border transition-colors bg-yellow-500/5 border-yellow-500/20 hover:bg-yellow-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-foreground">Foothold</span>
                  <span className="text-xs font-bold text-yellow-600 dark:text-yellow-400 bg-yellow-500/20 px-2 py-1 rounded-full">
                    {footholdCount} running
                  </span>
                </div>
                <div className="text-xs text-foreground font-medium space-y-1.5">
                  {footholdRunning.slice(0, 3).map((listener) => (
                    <div key={listener.id} className="truncate flex items-center gap-2">
                      <span className="text-green-500 text-base animate-pulse">●</span>
                      <span className="text-foreground">
                        {listener.name || listener.type} :{listener.port}
                      </span>
                    </div>
                  ))}
                  {footholdCount > 3 && (
                    <div className="text-muted-foreground font-semibold text-xs">
                      +{footholdCount - 3} more running...
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tunneling Sessions - Only show if there are running sessions */}
            {tunnelingCount > 0 && (
              <div className="px-3 py-2.5 rounded-lg border transition-colors bg-purple-500/5 border-purple-500/20 hover:bg-purple-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-foreground">Tunneling</span>
                  <span className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-500/20 px-2 py-1 rounded-full">
                    {tunnelingCount} running
                  </span>
                </div>
                <div className="text-xs text-foreground font-medium space-y-1.5">
                  {tunnelingRunning.slice(0, 3).map((session) => (
                    <div key={session.id} className="truncate flex items-center gap-2">
                      <span className="text-purple-500 text-base animate-pulse">●</span>
                      <span className="text-foreground">
                        {session.tool} {session.mode} :{session.port}
                      </span>
                    </div>
                  ))}
                  {tunnelingCount > 3 && (
                    <div className="text-muted-foreground font-semibold text-xs">
                      +{tunnelingCount - 3} more running...
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Subdomain Sessions - Only show if there are active sessions */}
            {subdomainCount > 0 && (
              <div className="px-3 py-2.5 rounded-lg border transition-colors bg-blue-500/5 border-blue-500/20 hover:bg-blue-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-foreground">Subdomain</span>
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-500/20 px-2 py-1 rounded-full">
                    {subdomainCount} active
                  </span>
                </div>
                <div className="text-xs text-foreground font-medium space-y-1.5">
                  {subdomainRunning.slice(0, 3).map((session) => (
                    <div key={session.toolId} className="truncate flex items-center gap-2">
                      <span className="text-blue-500 text-base">🔍</span>
                      <span className="text-foreground">
                        {session.toolName}: {session.domain}
                      </span>
                    </div>
                  ))}
                  {subdomainCount > 3 && (
                    <div className="text-muted-foreground font-semibold text-xs">
                      +{subdomainCount - 3} more active...
                    </div>
                  )}
                </div>
              </div>
            )}


          </div>
        </div>
      )}
    </div>
  );
}
