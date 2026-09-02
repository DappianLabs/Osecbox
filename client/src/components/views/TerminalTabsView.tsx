import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Plus, X, Terminal as TerminalIcon, Settings, Edit2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResetButton } from '@/components/ui/ResetButton';
import { SaveButton } from '@/components/ui/SaveButton';
import { Terminal } from '@/components/terminal/Terminal';
import { TerminalSearchBar } from '@/components/terminal/TerminalSearchBar';
import { useTerminalTabsStore } from '@/lib/terminal-tabs-store';
import { useSettingsStore } from '@/lib/settings-store';
import { cn } from '@/lib/utils';
import { terminalService } from '@/lib/terminal-service';
import { cleanupTerminalSession } from '@/lib/session-cleanup';
import { useNavigationStore } from '@/lib/navigation-store';
import { logger } from '@/lib/utils/logger';
import { ViewWithSidebar } from '@/components/layout/ViewWithSidebar';
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
import { Input } from '@/components/ui/input';

export const TerminalTabsView = React.memo(function TerminalTabsView({ isActive = true }: { isActive?: boolean }) {
  // PERFORMANCE: Use selective subscriptions to prevent unnecessary re-renders
  const terminals = useTerminalTabsStore((state) => state.terminals);
  const activeTerminalId = useTerminalTabsStore((state) => state.activeTerminalId);
  const addTerminal = useTerminalTabsStore((state) => state.addTerminal);
  const removeTerminal = useTerminalTabsStore((state) => state.removeTerminal);
  const setActiveTerminal = useTerminalTabsStore((state) => state.setActiveTerminal);
  const updateTerminalTitle = useTerminalTabsStore((state) => state.updateTerminalTitle);
  const clearAllTerminals = useTerminalTabsStore((state) => state.clearAllTerminals);
  const navigateToSettings = useNavigationStore((state) => state.navigateToSettings);
  
  // Check workspace persistence setting
  const persistWorkspace = useSettingsStore((state) => state.settings.persistWorkspace);
  
  // LAZY LOADING: Track which terminals have been created
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; terminalId: string } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ terminalId: string; currentName: string } | null>(null);
  const [newName, setNewName] = useState('');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
  // Terminal search state
  const [showSearch, setShowSearch] = useState(false);

  // PERFORMANCE: Memoize terminal count to prevent recalculating
  const terminalCount = useMemo(() => terminals.length, [terminals.length]);
  const hasMultipleTerminals = terminalCount > 1;
  
  // LAZY LOADING: Create terminal only when tab becomes active
  // FIX: Keyboard shortcut for search (Ctrl+F)
  React.useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && activeTerminalId) {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTerminalId, isActive]);

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

  // FIX: Initialize terminals on mount only
  const initializedRef = useRef(false);
  
  React.useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    
    logger.debug('TerminalTabsView', `Mount check - terminals.length: ${terminals.length}`);
    
    // `isRestored` is a one-load marker set by SessionManager. Manual session
    // loads must survive this startup cleanup even when general workspace
    // persistence is disabled; otherwise the view would erase the session as
    // soon as it mounted.
    const hasSessionRestoredTerminals = terminals.some(terminal => terminal.isRestored);
    if (!persistWorkspace && terminals.length > 0 && !hasSessionRestoredTerminals) {
      logger.info('TerminalTabsView', 'Clearing persisted terminals (persistWorkspace=false)');
      clearAllTerminals();
      setTimeout(() => {
        if (useTerminalTabsStore.getState().terminals.length === 0) {
          const newTerminal = addTerminal({
            title: 'Terminal 1',
            sessionType: 'general',
          });
          setActiveTerminal(newTerminal.id);
        }
      }, 0);
      return;
    }
    
    // PERFORMANCE: Don't create terminal on startup - wait for user interaction
    // Terminal will be created when user clicks "New Terminal" button
    logger.debug('TerminalTabsView', 'Skipping automatic terminal creation for faster startup');
  }, []);

  // CONNECTION CONTEXT: Handle focus-terminal events
  React.useEffect(() => {
    const handleFocusTerminal = (event: CustomEvent) => {
      const { terminalId } = event.detail;
      // Check if this terminal exists in this view
      const terminal = terminals.find(t => t.id === terminalId);
      if (terminal) {
        setActiveTerminal(terminalId);
      }
    };

    window.addEventListener('focus-terminal', handleFocusTerminal as EventListener);
    return () => {
      window.removeEventListener('focus-terminal', handleFocusTerminal as EventListener);
    };
  }, [terminals, setActiveTerminal]);

  // PERFORMANCE: Memoize callbacks to prevent re-renders
  const handleAddTerminal = useCallback(() => {
    const newTerminal = addTerminal();
    setActiveTerminal(newTerminal.id);
  }, [addTerminal, setActiveTerminal]);

  const handleRemoveTerminal = useCallback((terminalId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    logger.debug('TerminalTabsView', `Removing terminal: ${terminalId}`);
    
    // One lifecycle helper owns backend stop plus renderer cleanup.
    cleanupTerminalSession(terminalId);
    logger.debug('TerminalTabsView', `Destroyed terminal session: ${terminalId}`);
    
    // 3. Remove from store
    removeTerminal(terminalId);
  }, [removeTerminal]);

  const handleRenameTerminal = useCallback((terminalId: string) => {
    const terminal = terminals.find(t => t.id === terminalId);
    if (terminal) {
      setNewName(terminal.title);
      setRenameDialog({ terminalId, currentName: terminal.title });
    }
    setContextMenu(null);
  }, [terminals]);

  const handleConfirmRename = useCallback(() => {
    if (renameDialog && newName.trim()) {
      updateTerminalTitle(renameDialog.terminalId, newName.trim());
      setRenameDialog(null);
      setNewName('');
    }
  }, [renameDialog, newName, updateTerminalTitle]);

  const handleCloseOtherTerminals = useCallback((terminalId: string) => {
    // PERFORMANCE: Batch terminal closures
    const terminalsToClose = terminals.filter(t => t.id !== terminalId);
    
    terminalsToClose.forEach(t => cleanupTerminalSession(t.id));
    terminalsToClose.forEach(t => removeTerminal(t.id));
    
    setContextMenu(null);
  }, [terminals, removeTerminal]);

  const handleCloseAllTerminals = useCallback(() => {
    // PERFORMANCE: Batch terminal closures
    terminals.forEach(t => cleanupTerminalSession(t.id));
    terminals.forEach(t => removeTerminal(t.id));
    
    setContextMenu(null);
  }, [terminals, removeTerminal]);

  return (
    <ViewWithSidebar sectionId="terminals" showSidebar={isActive}>
    <div className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-background">
      {/* Terminal Tabs Header */}
      <div className="h-10 bg-card border-b border-border flex items-center px-2 shrink-0">
        <ResetButton
          sectionName="Terminals"
          description="This will close all terminal tabs except the first one and clear all terminal output. This action cannot be undone."
            onReset={() => {
              // Keep only the first terminal
              const firstTerminal = terminals[0];
              if (firstTerminal) {
                terminalService.clearOutput(firstTerminal.id);
                // Close all other terminals
                terminals.slice(1).forEach(t => {
                  cleanupTerminalSession(t.id);
                  removeTerminal(t.id);
                });
              // Set first terminal as active
              setActiveTerminal(firstTerminal.id);
            }
          }}
        />
        <div className="flex items-center gap-1 flex-1 overflow-x-auto ml-2" role="tablist" aria-label="Terminal sessions">
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              role="tab"
              aria-selected={activeTerminalId === terminal.id}
              aria-label={terminal.title}
              tabIndex={activeTerminalId === terminal.id ? 0 : -1}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-t-md cursor-pointer group transition-colors min-w-0 max-w-48",
                activeTerminalId === terminal.id
                  ? "bg-background border-t border-l border-r border-border text-foreground"
                  : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveTerminal(terminal.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                setActiveTerminal(terminal.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, terminalId: terminal.id });
              }}
            >
              <TerminalIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="text-sm font-medium truncate">
                {terminal.title}
              </span>
              {terminal.isRestored && (
                <span 
                  className="text-xs bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded shrink-0" 
                  title="Restored from saved session"
                >
                  📦
                </span>
              )}
              {hasMultipleTerminals && (
                <button
                  type="button"
                  onClick={(e) => handleRemoveTerminal(terminal.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive rounded p-0.5 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          
          {/* Add Terminal Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAddTerminal}
            className="h-8 w-8 p-0 shrink-0 ml-1"
            title="Add Terminal"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Terminal Actions */}
        <div className="flex items-center gap-1 ml-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSearch(!showSearch)}
            className="h-8 w-8 p-0"
            title="Search terminal (Ctrl+F)"
            disabled={!activeTerminalId}
          >
            <Search className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="Terminal Settings"
            onClick={() => navigateToSettings('terminal')}
          >
            <Settings className="w-4 h-4" />
          </Button>
          <SaveButton 
            type="section"
            sectionName="Terminals"
          />
        </div>
      </div>

      {/* Terminal Content */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden bg-black relative">
        {window.electron ? (
          <>
            {/* Keep the active terminal mounted while the section is hidden.
                The parent view is display:none during navigation, so the
                Terminal component must receive the visibility state instead
                of being destroyed and reattached on every return. */}
            {activeTerminalId && (
              <div className="absolute inset-0 w-full h-full min-h-0 min-w-0 overflow-hidden">
                <Terminal
                  key={activeTerminalId}
                  sessionId={activeTerminalId}
                  sessionType={terminals.find(terminal => terminal.id === activeTerminalId)?.sessionType || 'general'}
                  className="w-full h-full min-h-0 min-w-0"
                  isActive={isActive}
                />
              </div>
            )}
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <TerminalIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">Electron API Not Available</p>
              <p className="text-sm mb-4">Terminal requires Electron environment</p>
            </div>
          </div>
        )}
        
        {terminals.length === 0 && window.electron && (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <TerminalIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No Terminal Open</p>
              <p className="text-sm mb-4">Create a new terminal to get started</p>
              <Button onClick={handleAddTerminal} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                New Terminal
              </Button>
            </div>
          </div>
        )}
        
        {/* Terminal search overlay */}
        {showSearch && activeTerminalId && (
          <TerminalSearchBar
            sessionId={activeTerminalId}
            onClose={() => setShowSearch(false)}
          />
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
            onClick={() => handleRenameTerminal(contextMenu.terminalId)}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <Edit2 className="w-3 h-3" />
            Rename
          </button>
          <div className="border-t border-border my-0.5"></div>
          <button
            type="button"
            onClick={() => {
              const terminal = terminals.find(t => t.id === contextMenu.terminalId);
              if (terminal) {
                handleRemoveTerminal(terminal.id, { stopPropagation: () => {} } as React.MouseEvent);
              }
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <X className="w-3 h-3" />
            Close Terminal
          </button>
          <button
            type="button"
            onClick={() => handleCloseOtherTerminals(contextMenu.terminalId)}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
            disabled={!hasMultipleTerminals}
          >
            Close Other Terminals
          </button>
          <div className="border-t border-border my-0.5"></div>
          <button
            type="button"
            onClick={() => handleCloseAllTerminals()}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors text-destructive"
          >
            Close All Terminals
          </button>
        </div>
      )}

      {/* Rename Dialog */}
      <AlertDialog open={!!renameDialog} onOpenChange={(open) => !open && setRenameDialog(null)}>
        <AlertDialogContent className="bg-popover border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Rename Terminal</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Enter a new name for this terminal tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleConfirmRename();
                } else if (e.key === 'Escape') {
                  setRenameDialog(null);
                  setNewName('');
                }
              }}
              placeholder="Terminal name"
              className="w-full"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-muted text-foreground hover:bg-muted/80">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmRename}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={!newName.trim()}
            >
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </ViewWithSidebar>
  );
});
