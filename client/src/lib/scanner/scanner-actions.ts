/**
 * Scanner Context - Actions
 * 
 * This file contains all user actions and tab management functions.
 * Actions are the public API for interacting with scanner state.
 * 
 * @module scanner-actions
 */

import type { Tab, ScannerType, ScanError, NmapOption } from './scanner-types';
import { createTab, generateTabId, getNextActiveTabId } from './scanner-state';
import {
  cancelScanRun,
  cancelScanRunsForTab,
  getScanRunId,
  getScanRunSessionId,
  getScanRunTarget,
  getScanRunOutputMarker,
  getScanRunOutputOffset,
  hasActiveScanRun,
} from './scan-run-registry';
import { interruptTerminalCommand } from '@/lib/terminal/command-lifecycle';
import { cleanupTerminalSession } from '@/lib/session-cleanup';

/**
 * Create scanner action handlers
 */
export function createScannerActions(
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  setActiveTabId: React.Dispatch<React.SetStateAction<string>>,
  getTabs?: () => Tab[]
) {
  const parseStoppedScanOutput = async (scannerType: ScannerType, output: string, command: string): Promise<any[]> => {
    switch (scannerType) {
      case 'nmap': {
        const { parseNmapOutput } = await import('../nmap-parser');
        return parseNmapOutput(output);
      }
      case 'nikto': {
        const { parseNiktoOutput } = await import('../parsers/nikto-parser');
        return (parseNiktoOutput(output).findings || []) as any[];
      }
      case 'nuclei': {
        const { parseNucleiOutput } = await import('../parsers/nuclei-parser');
        return (parseNucleiOutput(output).findings || []) as any[];
      }
      case 'dirbuster': {
        const { parseDirBusterOutput } = await import('../dirbuster-parser');
        return (parseDirBusterOutput(output).findings || []) as any[];
      }
      case 'universal':
      default: {
        const { parseUniversalOutput } = await import('../universal-parser');
        return parseUniversalOutput(command, output).findings as any[];
      }
    }
  };

  /**
   * Add a new tab
   */
  const addTab = (target: string = '', scannerType: ScannerType = 'nmap', forceNew: boolean = false) => {
    // Create the tab before scheduling the state update so callers can safely
    // start work on the returned id. The old implementation tried to read the
    // newly-created tab from a stale `tabs` closure, which dropped batch scans.
    const newTab = createTab(target, scannerType);
    console.log('[addTab] Creating new tab:', newTab.id, scannerType, 'forceNew:', forceNew);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
  };

  /**
   * Close a tab
   */
  const closeTab = (id: string) => {
    console.log(`[scanner-actions] Closing tab: ${id}`);

    // Stop monitor timers synchronously before removing React state. The
    // terminal cleanup below is intentionally async because terminal-service
    // is lazy-loaded, but a stale monitor must never get another state update.
    cancelScanRunsForTab(id);
    
    // Clean up all per-scanner terminals and PTYs for this tab
    import('../terminal-service').then(({ terminalService }) => {
      const scannerTypes = ['nmap', 'nikto', 'nuclei', 'dirbuster', 'universal'];
      for (const st of scannerTypes) {
        const tid = `${id}::${st}`;
        cleanupTerminalSession(tid);
        console.log(`[scanner-actions] Destroyed terminal session: ${tid}`);
      }
      // Also clean up the legacy id-only entries (back-compat)
      cleanupTerminalSession(id);
    }).catch((error) => {
      console.error(`[scanner-actions] Failed to destroy terminal/PTY for tab ${id}:`, error);
    });
    
    setTabs((prev) => {
      const newTabs = prev.filter(t => t.id !== id);

      // Always leave the scanner with one valid tab. The old code generated a
      // random active ID for the final tab, then returned the old tab array,
      // leaving TerminalPanel with an active tab that did not exist.
      if (newTabs.length === 0) {
        const replacementTab = createTab('', 'nmap', 'Nmap');
        setActiveTabId(replacementTab.id);
        return [replacementTab];
      }

      // Handle active tab switching
      setActiveTabId((currentActive) => {
        if (id !== currentActive) return currentActive;
        return getNextActiveTabId(prev, id, currentActive);
      });

      return newTabs;
    });
  };

  /**
   * Update tab target
   */
  const updateTabTarget = (id: string, target: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, target, title: target || t.title } : t))
    );
  };

  /**
   * Toggle an nmap option
   */
  const toggleOption = async (id: string, option: NmapOption) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;

        const isSelected = t.selectedOptions.some((o) => o.id === option.id);

        if (isSelected) {
          return { 
            ...t, 
            selectedOptions: t.selectedOptions.filter((o) => o.id !== option.id) 
          };
        } else {
          let newOptions = [...t.selectedOptions];
          
          // Handle exclusive groups
          if (option.exclusiveGroup) {
            newOptions = newOptions.filter((o) => o.exclusiveGroup !== option.exclusiveGroup);
          }
          
          newOptions.push(option);
          return { ...t, selectedOptions: newOptions };
        }
      })
    );
  };

  /**
   * Toggle advanced options panel
   */
  const toggleAdvanced = (id: string) => {
    setTabs((prev) =>
      prev.map((t) => 
        t.id === id ? { ...t, showAdvanced: !t.showAdvanced } : t
      )
    );
  };

  /**
   * Update tab options from flag strings
   */
  const updateTabOptions = async (id: string, flags: string[]) => {
    const { NMAP_OPTIONS } = await import('../nmap-config');
    const allOptions: NmapOption[] = (Object.values(NMAP_OPTIONS) as NmapOption[][]).flat();
    
    const selectedOptions = flags
      .map(flag => allOptions.find(opt => opt.flag === flag))
      .filter((opt): opt is NmapOption => opt !== undefined);

    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, selectedOptions } : t))
    );
  };

  /**
   * Add an error to a tab
   */
  const addError = (tabId: string, error: Omit<ScanError, 'id' | 'timestamp'>) => {
    const newError: ScanError = {
      ...error,
      id: `error-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
    };

    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          errors: [...(t.errors || []), newError]
        };
      })
    );

    // Show notification
    import('@/lib/notification-store').then(({ useNotificationStore }) => {
      const { addNotification } = useNotificationStore.getState();
      addNotification({
        title: error.title,
        message: error.message,
        type: error.type,
        duration: error.type === 'error' ? 8000 : 5000,
      });
    });
  };

  /**
   * Clear errors from a tab
   */
  const clearErrors = (tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          errors: []
        };
      })
    );
  };

  /**
   * Stop a running scan
   */
  const stopScan = async (id: string, requestedScannerType?: ScannerType) => {
    // The caller supplies the scanner whose control initiated Stop. Falling
    // back to the tab is retained for older integrations, but normal UI paths
    // no longer depend on the currently selected scanner tab.
    const tab = getTabs?.().find(t => t.id === id);
    const scannerType = requestedScannerType || tab?.scannerType || 'nmap';
    const terminalId = `${id}::${scannerType}`;
    // Capture the active run boundary before cancellation removes its registry
    // entry. Stop must parse only this run while preserving every older run in
    // the same terminal transcript.
    const outputOffset = getScanRunOutputOffset(terminalId);
    const outputMarker = getScanRunOutputMarker(terminalId);
    const scanRunId = getScanRunId(terminalId);
    const scanSessionId = getScanRunSessionId(terminalId);
    const scanTarget = getScanRunTarget(terminalId);
    cancelScanRun(terminalId);

    // Flip the UI state immediately so a second Start is available. The
    // terminal interrupt itself is awaited below and is serialized by the
    // lifecycle helper, so a fast Stop -> Start cannot race the old command.
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id || hasActiveScanRun(terminalId)) return t;
        const scanningByScanner = { ...(t.scanningByScanner || {}), [scannerType]: false };
        return {
          ...t,
          isScanning: (t.scannerType || 'nmap') === scannerType ? false : t.isScanning,
          lastScanStatus: 'stopped',
          lastScanExitCode: undefined,
          scanningByScanner,
        };
      })
    );
    
    if (window.electron) {
      try {
        // Current scans run inside the reusable terminal PTY. Ctrl+C is the
        // authoritative cancellation path; calling the legacy Electron scan
        // endpoint here recorded a pending cancellation for `scan-${id}` even
        // though no child process owned that id, which could cancel a later
        // direct/scheduled run that reused the id.
        await interruptTerminalCommand(terminalId);
      } catch (error) {
        console.warn('[stopScan] Terminal cleanup completed with warnings:', error);
      }

      // Stop intentionally cancels the monitor, so parse the retained partial
      // transcript here. A replacement run must not receive the old UI result,
      // but the old run's captured session/target evidence is still valid and
      // must be committed independently.
      try {
        const { terminalService } = await import('../terminal-service');
        const retainedOutput = terminalService.getOutput(terminalId);
        const output = outputOffset !== undefined && retainedOutput.length >= outputOffset
          ? retainedOutput.slice(outputOffset)
          : outputMarker
            ? (() => {
                const markerIndex = retainedOutput.lastIndexOf(outputMarker);
                return markerIndex >= 0
                  ? retainedOutput.slice(markerIndex + outputMarker.length)
                  : retainedOutput;
              })()
            : retainedOutput;
        if (output.trim()) {
          const partialResults = await parseStoppedScanOutput(
            scannerType,
            output,
            tab?.target || '',
          );
          const replacementRunActive = hasActiveScanRun(terminalId);

          if (!replacementRunActive) {
            setTabs((prev) => prev.map((currentTab) => {
              if (currentTab.id !== id) return currentTab;
              const resultsByScanner = {
                ...(currentTab.resultsByScanner || {}),
                [scannerType]: partialResults,
              };
              return {
                ...currentTab,
                results: (currentTab.scannerType || 'nmap') === scannerType
                  ? partialResults as any
                  : currentTab.results,
                resultsByScanner,
              };
            }));
          }

          // A canceled scan is still evidence. Feed the retained transcript
          // through the same bounded AI/loot pipeline even if a replacement
          // run already owns the reusable terminal. The captured session/run
          // identity prevents the old transcript from entering a new session.
          const target = scanTarget || tab?.target || '';
          if ((target || partialResults.length > 0) && scanSessionId) {
            try {
              const { useAttackState } = await import('../attack-state-store');
              const attackState = useAttackState.getState();
              if (attackState.session?.id === scanSessionId) {
                const committed = await attackState.processScannerResults(target, {
                  scannerType,
                  results: partialResults,
                  command: `${scannerType} ${target}`.trim(),
                  output,
                  timestamp: Date.now(),
                  target,
                  tabId: id,
                  terminalId,
                  sessionId: scanSessionId,
                  tool: scannerType,
                  runId: scanRunId,
                });
                if (committed === false) {
                  console.warn('[stopScan] Partial scan evidence was not committed');
                }
              }
            } catch (attackStateError) {
              console.warn('[stopScan] Failed to record partial scan evidence:', attackStateError);
            }
          }
        }
      } catch (error) {
        console.warn('[stopScan] Failed to parse retained partial output:', error);
      }
    }
  };

  /**
   * Reset a tab to default state
   */
  const resetCurrentTab = async (id: string) => {
    cancelScanRunsForTab(id);

    // Clear all per-scanner terminal outputs for this tab
    try {
      const { terminalService } = await import('../terminal-service');
      const scannerTypes = ['nmap', 'nikto', 'nuclei', 'dirbuster', 'universal'];
      for (const st of scannerTypes) {
        const tid = `${id}::${st}`;
        if (window.electron) {
          // Reset is a destructive session reset, unlike Stop. Wait for the
          // backend process to terminate before releasing this stable ID so a
          // fast new scan cannot overlap the old shell.
          await window.electron.stopListener(tid).catch(() => undefined);
        }
        if (terminalService.hasTerminal(tid) || terminalService.hasPTY(tid)) {
          terminalService.cancelPendingWrites(tid);
          terminalService.clearOutput(tid);
          // stop-listener owns the backend kill; destroyPTY now retires the
          // renderer-side PTY as well, so the next Start creates a fresh shell.
          terminalService.destroyPTY(tid);
          console.log(`[resetCurrentTab] Cleared terminal output: ${tid}`);
        }
      }
    } catch (error) {
      console.error(`[resetCurrentTab] Failed to clear terminal for tab ${id}:`, error);
    }

    // Remove only this tab's command evidence from the global AI store.
    // Other tabs/engagements must remain intact.
    try {
      const { useAttackState } = await import('../attack-state-store');
      const manager = useAttackState.getState().manager;
      manager?.commandOutputStore?.clearForScope?.({ tabId: id });
    } catch (error) {
      console.warn(`[resetCurrentTab] Failed to clear AI command scope for tab ${id}:`, error);
    }
    
    // Reset tab data
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        return {
          ...t,
          target: '',
          title: 'New Scan',
          selectedOptions: [],
          isScanning: false,
          scanProgress: 0,
          results: [],
          resultsByScanner: {},
          structuredResultsByScanner: {},
          scanningByScanner: {},
          terminalOutput: [], // Keep empty - use terminalService buffer
          aiConversation: [],
          scanSummary: null,
          errors: [],
        };
      })
    );
  };

  /**
   * Add AI message to tab
   * Limit conversation history to prevent memory leak
   */
  const addAIMessage = (tabId: string, message: import('./scanner-types').AIMessage) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const newConversation = [...t.aiConversation, message];
        // Keep only last 50 messages to prevent memory leak
        const trimmedConversation = newConversation.slice(-50);
        return {
          ...t,
          aiConversation: trimmedConversation
        };
      })
    );
  };

  /**
   * Clear AI conversation
   */
  const clearAIConversation = (tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          aiConversation: []
        };
      })
    );
  };

  /**
   * Clear terminal output (for the active scanner type)
   */
  const clearTerminal = async (tabId: string) => {
    // Clear terminal buffer for the currently-active scanner of this tab
    const tab = getTabs?.().find(t => t.id === tabId);
    const scannerType = tab?.scannerType || 'nmap';
    const terminalId = `${tabId}::${scannerType}`;
    
    try {
      const { terminalService } = await import('../terminal-service');
      if (terminalService.hasTerminal(terminalId)) {
        terminalService.clearOutput(terminalId);
        console.log(`[clearTerminal] Cleared terminal buffer: ${terminalId}`);
      }
    } catch (error) {
      console.error(`[clearTerminal] Failed to clear terminal buffer:`, error);
    }

    // Clear React state (legacy)
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          terminalOutput: []
        };
      })
    );
  };

  /**
   * Update terminal output (DEPRECATED - use terminalService buffer instead)
   */
  const updateTabTerminalOutput = (id: string, output: string) => {
    // DEPRECATED: This is kept for backwards compatibility only
    // Terminal output should be read from terminalService.getOutput() instead
    console.warn('[updateTabTerminalOutput] DEPRECATED - use terminalService.getOutput() instead');
    
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, terminalOutput: [...t.terminalOutput, output] }
          : t
      )
    );
  };

  return {
    addTab,
    closeTab,
    updateTabTarget,
    toggleOption,
    toggleAdvanced,
    updateTabOptions,
    addError,
    clearErrors,
    stopScan,
    resetCurrentTab,
    addAIMessage,
    clearAIConversation,
    clearTerminal,
    updateTabTerminalOutput,
  };
}

