
import React, { useState, useRef } from 'react';
import { useScanner } from '@/lib/scanner-context';
import { useFootholdStore } from '@/lib/foothold-store';
import { useTunnelingStore } from '@/lib/tunneling-store';
import { useGlobalTerminalStore } from '@/lib/global-terminal-store';
import { useTerminalTabsStore } from '@/lib/terminal-tabs-store';
import { useSubdomainStore } from '@/lib/subdomain-store';
import { useMetasploitStore } from '@/lib/metasploit-store';
import { cn } from '@/lib/utils';
import { Plus, X, Globe, RotateCcw, Save } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TabBarProps {
  currentView?: 'scan' | 'exploit' | 'foothold' | 'tunneling' | 'subdomains' | 'terminals' | 'automate' | 'timeline' | 'topology';
  viewType?: 'scan' | 'subdomain' | 'foothold' | 'tunneling' | 'terminals' | 'metasploit' | 'automate';
}

export function TabBar({ currentView = 'scan', viewType = 'scan' }: TabBarProps) {
  const { tabs, activeTabId, setActiveTabId, addTab, closeTab, resetCurrentTab } = useScanner();
  const footholdStore = useFootholdStore();
  const tunnelingStore = useTunnelingStore();
  const globalTerminalStore = useGlobalTerminalStore();
  const terminalTabsStore = useTerminalTabsStore();
  const subdomainStore = useSubdomainStore();
  const metasploitStore = useMetasploitStore();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [tabToClose, setTabToClose] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
  // Support for custom tab handlers (for SubdomainView)
  const [customTabHandler, setCustomTabHandler] = useState<{
    onAddTab?: () => void;
    onCloseTab?: (tabId: string) => void;
    onSwitchTab?: (tabId: string) => void;
    tabs?: any[];
    activeTabId?: string;
  } | null>(null);
  
  // Expose method to register custom tab handler
  React.useEffect(() => {
    // Listen for tab registration events based on viewType
    const eventName = viewType === 'subdomain' ? 'subdomain-register-tabs' 
                    : viewType === 'foothold' ? 'foothold-register-tabs'
                    : viewType === 'tunneling' ? 'tunneling-register-tabs'
                    : null;
    
    if (eventName) {
      const handleRegister = (e: CustomEvent) => {
        setCustomTabHandler(e.detail);
      };
      window.addEventListener(eventName as any, handleRegister);
      return () => window.removeEventListener(eventName as any, handleRegister);
    }
  }, [viewType]);
  
  // Each section uses its OWN tabs, not scanner tabs
  // Get tabs based on viewType
  const getSectionTabs = () => {
    switch (viewType) {
      case 'foothold':
        return footholdStore.tabs;
      case 'tunneling':
        return tunnelingStore.tabs;
      case 'subdomain':
      case 'scan':
      default:
        return tabs; // Scanner tabs
    }
  };
  
  const getSectionActiveTabId = () => {
    switch (viewType) {
      case 'foothold':
        return footholdStore.activeTabId;
      case 'tunneling':
        return tunnelingStore.activeTabId;
      case 'subdomain':
      case 'scan':
      default:
        return activeTabId; // Scanner active tab
    }
  };
  
  // FIX: Use custom tabs if registered (for views that dispatch events), otherwise use section tabs
  const useCustomTabs = ['subdomain', 'foothold', 'tunneling'].includes(viewType) && customTabHandler?.tabs;
  const displayTabs = useCustomTabs ? customTabHandler.tabs : getSectionTabs();
  const displayActiveTabId = useCustomTabs && customTabHandler?.activeTabId
    ? customTabHandler.activeTabId
    : getSectionActiveTabId();

  const sectionTabs = displayTabs || [];

  const closeSectionTab = (tabId: string) => {
    if (useCustomTabs && customTabHandler?.onCloseTab) {
      customTabHandler.onCloseTab(tabId);
      return;
    }

    switch (viewType) {
      case 'foothold':
        footholdStore.closeTab(tabId);
        break;
      case 'tunneling':
        tunnelingStore.closeTab(tabId);
        break;
      case 'scan':
      default:
        closeTab(tabId);
        break;
    }
  };

  const isSectionTabRunning = (tabId: string) => {
    if (viewType === 'scan') return !!tabs.find(tab => tab.id === tabId)?.isScanning;
    if (viewType === 'foothold') return hasRunningListeners(tabId);
    if (viewType === 'tunneling') return hasRunningSessions(tabId);
    return false;
  };
  
  // Close context menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);
  
  // Check if a tab has any running listeners
  const hasRunningListeners = (tabId: string) => {
    const tabData = footholdStore.tabs.find(t => t.id === tabId);
    if (!tabData) return false;
    return tabData.listeners.some((l: any) => l.status === 'running');
  };
  
  // Check if a tab has any running tunneling sessions
  const hasRunningSessions = (tabId: string) => {
    const tabData = tunnelingStore.tabs.find(t => t.id === tabId);
    if (!tabData) return false;
    return tabData.sessions.some((s: any) => s.status === 'running');
  };

  const handleReset = () => {
    console.log('[TabBar] Reset button clicked, viewType:', viewType);
    
    // Handle reset based on view type
    switch (viewType) {
      case 'scan':
        // Scan section has tabs
        if (tabs.length === 0) {
          console.log('[TabBar] No tabs, creating new one');
          addTab();
          setShowResetDialog(false);
          return;
        }

        // Get the first tab ID before we start closing
        const firstTabId = tabs[0].id;
        console.log('[TabBar] First tab ID:', firstTabId);
        
        // Close all tabs except the first one (in reverse order to avoid index issues)
        const tabsToClose = tabs.slice(1).reverse();
        console.log('[TabBar] Closing tabs:', tabsToClose.map(t => t.id));
        tabsToClose.forEach(tab => closeTab(tab.id));
        
        // Set the first tab as active
        console.log('[TabBar] Setting active tab to:', firstTabId);
        setActiveTabId(firstTabId);
        
        // Reset the first tab
        console.log('[TabBar] Resetting tab:', firstTabId);
        resetCurrentTab(firstTabId);
        
        // Clear scan terminal output
        globalTerminalStore.clearOutput('scan');
        break;
        
      case 'terminals':
        // Clear terminal output for active terminal
        if (terminalTabsStore.activeTerminalId) {
          globalTerminalStore.clearOutput(terminalTabsStore.activeTerminalId);
        }
        // Reset terminal tabs store (if reset method exists)
        if ('reset' in terminalTabsStore && typeof terminalTabsStore.reset === 'function') {
          terminalTabsStore.reset();
        }
        break;
        
      case 'foothold':
        // Clear all listeners
        footholdStore.clearListeners();
        // Clear terminal output for foothold context
        globalTerminalStore.clearOutput('foothold');
        break;
        
      case 'tunneling':
        // Clear all tunneling sessions
        tunnelingStore.clearSessions();
        // Clear terminal output for tunneling context
        globalTerminalStore.clearOutput('tunneling');
        break;
        
      case 'metasploit':
        // Clear metasploit data
        metasploitStore.reset();
        // Clear terminal output for metasploit context
        globalTerminalStore.clearOutput('metasploit');
        globalTerminalStore.clearOutput('msf-console-persistent');
        break;
        
      case 'subdomain':
        // Clear both the persisted fallback and the view's local per-tab
        // sessions. The view owns the visible result state, so notify it
        // instead of resetting only the Zustand snapshot.
        window.dispatchEvent(new Event('subdomain-reset-section'));
        subdomainStore.resetAll();
        // Clear subdomain terminal output
        globalTerminalStore.clearOutput('subdomain');
        break;
        
      default:
        console.warn('[TabBar] Unknown viewType:', viewType);
        break;
    }
    
    console.log('[TabBar] Reset complete');
    setShowResetDialog(false);
  };

  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // The scan save action is positioned with the scan controls, but the tab
  // bar remains the owner of the section export implementation.
  React.useEffect(() => {
    if (viewType !== 'scan') return;

    const handleOpenScanSaveDialog = () => setShowSaveDialog(true);
    window.addEventListener('open-scan-save-dialog', handleOpenScanSaveDialog);
    return () => window.removeEventListener('open-scan-save-dialog', handleOpenScanSaveDialog);
  }, [viewType]);

  // AlertDialog intentionally traps outside interaction. The scan export is a
  // lightweight action menu, so close it at the document boundary whenever a
  // pointer lands outside the dialog content.
  React.useEffect(() => {
    if (!showSaveDialog) return;

    const handleSaveOutsidePointer = (event: PointerEvent) => {
      const dialog = document.querySelector('[role="alertdialog"]');
      if (dialog && !dialog.contains(event.target as Node)) {
        setShowSaveDialog(false);
      }
    };

    document.addEventListener('pointerdown', handleSaveOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', handleSaveOutsidePointer, true);
  }, [showSaveDialog]);

  const handleSave = async (scope: 'tab' | 'section') => {
    let saveData: any;
    let filename: string;
    
    // Sanitize filename for Windows/Linux/Mac
    const sanitizeFilename = (name: string): string => {
      return name.replace(/[^a-zA-Z0-9-_.]/g, '_');
    };

    try {
      // Handle save based on view type
      switch (viewType) {
      case 'scan':
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (!activeTab) return;

        if (scope === 'tab') {
          // FIX: Get terminal output from buffer
          let terminalOutputString = '';
          try {
            const { terminalService } = await import('@/lib/terminal-service');
            terminalOutputString = terminalService.getOutput(activeTab.id) || '';
          } catch (error) {
            console.warn('[TabBar] Failed to get terminal output:', error);
            terminalOutputString = activeTab.terminalOutput.join('\n');
          }

          // Save only current tab
          saveData = {
            type: 'single-tab',
            timestamp: new Date().toISOString(),
            tab: {
              target: activeTab.target,
              scannerType: activeTab.scannerType || 'nmap',
              selectedOptions: activeTab.selectedOptions.map(o => o.label),
              results: activeTab.results,
              terminalOutput: terminalOutputString,
            }
          };
          filename = `scan-tab-${sanitizeFilename(activeTab.target || 'scan')}-${Date.now()}.json`;
        } else {
          // FIX: Get terminal output from buffer for all tabs
          const tabsWithOutput = await Promise.all(
            tabs.map(async (t) => {
              let terminalOutputString = '';
              try {
                const { terminalService } = await import('@/lib/terminal-service');
                terminalOutputString = terminalService.getOutput(t.id) || '';
              } catch (error) {
                console.warn(`[TabBar] Failed to get terminal output for tab ${t.id}:`, error);
                terminalOutputString = t.terminalOutput.join('\n');
              }

              return {
                target: t.target,
                scannerType: t.scannerType || 'nmap',
                selectedOptions: t.selectedOptions.map(o => o.label),
                results: t.results,
                terminalOutput: terminalOutputString,
              };
            })
          );

          // Save entire section (all tabs)
          saveData = {
            type: 'section',
            section: 'scan',
            timestamp: new Date().toISOString(),
            tabs: tabsWithOutput,
          };
          filename = `scan-section-${Date.now()}.json`;
        }
        break;

      case 'foothold':
        const footholdTabs = footholdStore.tabs;
        const activeFootholdTab = footholdTabs.find(t => t.id === footholdStore.activeTabId);
        
        if (scope === 'tab' && activeFootholdTab) {
          // FIX: Get terminal output from all listeners in active tab
          const listenersWithOutput = await Promise.all(
            activeFootholdTab.listeners.map(async (l) => {
              let terminalOutput = '';
              try {
                const { terminalService } = await import('@/lib/terminal-service');
                const output = terminalService.getOutput(l.id) || '';
                
                // Also try xterm buffer
                const terminal = terminalService.getTerminal(l.id);
                if (terminal) {
                  const buffer = terminal.buffer.active;
                  const lines: string[] = [];
                  for (let i = 0; i < buffer.length; i++) {
                    const line = buffer.getLine(i);
                    if (line) lines.push(line.translateToString(true));
                  }
                  const xtermOutput = lines.join('\n');
                  terminalOutput = xtermOutput.length > output.length ? xtermOutput : output;
                } else {
                  terminalOutput = output;
                }
              } catch (error) {
                console.warn(`[TabBar] Failed to get terminal output for listener ${l.id}:`, error);
              }
              
              return {
                type: l.type,
                port: l.port,
                command: l.command,
                name: l.name,
                status: l.status,
                terminalOutput,
              };
            })
          );
          
          saveData = {
            type: 'single-tab',
            section: 'foothold',
            timestamp: new Date().toISOString(),
            tab: {
              listeners: listenersWithOutput
            }
          };
          filename = `foothold-tab-${Date.now()}.json`;
        } else {
          // FIX: Get terminal output from all listeners in all tabs
          const tabsWithOutput = await Promise.all(
            footholdTabs.map(async (t) => {
              const listenersWithOutput = await Promise.all(
                t.listeners.map(async (l) => {
                  let terminalOutput = '';
                  try {
                    const { terminalService } = await import('@/lib/terminal-service');
                    const output = terminalService.getOutput(l.id) || '';
                    
                    // Also try xterm buffer
                    const terminal = terminalService.getTerminal(l.id);
                    if (terminal) {
                      const buffer = terminal.buffer.active;
                      const lines: string[] = [];
                      for (let i = 0; i < buffer.length; i++) {
                        const line = buffer.getLine(i);
                        if (line) lines.push(line.translateToString(true));
                      }
                      const xtermOutput = lines.join('\n');
                      terminalOutput = xtermOutput.length > output.length ? xtermOutput : output;
                    } else {
                      terminalOutput = output;
                    }
                  } catch (error) {
                    console.warn(`[TabBar] Failed to get terminal output for listener ${l.id}:`, error);
                  }
                  
                  return {
                    type: l.type,
                    port: l.port,
                    command: l.command,
                    name: l.name,
                    status: l.status,
                    terminalOutput,
                  };
                })
              );
              
              return { listeners: listenersWithOutput };
            })
          );
          
          saveData = {
            type: 'section',
            section: 'foothold',
            timestamp: new Date().toISOString(),
            tabs: tabsWithOutput,
          };
          filename = `foothold-section-${Date.now()}.json`;
        }
        break;

      case 'tunneling':
        const tunnelingTabs = tunnelingStore.tabs;
        const activeTunnelingTab = tunnelingTabs.find(t => t.id === tunnelingStore.activeTabId);
        
        if (scope === 'tab' && activeTunnelingTab) {
          // FIX: Get terminal output from all sessions in active tab
          const sessionsWithOutput = await Promise.all(
            activeTunnelingTab.sessions.map(async (s) => {
              let terminalOutput = '';
              try {
                const { terminalService } = await import('@/lib/terminal-service');
                const output = terminalService.getOutput(s.id) || '';
                
                // Also try xterm buffer
                const terminal = terminalService.getTerminal(s.id);
                if (terminal) {
                  const buffer = terminal.buffer.active;
                  const lines: string[] = [];
                  for (let i = 0; i < buffer.length; i++) {
                    const line = buffer.getLine(i);
                    if (line) lines.push(line.translateToString(true));
                  }
                  const xtermOutput = lines.join('\n');
                  terminalOutput = xtermOutput.length > output.length ? xtermOutput : output;
                } else {
                  terminalOutput = output;
                }
              } catch (error) {
                console.warn(`[TabBar] Failed to get terminal output for session ${s.id}:`, error);
              }
              
              return {
                tool: s.tool,
                mode: s.mode,
                port: s.port,
                command: s.command,
                name: s.name,
                status: s.status,
                terminalOutput,
              };
            })
          );
          
          saveData = {
            type: 'single-tab',
            section: 'tunneling',
            timestamp: new Date().toISOString(),
            tab: {
              sessions: sessionsWithOutput
            }
          };
          filename = `tunneling-tab-${Date.now()}.json`;
        } else {
          // FIX: Get terminal output from all sessions in all tabs
          const tabsWithOutput = await Promise.all(
            tunnelingTabs.map(async (t) => {
              const sessionsWithOutput = await Promise.all(
                t.sessions.map(async (s) => {
                  let terminalOutput = '';
                  try {
                    const { terminalService } = await import('@/lib/terminal-service');
                    const output = terminalService.getOutput(s.id) || '';
                    
                    // Also try xterm buffer
                    const terminal = terminalService.getTerminal(s.id);
                    if (terminal) {
                      const buffer = terminal.buffer.active;
                      const lines: string[] = [];
                      for (let i = 0; i < buffer.length; i++) {
                        const line = buffer.getLine(i);
                        if (line) lines.push(line.translateToString(true));
                      }
                      const xtermOutput = lines.join('\n');
                      terminalOutput = xtermOutput.length > output.length ? xtermOutput : output;
                    } else {
                      terminalOutput = output;
                    }
                  } catch (error) {
                    console.warn(`[TabBar] Failed to get terminal output for session ${s.id}:`, error);
                  }
                  
                  return {
                    tool: s.tool,
                    mode: s.mode,
                    port: s.port,
                    command: s.command,
                    name: s.name,
                    status: s.status,
                    terminalOutput,
                  };
                })
              );
              
              return { sessions: sessionsWithOutput };
            })
          );
          
          saveData = {
            type: 'section',
            section: 'tunneling',
            timestamp: new Date().toISOString(),
            tabs: tabsWithOutput,
          };
          filename = `tunneling-section-${Date.now()}.json`;
        }
        break;

      case 'subdomain':
        const subdomainData = subdomainStore;
        
        // FIX: Get terminal output from subdomain sessions
        const subdomainSessionsWithOutput = await Promise.all(
          subdomainData.sessions.map(async (session) => {
            let terminalOutput = '';
            try {
              const { terminalService } = await import('@/lib/terminal-service');
              const output = terminalService.getOutput(session.toolId) || '';
              
              // Also try xterm buffer
              const terminal = terminalService.getTerminal(session.toolId);
              if (terminal) {
                const buffer = terminal.buffer.active;
                const lines: string[] = [];
                for (let i = 0; i < buffer.length; i++) {
                  const line = buffer.getLine(i);
                  if (line) lines.push(line.translateToString(true));
                }
                const xtermOutput = lines.join('\n');
                terminalOutput = xtermOutput.length > output.length ? xtermOutput : output;
              } else {
                terminalOutput = output;
              }
            } catch (error) {
              console.warn(`[TabBar] Failed to get terminal output for subdomain session ${session.toolId}:`, error);
            }
            
            return {
              ...session,
              terminalOutput,
            };
          })
        );
        
        saveData = {
          type: 'section',
          section: 'subdomain',
          timestamp: new Date().toISOString(),
          domain: subdomainData.domain,
          subdomains: subdomainData.subdomains,
          sessions: subdomainSessionsWithOutput,
        };
        filename = `subdomain-${sanitizeFilename(subdomainData.domain || 'scan')}-${Date.now()}.json`;
        break;

      case 'metasploit':
        const metasploitData = metasploitStore;
        
        // FIX: Get terminal output from metasploit console
        let msfConsoleOutput = '';
        try {
          const { terminalService } = await import('@/lib/terminal-service');
          const output = terminalService.getOutput('msf-console-persistent') || '';
          
          // Also try xterm buffer
          const terminal = terminalService.getTerminal('msf-console-persistent');
          if (terminal) {
            const buffer = terminal.buffer.active;
            const lines: string[] = [];
            for (let i = 0; i < buffer.length; i++) {
              const line = buffer.getLine(i);
              if (line) lines.push(line.translateToString(true));
            }
            const xtermOutput = lines.join('\n');
            msfConsoleOutput = xtermOutput.length > output.length ? xtermOutput : output;
          } else {
            msfConsoleOutput = output;
          }
        } catch (error) {
          console.warn('[TabBar] Failed to get metasploit console output:', error);
        }
        
        saveData = {
          type: 'section',
          section: 'metasploit',
          timestamp: new Date().toISOString(),
          modules: metasploitData.modules,
          sessions: metasploitData.sessions,
          campaigns: metasploitData.campaigns,
          handlers: metasploitData.handlers,
          consoleOutput: msfConsoleOutput,
        };
        filename = `metasploit-${Date.now()}.json`;
        break;

      case 'terminals':
        const terminalData = terminalTabsStore;
        
        // FIX: Get terminal output from all terminals
        const terminalsWithOutput = await Promise.all(
          terminalData.terminals.map(async (term) => {
            let terminalOutput = '';
            try {
              const { terminalService } = await import('@/lib/terminal-service');
              const output = terminalService.getOutput(term.id) || '';
              
              // Also try xterm buffer
              const terminal = terminalService.getTerminal(term.id);
              if (terminal) {
                const buffer = terminal.buffer.active;
                const lines: string[] = [];
                for (let i = 0; i < buffer.length; i++) {
                  const line = buffer.getLine(i);
                  if (line) lines.push(line.translateToString(true));
                }
                const xtermOutput = lines.join('\n');
                terminalOutput = xtermOutput.length > output.length ? xtermOutput : output;
              } else {
                terminalOutput = output;
              }
            } catch (error) {
              console.warn(`[TabBar] Failed to get terminal output for terminal ${term.id}:`, error);
            }
            
            return {
              ...term,
              terminalOutput,
            };
          })
        );
        
        saveData = {
          type: 'section',
          section: 'terminals',
          timestamp: new Date().toISOString(),
          terminals: terminalsWithOutput,
        };
        filename = `terminals-${Date.now()}.json`;
        break;

      default:
        console.warn('[TabBar] Save not implemented for viewType:', viewType);
        setShowSaveDialog(false);
        return;
      }

      // Create downloadable file with proper encoding
      const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      // Cleanup after delay, but tolerate a view unmounting before the timer.
      setTimeout(() => {
        if (a.isConnected) a.remove();
        URL.revokeObjectURL(url);
      }, 100);
      
      setShowSaveDialog(false);
    } catch (error: any) {
      console.error('[TabBar] Failed to export section:', error);
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { message: `Export failed: ${error?.message || 'Unable to create the file'}`, type: 'error' },
      }));
    }
  };

  // Browser-like tab closing functions
  const handleCloseTab = (tabId: string) => {
    if (isSectionTabRunning(tabId)) {
      setTabToClose(tabId);
      setShowCloseDialog(true);
    } else {
      closeSectionTab(tabId);
    }
    setContextMenu(null);
  };

  const handleCloseOtherTabs = (tabId: string) => {
    sectionTabs.forEach(tab => {
      if (tab.id !== tabId && !isSectionTabRunning(tab.id)) closeSectionTab(tab.id);
    });
    setContextMenu(null);
  };

  const handleCloseTabsToRight = (tabId: string) => {
    const tabIndex = sectionTabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;
    
    // Close all tabs to the right
    sectionTabs.slice(tabIndex + 1).forEach(tab => {
      if (!isSectionTabRunning(tab.id)) closeSectionTab(tab.id);
    });
    setContextMenu(null);
  };

  const handleCloseTabsToLeft = (tabId: string) => {
    const tabIndex = sectionTabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;
    
    // Close all tabs to the left
    sectionTabs.slice(0, tabIndex).forEach(tab => {
      if (!isSectionTabRunning(tab.id)) closeSectionTab(tab.id);
    });
    setContextMenu(null);
  };

  const handleCloseAllTabs = () => {
    sectionTabs.forEach(tab => {
      if (!isSectionTabRunning(tab.id)) closeSectionTab(tab.id);
    });
    setContextMenu(null);
  };

  const handleDuplicateTab = (tabId: string) => {
    const tab = sectionTabs.find(t => t.id === tabId);
    if (tab) {
      addTab(tab.target, tab.scannerType, true);
    }
    setContextMenu(null);
  };

  const handleStartFreshScan = (tabId: string) => {
    if (viewType !== 'scan') return;
    setActiveTabId(tabId);
    // resetCurrentTab cancels the active run, interrupts the reusable shell,
    // clears visible output, and removes per-scanner results/caches.
    void resetCurrentTab(tabId);
    setContextMenu(null);
  };

  // Get tab display name based on view type
  const getTabDisplayName = (tab: any, index: number) => {
    switch (viewType) {
      case 'subdomain':
        return tab.target ? `SUBDOMAIN: ${tab.target}` : `SUBDOMAIN ${index + 1}`;
      case 'foothold':
        return `LISTENER ${index + 1}`;
      case 'tunneling':
        return `TUNNEL ${index + 1}`;
      case 'terminals':
        return `TERMINAL ${index + 1}`;
      case 'metasploit':
        return `SESSION ${index + 1}`;
      case 'scan':
      default:
        // Get scanner type name
        const scannerName = tab.scannerType?.toUpperCase() || 'SCAN';
        return tab.target ? `${scannerName}: ${tab.target}` : `${scannerName} ${index + 1}`;
    }
  };

  return (
    <>
      <div className="flex items-end w-full h-9 bg-muted/30 border-b border-border select-none pl-2 pt-1 relative z-10">
        {/* Reset Button - Left Side */}
        <button
          type="button"
          onClick={() => setShowResetDialog(true)}
          className="flex items-center justify-center h-7 px-3 mb-0.5 mr-2 rounded-t bg-red-600 hover:bg-red-700 text-white transition-colors border-t border-l border-r border-red-500 shadow-sm"
          title="Reset Section"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <div className="flex-1 overflow-hidden flex items-end min-w-0">
          {displayTabs?.map((tab, index) => {
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={tab.id === displayActiveTabId}
                aria-label={getTabDisplayName(tab, index)}
                tabIndex={tab.id === displayActiveTabId ? 0 : -1}
                onClick={() => {
                  // Use correct store method based on viewType
                  if (useCustomTabs && customTabHandler?.onSwitchTab) {
                    customTabHandler.onSwitchTab(tab.id);
                  } else {
                    // Use section-specific set active tab method
                    switch (viewType) {
                      case 'foothold':
                        footholdStore.setActiveTabId(tab.id);
                        break;
                      case 'tunneling':
                        tunnelingStore.setActiveTabId(tab.id);
                        break;
                      case 'scan':
                      default:
                        setActiveTabId(tab.id);
                        break;
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (useCustomTabs && customTabHandler?.onSwitchTab) {
                      customTabHandler.onSwitchTab(tab.id);
                    } else {
                      switch (viewType) {
                        case 'foothold':
                          footholdStore.setActiveTabId(tab.id);
                          break;
                        case 'tunneling':
                          tunnelingStore.setActiveTabId(tab.id);
                          break;
                        case 'scan':
                        default:
                          setActiveTabId(tab.id);
                          break;
                      }
                    }
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
                }}
                style={{
                  maxWidth: (displayTabs?.length || 0) <= 3 ? '240px' : `${Math.max(100, 240 / Math.ceil((displayTabs?.length || 1) / 3))}px`,
                  minWidth: '80px',
                  flex: '1 1 0'
                }}
                className={cn(
                  "group relative flex items-center h-8 px-3 text-xs cursor-pointer smooth-colors animate-scale-in rounded-t-xl mr-[-1px] border-t-2 border-l-2 border-r-2 transition-all duration-200",
                  tab.id === displayActiveTabId 
                    ? "bg-card/80 text-foreground font-bold border-white/60 shadow-[0_-2px_8px_rgba(0,0,0,0.2)] z-20" 
                    : "bg-muted/30 text-foreground/80 hover:text-foreground hover:bg-muted/60 border-transparent z-10"
                )}
              >
                <div className="mr-2 opacity-80">
                  {(tab.isScanning || hasRunningListeners(tab.id) || hasRunningSessions(tab.id)) ? (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-600"></span>
                    </span>
                  ) : (
                     <Globe className={cn("w-3.5 h-3.5", tab.id === displayActiveTabId ? "text-primary" : "text-muted-foreground")} />
                  )}
                </div>
                <span className="truncate flex-1 mr-2">{getTabDisplayName(tab, index)}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Use correct store method based on viewType
                    handleCloseTab(tab.id);
                  }}
                  className={cn(
                    "p-0.5 rounded-sm hover:bg-destructive/10 hover:text-destructive transition-colors",
                    tab.id !== displayActiveTabId && "opacity-0 group-hover:opacity-100"
                  )}
                  aria-label={`Close ${getTabDisplayName(tab, index)}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          
          <button
            type="button"
            onClick={() => {
              // Use correct store method based on viewType
              if (useCustomTabs && customTabHandler?.onAddTab) {
                customTabHandler.onAddTab();
              } else {
                // Use section-specific add tab method
                switch (viewType) {
                  case 'foothold':
                    footholdStore.addTab();
                    break;
                  case 'tunneling':
                    tunnelingStore.addTab();
                    break;
                  case 'scan':
                  default:
                    addTab('', 'nmap', true);
                    break;
                }
              }
            }}
            className="flex items-center justify-center h-6 w-7 ml-2 mb-1 rounded bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground smooth-colors animate-button border border-transparent hover:border-border flex-shrink-0"
            title="New Tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scan save is positioned beside the Run Scan action. Other sections
            keep their section-level save control in this tab bar. */}
        {viewType !== 'scan' && (
          <button
            type="button"
            onClick={() => setShowSaveDialog(true)}
            className="flex items-center justify-center h-7 px-3 mb-0.5 ml-2 mr-2 rounded-t bg-emerald-600 hover:bg-emerald-700 text-white border-t border-l border-r border-emerald-500 transition-all shadow-sm"
            title="Save Data"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            <span className="text-xs font-semibold">SAVE</span>
          </button>
        )}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-0.5 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => handleCloseTab(contextMenu.tabId)}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <X className="w-3 h-3" />
            Close Tab
          </button>
          <button
            type="button"
            onClick={() => handleCloseOtherTabs(contextMenu.tabId)}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
            disabled={sectionTabs.length <= 1}
          >
            Close Other Tabs
          </button>
          {sectionTabs.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => handleCloseTabsToRight(contextMenu.tabId)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
                disabled={sectionTabs.findIndex(t => t.id === contextMenu.tabId) === sectionTabs.length - 1}
              >
                Close Tabs to the Right
              </button>
              <button
                type="button"
                onClick={() => handleCloseTabsToLeft(contextMenu.tabId)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
                disabled={sectionTabs.findIndex(t => t.id === contextMenu.tabId) === 0}
              >
                Close Tabs to the Left
              </button>
            </>
          )}
          <div className="border-t border-border my-0.5"></div>
          {sectionTabs.length > 1 && (
            <button
              type="button"
              onClick={() => handleCloseAllTabs()}
              className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors text-destructive"
            >
              Close All Tabs
            </button>
          )}
          <div className="border-t border-border my-0.5"></div>
          {viewType === 'scan' && (
            <>
              <button
                type="button"
                onClick={() => handleStartFreshScan(contextMenu.tabId)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
              >
                Start Fresh Scan
              </button>
              <button
                type="button"
                onClick={() => handleDuplicateTab(contextMenu.tabId)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
              >
                Duplicate Tab
              </button>
            </>
          )}
        </div>
      )}

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent className="bg-popover border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Reset Section?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {viewType === 'scan' && 'This will close all tabs except one, clear all scan results, terminal output, and selected options.'}
              {viewType === 'terminals' && 'This will close all terminals except one and clear all terminal output.'}
              {viewType === 'foothold' && 'This will close all tabs except one, clear all listeners and terminal output.'}
              {viewType === 'tunneling' && 'This will close all tabs except one, clear all tunneling sessions and terminal output.'}
              {viewType === 'metasploit' && 'This will close all tabs except one, clear all search results, modules, and terminal output.'}
              {viewType === 'subdomain' && 'This will close all tabs except one, clear all subdomain enumeration results and terminal output.'}
              {!['scan', 'terminals', 'foothold', 'tunneling', 'metasploit', 'subdomain'].includes(viewType) && 'This will close all tabs except one and clear all data.'}
              {' '}This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-muted text-foreground hover:bg-muted/80">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleReset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset Section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close Tab Confirmation Dialog */}
      <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <AlertDialogContent className="bg-popover border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Close Running Session?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This tab has an active process running. Closing it will stop the process and you'll lose any unsaved results. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-muted text-foreground hover:bg-muted/80">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (tabToClose) {
                  closeSectionTab(tabToClose);
                  setTabToClose(null);
                }
                setShowCloseDialog(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Close Tab
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save Dialog */}
      <AlertDialog modal={false} open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <AlertDialogContent
          className="bg-popover border-border max-w-md"
          allowOutsideInteraction
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base text-foreground">Save Data</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              Choose what you want to save:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <button
              type="button"
              onClick={() => handleSave('tab')}
              className="w-full p-3 rounded-lg border-2 border-border bg-background hover:border-primary hover:bg-primary/5 transition-all text-left"
            >
              <div className="font-bold text-xs text-foreground mb-0.5">Current Tab Only</div>
              <div className="text-[10px] text-muted-foreground">Save only the active tab's data</div>
            </button>
            <button
              type="button"
              onClick={() => handleSave('section')}
              className="w-full p-3 rounded-lg border-2 border-border bg-background hover:border-primary hover:bg-primary/5 transition-all text-left"
            >
              <div className="font-bold text-xs text-foreground mb-0.5">Entire Section</div>
              <div className="text-[10px] text-muted-foreground">Save all tabs and data from this section</div>
            </button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-muted text-foreground hover:bg-muted/80 text-xs h-8">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
