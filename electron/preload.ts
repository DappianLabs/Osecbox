import { contextBridge, ipcRenderer } from 'electron';

const SAFE_EVENT_CHANNEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  confirmClose: () => ipcRenderer.send('window-confirm-close'),
  
  // Platform service
  getPlatformInfo: (forceRefresh?: boolean) => ipcRenderer.invoke('get-platform-info', forceRefresh),
  checkToolAvailability: (args: { toolName: string; requiresLinux?: boolean }) => ipcRenderer.invoke('check-tool-availability', args),
  checkLocalPort: (args: { port: number; host?: string; requiresLinux?: boolean }) => ipcRenderer.invoke('check-local-port', args),
  getWSL2Instructions: () => ipcRenderer.invoke('get-wsl2-instructions'),
  diagnoseDns: (args?: { target?: string }) => ipcRenderer.invoke('diagnose-dns', args || {}),
  refreshPlatformInfo: () => ipcRenderer.invoke('refresh-platform-info'),
  
  // Nmap operations
  checkNmap: () => ipcRenderer.invoke('check-nmap'),
  setNmapPath: (path: string) => ipcRenderer.invoke('set-nmap-path', path),
  executeNmap: (args: { target: string; flags: string[]; scanId: string; captureOutput?: boolean }) => ipcRenderer.invoke('execute-nmap', args),
  cancelScan: (scanId: string) => ipcRenderer.invoke('cancel-scan', scanId),
  
  // AI operations
  setGroqKey: (apiKey: string) => ipcRenderer.invoke('set-groq-key', apiKey),
  getGroqStatus: () => ipcRenderer.invoke('get-groq-status'),
  analyzeScan: (args: { nmapOutput: string; target: string }) => ipcRenderer.invoke('analyze-scan', args),
  chatAI: (args: {
    messages: any[];
    scanContext?: string;
    tools?: any[];
    tool_choice?: string;
    mode?: string;
    contextScope?: { sessionId?: string; tabId?: string; terminalId?: string; target?: string };
    stream?: boolean;
    requestId?: string;
  }) => ipcRenderer.invoke('chat-ai', args),
  onAIStreamChunk: (callback: (data: { requestId: string; content: string }) => void) => {
    const handler = (_event: any, data: { requestId: string; content: string }) => callback(data);
    ipcRenderer.on('ai-stream-chunk', handler);
    return () => ipcRenderer.removeListener('ai-stream-chunk', handler);
  },
  explainFinding: (args: { tool?: string; title: string; context?: string }) => ipcRenderer.invoke('explain-finding', args),
  
  // AI tool requests (for function calling)
  onAIToolRequest: (callback: (data: {
    requestId: string;
    toolName: string;
    args: any;
    scope?: { sessionId?: string; tabId?: string; terminalId?: string; target?: string };
  }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai-tool-request', handler);
    return () => ipcRenderer.removeListener('ai-tool-request', handler);
  },
  sendAIToolResponse: (requestId: string, data: any) => ipcRenderer.send(`ai-tool-response-${requestId}`, data),
  
  // Subdomain enumeration
  executeSubdomainTool: (args: { tool: string; domain: string; toolId: string; terminalId?: string; customFlags?: string }) => ipcRenderer.invoke('execute-subdomain-tool', args),
  
  // Tool execution with settings integration
  executeNikto: (args: { target: string; toolId: string }) => ipcRenderer.invoke('execute-nikto', args),
  executeNuclei: (args: { target: string; toolId: string }) => ipcRenderer.invoke('execute-nuclei', args),
  executeGobuster: (args: { target: string; toolId: string }) => ipcRenderer.invoke('execute-gobuster', args),
  executeMsfvenom: (args: { payload: string; format: string; outputFile: string; toolId: string }) => ipcRenderer.invoke('execute-msfvenom', args),
  
  // Tool process management
  cancelTool: (processId: string) => ipcRenderer.invoke('cancel-tool', processId),
  getActiveTools: () => ipcRenderer.invoke('get-active-tools'),
  
  // System commands
  executeSystemCommand: (args: { command: string; scanId: string }) => ipcRenderer.invoke('execute-system-command', args),
  
  // Terminal command execution (unrestricted)
  executeCommand: (command: string) => ipcRenderer.invoke('execute-command', command),
  
  // Send command to active terminal (for AI suggestions)
  sendToTerminal: (command: string) => ipcRenderer.send('send-to-terminal', command),
  
  // Error logging + IPC health ping
  invoke: (channel: string, ...args: any[]) => {
    // Keep the small compatibility bridge useful for existing renderer code
    // without exposing every main-process IPC handler to arbitrary page code.
    // New capabilities should get a typed preload method instead.
    const allowedChannels = new Set([
      'log-error',
      'ipc-health-ping',
      'get-settings',
      'update-setting',
      'reset-settings',
      'set-ai-config',
      'test-ai-config',
      'get-ai-status',
      'detect-tool-paths',
      'get-system-info',
      'get-app-memory',
    ]);
    if (!allowedChannels.has(channel)) {
      return Promise.reject(new Error(`IPC channel is not exposed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  
  // Long-running listener processes
  startListener: (args: { command: string; listenerId: string }) => ipcRenderer.invoke('start-listener', args),
  stopListener: (listenerId: string) => ipcRenderer.invoke('stop-listener', listenerId),
  // Use send instead of invoke for zero-latency input
  writeToListener: (args: { listenerId: string; data: string }) => {
    ipcRenderer.send('write-to-listener', args);
    return Promise.resolve({ success: true });
  },
  resizeTerminal: (args: { sessionId: string; cols: number; rows: number }) => ipcRenderer.invoke('resize-terminal', args),
  
  // SESSION RESTORE: Restore terminal state (working directory, env vars)
  restoreTerminalState: (sessionId: string, args: { workingDirectory?: string; envVars?: Record<string, string> }) => 
    ipcRenderer.invoke('restore-terminal-state', { sessionId, ...args }),
  
  // DISK-BACKED HISTORY: Terminal history operations
  terminalHistoryGetRecent: (args: { ptyId: string; count?: number }) => ipcRenderer.invoke('terminal-history-get-recent', args),
  terminalHistoryLoadOlder: (args: { ptyId: string; fromLine: number; count: number }) => ipcRenderer.invoke('terminal-history-load-older', args),
  terminalHistorySearch: (args: { ptyId: string; query: string; caseSensitive?: boolean }) => ipcRenderer.invoke('terminal-history-search', args),
  terminalHistoryGetTotalLines: (args: { ptyId: string }) => ipcRenderer.invoke('terminal-history-get-total-lines', args),
  terminalHistoryGetStats: (args: { ptyId: string }) => ipcRenderer.invoke('terminal-history-get-stats', args),
  terminalHistoryGetTail: (args: { ptyId: string; maxBytes?: number }) => ipcRenderer.invoke('terminal-history-get-tail', args),
  terminalHistoryExport: (args: { ptyIds: string[]; suggestedName?: string }) => ipcRenderer.invoke('terminal-history-export', args),
  terminalHistoryClear: (args: { ptyId: string }) => ipcRenderer.invoke('terminal-history-clear', args),
  terminalHistoryAppend: (args: { ptyId: string; data: string }) => ipcRenderer.invoke('terminal-history-append', args),
  
  // Listen for listener output
  onListenerOutput: (callback: (data: { listenerId: string; data: string; type: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('listener-output', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('listener-output', handler);
  },
  onListenerClosed: (callback: (data: { listenerId: string; code: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('listener-closed', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('listener-closed', handler);
  },
  onListenerExit: (callback: (data: { listenerId: string; exitCode: number; timestamp: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('listener-exit', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('listener-exit', handler);
  },
  onListenerError: (callback: (data: { listenerId: string; error: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('listener-error', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('listener-error', handler);
  },
  
  // Metasploit operations
  msfSearch: (query: string) => ipcRenderer.invoke('msf-search', query),
  msfModuleInfo: (modulePath: string) => ipcRenderer.invoke('msf-module-info', modulePath),
  msfExecute: (args: { modulePath: string; options: Record<string, string>; sessionId: string }) => ipcRenderer.invoke('msf-execute', args),
  
  // MSF console input (for terminal typing)
  msfConsoleInput: (data: string) => ipcRenderer.send('msf-console-input', data),
  msfConsoleClear: () => ipcRenderer.invoke('msf-console-clear'),
  
  // MSF console resize (for terminal resize)
  msfConsoleResize: (cols: number, rows: number) => ipcRenderer.invoke('msf-console-resize', cols, rows),
  
  // Persistent Metasploit Console operations
  msfConsoleInit: () => ipcRenderer.invoke('msf-console-init'),
  msfConsoleCommand: (command: string) => ipcRenderer.invoke('msf-console-command', command),
  msfConsoleUseModule: (modulePath: string) => ipcRenderer.invoke('msf-console-use-module', modulePath),
  msfConsoleSetOption: (name: string, value: string) => ipcRenderer.invoke('msf-console-set-option', name, value),
  msfConsoleShowOptions: () => ipcRenderer.invoke('msf-console-show-options'),
  msfConsoleExploit: () => ipcRenderer.invoke('msf-console-exploit'),
  msfConsoleRun: () => ipcRenderer.invoke('msf-console-run'),
  msfConsoleBack: () => ipcRenderer.invoke('msf-console-back'),
  msfConsoleSessions: (action?: string, sessionId?: number) => ipcRenderer.invoke('msf-console-sessions', action, sessionId),
  msfConsoleBackground: () => ipcRenderer.invoke('msf-console-background'),
  msfConsoleJobs: (action?: string, jobId?: number) => ipcRenderer.invoke('msf-console-jobs', action, jobId),
  msfConsoleSearch: (query: string) => ipcRenderer.invoke('msf-console-search', query),
  msfConsoleInfo: (modulePath?: string) => ipcRenderer.invoke('msf-console-info', modulePath),
  msfConsoleState: () => ipcRenderer.invoke('msf-console-state'),
  msfConsoleGetBuffer: () => ipcRenderer.invoke('msf-console-get-buffer'),
  msfConsoleRestart: () => ipcRenderer.invoke('msf-console-restart'),
  
  // Persistent console event listeners
  onMsfConsoleReady: (callback: (state: any) => void) => {
    const handler = (_event: any, state: any) => callback(state);
    ipcRenderer.on('msf-console-ready', handler);
    return () => ipcRenderer.removeListener('msf-console-ready', handler);
  },
  onMsfConsoleStateChange: (callback: (state: any) => void) => {
    const handler = (_event: any, state: any) => callback(state);
    ipcRenderer.on('msf-console-state-change', handler);
    return () => ipcRenderer.removeListener('msf-console-state-change', handler);
  },
  onMsfConsoleClosed: (callback: (code: number) => void) => {
    const handler = (_event: any, code: number) => callback(code);
    ipcRenderer.on('msf-console-closed', handler);
    return () => ipcRenderer.removeListener('msf-console-closed', handler);
  },
  onMsfConsoleError: (callback: (error: string) => void) => {
    const handler = (_event: any, error: string) => callback(error);
    ipcRenderer.on('msf-console-error', handler);
    return () => ipcRenderer.removeListener('msf-console-error', handler);
  },
  
  // Listen for tool output events
  onNiktoOutput: (callback: (data: { toolId: string; data: string; type: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('nikto-output', handler);
    return () => ipcRenderer.removeListener('nikto-output', handler);
  },
  onNucleiOutput: (callback: (data: { toolId: string; data: string; type: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('nuclei-output', handler);
    return () => ipcRenderer.removeListener('nuclei-output', handler);
  },
  onGobusterOutput: (callback: (data: { toolId: string; data: string; type: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('gobuster-output', handler);
    return () => ipcRenderer.removeListener('gobuster-output', handler);
  },
  
  // Listen for nmap output
  onNmapOutput: (callback: (data: { scanId: string; data: string; type: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('nmap-output', handler);
    return () => ipcRenderer.removeListener('nmap-output', handler);
  },
  
  // Listen for scan completion
  onNmapComplete: (callback: (data: { scanId: string; code: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('nmap-complete', handler);
    return () => ipcRenderer.removeListener('nmap-complete', handler);
  },
  
  // Generic event listener for any IPC event
  on: (channel: string, callback: (data: any) => void) => {
    if (typeof channel !== 'string' || !SAFE_EVENT_CHANNEL_PATTERN.test(channel)) {
      throw new Error('Invalid IPC event channel');
    }

    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  
  // PRIVILEGE: Listen for privilege warnings
  onScanPrivilegeWarning: (callback: (data: { 
    scanId: string; 
    level: string;
    message: string; 
    suggestion: string;
    originalFlags: string[];
    modifiedFlags: string[];
  }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('scan-privilege-warning', handler);
    return () => ipcRenderer.removeListener('scan-privilege-warning', handler);
  },
  
  // NOTIFICATIONS: Listen for system notifications from main process
  onSystemNotification: (callback: (data: {
    title: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    action?: { label: string; url?: string };
  }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('system-notification', handler);
    return () => ipcRenderer.removeListener('system-notification', handler);
  },
  
  // SAVE DIALOG: Listen for save before close request
  onRequestSaveBeforeClose: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('request-save-before-close', handler);
    return () => ipcRenderer.removeListener('request-save-before-close', handler);
  },
  
  // Listen for command output
  onCommandOutput: (callback: (data: { data: string; type: string }) => void) => {
    const handler = (_event: any, data: { data: string; type: string }) => callback(data);
    ipcRenderer.on('command-output', handler);
    return () => ipcRenderer.removeListener('command-output', handler);
  },
  
  // Listen for command completion
  onCommandComplete: (callback: (data: { code: number }) => void) => {
    const handler = (_event: any, data: { code: number }) => callback(data);
    ipcRenderer.on('command-complete', handler);
    return () => ipcRenderer.removeListener('command-complete', handler);
  },
  
  // Listen for Metasploit output
  onMsfOutput: (callback: (data: { sessionId: string; data: string; type: string }) => void) => {
    const handler = (_event: any, data: { sessionId: string; data: string; type: string }) => callback(data);
    ipcRenderer.on('msf-output', handler);
    return () => ipcRenderer.removeListener('msf-output', handler);
  },
  
  // Listen for Metasploit completion
  onMsfComplete: (callback: (data: { sessionId: string; code: number }) => void) => {
    const handler = (_event: any, data: { sessionId: string; code: number }) => callback(data);
    ipcRenderer.on('msf-complete', handler);
    return () => ipcRenderer.removeListener('msf-complete', handler);
  },
  
  // Auto-updater operations
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // License management
  activateLicense: (key: string) => ipcRenderer.invoke('activate-license', key),
  isPro: () => ipcRenderer.invoke('is-pro'),
  getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),
  hasFeature: (feature: string) => ipcRenderer.invoke('has-feature', feature),
  deactivateLicense: () => ipcRenderer.invoke('deactivate-license'),
  openUpgradeUrl: () => ipcRenderer.invoke('open-upgrade-url'),
  
  // Ultra module decryption
  isUltraAvailable: () => ipcRenderer.invoke('is-ultra-available'),
  decryptUltraModule: (moduleName: string) => ipcRenderer.invoke('decrypt-ultra-module', moduleName),
  
  // Listen for update events
  onUpdateAvailable: (callback: (data: { version: string; releaseNotes: string; releaseDate: string }) => void) => {
    const handler = (_event: any, data: { version: string; releaseNotes: string; releaseDate: string }) => callback(data);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('update-not-available', handler);
    return () => ipcRenderer.removeListener('update-not-available', handler);
  },
  onUpdateDownloadProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => {
    const handler = (_event: any, data: { percent: number; transferred: number; total: number }) => callback(data);
    ipcRenderer.on('update-download-progress', handler);
    return () => ipcRenderer.removeListener('update-download-progress', handler);
  },
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => {
    const handler = (_event: any, data: { version: string }) => callback(data);
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },
  onUpdateError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: any, data: { message: string }) => callback(data);
    ipcRenderer.on('update-error', handler);
    return () => ipcRenderer.removeListener('update-error', handler);
  },
  
  // Settings operations
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSetting: (key: string, value: any) => ipcRenderer.invoke('update-setting', key, value),
  updateSettings: (updates: any) => ipcRenderer.invoke('update-settings', updates),
  validateToolPath: (toolPath: string) => ipcRenderer.invoke('validate-tool-path', toolPath),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  exportSettings: (filePath: string) => ipcRenderer.invoke('export-settings', filePath),
  importSettings: (filePath: string) => ipcRenderer.invoke('import-settings', filePath),
  
  // COMPATIBILITY: Tool path detection
  detectToolPaths: () => ipcRenderer.invoke('detect-tool-paths'),
  findWordlist: (wordlistName: string) => ipcRenderer.invoke('find-wordlist', wordlistName),
  
  // PRIVILEGE: Privilege detection
  getPrivilegeInfo: () => ipcRenderer.invoke('get-privilege-info'),
  
  // TOOL INSTALLATION: Tool bootstrap and installation
  getInstallCommand: (tool: string) => ipcRenderer.invoke('get-install-command', tool),
  getInstallScript: (tools: string[]) => ipcRenderer.invoke('get-install-script', tools),
  // App-supported security tools are Linux binaries and run in the selected
  // WSL2 distro on Windows. Keep the flag optional for compatibility, while
  // the main handler defaults it to true so checks match terminal execution.
  checkToolInstalled: (tool: string, requiresLinux = true) => ipcRenderer.invoke('check-tool-installed', tool, requiresLinux),
  checkToolsInstalled: (tools: string[], requiresLinux = true) => ipcRenderer.invoke('check-tools-installed', tools, requiresLinux),
  clearToolCache: () => ipcRenderer.invoke('clear-tool-cache'),
  openTerminalWithCommand: (command: string) => ipcRenderer.invoke('open-terminal-with-command', command),
  onOpenTerminalTab: (callback: (data: { command: string }) => void) => {
    const handler = (_event: any, data: { command: string }) => callback(data);
    ipcRenderer.on('open-terminal-tab', handler);
    return () => ipcRenderer.removeListener('open-terminal-tab', handler);
  },
  // ========================================
  // SESSION PERSISTENCE (Attack State V2)
  // ========================================
  saveSessionState: (sessionId: string, data: string) => ipcRenderer.invoke('save-session-state', sessionId, data),
  loadSessionState: (sessionId: string) => ipcRenderer.invoke('load-session-state', sessionId),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('delete-session', sessionId),
  saveSessionArtifact: (args: { sessionId: string; key: string; revision: string; data: string }) => ipcRenderer.invoke('save-session-artifact', args),
  loadSessionArtifact: (args: { sessionId: string; key: string; revision: string }) => ipcRenderer.invoke('load-session-artifact', args),
  saveAutomationResult: (args: { directory: string; filename: string; content: string }) =>
    ipcRenderer.invoke('save-automation-result', args),
});
