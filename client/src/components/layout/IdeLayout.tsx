
import React, { useState, useEffect, useLayoutEffect, lazy, Suspense } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SmoothResizable } from '@/components/ui/smooth-resizable';
import { TabBar } from '@/components/nmap/TabBar';
import { ControlPanel } from '@/components/nmap/ControlPanel';
import { ResultsPanel } from '@/components/nmap/ResultsPanel';
import { MainSidebar, SidebarView } from '@/components/layout/MainSidebar';
import { TitleBar } from '@/components/layout/TitleBar';
import { ToastProvider } from '@/components/ui/toast';
import { useNavigationStore } from '@/lib/navigation-store';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary';
import { ToolNotFoundDialog } from '@/components/dialogs/ToolNotFoundDialog';
import { useToolCheckStore } from '@/lib/tool-check-store';
import { NotificationToast } from '@/components/ui/notification-toast';
import { useNotificationStore } from '@/lib/notification-store';
import { networkResilience } from '@/lib/network-resilience';
import { NetworkStatusBar } from '@/components/ui/NetworkStatusBar';
import { usePanelLayoutStore } from '@/lib/panel-layout-store';
import { ProcessStatusSync } from '@/components/layout/ProcessStatusSync';
import { ScannerProvider } from '@/lib/scanner-context';
import { ScannerCarousel } from '@/components/scanners/ScannerCarousel';
import { useSettingsStore } from '@/lib/settings-store';
import { useTerminalTabsStore } from '@/lib/terminal-tabs-store';
import { terminalService } from '@/lib/terminal-service';

// PERFORMANCE: Lazy loading with preload capability
// Components load on-demand, but can be preloaded on hover for instant switching

const TerminalPanel = lazy(() =>
  import('@/components/nmap/TerminalPanel').then(m => ({ default: m.TerminalPanel }))
);

const AiSidebar = lazy(() =>
  import('@/components/nmap/AiSidebar').then(m => ({ default: m.AiSidebar }))
);

const FootholdView = lazy(() =>
  import('@/components/views/FootholdView').then(m => ({ default: m.FootholdView }))
);

const TunnelingView = lazy(() =>
  import('@/components/views/TunnelingView').then(m => ({ default: m.TunnelingView }))
);

const TerminalTabsView = lazy(() =>
  import('@/components/views/TerminalTabsView').then(m => ({ default: m.TerminalTabsView }))
);

const SubdomainView = lazy(() =>
  import('@/components/views/SubdomainView').then(m => ({ default: m.SubdomainView }))
);

const MetasploitView = lazy(() =>
  import('@/components/views/MetasploitView').then(m => ({ default: m.MetasploitView }))
);

const AutomationView = lazy(() =>
  import('@/components/views/AutomationView').then(m => ({ default: m.AutomationView }))
);

const TimelineView = lazy(() =>
  import('@/components/views/TimelineView').then(m => ({ default: m.TimelineView }))
);

const SettingsView = lazy(() =>
  import('@/components/views/SettingsView').then(m => ({ default: m.SettingsView }))
);

const TopologyView = lazy(() =>
  import('@/components/views/TopologyView').then(m => ({ default: m.TopologyView }))
);

// PERFORMANCE: Preload functions for instant view switching
const preloadMap: Record<string, () => Promise<any>> = {
  exploit: () => import('@/components/views/MetasploitView'),
  automate: () => import('@/components/views/AutomationView'),
  timeline: () => import('@/components/views/TimelineView'),
  topology: () => import('@/components/views/TopologyView'),
  settings: () => import('@/components/views/SettingsView'),
  foothold: () => import('@/components/views/FootholdView'),
  tunneling: () => import('@/components/views/TunnelingView'),
  terminals: () => import('@/components/views/TerminalTabsView'),
  subdomains: () => import('@/components/views/SubdomainView'),
};

// Track which views have been preloaded
const preloadedViews = new Set<string>();

