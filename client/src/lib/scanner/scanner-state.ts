/**
 * Scanner Context - State Management
 * 
 * This file contains state initialization and management logic.
 * Pure functions that can be tested independently.
 * 
 * @module scanner-state
 */

import type { Tab, ScannerType } from './scanner-types';

/**
 * Generate a unique tab ID
 */
export function generateTabId(): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 11);
  return `scan-tab-${timestamp}-${randomStr}`;
}

/**
 * Create a new tab with default values
 */
export function createTab(
  target: string = '',
  scannerType: ScannerType = 'nmap',
  customTitle?: string
): Tab {
  const scannerNames: Record<ScannerType, string> = {
    'nmap': 'Nmap',
    'nikto': 'Nikto',
    'nuclei': 'Nuclei',
    'dirbuster': 'DirBuster',
    'universal': 'Terminal'
  };
  
  const title = customTitle || target || scannerNames[scannerType] || 'Terminal';
  
  return {
    id: generateTabId(),
    title,
    // Preserve a target when a tab is duplicated or opened from a queued scan.
    // Dropping it here made the new tab look correct while silently scanning
    // an empty target on the next action.
    target,
    selectedOptions: [],
    isScanning: false,
    scanProgress: 0,
    results: [],
    terminalOutput: [],
    aiConversation: [],
    scanSummary: null,
    resultsByScanner: {},
    structuredResultsByScanner: {},
    scanningByScanner: {},
    scannerType,
    showAdvanced: scannerType !== 'universal',
    errors: [],
    aiMode: 'compact', // Initialize AI mode to compact by default
  };
}

/**
 * Get initial scanner state with default nmap tab
 */
export function getInitialState(): { tabs: Tab[]; activeTabId: string } {
  const defaultTab = createTab('', 'nmap', 'Nmap');
  
  return {
    tabs: [defaultTab],
    activeTabId: defaultTab.id,
  };
}

/**
 * Find tab by ID
 */
export function findTab(tabs: Tab[], tabId: string): Tab | undefined {
  return tabs.find(t => t.id === tabId);
}

/**
 * Update tab in array
 */
export function updateTab(tabs: Tab[], tabId: string, updates: Partial<Tab>): Tab[] {
  return tabs.map(t => t.id === tabId ? { ...t, ...updates } : t);
}

/**
 * Remove tab from array
 */
export function removeTab(tabs: Tab[], tabId: string): Tab[] {
  return tabs.filter(t => t.id !== tabId);
}

/**
 * Get next active tab ID after closing a tab
 */
export function getNextActiveTabId(
  tabs: Tab[],
  closedTabId: string,
  currentActiveId: string
): string {
  // If closing a different tab, keep current active
  if (closedTabId !== currentActiveId) {
    return currentActiveId;
  }
  
  // Find the closed tab's index
  const index = tabs.findIndex(t => t.id === closedTabId);
  if (index === -1) {
    return currentActiveId;
  }
  
  // Try next tab, then previous tab
  const nextTab = tabs[index + 1] || tabs[index - 1];
  
  if (nextTab) {
    return nextTab.id;
  }
  
  // No tabs left - will create a new one
  return generateTabId();
}

/**
 * Check if tab should be reused (for universal terminals)
 */
export function shouldReuseTab(
  tabs: Tab[],
  scannerType: ScannerType,
  forceNew: boolean
): Tab | null {
  // Only reuse for universal terminals when not forcing new
  if (forceNew || scannerType !== 'universal') {
    return null;
  }
  
  // Find existing universal terminal
  const existingTab = tabs.find(t => t.scannerType === 'universal');
  return existingTab || null;
}
