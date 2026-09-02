import React from 'react';
import { useScanner } from '@/lib/scanner-context';
import { Terminal } from '@/components/terminal/Terminal';
import { TerminalSearchBar } from '@/components/terminal/TerminalSearchBar';
import { SaveButton } from '@/components/ui/SaveButton';
import { Search } from 'lucide-react';

interface TerminalPanelProps {
  isExpanded?: boolean;
  onExpandToggle?: (expanded: boolean) => void;
  isSectionActive?: boolean;
  isResizing?: boolean;
}

export const TerminalPanel = React.memo(function TerminalPanel({ isExpanded, onExpandToggle, isSectionActive = true, isResizing = false }: TerminalPanelProps = {}) {
  // useScanner intentionally throws when the component is mounted outside its
  // provider. Keeping hooks unconditional here avoids a rules-of-hooks
  // violation during provider/bootstrap transitions.
  const { tabs, activeTabId } = useScanner();
  const [showSearch, setShowSearch] = React.useState(false);
  
  // PERFORMANCE: Memoize active tab to prevent re-renders during resize
  const activeTab = React.useMemo(() => tabs.find(t => t.id === activeTabId), [tabs, activeTabId]);
  
  // FIX: Active terminal ID is per-scanner so each tool has its own terminal
  const activeTerminalId = React.useMemo(() => {
    if (!activeTab) return null;
    return `${activeTab.id}::${activeTab.scannerType || 'nmap'}`;
  }, [activeTab]);

  // Keep one renderer per scanner that has been used by the active tab. The
  // visible scanner can change while another process is still producing output;
  // unmounting that renderer loses its DOM attachment and made returning to
  // Nuclei/Nikto look like an empty terminal even though the service buffer was
  // still intact.
  const terminalIds = React.useMemo(() => {
    if (!activeTab) return [];

    const scannerTypes = new Set<string>([activeTab.scannerType || 'nmap']);
    Object.keys(activeTab.resultsByScanner || {}).forEach(scanner => scannerTypes.add(scanner));
    Object.keys(activeTab.scanningByScanner || {}).forEach(scanner => scannerTypes.add(scanner));

    return Array.from(scannerTypes)
      .filter(scanner => /^[a-z0-9-]+$/i.test(scanner))
      .map(scanner => `${activeTab.id}::${scanner}`);
  }, [activeTab]);
  
  // The parent resizable owns the interaction state. Keeping that state out of
  // this panel avoids a document listener and a React update for every drag,
  // while TerminalRenderer performs one lossless fit after the interaction.

  // CLEAN ARCHITECTURE: Let Terminal component handle all logic
  // Terminal.tsx now handles:
  // - Resize handling (disabled for smooth sliding)
  // - Active state restoration (fit + scroll restore)
  // - Click handling (fit + scroll restore)
  // - Scroll position saving on cleanup
  // No duplicate logic needed here

  // FIX: Keyboard shortcut for search (Ctrl+F)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSectionActive && (e.ctrlKey || e.metaKey) && e.key === 'f' && activeTerminalId) {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTerminalId, isSectionActive]);

  // SAFETY: Check if tabs array is available
  if (!tabs || !Array.isArray(tabs)) {
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading scan tabs...</div>
      </div>
    );
  }

  if (tabs.length === 0) {
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <div className="text-muted-foreground text-sm">No scan tabs</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-black relative overflow-hidden">
      {/* Terminal Session Info Bar */}
      {activeTab && (
        <div className="absolute top-0 left-0 right-0 h-9 z-20 bg-blue-500/10 border-b border-blue-500/30 px-3 py-0.5 flex items-center gap-2 text-xs">
          <span className="text-blue-400 font-mono">Scanner:</span>
          <span className="text-blue-300 font-mono font-bold uppercase">{activeTab.scannerType || 'nmap'}</span>
          {activeTab.target && (
            <>
              <span className="text-blue-400/60">•</span>
              <span className="text-blue-400/80 font-mono">{activeTab.target}</span>
            </>
          )}
          {activeTab.commandsByScanner?.[activeTab.scannerType || 'nmap'] && (
            <>
              <span className="text-blue-400/60">•</span>
              <span
                className="min-w-0 max-w-[42%] truncate text-slate-300/80 font-mono"
                title={activeTab.commandsByScanner[activeTab.scannerType || 'nmap']}
              >
                $ {activeTab.commandsByScanner[activeTab.scannerType || 'nmap']}
              </span>
            </>
          )}
          {(activeTab.scanningByScanner?.[activeTab.scannerType || 'nmap'] ?? activeTab.isScanning) && (
            <>
              <span className="text-blue-400/60">•</span>
              <span className="text-green-400 font-mono animate-pulse">● SCANNING</span>
            </>
          )}
        </div>
      )}
      
      {/* Search and Save buttons */}
      {activeTerminalId && (
        <div className="absolute right-2 z-30 flex items-center gap-1 pointer-events-auto" style={{ top: activeTab ? '0.125rem' : '0.375rem' }}>
          <SaveButton 
            type="section" 
            terminalId={activeTerminalId}
            sectionName="Scan"
            variant="ghost"
            size="icon"
          />
        <button
          type="button"
          onClick={() => setShowSearch(!showSearch)}
            className="p-2 bg-card/80 hover:bg-card border border-border rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Search terminal (Ctrl+F)"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      )}
      
      {/* Keep scanner terminals mounted for this tab; only the selected one is
          interactive. TerminalService retains the PTY/output buffer even when a
          tab or section is later hidden. */}
      {activeTab && terminalIds.map((terminalId) => {
        const isVisible = terminalId === activeTerminalId;

        return (
          <div
            key={terminalId}
            className="absolute inset-0 w-full h-full min-h-0"
            aria-hidden={!isVisible}
            style={{
              paddingTop: '2.25rem',
              visibility: isVisible ? 'visible' : 'hidden',
              pointerEvents: isVisible && isSectionActive ? 'auto' : 'none',
              zIndex: isVisible ? 10 : 0,
            }}
          >
            <Terminal
              sessionId={terminalId}
              sessionType="scan"
              className="w-full h-full min-h-0"
              isActive={isVisible && isSectionActive}
              disableResize={isResizing || !isVisible || !isSectionActive}
            />
          </div>
        );
      })}
      
      {/* ELITE: Terminal search overlay */}
      {isSectionActive && showSearch && activeTerminalId && (
        <TerminalSearchBar
          sessionId={activeTerminalId}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
});