// Preload a view component
const preloadView = (view: string) => {
  if (preloadedViews.has(view) || !preloadMap[view]) return;
  preloadedViews.add(view);
  preloadMap[view]().catch(() => {
    // Remove from set if preload fails so it can be retried
    preloadedViews.delete(view);
  });

  // Metasploit's first WSL launch is expensive (Ruby/module boot, not an
  // Electron render cost). Start it while the user is hovering Exploit so the
  // click can reuse the same backend initialization promise. This is
  // best-effort and intentionally silent; the visible console owns errors and
  // retry UI when the tool is unavailable.
  if (view === 'exploit' && window.electron?.msfConsoleInit) {
    void window.electron.msfConsoleInit().then(result => {
      if (!result.success) {
        console.debug('[IdeLayout] Metasploit hover prewarm unavailable:', result.error);
      }
    }).catch(error => {
      console.debug('[IdeLayout] Metasploit hover prewarm failed:', error);
    });
  }
};

// Loading fallback component with better UX
const LoadingFallback = ({ componentName }: { componentName?: string }) => (
  <div className="h-full w-full flex items-center justify-center bg-background ui-view-enter" role="status" aria-live="polite">
    <div className="text-center">
      <img src="./osecbox-icon.png" alt="" width={48} height={48} draggable={false} className="w-12 h-12 rounded-xl object-cover mx-auto mb-3 shadow-[0_0_24px_rgba(139,92,246,0.32)]" />
      <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-2" aria-hidden="true"></div>
      <div className="text-sm text-muted-foreground">
        {componentName ? `Loading ${componentName}...` : 'Loading...'}
      </div>
    </div>
  </div>
);

