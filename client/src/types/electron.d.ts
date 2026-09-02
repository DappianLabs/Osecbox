export interface NmapCheckResult {
  installed: boolean;
  path: string | null;
  version: string | null;
  error?: string;
  usedWSL?: boolean;
}

export interface NmapExecuteArgs {
  target: string;
  flags: string[];
  scanId: string;
  captureOutput?: boolean;
}

export interface NmapOutput {
  scanId: string;
  data: string;
  type: 'stdout' | 'stderr';
}

export interface NmapComplete {
  scanId: string;
  code: number;
}

export interface DnsDiagnosticProbe {
  ok: boolean;
  available: boolean;
  output?: string;
  error?: string;
}

export interface DnsDiagnosticResult {
  status: 'healthy' | 'not-required' | 'target-unresolved' | 'resolver-unavailable' | 'network-unavailable' | 'runtime-unavailable' | 'diagnostic-unavailable';
  ok: boolean;
  runtime: 'wsl2' | 'linux' | 'darwin' | 'windows' | 'unknown';
  target?: string;
  publicProbe: DnsDiagnosticProbe;
  targetProbe?: DnsDiagnosticProbe;
  nameservers: string[];
  routeEvidence?: string;
  message: string;
  remediation: string[];
}

export interface IElectronAPI {
  platform: string;
  
  // Window controls
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  confirmClose: () => void;
  
  // Nmap operations
  checkNmap: () => Promise<NmapCheckResult>;
  setNmapPath: (path: string) => Promise<{ success: boolean; error?: string }>;
  executeNmap: (args: NmapExecuteArgs) => Promise<{ success: boolean; output?: string; error?: string; scanId: string }>;
  cancelScan: (scanId: string) => Promise<{ success: boolean; error?: string }>;
  
  // AI operations
  setGroqKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  getGroqStatus: () => Promise<{ configured: boolean; hasKey: boolean; verified?: boolean }>;
  analyzeScan: (args: { nmapOutput: string; target: string }) => Promise<{ success: boolean; insights: string[] }>;
  chatAI: (args: { 
    messages: Array<{ role: string; content: string }>; 
    scanContext?: string; 
    tools?: Array<{ type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }>; 
    tool_choice?: string;
    mode?: string;
    contextScope?: { sessionId?: string; tabId?: string; terminalId?: string; target?: string };
    stream?: boolean;
    requestId?: string;
  }) => Promise<{ 
    success: boolean; 
    response: string; 
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> 
  }>;
  onAIStreamChunk: (callback: (data: { requestId: string; content: string }) => void) => () => void;
  
  // Explain a single finding (e.g. an nmap port/service) using the configured AI provider
  explainFinding: (args: { tool?: string; title: string; context?: string }) => Promise<{
    success: boolean;
    explanation?: string;
    error?: string;
  }>;
  
  // AI tool requests (for function calling)
  onAIToolRequest: (callback: (data: {
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
    scope?: { sessionId?: string; tabId?: string; terminalId?: string; target?: string };
  }) => void) => () => void;
  sendAIToolResponse: (requestId: string, data: any) => void;
  // Subdomain enumeration
  executeSubdomainTool: (args: { tool: string; domain: string; toolId: string; terminalId?: string; customFlags?: string }) => Promise<{ success: boolean; output?: string; stderr?: string; error?: string; toolId: string }>;
  
  // Tool execution with settings integration
  executeNikto: (args: { target: string; toolId: string }) => Promise<{ success: boolean; output?: string; error?: string }>;
  executeNuclei: (args: { target: string; toolId: string }) => Promise<{ success: boolean; output?: string; error?: string }>;
  executeGobuster: (args: { target: string; toolId: string }) => Promise<{ success: boolean; output?: string; error?: string }>;
  executeMsfvenom: (args: { payload: string; format: string; outputFile: string; toolId: string }) => Promise<{ success: boolean; error?: string }>;
  
  // Tool process management
  cancelTool: (processId: string) => Promise<{ success: boolean; error?: string }>;
  getActiveTools: () => Promise<{ success: boolean; processes?: string[]; error?: string }>;
  
  // System commands (ipconfig, arp, etc)
  executeSystemCommand: (args: { command: string; scanId: string }) => Promise<{ success: boolean; output?: string; error?: string; scanId: string }>;
  
  // Terminal command execution (unrestricted)
  executeCommand: (command: string) => Promise<{
    success: boolean;
    output?: string;
    error?: string;
    exitCode?: number | null;
  }>;
  
  // Send command to active terminal (for AI suggestions)
  sendToTerminal: (command: string) => void;
  
