import React, { useState, useEffect } from 'react';
import { useScanner } from '@/lib/scanner-context';
import { NMAP_SECTIONS, NMAP_OPTIONS, NmapSection } from '@/lib/nmap-config';
import { Play, Loader2, Search, SlidersHorizontal, X, Radar, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NmapCommandBuilder } from '@/lib/nmap-command-builder';
import { useToast } from '@/components/ui/toast';
import { terminalService } from '@/lib/terminal-service';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NmapPanelProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function NmapPanel({ isCollapsed = false, onToggleCollapse }: NmapPanelProps = {}) {
  const { activeTabId, tabs, updateTabTarget, toggleOption, toggleAdvanced, runScan, stopScan, resetCurrentTab } = useScanner();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [activeSection, setActiveSection] = useState<NmapSection>('SCAN_TYPE');
  const { showToast } = useToast();

  // PRIVILEGE: Listen for privilege warnings
  useEffect(() => {
    const cleanup = window.electron?.onScanPrivilegeWarning?.((data) => {
      if (data.scanId === activeTabId) {
        showToast(
          `${data.message} ${data.suggestion}`,
          'warning'
        );
        console.log('[Privilege] Scan modified:', data.originalFlags, '→', data.modifiedFlags);
      }
    });
    
    return cleanup;
  }, [activeTabId, showToast]);

  if (!activeTab) return null;

  const currentOptions = NMAP_OPTIONS[activeSection] || [];
  
  const getValidationWarnings = () => {
    if (!activeTab.target) return [];
    
    try {
      const builder = new NmapCommandBuilder(activeTab.target);
      activeTab.selectedOptions.forEach(option => {
        builder.addOption(option);
      });
      return builder.getValidationWarnings();
    } catch (error) {
      return [];
    }
  };
  
  const warnings = getValidationWarnings();
  const isWindows = window.electron?.platform === 'win32';
  
  const discoveryCommands = [
    { 
      id: 'ipconfig', 
      label: 'IP Configuration', 
      command: isWindows ? 'ipconfig /all' : 'ip a',
      description: 'Show network interfaces'
    },
    { 
      id: 'arp', 
      label: 'ARP Table', 
      command: 'arp -a',
      description: 'IP to MAC mappings'
    },
    { 
      id: 'route', 
      label: 'Routing Table', 
      command: isWindows ? 'route print' : 'ip route',
      description: 'Network routes'
    },
    { 
      id: 'netstat', 
      label: 'Active Connections', 
      command: 'netstat -ano',
      description: 'Network connections'
    },
    { 
      id: 'ping-scan', 
      label: 'Quick Network Scan', 
      command: 'nmap -sn 192.168.1.0/24',
      description: 'Discover local devices'
    },
  ];

  const handleDiscoveryCommand = async (cmd: string) => {
    if (!window.electron) return;
    
    try {
      const terminalId = `${activeTabId}::${activeTab?.scannerType || 'nmap'}`;
      // Discovery commands are shell commands, not Nmap targets. Run them in
      // the terminal already visible beside the scanner and keep the target
      // field reserved for actual scan targets.
      await terminalService.getOrCreateTerminal(terminalId, 'scan');
      terminalService.writeWhenReady(terminalId, `${cmd}\n`);
      window.dispatchEvent(new CustomEvent('focus-terminal', { detail: { terminalId } }));
      showToast(`Running in scan terminal: ${cmd}`, 'info');
    } catch (error) {
      console.error('Discovery command error:', error);
      showToast('Could not run the discovery command in the scan terminal.', 'error');
    }
  };

  return (
    <div className="flex flex-col relative">
      {!isCollapsed && (
        <>
      {/* COMPACT INPUT BAR */}
      <div className="bg-card/50 px-2 py-2 border-b border-border flex items-center gap-2">
        <div className="flex-1 flex gap-0 shadow-sm rounded overflow-hidden border-2 border-border bg-background transition-all focus-within:ring-2 focus-within:ring-primary/50 focus-within:border-primary">
          <div className="bg-background px-2 flex items-center justify-center border-r border-border/50">
            <Search className="w-3.5 h-3.5 text-foreground" />
          </div>
          
          {activeTab.selectedOptions.length > 0 && (
            <div className="flex items-center px-2 text-xs font-mono text-muted-foreground">
              nmap {activeTab.selectedOptions.map(o => o.flag).join(' ')}
            </div>
          )}
          
          <input 
            value={activeTab.target}
            onChange={(e) => updateTabTarget(activeTab.id, e.target.value)}
            placeholder={activeTab.selectedOptions.length > 0 ? "<target>" : "nmap [options] <target>"} 
            className="flex-1 h-9 px-2 bg-background text-foreground placeholder:text-muted-foreground font-mono text-xs border-none focus:outline-none"
          />
        </div>

        {/* Quick Actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
          <button type="button" className="win7-button px-3 h-9 flex items-center gap-1.5 border-2 border-green-500/50 hover:border-green-500 bg-green-500/10">
              <Radar className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
              <span className="text-xs font-bold text-green-700 dark:text-green-300">DISCOVER</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs">Network Discovery</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {discoveryCommands.map((cmd) => (
              <DropdownMenuItem
                key={cmd.id}
                onClick={() => handleDiscoveryCommand(cmd.command)}
                className="flex flex-col items-start py-2 cursor-pointer"
              >
                <div className="font-medium text-sm">{cmd.label}</div>
                <div className="text-xs text-muted-foreground">{cmd.description}</div>
                <div className="text-xs font-mono text-muted-foreground/70 mt-1">{cmd.command}</div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

          <button
            type="button"
            onClick={() => toggleAdvanced(activeTabId)}
          className={cn(
            "win7-button px-3 h-9 flex items-center gap-1.5 border-2 transition-all",
            activeTab.showAdvanced 
              ? "border-primary bg-primary/10 text-primary" 
              : "border-border hover:border-border/80"
          )}
          title="Toggle advanced options"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="text-xs font-bold">OPTIONS</span>
        </button>

          <button
            type="button"
            onClick={() => resetCurrentTab(activeTab.id)}
          className="win7-button w-9 h-9 p-0 flex items-center justify-center text-muted-foreground hover:text-destructive"
          title="Clear All (Reset)"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {activeTab.isScanning ? (
            <button
              type="button"
              onClick={() => stopScan(activeTab.id, 'nmap')}
              className="win7-button h-9 gap-2 border-2 border-red-300 px-6 text-sm font-semibold text-red-600 shadow-md hover:shadow-lg dark:border-red-800 dark:text-red-400"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              STOP
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                console.log('[NmapPanel] Scan button clicked, activeTab:', activeTab.id, 'target:', activeTab.target);
                if (!activeTab.target || !activeTab.target.trim()) return;
                runScan(activeTab.id);
              }}
              disabled={!activeTab.target || !activeTab.target.trim()}
              className={cn(
                "win7-button h-9 gap-2 px-6 text-sm font-semibold shadow-md hover:shadow-lg",
                !activeTab.target || !activeTab.target.trim()
                  ? "text-muted-foreground border-2 border-border cursor-not-allowed opacity-50"
                  : "text-green-700 border-2 border-green-300 dark:border-green-800 dark:text-green-400"
              )}
              title={!activeTab.target || !activeTab.target.trim() ? "Enter a target first" : "Start scan"}
            >
              <Play className="w-4 h-4 fill-current" />
              SCAN
            </button>
        )}
      </div>

      {/* ADVANCED OPTIONS - Collapsible */}
      {activeTab.showAdvanced && (
        <div className="border-b border-border bg-secondary/20 animate-in slide-in-from-top-2 duration-200">
          {/* Section Tabs */}
          <div className="px-2 py-1.5 flex items-center gap-1 overflow-x-auto border-b border-border/60">
            {NMAP_SECTIONS.map((section) => (
          <button
            type="button"
            key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "win7-button px-2.5 py-1 min-w-fit flex items-center gap-1 h-7 border-2 flex-shrink-0 text-xs",
                  activeSection === section.id 
                    ? "active ring-2 ring-primary/20 border-primary font-bold" 
                    : "border-border/80 hover:border-border"
                )}
              >
                <span className="uppercase tracking-tight">{section.label}</span>
              </button>
            ))}
          </div>

          {/* Option Grid */}
          <div className="px-2 py-2 max-h-[200px] overflow-y-auto">
            <div className="flex flex-wrap gap-1.5">
              {currentOptions.map((option) => {
                const isSelected = activeTab.selectedOptions.some(o => o.id === option.id);
                const isInExclusiveGroup = option.exclusiveGroup && activeTab.selectedOptions.some(
                  o => o.exclusiveGroup === option.exclusiveGroup && o.id !== option.id
                );
                
                return (
                  <Tooltip key={option.id}>
                    <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => toggleOption(activeTab.id, option)}
                        className={cn(
                          "win7-button px-2 py-1 h-7 flex items-center gap-1.5 border-2 transition-all text-xs",
                          isSelected 
                            ? "active ring-2 ring-primary/30 border-primary font-bold shadow-md" 
                            : isInExclusiveGroup
                            ? "text-muted-foreground border-border/40 opacity-50"
                            : "border-border hover:border-border/80"
                        )}
                      >
                        <span className="font-mono bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-black/5 dark:border-white/5 leading-none font-bold">{option.flag}</span>
                        <span className="leading-none truncate max-w-[100px] font-medium">
                          {option.label}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs max-w-[200px]">
                      {option.description}
                      {option.exclusiveGroup && (
                        <div className="mt-1 text-yellow-500 text-[10px]">
                          ⚠️ Only one option from this group can be selected
                        </div>
                      )}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* VALIDATION WARNINGS */}
      {warnings.length > 0 && (
        <div className="px-2 py-1.5 bg-yellow-500/10 border-b border-yellow-500/30">
          <div className="flex flex-col gap-1">
            {warnings.map((warning, idx) => {
              const isError = warning.includes('❌');
              const isInfo = warning.includes('ℹ️');
              const isWarning = warning.includes('⚠️');
              
              return (
                <div key={idx} className={cn(
                  "flex items-center gap-2 text-xs font-medium",
                  isError && "text-red-600 dark:text-red-400",
                  isWarning && "text-yellow-700 dark:text-yellow-300",
                  isInfo && "text-blue-600 dark:text-blue-400"
                )}>
                  {isError && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                  {isWarning && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                  {isInfo && <Info className="w-3.5 h-3.5 flex-shrink-0" />}
                  <span>{warning}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