export function IdeLayout() {
  const [activeView, setActiveView] = useState<SidebarView>('scan');
  // Keep a section mounted after its first visit. Navigation should only hide
  // the section; it must not tear down its terminal bridge or event listeners
  // while the Electron-side process continues to run.
  const [visitedViews, setVisitedViews] = useState<Set<SidebarView>>(
    () => new Set<SidebarView>(['scan'])
  );
  // Keep the title bar, settings page, and document class on one source of
  // truth. The settings store updates synchronously before it syncs to the
  // Electron backend, so the theme never waits on IPC.
  const isDarkMode = useSettingsStore((state) => state.settings.darkMode);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const themeSwitchToken = React.useRef(0);

  const applyTheme = React.useCallback((darkMode: boolean) => {
    const root = document.documentElement;
    const token = ++themeSwitchToken.current;

    // Large surfaces should repaint immediately. The temporary class keeps
    // button/panel transitions from making the mode switch look delayed.
    root.classList.add('theme-switching');
    root.classList.toggle('dark', darkMode);
    root.style.colorScheme = darkMode ? 'dark' : 'light';

    const clearSwitchingState = () => {
      if (themeSwitchToken.current === token) {
        root.classList.remove('theme-switching');
      }
    };

    // A timer is deliberately used instead of requestAnimationFrame here:
    // hidden/background browser windows may throttle animation frames for
    // seconds, which would leave the transition guard stuck on the document.
    window.setTimeout(clearSwitchingState, 80);
  }, []);

  const toggleTheme = React.useCallback(() => {
    const nextMode = !useSettingsStore.getState().settings.darkMode;
    applyTheme(nextMode);
    void updateSetting('darkMode', nextMode);
  }, [applyTheme, updateSetting]);
  const [isTerminalExpanded, setIsTerminalExpanded] = useState(false);
  const [isScanTerminalResizing, setIsScanTerminalResizing] = useState(false);
  const handleScanTerminalResizeStart = React.useCallback(() => setIsScanTerminalResizing(true), []);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  
  // PERFORMANCE: Preload lazy view chunks during idle time so the FIRST switch
  // Load view chunks on explicit navigation intent (click/hover), keeping first
  // paint light while making intentional section switches feel immediate.
  // SECTION REFRESH: Track refresh keys for each section to force remount on error
  const [sectionKeys, setSectionKeys] = useState<Record<string, number>>({
    scan: 0,
    exploit: 0,
    automate: 0,
    timeline: 0,
    topology: 0,
    settings: 0,
    foothold: 0,
    tunneling: 0,
    terminals: 0,
    subdomains: 0,
  });
  
  // UNIFIED PERSISTENCE: Use single store for all panel layouts
  const { getPanelSize, saveLayout } = usePanelLayoutStore();
  const handleScanTerminalResizeEnd = React.useCallback((bottomHeight: number) => {
    setIsScanTerminalResizing(false);
    // Persist once at the end of the drag. Saving on every pointer move would
    // cause storage writes and rerenders while the terminal is under load.
    saveLayout('scan-vertical-layout', 'terminal-panel', bottomHeight);
  }, [saveLayout]);
  
  // Helper to refresh a specific section
  const refreshSection = React.useCallback((section: string) => {
    console.log(`[IdeLayout] Refreshing section: ${section}`);
    setSectionKeys(prev => ({
      ...prev,
      [section]: prev[section] + 1,
    }));
  }, []);
  
  // PERFORMANCE: Removed eager preloading - components load on-demand via Suspense
  // This eliminates 2-4 seconds of blocking work during startup
  // Components are already lazy-loaded via React.lazy() and will load when tabs are opened
  
  // PERFORMANCE: Only render active view to eliminate lag
  const renderActiveView = () => {
    const viewProps = {
      className: "h-full w-full flex flex-col bg-background"
    };

    switch (activeView) {
      case 'scan':
        return (
          <div {...viewProps}>
            <ErrorBoundary>
              <TabBar currentView="scan" viewType="scan" />
              <div className="flex-1 flex flex-col overflow-hidden relative">
                <ResizablePanelGroup 
                  direction="vertical"
                  className="flex-1 min-h-0 min-w-0 overflow-hidden"
                >
                  <ResizablePanel defaultSize={60} minSize={20} className="min-h-0 min-w-0 overflow-hidden">
                    <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
                      <ScannerCarousel />
                    </Suspense>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={40} minSize={15} className="min-h-0 min-w-0 overflow-hidden">
                    <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Loading terminal...</div>}>
                      <TerminalPanel />
                    </Suspense>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            </ErrorBoundary>
          </div>
        );
      
      case 'exploit':
        return (
          <div {...viewProps}>
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
              <SectionErrorBoundary sectionName="Metasploit" onReset={() => refreshSection('exploit')}>
                <MetasploitView />
              </SectionErrorBoundary>
            </Suspense>
          </div>
        );
      
      case 'automate':
        return (
          <div {...viewProps}>
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
              <SectionErrorBoundary sectionName="Automation" onReset={() => refreshSection('automate')}>
                <AutomationView />
              </SectionErrorBoundary>
            </Suspense>
          </div>
        );
      
      case 'timeline':
        return (
          <div {...viewProps}>
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
              <SectionErrorBoundary sectionName="Timeline" onReset={() => refreshSection('timeline')}>
                <TimelineView />
              </SectionErrorBoundary>
            </Suspense>
          </div>
        );
      
      case 'topology':
        return (
          <div {...viewProps}>
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
              <SectionErrorBoundary sectionName="Topology" onReset={() => refreshSection('topology')}>
                <TopologyView />
              </SectionErrorBoundary>
            </Suspense>
          </div>
        );
      
      case 'settings':
        return (
          <div {...viewProps}>
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
              <SectionErrorBoundary sectionName="Settings" onReset={() => refreshSection('settings')}>
                <SettingsView scrollToSection={settingsSection} />
              </SectionErrorBoundary>
            </Suspense>
          </div>
        );
      
      case 'foothold':
        return (
          <div {...viewProps}>
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
              <SectionErrorBoundary sectionName="Foothold" onReset={() => refreshSection('foothold')}>
                <FootholdView isActive={true} />
              </SectionErrorBoundary>
            </Suspense>
          </div>
        );
      
      case 'tunneling':
        return (
          <div {...viewProps}>
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
              <SectionErrorBoundary sectionName="Tunneling" onReset={() => refreshSection('tunneling')}>
                <TunnelingView isActive={true} />
              </SectionErrorBoundary>
            </Suspense>
          </div>
        );
      
      case 'terminals':
        return (
          <div {...viewProps}>
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
              <SectionErrorBoundary sectionName="Terminals" onReset={() => refreshSection('terminals')}>
                <TerminalTabsView isActive={true} />
              </SectionErrorBoundary>
            </Suspense>
          </div>
        );
      
      case 'subdomains':
        return (
          <div {...viewProps}>
            <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
              <SectionErrorBoundary sectionName="Subdomains" onReset={() => refreshSection('subdomains')}>
                <SubdomainView />
              </SectionErrorBoundary>
            </Suspense>
          </div>
        );
      
      default:
        return null;
    }
  };

  // PERFORMANCE: Instant view change with preload
  const handleViewChange = React.useCallback((view: SidebarView) => {
    console.log(`[IdeLayout] View changing from ${activeView} to ${view}`);
    
    // Preload the view immediately if not already loaded
    preloadView(view);
    
    // Mount lazily on first visit, then preserve the section across navigation.
    setVisitedViews(previous => {
      if (previous.has(view)) return previous;
      const next = new Set(previous);
      next.add(view);
      return next;
    });

    // Change view instantly - no waiting
    setActiveView(view);
  }, [activeView]);

  // Tool installation guidance is generated in the Electron main process.
  // Open a real in-app terminal tab for the command and leave it selected for
  // review; the user can edit it and press Enter, including any sudo prompt.
  // This is deliberately renderer-owned because the terminal tab and PTY are
  // created by the renderer terminal service.
  React.useEffect(() => {
    if (!window.electron?.onOpenTerminalTab) return;

    return window.electron.onOpenTerminalTab(({ command }) => {
      const normalizedCommand = String(command || '').trim();
      if (!normalizedCommand) return;

      const terminal = useTerminalTabsStore.getState().addTerminal({
        title: 'Install tools',
        sessionType: 'general',
      });
      useTerminalTabsStore.getState().setActiveTerminal(terminal.id);
      handleViewChange('terminals');
      terminalService.writeWhenReady(terminal.id, normalizedCommand);
    });
  }, [handleViewChange]);
  
  const setNavigateToSettings = useNavigationStore((state) => state.setNavigateToSettings);
  const showNotification = useNotificationStore((state) => state.addNotification);

  // Function to navigate to settings with specific section
  const navigateToSettings = (section?: string) => {
    setSettingsSection(section);
    setVisitedViews(previous => {
      if (previous.has('settings')) return previous;
      const next = new Set(previous);
      next.add('settings');
      return next;
    });
    setActiveView('settings');
  };

  // FIX: Use Zustand store for navigation
  React.useEffect(() => {
    setNavigateToSettings(navigateToSettings);
  }, [setNavigateToSettings]);
  
  // STARTUP: Show compatibility warnings in background (deferred)
  useEffect(() => {
    // CRITICAL OPTIMIZATION: Defer to 3 seconds - not needed immediately
    const timer = setTimeout(() => {
      requestIdleCallback(async () => {
        try {
          const systemInfo = await window.electron?.invoke('get-system-info');
          if (systemInfo?.success) {
            const info = systemInfo.systemInfo;
            
            // Show warnings for edge cases
            if (info.isAlpine || info.isMusl) {
              showNotification({
                title: 'Alpine Linux Detected',
                message: 'Some features may have limited support on Alpine/musl systems.',
                type: 'warning',
                duration: 5000,
              });
            }
            
            if (info.isSnap || info.isFlatpak) {
              showNotification({
                title: 'Sandboxed Environment',
                message: 'Running in Snap/Flatpak. System tools may not be accessible.',
                type: 'warning',
                duration: 5000,
              });
            }
            
            if (info.isARM) {
              showNotification({
                title: 'ARM Architecture',
                message: 'Some pentesting tools may not be available for ARM.',
                type: 'info',
                duration: 5000,
              });
            }
          }
        } catch (error) {
          console.error('[Compatibility] Failed to check system info:', error);
        }
      });
    }, 3000);
    
    // Listen for system notifications from Electron main process
    const cleanup = window.electron?.onSystemNotification?.((data) => {
      showNotification({
        title: data.title,
        message: data.message,
        type: data.type,
        action: data.action ? {
          label: data.action.label,
          onClick: () => {
            if (data.action?.url) {
              window.open(data.action.url, '_blank');
            }
          },
        } : undefined,
        duration: 5000,
      });
    });
    
    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
  }, [showNotification]);

  // NETWORK RESILIENCE: Monitor network health immediately (background)
  useEffect(() => {
    requestIdleCallback(() => {
      const unsubscribe = networkResilience.subscribe((health) => {
        // Show notifications for network status changes
        if (health.status === 'offline') {
          showNotification({
            title: 'Network Offline',
            message: health.lastError || 'Network connection lost. Attempting to reconnect...',
            type: 'error',
            duration: 0, // Don't auto-dismiss
          });
        } else if (health.status === 'degraded') {
          showNotification({
            title: 'Slow Network',
            message: `High latency detected: ${health.latency}ms`,
            type: 'warning',
            duration: 5000,
          });
        } else if (health.status === 'online' && health.retryCount > 0) {
          showNotification({
            title: 'Network Restored',
            message: 'Connection re-established successfully.',
            type: 'success',
            duration: 3000,
          });
        }
      });
      
      return unsubscribe;
    });
  }, [showNotification]);
  
  // IPC health monitoring - only start when actually needed
  useEffect(() => {
    // The web preview intentionally has no preload bridge. Do not turn that
    // expected capability boundary into a persistent error toast while the
    // UI is being inspected outside Electron.
    if (!window.electron) return;

    const startIPCMonitoring = () => {
      // Dynamic import to avoid issues
      import('@/lib/ipc-health-monitor').then(({ ipcHealthMonitor }) => {
        const unsubscribe = ipcHealthMonitor.subscribe((health: any) => {
          if (health.status === 'offline') {
            showNotification({
              title: 'IPC Channel Offline',
              message: 'Connection to Electron main process lost. Terminals may be unresponsive.',
              type: 'error',
              duration: 0,
            });
          } else if (health.status === 'degraded') {
            showNotification({
              title: 'IPC Channel Degraded',
              message: `High latency detected: ${health.latency}ms. Terminals may be slow.`,
              type: 'warning',
              duration: 5000,
            });
          } else if (health.status === 'online' && health.reconnectAttempts > 0) {
            showNotification({
              title: 'IPC Channel Restored',
              message: 'Connection to main process re-established.',
              type: 'success',
              duration: 3000,
            });
          }
        });
        
        return () => {
          unsubscribe();
        };
      }).catch(err => {
        console.error('[IdeLayout] Failed to load IPC health monitor:', err);
      });
    };

    // CLEAN FIX: Only start IPC monitoring when user interacts with terminal
    let hasStartedMonitoring = false;
    const startMonitoringOnce = () => {
      if (!hasStartedMonitoring) {
        hasStartedMonitoring = true;
        startIPCMonitoring();
      }
    };

    // Listen for terminal interactions
    const handleTerminalInteraction = () => startMonitoringOnce();
    window.addEventListener('terminal-interaction', handleTerminalInteraction);
    
    // Fallback: start after 5 seconds if no terminal interaction
    const fallbackTimer = setTimeout(startMonitoringOnce, 5000);
    
    return () => {
      window.removeEventListener('terminal-interaction', handleTerminalInteraction);
      clearTimeout(fallbackTimer);
    };
  }, [showNotification]);

  // Apply hydrated/persisted settings before the browser paints the next
  // frame. This also corrects the class if the backend rejects a setting.
  useLayoutEffect(() => {
    applyTheme(isDarkMode);
  }, [applyTheme, isDarkMode]);

  const renderMainContent = () => {
    // Removed transitions to eliminate lag when switching views
    
    return (
      <>
        {/* Scan section - always loaded */}
        <div 
          className="ui-view-layer absolute inset-0 flex flex-col bg-background"
          data-view-id="scan"
          data-active={activeView === 'scan' ? 'true' : 'false'}
          aria-hidden={activeView !== 'scan'}
          style={{
            display: activeView === 'scan' ? 'flex' : 'none',
          }}
        >
          <ErrorBoundary>
            <TabBar currentView="scan" viewType="scan" />
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                 <ResizablePanelGroup 
                    direction="horizontal" 
                     className="flex-1 min-h-0"
                  >
                    {/* Left side: Main content */}
                    <ResizablePanel 
                      defaultSize={getPanelSize('scan-main-layout', 'main-content', 75)}
                      minSize={50}
                      className="min-h-0 min-w-0 border-r border-border/70"
                    >
                      <div className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden">
                        <ControlPanel />
                        <SmoothResizable
                          defaultBottomHeight={getPanelSize('scan-vertical-layout', 'terminal-panel', 40)}
                          minBottomHeight={5}
                          maxBottomHeight={95}
                          onResizeStart={handleScanTerminalResizeStart}
                          onResizeEnd={handleScanTerminalResizeEnd}
                          topContent={
                            <div className="h-full min-h-0 flex flex-col bg-card/30 overflow-hidden">
                              <ResultsPanel isSectionActive={activeView === 'scan'} />
                            </div>
                          }
                          bottomContent={
                            <div className="h-full min-h-0 w-full bg-black overflow-hidden relative" id="scan-terminal-container">
                              <Suspense fallback={<LoadingFallback componentName="Terminal" />}>
                                <TerminalPanel 
                                  isExpanded={isTerminalExpanded}
                                  onExpandToggle={setIsTerminalExpanded}
                                  isSectionActive={activeView === 'scan'}
                                  isResizing={isScanTerminalResizing}
                                />
                              </Suspense>
                            </div>
                          }
                           className="flex-1 min-h-0"
                        />
                      </div>
                    </ResizablePanel>
                    {/* Right side: AI Sidebar */}
                    <ResizableHandle withHandle className="w-2" />
                     <ResizablePanel 
                       defaultSize={getPanelSize('scan-main-layout', 'ai-sidebar', 25)}
                        minSize={15} 
                        maxSize={35}
                        className="min-h-0 min-w-0"
                      >
                        {activeView === 'scan' && <Suspense fallback={<LoadingFallback componentName="AI Assistant" />}>
                          <AiSidebar />
                        </Suspense>}
                      </ResizablePanel>
                   </ResizablePanelGroup>
              </div>
            </ErrorBoundary>
          </div>

        {/* Exploit view - terminal instances are preserved by terminalService */}
        {visitedViews.has('exploit') && (<div 
          key={`exploit-${sectionKeys.exploit}`}
          className="ui-view-layer absolute inset-0"
          data-view-id="exploit"
          data-active={activeView === 'exploit' ? 'true' : 'false'}
          aria-hidden={activeView !== 'exploit'}
          style={{
            display: activeView === 'exploit' ? 'block' : 'none',
          }}
        >
          <Suspense fallback={<LoadingFallback componentName="Metasploit" />}>
            <SectionErrorBoundary 
              sectionName="Metasploit" 
              onReset={() => refreshSection('exploit')}
            >
              <MetasploitView isSectionActive={activeView === 'exploit'} />
            </SectionErrorBoundary>
          </Suspense>
        </div>)}

        {/* Automate View */}
        {activeView === 'automate' && (<div 
          key={`automate-${sectionKeys.automate}`}
          className="ui-view-layer absolute inset-0"
          data-view-id="automate"
          data-active={activeView === 'automate' ? 'true' : 'false'}
          aria-hidden={activeView !== 'automate'}
          style={{
            display: activeView === 'automate' ? 'block' : 'none',
          }}
        >
          <Suspense fallback={<LoadingFallback componentName="Automation" />}>
            <SectionErrorBoundary 
              sectionName="Automation" 
              onReset={() => refreshSection('automate')}
            >
              <AutomationView />
            </SectionErrorBoundary>
          </Suspense>
        </div>)}

        {/* Timeline View */}
        {activeView === 'timeline' && (<div 
          key={`timeline-${sectionKeys.timeline}`}
          className="ui-view-layer absolute inset-0"
          data-view-id="timeline"
          data-active={activeView === 'timeline' ? 'true' : 'false'}
          aria-hidden={activeView !== 'timeline'}
          style={{
            display: activeView === 'timeline' ? 'block' : 'none',
          }}
        >
          <Suspense fallback={<LoadingFallback componentName="Timeline" />}>
            <SectionErrorBoundary 
              sectionName="Timeline" 
              onReset={() => refreshSection('timeline')}
            >
              <TimelineView />
            </SectionErrorBoundary>
          </Suspense>
        </div>)}

        {/* Topology View */}
        {activeView === 'topology' && (<div 
          key={`topology-${sectionKeys.topology}`}
          className="ui-view-layer absolute inset-0"
          data-view-id="topology"
          data-active={activeView === 'topology' ? 'true' : 'false'}
          aria-hidden={activeView !== 'topology'}
          style={{
            display: activeView === 'topology' ? 'block' : 'none',
          }}
        >
          <Suspense fallback={<LoadingFallback componentName="Topology" />}>
            <SectionErrorBoundary 
              sectionName="Topology" 
              onReset={() => refreshSection('topology')}
            >
              <TopologyView />
            </SectionErrorBoundary>
          </Suspense>
        </div>)}

        {/* Settings View */}
        {activeView === 'settings' && (<div 
          key={`settings-${sectionKeys.settings}`}
          className="ui-view-layer absolute inset-0"
          data-view-id="settings"
          data-active={activeView === 'settings' ? 'true' : 'false'}
          aria-hidden={activeView !== 'settings'}
          style={{
            display: activeView === 'settings' ? 'block' : 'none',
          }}
        >
          <Suspense fallback={<LoadingFallback componentName="Settings" />}>
            <SectionErrorBoundary 
              sectionName="Settings" 
              onReset={() => refreshSection('settings')}
            >
              <SettingsView scrollToSection={settingsSection} />
            </SectionErrorBoundary>
          </Suspense>
        </div>)}

        {/* Foothold view - terminal instances are preserved by terminalService */}
        {visitedViews.has('foothold') && (<div 
          key={`foothold-${sectionKeys.foothold}`}
          className="ui-view-layer absolute inset-0"
          data-view-id="foothold"
          data-active={activeView === 'foothold' ? 'true' : 'false'}
          aria-hidden={activeView !== 'foothold'}
          style={{
            display: activeView === 'foothold' ? 'block' : 'none',
          }}
        >
          <Suspense fallback={<LoadingFallback componentName="Foothold" />}>
            <SectionErrorBoundary 
              sectionName="Foothold" 
              onReset={() => refreshSection('foothold')}
            >
              <FootholdView isActive={activeView === 'foothold'} />
            </SectionErrorBoundary>
          </Suspense>
        </div>)}

        {/* Tunneling view - terminal instances are preserved by terminalService */}
        {visitedViews.has('tunneling') && (<div 
          key={`tunneling-${sectionKeys.tunneling}`}
          className="ui-view-layer absolute inset-0"
          data-view-id="tunneling"
          data-active={activeView === 'tunneling' ? 'true' : 'false'}
          aria-hidden={activeView !== 'tunneling'}
          style={{
            display: activeView === 'tunneling' ? 'block' : 'none',
          }}
        >
          <Suspense fallback={<LoadingFallback componentName="Tunneling" />}>
            <SectionErrorBoundary 
              sectionName="Tunneling" 
              onReset={() => refreshSection('tunneling')}
            >
              <TunnelingView isActive={activeView === 'tunneling'} />
            </SectionErrorBoundary>
          </Suspense>
        </div>)}

        {/* Terminals view - terminal instances are preserved by terminalService */}
        {visitedViews.has('terminals') && (<div 
          key={`terminals-${sectionKeys.terminals}`}
          className="ui-view-layer absolute inset-0"
          data-view-id="terminals"
          data-active={activeView === 'terminals' ? 'true' : 'false'}
          aria-hidden={activeView !== 'terminals'}
          style={{
            display: activeView === 'terminals' ? 'block' : 'none',
          }}
        >
          <Suspense fallback={<LoadingFallback componentName="Terminals" />}>
            <SectionErrorBoundary 
              sectionName="Terminals" 
              onReset={() => refreshSection('terminals')}
            >
              <TerminalTabsView isActive={activeView === 'terminals'} />
            </SectionErrorBoundary>
          </Suspense>
        </div>)}

        {/* Subdomains view - terminal instances are preserved by terminalService */}
        {visitedViews.has('subdomains') && (<div 
          key={`subdomains-${sectionKeys.subdomains}`}
          className="ui-view-layer absolute inset-0"
          data-view-id="subdomains"
          data-active={activeView === 'subdomains' ? 'true' : 'false'}
          aria-hidden={activeView !== 'subdomains'}
          style={{
            display: activeView === 'subdomains' ? 'block' : 'none',
          }}
        >
          <Suspense fallback={<LoadingFallback componentName="Subdomain Scanner" />}>
            <SectionErrorBoundary 
              sectionName="Subdomain Scanner" 
              onReset={() => refreshSection('subdomains')}
            >
              <SubdomainView isActive={activeView === 'subdomains'} />
            </SectionErrorBoundary>
          </Suspense>
        </div>)}

        {/* Unknown View Fallback */}
        {!['scan', 'exploit', 'automate', 'timeline', 'topology', 'settings', 'foothold', 'tunneling', 'terminals', 'subdomains'].includes(activeView) && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
      <img src="./osecbox-icon.png" alt="" width={48} height={48} draggable={false} className="w-12 h-12 rounded-xl object-cover mx-auto mb-3 shadow-[0_0_24px_rgba(139,92,246,0.32)]" />
              <p className="text-lg font-medium mb-2">Unknown View</p>
              <p className="text-sm">View "{activeView}" not found</p>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <ToastProvider>
      <Suspense fallback={<LoadingFallback componentName="Scanner" />}>
        <ScannerProvider>
          <ProcessStatusSync />
          <div className="h-screen w-screen bg-background text-foreground flex flex-col relative">
          {/* Custom Title Bar */}
          <TitleBar isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
          
          <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
            {/* Far Left: Main Navigation Sidebar */}
            <MainSidebar 
                currentView={activeView} 
                onViewChange={handleViewChange}
                onViewHover={preloadView}
            />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-background/50 relative shadow-2xl">
                {renderMainContent()}
            </div>
          </div>
          
          {/* TOOL INSTALLATION: Global tool not found dialog */}
          <ToolNotFoundDialog 
            tool={useToolCheckStore(state => state.installDialogTool) || ''}
            open={!!useToolCheckStore(state => state.installDialogTool)}
            onClose={() => useToolCheckStore.getState().closeInstallDialog()}
          />
          
          {/* NOTIFICATIONS: Modern toast notifications for all errors/warnings */}
          <NotificationToast />
          
          {/* NETWORK STATUS: Show network health - positioned absolutely at bottom, only bar is clickable */}
          <div className="absolute bottom-0 left-0 right-0 z-[100] pointer-events-none">
            <NetworkStatusBar />
          </div>
        </div>
        </ScannerProvider>
      </Suspense>
    </ToastProvider>
  );
}
