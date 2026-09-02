import { useEffect, useState, useRef } from 'react';
import { CheckCircle2, AlertCircle, ChevronDown, RefreshCw, Copy } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ToolNotFoundDialog } from '@/components/dialogs/ToolNotFoundDialog';

interface ToolStatus {
  name: string;
  connected: boolean;
  version?: string;
  command?: string; // The actual command name for installation lookup
  error?: string;
}

export function ToolStatusChecker() {
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [selectedTool, setSelectedTool] = useState<ToolStatus | null>(null);
  const [setupScriptCopied, setSetupScriptCopied] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isHoveringRef = useRef(false);
  const checkGenerationRef = useRef(0);

  useEffect(() => {
    // Tool discovery can invoke WSL/where.exe and should never compete with
    // the first paint or the first terminal prompt.
    const timer = window.setTimeout(() => checkTools(), 250);
    return () => window.clearTimeout(timer);
  }, []);

  const checkTools = async (forceRefresh = false) => {
    const generation = ++checkGenerationRef.current;
    setIsChecking(true);
    
    // Preserve the backend's warm cache during normal startup. Only a user
    // requested recheck should invalidate it.
    if (forceRefresh) {
      try {
        if (window.electron?.clearToolCache) {
          await window.electron.clearToolCache();
          console.log('[ToolStatus] Cache cleared');
        }
      } catch (err) {
        console.log('[ToolStatus] Failed to clear cache:', err);
      }
    }
    
    const toolsToCheck = [
      { name: 'Metasploit', command: 'msfconsole' },
      { name: 'Subfinder', command: 'subfinder' },
      { name: 'Sublist3r', command: 'sublist3r' },
      { name: 'Amass', command: 'amass' },
      { name: 'Assetfinder', command: 'assetfinder' },
      { name: 'FFUF', command: 'ffuf' },
      { name: 'Nikto', command: 'nikto' },
      { name: 'Nuclei', command: 'nuclei' },
      { name: 'Gobuster', command: 'gobuster' },
      { name: 'MSFVenom', command: 'msfvenom' },
    ];

    // Prefer one backend probe for the whole title bar. On Windows/WSL this is
    // one warm shell instead of ten separate `wsl.exe` processes, and the
    // result is still mapped back to each tool for the existing UI.
    if (window.electron?.checkToolsInstalled) {
      try {
        const response = await window.electron.checkToolsInstalled(toolsToCheck.map(tool => tool.command));
        if (generation !== checkGenerationRef.current) return;

        if (response.success && response.tools) {
          const results = toolsToCheck.map(tool => {
            const result = response.tools?.[tool.command];
            return result?.installed
              ? { name: tool.name, connected: true, version: result.version || 'Installed', command: tool.command }
              : { name: tool.name, connected: false, command: tool.command, error: result?.error };
          });
          setTools(results);
          setIsChecking(false);
          return;
        }
      } catch (error) {
        console.warn('[ToolStatus] Batch check unavailable, falling back to individual checks:', error);
      }
    }

    const checkOne = async (tool: { name: string; command: string }): Promise<ToolStatus> => {
      try {
        if (window.electron?.checkToolInstalled) {
          const result = await window.electron.checkToolInstalled(tool.command);
          console.log(`[ToolStatus] ${tool.name} (${tool.command}):`, result);
          return result.installed
            ? { name: tool.name, connected: true, version: result.version || 'Installed', command: tool.command }
            : { name: tool.name, connected: false, command: tool.command, error: result.error };
        }
      } catch (error) {
        console.log(`Tool check failed for ${tool.name}:`, error);
      }
      return { name: tool.name, connected: false, command: tool.command };
    };

    // Run a small number in parallel so one slow WSL lookup does not serialize
    // the entire title bar, while avoiding a process storm on Windows.
    const results: ToolStatus[] = [];
    for (let index = 0; index < toolsToCheck.length; index += 3) {
      const batch = toolsToCheck.slice(index, index + 3);
      results.push(...await Promise.all(batch.map(checkOne)));
    }

    // A manual recheck can overlap the deferred startup check. Never let the
    // older response overwrite the newer, user-requested result.
    if (generation !== checkGenerationRef.current) return;
    setTools(results);
    setIsChecking(false);
  };

  const handleToolClick = async (tool: ToolStatus) => {
    if (!tool.command) return;
    setSelectedTool(tool);
    setIsExpanded(false);
  };

  const handleCopySetupScript = async () => {
    if (!window.electron?.getInstallScript) return;

    try {
      const missingTools = disconnectedTools
        .map(tool => tool.command)
        .filter((tool): tool is string => Boolean(tool));
      const result = await window.electron.getInstallScript(missingTools);
      if (!result.success || !result.script || !navigator.clipboard) {
        if (result.error) alert(result.error);
        return;
      }

      await navigator.clipboard.writeText(result.script);
      setSetupScriptCopied(true);
      window.setTimeout(() => setSetupScriptCopied(false), 2500);
    } catch (error) {
      console.error('[ToolStatus] Failed to generate install script:', error);
    }
  };

  const disconnectedTools = tools.filter(t => !t.connected);
  // A tool-specific probe failure is not proof that WSL itself is down. Keep
  // the title-bar diagnosis honest so a missing binary does not turn into the
  // misleading global "WSL2 Unavailable" state.
  const blockedTools = disconnectedTools.filter(tool =>
    /wsl2 unavailable|wsl service|wsl.*could not execute/i.test(tool.error || '')
  );
  const platformBlocked = blockedTools.length > 0;
  const allConnected = disconnectedTools.length === 0 && tools.length > 0;

  const handleMouseEnter = () => {
    isHoveringRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Show dropdown for disconnected tools OR all tools if everything is connected
    if (disconnectedTools.length > 0 || allConnected) {
      updateDropdownPosition();
      setIsExpanded(true);
    }
  };

  const updateDropdownPosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left
      });
    }
  };

  const handleMouseLeave = () => {
    isHoveringRef.current = false;
    // Wait a bit before closing
    timeoutRef.current = setTimeout(() => {
      if (!isHoveringRef.current) {
        setIsExpanded(false);
      }
    }, 200);
  };

  const toggleExpanded = () => {
    if (disconnectedTools.length === 0 && !allConnected) return;
    if (!isExpanded) updateDropdownPosition();
    setIsExpanded(previous => !previous);
  };

  if (isChecking) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
        <div className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
        <span>Checking tools...</span>
      </div>
    );
  }

  return (
    <div 
      ref={buttonRef}
      className="relative" 
      style={{ WebkitAppRegion: 'no-drag' } as any}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {allConnected ? (
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
          className="ui-button flex items-center gap-2 px-3 py-1 text-xs text-green-500 cursor-pointer hover:bg-green-500/10 rounded transition-colors"
          title="Show installed tools"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span className="font-medium">Tools Ready</span>
        </button>
      ) : (
        <button
          type="button"
          className="ui-button flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-accent/50 rounded transition-colors"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
          title="Show tool status"
        >
          <AlertCircle className={`w-3.5 h-3.5 ${platformBlocked ? 'text-orange-500' : 'text-red-500'}`} />
          <span className={`font-medium ${platformBlocked ? 'text-orange-500' : 'text-red-500'}`}>
            {platformBlocked
              ? 'WSL2 Unavailable'
              : disconnectedTools.length === 1
              ? `${disconnectedTools[0].name} Not Connected`
              : `${disconnectedTools.length} Tools Not Connected`}
          </span>
          <ChevronDown className={`w-3 h-3 ${platformBlocked ? 'text-orange-500' : 'text-red-500'} transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
      )}

      {/* Dropdown for disconnected tools - rendered in portal */}
      {isExpanded && disconnectedTools.length > 0 && createPortal(
        <div 
          className="fixed"
          style={{ 
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            zIndex: 999999
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="ui-popover-enter bg-card border border-border rounded-lg shadow-xl min-w-[220px] overflow-hidden">
            <div className={`px-3 py-2 ${platformBlocked ? 'bg-orange-500/10' : 'bg-red-500/10'} border-b border-border`}>
              <span className={`text-xs font-semibold ${platformBlocked ? 'text-orange-500' : 'text-red-500'}`}>
                {platformBlocked ? 'Tool checks blocked' : 'Disconnected Tools'}
              </span>
            </div>
            {platformBlocked && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border">
                {blockedTools[0]?.error}
              </div>
            )}
            <div className="py-1 max-h-[300px] overflow-y-auto">
              {disconnectedTools.map((tool) => (
                <button
                  type="button"
                  key={tool.name}
                  className="w-full px-3 py-2 hover:bg-accent/50 transition-colors flex items-center gap-2 cursor-pointer text-left"
                  onClick={() => handleToolClick(tool)}
                  title={tool.error || `Click to see installation instructions for ${tool.name}`}
                >
                  <AlertCircle className={`w-3 h-3 ${tool.error ? 'text-orange-500' : 'text-red-500'} flex-shrink-0`} />
                  <span className="text-xs text-foreground font-medium">{tool.name}</span>
                </button>
              ))}
            </div>
            <div className="px-3 py-2 bg-muted/30 border-t border-border">
              {!platformBlocked && window.electron?.getInstallScript && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCopySetupScript();
                  }}
                  className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors font-medium w-full mb-2"
                  title="Copy a reviewed setup script for the missing tools"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{setupScriptCopied ? 'Setup script copied' : 'Copy setup script'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  checkTools(true);
                  setIsExpanded(false);
                }}
                className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors font-medium w-full"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Recheck Tools</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ToolNotFoundDialog
        tool={selectedTool?.command || ''}
        open={Boolean(selectedTool)}
        onClose={() => setSelectedTool(null)}
      />

      {/* Tooltip for all connected tools - rendered in portal */}
      {isExpanded && allConnected && createPortal(
        <div 
          className="fixed"
          style={{ 
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            zIndex: 999999
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="ui-popover-enter bg-card border border-green-500/20 rounded-lg shadow-xl min-w-[220px] overflow-hidden">
            <div className="px-3 py-2 bg-green-500/10 border-b border-green-500/20">
              <span className="text-xs font-semibold text-green-500">✓ All Tools Ready</span>
            </div>
            <div className="py-1 max-h-[300px] overflow-y-auto">
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="px-3 py-2 flex items-center gap-2"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-foreground font-medium">{tool.name}</div>
                    {tool.version && (
                      <div className="text-[10px] text-muted-foreground truncate">{tool.version}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 py-2 bg-muted/30 border-t border-border">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  checkTools(true);
                  setIsExpanded(false);
                }}
                className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors font-medium w-full"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Recheck Tools</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