  // Long-running listener processes
  startListener: (args: { command: string; listenerId: string }) => Promise<{
    success: boolean;
    listenerId?: string;
    error?: string;
    cancelled?: boolean;
    starting?: boolean;
    reused?: boolean;
    managed?: boolean;
    usedWSL?: boolean;
  }>;
  stopListener: (listenerId: string) => Promise<{ success: boolean; error?: string }>;
  writeToListener: (args: { listenerId: string; data: string }) => Promise<{ success: boolean; error?: string }>;
  resizeTerminal: (args: { sessionId: string; cols: number; rows: number }) => Promise<{ success: boolean; error?: string }>;
  
  // SESSION RESTORE: Restore terminal state (working directory, env vars)
  restoreTerminalState: (sessionId: string, args: { workingDirectory?: string; envVars?: Record<string, string> }) => Promise<{ success: boolean; error?: string }>;
  
  onListenerOutput: (callback: (data: { listenerId: string; data: string; type: string }) => void) => () => void;
  onListenerClosed: (callback: (data: { listenerId: string; code: number }) => void) => () => void;
  onListenerExit: (callback: (data: { listenerId: string; exitCode: number; timestamp: number }) => void) => () => void;
  onListenerError: (callback: (data: { listenerId: string; error: string }) => void) => () => void;
  
  // DISK-BACKED HISTORY: Terminal history operations
  terminalHistoryGetRecent: (args: { ptyId: string; count?: number }) => Promise<{ success: boolean; lines?: string[]; error?: string }>;
  terminalHistoryLoadOlder: (args: { ptyId: string; fromLine: number; count: number }) => Promise<{ success: boolean; lines?: string[]; error?: string }>;
  terminalHistorySearch: (args: { ptyId: string; query: string; caseSensitive?: boolean }) => Promise<{ success: boolean; results?: Array<{ line: string; lineNumber: number }>; error?: string }>;
  terminalHistoryGetTotalLines: (args: { ptyId: string }) => Promise<{ success: boolean; totalLines?: number; error?: string }>;
  terminalHistoryGetStats: (args: { ptyId: string }) => Promise<{ success: boolean; stats?: any; error?: string }>;
  terminalHistoryGetTail: (args: { ptyId: string; maxBytes?: number }) => Promise<{ success: boolean; data?: string; totalBytes?: number; truncated?: boolean; error?: string }>;
  terminalHistoryExport: (args: { ptyIds: string[]; suggestedName?: string }) => Promise<{ success: boolean; canceled?: boolean; path?: string; bytes?: number; error?: string }>;
  terminalHistoryClear: (args: { ptyId: string }) => Promise<{ success: boolean; error?: string }>;
  terminalHistoryAppend: (args: { ptyId: string; data: string }) => Promise<{ success: boolean; error?: string }>;
  
  // Metasploit operations
  msfSearch: (query: string) => Promise<{ 
    success: boolean; 
    modules?: Array<{ name: string; type: string; rank: string; description: string }>; 
    error?: string 
  }>;
  msfModuleInfo: (modulePath: string) => Promise<{ 
    success: boolean; 
    options?: Array<{ name: string; required: boolean; default?: string; description: string }>; 
    error?: string 
  }>;
  msfExecute: (args: { modulePath: string; options: Record<string, string>; sessionId: string }) => Promise<{ success: boolean; output?: string; error?: string; sessionId: string }>;
  
