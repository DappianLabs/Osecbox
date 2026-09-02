/**
 * Scanner Context - Type Definitions
 * 
 * This file contains all TypeScript interfaces and types for the scanner system.
 * Types have zero runtime cost and can be imported anywhere without performance impact.
 * 
 * @module scanner-types
 */

// Type-only imports (no runtime cost)
export type NmapOption = import('../nmap-config').NmapOption;
export type ScanResult = import('../nmap-parser').ScanResult;

/**
 * AI conversation message
 */
export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Supported scanner types
 */
export type ScannerType = 'nmap' | 'nikto' | 'nuclei' | 'dirbuster' | 'universal';

/**
 * Scan error/warning/info message
 */
export interface ScanError {
  id: string;
  timestamp: number;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  details?: string;
  tool?: string;
  target?: string;
  command?: string;
}

/**
 * Scanner tab state
 */
export interface Tab {
  id: string;
  title: string;
  target: string;
  selectedOptions: NmapOption[];
  isScanning: boolean;
  scanProgress: number;
  /** Lifecycle result of the most recent run for the active scanner. */
  lastScanStatus?: 'running' | 'completed' | 'failed' | 'stale' | 'timeout' | 'stopped';
  lastScanExitCode?: number;
  results: ScanResult[];
  /** Results per scanner type - allows each scanner to keep its own independent results */
  resultsByScanner?: Partial<Record<ScannerType, any[]>>;
  /** Completed parser snapshots retained for dedicated result panels. */
  structuredResultsByScanner?: Partial<Record<ScannerType, unknown>>;
  /** Per-scanner scanning state - each scanner can scan independently in parallel */
  scanningByScanner?: Partial<Record<ScannerType, boolean>>;
  terminalOutput: string[]; // DEPRECATED: Use terminalService.getOutput(tabId) instead
  /** Last command submitted for each scanner, kept visible outside xterm scrollback. */
  commandsByScanner?: Partial<Record<ScannerType, string>>;
  aiConversation: AIMessage[];
  scanSummary: string | null;
  scannerType?: ScannerType;
  showAdvanced?: boolean; // Track if options panel is expanded
  errors?: ScanError[]; // Track scan errors
  aiMode?: 'compact' | 'ultra'; // Persist AI mode per tab (compact: compressed, ultra: full)
  aiScope?: 'engagement' | 'focused'; // AI context scope for this scanner tab
}

/**
 * Scanner context API
 */
export interface ScannerContextType {
  // State
  tabs: Tab[];
  activeTabId: string;
  
  // State setters
  setActiveTabId: (id: string) => void;
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  
  // Tab management
  addTab: (target?: string, scannerType?: ScannerType, forceNew?: boolean) => string | undefined;
  closeTab: (id: string) => void;
  
  // Tab updates
  updateTabTarget: (id: string, target: string) => void;
  updateTabOptions: (id: string, flags: string[]) => void;
  toggleOption: (tabId: string, option: NmapOption) => void;
  toggleAdvanced: (tabId: string) => void;
  
  // Scan operations
  runScan: (tabId: string, overrideTarget?: string, forceSystemCommand?: boolean, scannerOptions?: string[]) => void;
  stopScan: (tabId: string, scannerType?: ScannerType) => void;
  resetCurrentTab: (tabId: string) => void;
  
  // Terminal operations
  clearTerminal: (tabId: string) => void;
  updateTabTerminalOutput: (id: string, output: string) => void;
  
  // AI operations
  addAIMessage: (tabId: string, message: AIMessage) => void;
  clearAIConversation: (tabId: string) => void;
  
  // Error handling
  addError: (tabId: string, error: Omit<ScanError, 'id' | 'timestamp'>) => void;
  clearErrors: (tabId: string) => void;
  
  // AI services (lazy loaded)
  orchestrator: any;
  executor: any | null;
}

/**
 * Scan completion event data
 */
export interface ScanCompleteData {
  scanId: string;
  code: number;
  /** Scanner identity captured when the process was started. */
  scannerType?: ScannerType;
  /** Exact terminal that owns the process output. */
  terminalId?: string;
}

/**
 * Scan output event data
 */
export interface ScanOutputData {
  scanId: string;
  data: string;
  type: string;
}
