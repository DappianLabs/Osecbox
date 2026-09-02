/**
 * Type definitions for Electron IPC API
 */

export interface PlatformInfo {
  platform: 'windows' | 'linux' | 'darwin' | 'unknown';
  isWindows: boolean;
  isLinux: boolean;
  isMac: boolean;
  wsl2Status: 'available' | 'unavailable' | 'not-installed' | 'not-applicable' | 'checking';
  wsl2Version?: string;
  wsl2Distros?: string[];
  defaultDistro?: string;
  wsl2Error?: string;
}

export interface ToolAvailability {
  available: boolean;
  path?: string;
  version?: string;
  usedWSL: boolean;
  error?: string;
  role?: 'proxy' | 'agent' | 'unknown';
}

declare global {
  interface Window {
    electron: {
      platform: string;
      
      // Window controls
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      confirmClose: () => void;
      
      // Platform service
      getPlatformInfo: (forceRefresh?: boolean) => Promise<{ success: boolean; platformInfo?: PlatformInfo; error?: string }>;
      checkToolAvailability: (args: { toolName: string; requiresLinux?: boolean }) => Promise<{ success: boolean } & Partial<ToolAvailability> & { error?: string }>;
      checkLocalPort: (args: { port: number; host?: string; requiresLinux?: boolean }) => Promise<{
        success: boolean;
        available?: boolean;
        status?: 'available' | 'occupied' | 'permission-denied' | 'runtime-unavailable' | 'diagnostic-unavailable' | 'invalid';
        runtime?: string;
        verification?: 'bind' | 'occupancy-only';
        message?: string;
        error?: string;
      }>;
      getWSL2Instructions: () => Promise<{ success: boolean; instructions: string[] }>;
      refreshPlatformInfo: () => Promise<{ success: boolean; platformInfo?: PlatformInfo; error?: string }>;
      
      // Nmap operations
      checkNmap: () => Promise<{ installed: boolean; path: string | null; version: string | null; usedWSL?: boolean; error?: string }>;
      setNmapPath: (path: string) => Promise<{ success: boolean; error?: string }>;
      executeNmap: (args: { target: string; flags: string[]; scanId: string }) => Promise<any>;
      cancelScan: (scanId: string) => Promise<{ success: boolean }>;
      
      // AI operations
      setGroqKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
      getGroqStatus: () => Promise<{ configured: boolean; hasKey: boolean }>;
      analyzeScan: (args: { nmapOutput: string; target: string }) => Promise<{ success: boolean; insights: string[] }>;
      chatAI: (args: { messages: any[]; scanContext?: string }) => Promise<{ success: boolean; response: string }>;
      
      // Subdomain enumeration
      executeSubdomainTool: (args: { tool: string; domain: string; toolId: string; terminalId?: string; customFlags?: string }) => Promise<any>;
      
      // System commands
      executeSystemCommand: (args: { command: string; scanId: string }) => Promise<any>;
      executeCommand: (command: string) => Promise<any>;
      
      // Long-running listener processes
      startListener: (args: { command: string; listenerId: string }) => Promise<any>;
      stopListener: (listenerId: string) => Promise<{ success: boolean }>;
      writeToListener: (args: { listenerId: string; data: string }) => Promise<{ success: boolean }>;
      
      // Event listeners
      onListenerOutput: (callback: (data: { listenerId: string; data: string; type: string }) => void) => void;
      onListenerClosed: (callback: (data: { listenerId: string; code: number }) => void) => void;
      onListenerError: (callback: (data: { listenerId: string; error: string }) => void) => void;
      onNmapOutput: (callback: (data: { scanId: string; data: string; type: string }) => void) => void;
      onNmapComplete: (callback: (data: { scanId: string; code: number }) => void) => void;
      onCommandOutput: (callback: (data: { data: string; type: string }) => void) => () => void;
      onCommandComplete: (callback: (data: { code: number }) => void) => () => void;
      onMsfOutput: (callback: (data: { sessionId: string; data: string; type: string }) => void) => () => void;
      onMsfComplete: (callback: (data: { sessionId: string; code: number }) => void) => () => void;
      
      // Metasploit operations
      msfSearch: (query: string) => Promise<any>;
      msfModuleInfo: (modulePath: string) => Promise<any>;
      msfExecute: (args: { modulePath: string; options: Record<string, string>; sessionId: string }) => Promise<any>;
      
      // Auto-updater operations
      checkForUpdates: () => Promise<any>;
      downloadUpdate: () => Promise<any>;
      installUpdate: () => Promise<{ success: boolean; error?: string }>;
      getAppVersion: () => Promise<{ version: string }>;
      
      // Update event listeners
      onUpdateAvailable: (callback: (data: { version: string; releaseNotes: string; releaseDate: string }) => void) => () => void;
      onUpdateNotAvailable: (callback: () => void) => () => void;
      onUpdateDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => () => void;
      onUpdateDownloaded: (callback: (data: { version: string }) => void) => () => void;
      onUpdateError: (callback: (data: { message: string }) => void) => () => void;

      // Tool installation terminal hand-off
      onOpenTerminalTab: (callback: (data: { command: string }) => void) => () => void;
    };
  }
}

export {};