  // MSF console input/resize (for terminal integration)
  msfConsoleInput: (data: string) => void;
  msfConsoleClear: () => Promise<{ success: boolean; error?: string }>;
  msfConsoleResize: (cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
  
  // Persistent Metasploit Console operations
  msfConsoleInit: () => Promise<{ success: boolean; state?: any; error?: string }>;
  msfConsoleCommand: (command: string) => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleUseModule: (modulePath: string) => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleSetOption: (name: string, value: string) => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleShowOptions: () => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleExploit: () => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleRun: () => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleBack: () => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleSessions: (action?: string, sessionId?: number) => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleBackground: () => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleJobs: (action?: string, jobId?: number) => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleSearch: (query: string) => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleInfo: (modulePath?: string) => Promise<{ success: boolean; output?: string; error?: string; state?: any; prompt?: string; context?: string }>;
  msfConsoleState: () => Promise<{ success: boolean; state?: any; error?: string }>;
  msfConsoleGetBuffer: () => Promise<{ success: boolean; buffer?: string; error?: string }>;
  msfConsoleRestart: () => Promise<{ success: boolean; state?: any; error?: string }>;
  
  // Persistent console event listeners
  onMsfConsoleReady: (callback: (state: any) => void) => () => void;
  onMsfConsoleStateChange: (callback: (state: any) => void) => () => void;
  onMsfConsoleClosed: (callback: (code: number) => void) => () => void;
  onMsfConsoleError: (callback: (error: string) => void) => () => void;
  
  // Event listeners
  onNmapOutput: (callback: (data: NmapOutput) => void) => () => void;
  onNmapComplete: (callback: (data: NmapComplete) => void) => () => void;
  
  // Tool output event listeners
  onNiktoOutput: (callback: (data: { toolId: string; data: string; type: string }) => void) => () => void;
  onNucleiOutput: (callback: (data: { toolId: string; data: string; type: string }) => void) => () => void;
  onGobusterOutput: (callback: (data: { toolId: string; data: string; type: string }) => void) => () => void;
  
  onScanPrivilegeWarning: (callback: (data: {
    scanId: string;
    level: string;
    message: string;
    suggestion: string;
    originalFlags: string[];
    modifiedFlags: string[];
  }) => void) => () => void;
  onSystemNotification: (callback: (data: {
    title: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    action?: { label: string; url?: string };
  }) => void) => () => void;
  onRequestSaveBeforeClose: (callback: () => void) => () => void;
  onCommandOutput: (callback: (data: { data: string; type: string }) => void) => () => void;
  onCommandComplete: (callback: (data: { code: number }) => void) => () => void;
  onMsfOutput: (callback: (data: { sessionId: string; data: string; type: string }) => void) => () => void;
  onMsfComplete: (callback: (data: { sessionId: string; code: number }) => void) => () => void;
  
  // Auto-updater
  checkForUpdates: () => Promise<{ 
    success: boolean; 
    updateInfo?: { version: string; releaseDate: string; releaseNotes: string }; 
    error?: string 
  }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  installUpdate: () => Promise<{ success: boolean; error?: string }>;
  getAppVersion: () => Promise<{ version: string }>;

  // License management
  activateLicense: (key: string) => Promise<{ success: boolean; error?: string }>;
  isPro: () => Promise<boolean>;
  getLicenseInfo: () => Promise<{ tier: 'free' | 'pro'; expiresAt?: Date; daysRemaining?: number }>;
  hasFeature: (feature: string) => Promise<boolean>;
  deactivateLicense: () => Promise<{ success: boolean }>;
  openUpgradeUrl: () => Promise<{ success: boolean }>;
  
  // Ultra module decryption
  isUltraAvailable: () => Promise<boolean>;
  decryptUltraModule: (moduleName: string) => Promise<Record<string, unknown>>;
  
  // Generic invoke method for IPC health monitoring
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  
  onUpdateAvailable: (callback: (data: { version: string; releaseNotes: string; releaseDate: string }) => void) => () => void;
  onUpdateNotAvailable: (callback: () => void) => () => void;
  onUpdateDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => () => void;
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => () => void;
  onUpdateError: (callback: (data: { message: string }) => void) => () => void;
  
  // COMPATIBILITY: Tool path detection
  detectToolPaths: () => Promise<{ success: boolean; paths?: Record<string, string>; error?: string }>;
  findWordlist: (wordlistName: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  clearToolCache?: () => Promise<void>;
  
  // PRIVILEGE: Privilege detection
  getPrivilegeInfo: () => Promise<{
    success: boolean;
    info?: {
      level: 'root' | 'sudo' | 'user' | 'admin' | 'unknown';
      isRoot: boolean;
      hasSudo: boolean;
      sudoNoPassword?: boolean;
      isAdmin: boolean;
      uid?: number;
      username?: string;
    };
    error?: string;
  }>;
  
  // TOOL INSTALLATION: Tool bootstrap and installation
  getInstallCommand: (tool: string) => Promise<{
    success: boolean;
    info?: {
      tool: string;
      distro: string;
      packageManager: string;
      command: string;
      notes?: string;
    };
    error?: string;
  }>;
  getInstallScript?: (tools: string[]) => Promise<{
    success: boolean;
    runtime?: 'wsl2' | 'linux' | 'darwin';
    shell?: 'bash';
    distro?: string;
    tools?: string[];
    script?: string;
    error?: string;
  }>;
  checkToolInstalled: (tool: string, requiresLinux?: boolean) => Promise<{
    installed: boolean;
    path?: string;
    version?: string;
    error?: string;
  }>;
  checkToolsInstalled?: (tools: string[], requiresLinux?: boolean) => Promise<{
    success: boolean;
    tools?: Record<string, {
      installed: boolean;
      path?: string;
      version?: string;
      error?: string;
    }>;
    error?: string;
  }>;
  openTerminalWithCommand: (command: string) => Promise<{
    success: boolean;
    terminalId?: string;
    error?: string;
  }>;
  onOpenTerminalTab: (callback: (data: { command: string }) => void) => () => void;
  
  // ========================================
  // SESSION PERSISTENCE (Attack State V2)
  // ========================================
  saveSessionState: (sessionId: string, data: string) => Promise<boolean>;
  loadSessionState: (sessionId: string) => Promise<string | null>;
  listSessions: () => Promise<string[]>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  saveSessionArtifact?: (args: { sessionId: string; key: string; revision: string; data: string }) => Promise<{ success: boolean; bytes?: number; error?: string }>;
  loadSessionArtifact?: (args: { sessionId: string; key: string; revision: string }) => Promise<string | null>;
  saveAutomationResult: (args: { directory: string; filename: string; content: string }) => Promise<{
    success: boolean;
    filePath?: string;
    error?: string;
  }>;
  
  // Platform service
  getPlatformInfo: (forceRefresh?: boolean) => Promise<{ 
    success: boolean; 
    platformInfo?: {
      platform: 'windows' | 'linux' | 'darwin' | 'unknown';
      isWindows: boolean;
      isLinux: boolean;
      isMac: boolean;
      wsl2Status: 'available' | 'unavailable' | 'not-installed' | 'not-applicable' | 'checking';
      wsl2Version?: string;
      wsl2Distros?: string[];
      defaultDistro?: string;
      wsl2Error?: string;
    };
    info?: {
      platform: 'windows' | 'linux' | 'darwin' | 'unknown';
      isWindows: boolean;
      isLinux: boolean;
      isMac: boolean;
      wsl2Status: 'available' | 'unavailable' | 'not-installed' | 'not-applicable' | 'checking';
      wsl2Version?: string;
      wsl2Distros?: string[];
      defaultDistro?: string;
      wsl2Error?: string;
    };
    error?: string 
  }>;
  checkToolAvailability: (args: { toolName: string; requiresLinux?: boolean }) => Promise<{
    success: boolean;
    available?: boolean;
    path?: string;
    version?: string;
    usedWSL?: boolean;
    role?: 'proxy' | 'agent' | 'unknown';
    error?: string;
  }>;
  checkLocalPort: (args: { port: number; host?: string; requiresLinux?: boolean }) => Promise<{
    success: boolean;
    available?: boolean;
    status?: 'available' | 'occupied' | 'permission-denied' | 'runtime-unavailable' | 'diagnostic-unavailable' | 'invalid';
    runtime?: string;
    verification?: 'bind' | 'occupancy-only';
    message?: string;
    error?: string;
  }>;
  diagnoseDns: (args?: { target?: string }) => Promise<{
    success: boolean;
    diagnostic?: DnsDiagnosticResult;
    message?: string;
    error?: string;
  }>;
  getWSL2Instructions: () => Promise<{ 
    success: boolean; 
    instructions?: string[] | { title: string; steps: string[]; notes: string[] }
  }>;
  refreshPlatformInfo: () => Promise<{ 
    success: boolean; 
    platformInfo?: {
      platform: 'windows' | 'linux' | 'darwin' | 'unknown';
      isWindows: boolean;
      isLinux: boolean;
      isMac: boolean;
      wsl2Status: 'available' | 'unavailable' | 'not-installed' | 'not-applicable' | 'checking';
      wsl2Version?: string;
      wsl2Distros?: string[];
      defaultDistro?: string;
      wsl2Error?: string;
    };
    info?: {
      platform: 'windows' | 'linux' | 'darwin' | 'unknown';
      isWindows: boolean;
      isLinux: boolean;
      isMac: boolean;
      wsl2Status: 'available' | 'unavailable' | 'not-installed' | 'not-applicable' | 'checking';
      wsl2Version?: string;
      wsl2Distros?: string[];
      defaultDistro?: string;
      wsl2Error?: string;
    };
    error?: string 
  }>;
  
  // Settings operations
  getSettings: () => Promise<{ success: boolean; settings?: any; error?: string }>;
  updateSetting: (key: string, value: any) => Promise<{ success: boolean; error?: string }>;
  resetSettings: () => Promise<{ success: boolean; error?: string }>;
  
  // Metasploit additional operations
  msfGetPayloads: (exploitModule: string) => Promise<{ success: boolean; payloads?: any[]; error?: string }>;
  msfSessionCommand: (sessionId: string, command: string) => Promise<{ success: boolean; output?: string; error?: string }>;
  
  // Generic invoke for any IPC call
  invoke: (channel: string, ...args: any[]) => Promise<any>;
}

declare global {
  interface Window {
    electron?: IElectronAPI;
  }
}
