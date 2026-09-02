import React from 'react';
import { 
  Layers, 
  Sparkles, 
  Clock, 
  GitBranch, 
  Globe2,
  Settings,
  Radar,
  Swords,
  Wifi,
  Network,
  ChevronDown,
  ChevronUp,
  Trash2,
  TerminalSquare,
  Save,
  FolderOpen
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUpdateStore } from '@/lib/update-store';
import { useScanner } from '@/lib/scanner-context';
import { useFootholdStore } from '@/lib/foothold-store';
import { useTunnelingStore } from '@/lib/tunneling-store';
import { useMetasploitStore } from '@/lib/metasploit-store';
import { SessionManagerDialog } from '@/components/session/SessionManager';
import { AboutDialog } from '@/components/dialogs/AboutDialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export type SidebarView = 'scan' | 'exploit' | 'foothold' | 'tunneling' | 'terminals' | 'automate' | 'timeline' | 'topology' | 'subdomains' | 'settings';

interface MainSidebarProps {
  currentView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  onViewHover?: (view: string) => void;
}

// PERFORMANCE: Memoize component to prevent unnecessary re-renders
export const MainSidebar = React.memo(function MainSidebar({ currentView, onViewChange, onViewHover }: MainSidebarProps) {
  const [consoleExpanded, setConsoleExpanded] = React.useState(true);
  const [sessionDialog, setSessionDialog] = React.useState<'save' | 'load' | null>(null);
  const [showAbout, setShowAbout] = React.useState(false);
  const { updateAvailable } = useUpdateStore();
  
  // PERFORMANCE: Use correct hook pattern
  const { tabs, closeTab } = useScanner();
  
  // PERFORMANCE: Memoize expensive calculations
  const hasFootholdData = useFootholdStore(
    React.useCallback((state: any) => Object.values(state.tabs).some((tab: any) => tab.listeners.length > 0), [])
  );
  const hasTunnelingData = useTunnelingStore(
    React.useCallback((state: any) => Object.values(state.tabs).some((tab: any) => tab.sessions.length > 0), [])
  );
  const hasMetasploitData = useMetasploitStore(
    React.useCallback((state: any) => state.modules.length > 0, [])
  );
  
  const handleClearSection = (section: 'scan' | 'exploit' | 'foothold' | 'tunneling') => {
    if (section === 'scan') {
      // Close all tabs
      tabs.forEach(tab => closeTab(tab.id));
    } else if (section === 'exploit') {
      // Clear Metasploit modules
      const metasploitStore = useMetasploitStore.getState();
      metasploitStore.clearModules();
    } else if (section === 'foothold') {
      // Clear all foothold listeners across all tabs
      const footholdStore = useFootholdStore.getState();
      footholdStore.clearListeners();
    } else if (section === 'tunneling') {
      // Clear all tunneling sessions across all tabs
      const tunnelingStore = useTunnelingStore.getState();
      tunnelingStore.clearSessions();
    }
  };
  
  const navItems = [
    { id: 'console', icon: Layers, label: 'Console', hasSubmenu: true, description: 'Scanning, Exploitation & Listeners' },
    { id: 'terminals', icon: TerminalSquare, label: 'Terminals', description: 'Multiple Terminal Sessions' },
    { id: 'subdomains', icon: Globe2, label: 'Sub\nDomain', description: 'Subdomain Enumeration Tools' },
    { id: 'automate', icon: Sparkles, label: 'Automate', description: 'Batch Scans & Automation Tasks' },
    { id: 'timeline', icon: Clock, label: 'Timeline', description: 'Scheduled Scans & History' },
    { id: 'topology', icon: GitBranch, label: 'Topology', description: 'Network Map & Visualization' },
  ];

  const bottomItems = [
    { id: 'save-session', icon: Save, label: 'Save', description: 'Save Current Workspace Session', isSession: true, sessionMode: 'save' as const },
    { id: 'load-session', icon: FolderOpen, label: 'Load', description: 'Load Previous Workspace Session', isSession: true, sessionMode: 'load' as const },
    { id: 'settings', icon: Settings, label: 'Settings', description: 'App Configuration & Preferences', hasUpdate: updateAvailable },
  ];

  const consoleSubItems = [
    { id: 'scan', icon: Radar, label: 'Scan', description: 'Nmap Network Scanning', color: 'text-green-500', bgColor: 'bg-green-500/10', borderColor: 'border-green-500' },
    { id: 'exploit', icon: Swords, label: 'Exploit', description: 'Metasploit Framework', color: 'text-red-500', bgColor: 'bg-red-500/10', borderColor: 'border-red-500' },
    { id: 'foothold', icon: Wifi, label: 'Foothold', description: 'Listeners & Reverse Shells', color: 'text-yellow-500', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500' },
    { id: 'tunneling', icon: Network, label: 'Tunneling', description: 'Port Forwarding & Pivoting', color: 'text-purple-500', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500' },
  ];

  return (
    <div className="w-[80px] h-full min-h-0 overflow-hidden bg-sidebar border-r border-sidebar-border flex flex-col items-center py-5 z-20 shadow-[4px_0_24px_rgba(0,0,0,0.08)]">
      {/* App Logo */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => setShowAbout(true)}
          className="w-11 h-11 bg-gradient-to-br from-primary to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-primary/20 border border-primary/20 win7-button p-0 overflow-hidden active:translate-y-0 cursor-pointer hover:opacity-90 transition-opacity"
          title="About OsecBox"
        >
          <img
            src="./osecbox-icon.png"
            alt="OsecBox"
            width={36}
            height={36}
            draggable={false}
            className="w-9 h-9 rounded-lg object-cover shadow-[0_0_18px_rgba(139,92,246,0.45)]"
          />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-2.5 w-full px-1">
        <TooltipProvider delayDuration={350} skipDelayDuration={150}>
          {navItems.map((item) => (
            <React.Fragment key={item.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      if (item.hasSubmenu) {
                        setConsoleExpanded(!consoleExpanded);
                        if (!consoleExpanded) {
                          onViewChange('scan');
                        }
                      } else {
                        onViewChange(item.id as SidebarView);
                      }
                    }}
                    aria-expanded={item.hasSubmenu ? consoleExpanded : undefined}
                    aria-controls={item.hasSubmenu ? 'console-subnav' : undefined}
                    aria-current={((item.hasSubmenu && ['scan', 'exploit', 'foothold', 'tunneling'].includes(currentView)) || currentView === item.id) ? 'page' : undefined}
                    onMouseEnter={() => {
                      // Preload on hover for instant switching
                      if (!item.hasSubmenu) {
                        onViewHover?.(item.id);
                      }
                    }}
                    className={cn(
                      "win7-button w-full h-14 flex flex-col items-center justify-center gap-1 p-0 relative",
                      (currentView === 'scan' || currentView === 'exploit' || currentView === 'foothold' || currentView === 'tunneling') && item.id === 'console'
                        ? "active ring-2 ring-primary/30 border-primary" 
                        : currentView === item.id 
                        ? "active ring-2 ring-primary/30 border-primary" 
                        : "text-foreground"
                    )}
                  >
                    <item.icon className={cn(
                      "w-5 h-5", 
                      (currentView === 'scan' || currentView === 'exploit' || currentView === 'foothold' || currentView === 'tunneling') && item.id === 'console'
                        ? "text-primary"
                        : currentView === item.id 
                        ? "text-primary" 
                        : "text-foreground"
                    )} />
                    <span className={cn(
                      "text-[12px] font-extrabold leading-tight text-center whitespace-pre-line",
                      (currentView === 'scan' || currentView === 'exploit' || currentView === 'foothold' || currentView === 'tunneling') && item.id === 'console'
                        ? "text-primary"
                        : currentView === item.id 
                        ? "text-primary" 
                        : "text-foreground"
                    )}>{item.label}</span>
                    {/* Expandable indicator for Console */}
                    {item.hasSubmenu && (
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
                        {consoleExpanded ? (
                          <ChevronUp className="w-[18px] h-[18px] text-primary" strokeWidth={2.5} />
                        ) : (
                          <ChevronDown className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={2.5} />
                        )}
                      </div>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="ml-2 max-w-xs">
                  <div className="space-y-1">
                    <p className="font-bold text-sm">{item.label}</p>
                    <p className="text-xs text-muted-foreground font-medium">{item.description}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
              
              {/* Console Submenu */}
              {item.hasSubmenu && consoleExpanded && (
                <div id="console-subnav" className="ui-reveal relative flex flex-col gap-1.5 pl-3 mt-0.5 mb-0.5">
                  {/* Vertical line from Console button extending to next button */}
                  <div className="absolute left-[8px] top-[-4px] bottom-[-10px] w-[2px] bg-primary/60"></div>
                  
                  {consoleSubItems.map((subItem, index) => {
                    const hasData = 
                      (subItem.id === 'scan' && tabs.length > 0) ||
                      (subItem.id === 'exploit' && hasMetasploitData) ||
                      (subItem.id === 'foothold' && hasFootholdData) ||
                      (subItem.id === 'tunneling' && hasTunnelingData);
                    
                    return (
                      <div key={subItem.id} className="relative">
                        {/* Horizontal branch line - more vibrant */}
                        <div className="absolute left-[-16px] top-1/2 w-4 h-[2px] bg-primary/60"></div>
                        
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <div>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => onViewChange(subItem.id as SidebarView)}
                                    onMouseEnter={() => onViewHover?.(subItem.id)}
                                    className={cn(
                                      "win7-button w-full h-14 flex flex-col items-center justify-center gap-0.5 p-0 text-xs",
                                      currentView === subItem.id 
                                        ? `active ring-2 ${subItem.bgColor} ${subItem.borderColor}` 
                                      : "text-foreground"
                                    )}
                                    aria-current={currentView === subItem.id ? 'page' : undefined}
                                  >
                                    <subItem.icon className={cn("w-5 h-5", currentView === subItem.id ? subItem.color : "text-foreground")} />
                                    <span className={cn(
                                      "text-[12px] font-extrabold",
                                      currentView === subItem.id ? subItem.color : "text-foreground"
                                    )}>{subItem.label}</span>
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="ml-2 max-w-xs">
                                  <div className="space-y-1">
                                    <p className="font-bold text-sm">{subItem.label}</p>
                                  <p className="text-xs text-muted-foreground font-medium">{subItem.description}</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </ContextMenuTrigger>
                          {hasData && (
                            <ContextMenuContent className="w-48">
                              <ContextMenuItem 
                                onClick={() => handleClearSection(subItem.id as 'scan' | 'exploit' | 'foothold' | 'tunneling')}
                                className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                {subItem.id === 'exploit'
                                  ? 'Clear Module Cache'
                                  : `Clear All ${subItem.label === 'Scan' ? 'Tabs' : subItem.label === 'Foothold' ? 'Listeners' : 'Tunnels'}`}
                              </ContextMenuItem>
                            </ContextMenuContent>
                          )}
                        </ContextMenu>
                      </div>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          ))}
        </TooltipProvider>
      </nav>

      {/* Spacer and Divider */}
      <div className="mt-auto pt-4 w-full px-3">
        <div className="h-[2px] bg-gradient-to-r from-transparent via-border to-transparent rounded-full mb-4"></div>
      </div>

      {/* Bottom Actions - Session & Settings */}
      <div className="flex flex-col gap-2 w-full px-1 pb-2">
        <TooltipProvider delayDuration={350} skipDelayDuration={150}>
          {bottomItems.map((item: any) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    if (item.isSession) {
                      setSessionDialog(item.sessionMode);
                    } else {
                      onViewChange(item.id as SidebarView);
                    }
                  }}
                  onMouseEnter={() => {
                    if (!item.isSession) {
                      onViewHover?.(item.id);
                    }
                  }}
                  className={cn(
                    "win7-button w-full h-[46px] flex items-center justify-center p-0 relative",
                    currentView === item.id && !item.isSession && "active"
                  )}
                  aria-label={item.label}
                  aria-current={currentView === item.id && !item.isSession ? 'page' : undefined}
                >
                  <item.icon className={cn(
                    "w-[19px] h-[19px]",
                    item.isSession
                      ? item.sessionMode === 'save'
                        ? "text-green-500"
                        : "text-blue-500"
                      : "text-foreground"
                  )} />
                  {item.hasUpdate && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-sidebar animate-pulse" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="ml-2 max-w-xs">
                <div className="space-y-1">
                  <p className="font-bold text-sm">{item.label} {item.hasUpdate && '🔴'}</p>
                  <p className="text-xs text-muted-foreground font-medium">
                    {item.hasUpdate ? 'Update available!' : item.description}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>

      {/* Session Manager Dialog */}
      <SessionManagerDialog
        open={sessionDialog !== null}
        onOpenChange={(open) => !open && setSessionDialog(null)}
        mode={sessionDialog || 'save'}
      />
      
      {/* About Dialog */}
      <AboutDialog open={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  );
}, (prevProps, nextProps) => {
  // PERFORMANCE: Custom comparison for optimal re-render control
  return (
    prevProps.currentView === nextProps.currentView
  );
});
