/**
 * Scanner Context - Main Provider (Refactored)
 * 
 * This is the minimal React context provider that orchestrates all scanner functionality.
 * Heavy logic has been extracted to separate modules for better performance and maintainability.
 * 
 * @module scanner-context
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

// Import types (zero runtime cost)
import type { ScannerContextType, Tab } from './scanner/scanner-types';
import { invalidateScanWorkspace } from './scanner/scan-run-registry';

// Re-export types for backwards compatibility
export type { AIMessage, ScannerType, ScanError, Tab } from './scanner/scanner-types';

// Create context
const ScannerContext = createContext<ScannerContextType | undefined>(undefined);

/**
 * Hook to access scanner context
 */
export const useScanner = () => {
  const context = useContext(ScannerContext);
  if (!context) {
    throw new Error('useScanner must be used within a ScannerProvider');
  }
  return context;
};

/**
 * Scanner context provider
 */
export const ScannerProvider = ({ children }: { children: ReactNode }) => {
  // Initialize state with inline function to avoid import
  const getInitialState = () => {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 11);
    const defaultTab: Tab = {
      id: `scan-tab-${timestamp}-${randomStr}`,
      title: 'Nmap',
      target: '',
      selectedOptions: [],
      isScanning: false,
      scanProgress: 0,
      results: [],
      resultsByScanner: {},
      scanningByScanner: {},
      terminalOutput: [],
      aiConversation: [],
      scanSummary: null,
      scannerType: 'nmap' as const,
      showAdvanced: true,
      errors: [],
    };
    
    return {
      tabs: [defaultTab],
      activeTabId: defaultTab.id,
    };
  };
  
  const [initialState] = useState(getInitialState);
  const [tabs, setTabs] = useState<Tab[]>(initialState.tabs);
  const [activeTabId, setActiveTabId] = useState(initialState.activeTabId);
  const [actions, setActions] = useState<any>(null);
  const [runScan, setRunScan] = useState<any>(null);
  const [initialized, setInitialized] = useState(false);
  const tabsRef = React.useRef<Tab[]>(initialState.tabs);
  const actionsRef = React.useRef<any>(null);
  const runScanRef = React.useRef<any>(null);
  const initializationPromiseRef = React.useRef<Promise<void> | null>(null);
  const scannerEventCleanupsRef = React.useRef<(() => void)[]>([]);

  tabsRef.current = tabs;

  // PERFORMANCE: Lazy initialization - only load when scanner is actually used
  const initializeScanner = useCallback((): Promise<void> => {
    if (actionsRef.current && runScanRef.current) return Promise.resolve();
    if (initializationPromiseRef.current) return initializationPromiseRef.current;

    console.log('[scanner-context] Lazy loading scanner modules...');
    setInitialized(true);

    // Load all modules in parallel and expose the same promise to actions
    // invoked while the imports are still in flight. This prevents the first
    // target update or Scan click from being silently dropped.
    const initializationPromise = Promise.all([
      import('./scanner/scanner-actions'),
      import('./scanner/scanner-scan'),
      import('./scanner/scanner-handlers')
    ]).then(([actionsModule, scanModule, handlersModule]) => {
      const loadedActions = actionsModule.createScannerActions(
        setTabs,
        setActiveTabId,
        () => tabsRef.current
      );
      const loadedRunScan = scanModule.createRunScan(setTabs, loadedActions.addError);
      actionsRef.current = loadedActions;
      runScanRef.current = loadedRunScan;
      setActions(loadedActions);
      setRunScan(() => loadedRunScan);

      // Setup event handlers
      if (window.electron) {
        const handlers = handlersModule.createScanHandlers(setTabs);
        scannerEventCleanupsRef.current.forEach(cleanup => cleanup());
        scannerEventCleanupsRef.current = [
          window.electron.onNmapOutput(handlers.handleScanOutput),
          window.electron.onNmapComplete(handlers.handleScanComplete),
          window.electron.onListenerClosed(handlers.handleListenerClosed),
        ];
      }

      // Setup scheduler
      handlersModule.setupScheduler(setTabs);

      console.log('[scanner-context] Scanner modules loaded');
    }).catch((error) => {
      console.error('[scanner-context] Failed to load scanner modules:', error);
    }).finally(() => {
      initializationPromiseRef.current = null;
    });

    initializationPromiseRef.current = initializationPromise;
    return initializationPromise;
  }, []);

  useEffect(() => {
    return () => {
      invalidateScanWorkspace();
      scannerEventCleanupsRef.current.forEach(cleanup => cleanup());
      scannerEventCleanupsRef.current = [];
    };
  }, []);

  // FIX: Auto-initialize when scanner has tabs (user is using it)
  useEffect(() => {
    if (tabs.length > 0 && !initialized) {
      console.log('[scanner-context] Auto-initializing scanner (tabs exist)');
      initializeScanner();
    }
  }, [tabs.length, initialized, initializeScanner]);

  // Expose state to window for session manager
  useEffect(() => {
    // Expose a small, explicit bridge for session persistence. Keeping the
    // setters here avoids trying to serialize React context internals and lets
    // a restored session replace scanner tabs without a page reload.
    (window as any).__nmapContextState = {
      tabs,
      activeTabId,
      setTabs,
      setActiveTabId,
    };
  }, [tabs, activeTabId]);

  // A boot-time session restore can finish before this provider's first
  // effect exposes its setters. Consume that small hand-off once the React
  // state exists, without forcing a page reload.
  useEffect(() => {
    try {
      const pending = localStorage.getItem('pending-scanner-restore');
      if (!pending) return;
      const restored = JSON.parse(pending);
      if (Array.isArray(restored?.tabs) && restored.tabs.length > 0) {
        setTabs(restored.tabs);
        const activeId = restored.tabs.some((tab: any) => tab?.id === restored.activeTabId)
          ? restored.activeTabId
          : restored.tabs[0]?.id;
        if (activeId) setActiveTabId(activeId);
      }
      localStorage.removeItem('pending-scanner-restore');
    } catch (error) {
      console.warn('[scanner-context] Ignoring invalid pending scanner restore:', error);
      localStorage.removeItem('pending-scanner-restore');
    }
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = React.useMemo(() => {
    // PERFORMANCE: Wrap actions to trigger lazy initialization without
    // dropping interactions made while the dynamic modules are loading.
    const ensureInitialized = (fn: any, getLoadedAction: () => any): ((...args: any[]) => any) => {
      return (...args: any[]) => {
        if (fn) return fn(...args);
        return initializeScanner().then(() => {
          const loadedAction = getLoadedAction();
          return loadedAction ? loadedAction(...args) : undefined;
        });
      };
    };
    
    if (!actions || !runScan) {
      // Return a responsive context while loading. Target edits update local
      // state immediately; commands/actions queue behind the same import.
      const updateTabTargetWhileLoading = (id: string, target: string) => {
        setTabs((prev) => prev.map((tab) => (
          tab.id === id ? { ...tab, target, title: target || tab.title } : tab
        )));
      };

      return {
        tabs,
        activeTabId,
        setActiveTabId,
        setTabs,
        addTab: ensureInitialized(null, () => actionsRef.current?.addTab),
        closeTab: ensureInitialized(null, () => actionsRef.current?.closeTab),
        updateTabTarget: updateTabTargetWhileLoading,
        updateTabOptions: ensureInitialized(null, () => actionsRef.current?.updateTabOptions),
        toggleOption: ensureInitialized(null, () => actionsRef.current?.toggleOption),
        toggleAdvanced: ensureInitialized(null, () => actionsRef.current?.toggleAdvanced),
        runScan: ensureInitialized(null, () => runScanRef.current),
        stopScan: ensureInitialized(null, () => actionsRef.current?.stopScan),
        resetCurrentTab: ensureInitialized(null, () => actionsRef.current?.resetCurrentTab),
        clearTerminal: ensureInitialized(null, () => actionsRef.current?.clearTerminal),
        updateTabTerminalOutput: ensureInitialized(null, () => actionsRef.current?.updateTabTerminalOutput),
        addAIMessage: ensureInitialized(null, () => actionsRef.current?.addAIMessage),
        clearAIConversation: ensureInitialized(null, () => actionsRef.current?.clearAIConversation),
        addError: ensureInitialized(null, () => actionsRef.current?.addError),
        clearErrors: ensureInitialized(null, () => actionsRef.current?.clearErrors),
        orchestrator: null,
        executor: null,
      };
    }

    return {
      tabs,
      activeTabId,
      setActiveTabId,
      setTabs,
      addTab: actions.addTab,
      closeTab: actions.closeTab,
      updateTabTarget: actions.updateTabTarget,
      updateTabOptions: actions.updateTabOptions,
      toggleOption: actions.toggleOption,
      toggleAdvanced: actions.toggleAdvanced,
      runScan,
      stopScan: actions.stopScan,
      resetCurrentTab: actions.resetCurrentTab,
      clearTerminal: actions.clearTerminal,
      updateTabTerminalOutput: actions.updateTabTerminalOutput,
      addAIMessage: actions.addAIMessage,
      clearAIConversation: actions.clearAIConversation,
      addError: actions.addError,
      clearErrors: actions.clearErrors,
      orchestrator: null, // Lazy load when needed
      executor: null, // Lazy load when needed
    };
  }, [
    tabs,
    activeTabId,
    actions,
    runScan,
    initializeScanner,
  ]);

  return (
    <ScannerContext.Provider value={contextValue}>
      {children}
    </ScannerContext.Provider>
  );
};

