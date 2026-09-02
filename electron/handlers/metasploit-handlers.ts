/**
 * Metasploit Console Handlers
 * Handles persistent msfconsole management and operations
 */

import type { BrowserWindow } from 'electron';

let msfConsoleManager: any = null;
let mainWindow: BrowserWindow | null = null;

// Set main window for terminal events
export function setMetasploitMainWindow(window: BrowserWindow) {
  mainWindow = window;
  if (msfConsoleManager) {
    msfConsoleManager.setMainWindow(window);
  }
}

async function getMsfConsoleManager() {
  if (!msfConsoleManager) {
    // Use hybrid PTY manager for real-time output + state tracking
    const module = await import('../msf-pty-manager');
    msfConsoleManager = module.msfPtyManager;
    
    // Set main window if available
    if (mainWindow) {
      msfConsoleManager.setMainWindow(mainWindow);
    }
  }
  return msfConsoleManager;
}

async function ensureMsfReady() {
  const msf = await getMsfConsoleManager();
  if (!msf.isReady()) {
    await msf.initialize();
    if (!msf.isReady()) {
      // Throw error silently without logging
      throw new Error('Metasploit not available');
    }
  }
  return msf;
}

export function registerMetasploitHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void,
  registerIPCListener: (channel: string, handler: (...args: any[]) => void) => void
) {
  // Initialize persistent msfconsole
  registerIPCHandler('msf-console-init', async () => {
    try {
      console.log('[msf-console-init] ========== STARTING INITIALIZATION ==========');
      const msf = await getMsfConsoleManager();
      console.log('[msf-console-init] Got manager, checking if ready...');
      
      if (!msf.isReady()) {
        console.log('[msf-console-init] Not ready, calling initialize()...');
        await msf.initialize();
        console.log('[msf-console-init] initialize() completed');
      } else {
        console.log('[msf-console-init] Already ready, skipping initialization');
      }
      
      const state = msf.getState();
      console.log('[msf-console-init] Final state:', { isReady: state.isReady, prompt: state.prompt });
      console.log('[msf-console-init] ========== INITIALIZATION COMPLETE ==========');
      
      return { success: true, state };
    } catch (error: any) {
      console.error('[msf-console-init] ========== INITIALIZATION FAILED ==========');
      console.error('[msf-console-init] Error:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Handle terminal input for MSF console (fire-and-forget)
  registerIPCListener('msf-console-input', async (_event, data: string) => {
    try {
      const msf = await getMsfConsoleManager();
      // The manager owns readiness and initialization. Do not gate this on
      // isReady(): doing so drops characters typed while msfconsole is still
      // loading its prompt.
      await msf.writeInput(data);
    } catch (error: any) {
      console.error('[msf-console-input] Failed:', error);
    }
  });

  // Clear the visible transcript without tearing down the persistent PTY.
  // The manager owns the delayed prompt/output queue; clear the durable MSF
  // history in the same IPC transaction so a queued prompt cannot repaint or
  // append stale bytes after the renderer has reset xterm.
  registerIPCHandler('msf-console-clear', async () => {
    try {
      const msf = await getMsfConsoleManager();
      await msf.clearDisplayOutput();
      const { terminalHistoryService } = await import('../terminal-history-service');
      await terminalHistoryService.clear('msf-console-persistent');
      return { success: true };
    } catch (error: any) {
      console.error('[msf-console-clear] Failed:', error);
      return { success: false, error: error.message || 'Failed to clear Metasploit output' };
    }
  });
  
  // Handle terminal resize for MSF console
  registerIPCHandler('msf-console-resize', async (_event, cols: number, rows: number) => {
    try {
      const msf = await getMsfConsoleManager();
      if (msf.isReady()) {
        msf.resize(cols, rows);
        return { success: true };
      }
      return { success: false, error: 'Console not ready' };
    } catch (error: any) {
      console.error('[msf-console-resize] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Send command to persistent msfconsole (legacy - for quick commands)
  registerIPCHandler('msf-console-command', async (_event, command: string) => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.sendCommand(command);
      return result;
    } catch (error: any) {
      console.error('[msf-console-command] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Use module in persistent console
  registerIPCHandler('msf-console-use-module', async (_event, modulePath: string) => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.useModule(modulePath);
      return result;
    } catch (error: any) {
      console.error('[msf-console-use-module] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Set option in persistent console
  registerIPCHandler('msf-console-set-option', async (_event, name: string, value: string) => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.setOption(name, value);
      return result;
    } catch (error: any) {
      console.error('[msf-console-set-option] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Show options in persistent console
  registerIPCHandler('msf-console-show-options', async () => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.showOptions();
      return result;
    } catch (error: any) {
      console.error('[msf-console-show-options] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Execute exploit in persistent console
  registerIPCHandler('msf-console-exploit', async () => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.exploit();
      return result;
    } catch (error: any) {
      console.error('[msf-console-exploit] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Run auxiliary module in persistent console
  registerIPCHandler('msf-console-run', async () => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.run();
      return result;
    } catch (error: any) {
      console.error('[msf-console-run] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Go back to main console
  registerIPCHandler('msf-console-back', async () => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.back();
      return result;
    } catch (error: any) {
      console.error('[msf-console-back] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Session management in persistent console
  registerIPCHandler('msf-console-sessions', async (_event, action?: string, sessionId?: number) => {
    try {
      const msf = await ensureMsfReady();
      
      // Handle session upgrade
      if (action === 'upgrade' && sessionId !== undefined) {
        const result = await msf.sendCommand(`sessions -u ${sessionId}`);
        return result;
      }
      
      const result = await msf.sessions(action, sessionId);
      return result;
    } catch (error: any) {
      // FIX: Silent fail when MSF not available (prevents log spam)
      if (!error.message?.includes('Metasploit not available')) {
        console.error('[msf-console-sessions] Failed:', error);
      }
      return { success: false, error: error.message };
    }
  });

  // Background current session
  registerIPCHandler('msf-console-background', async () => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.background();
      return result;
    } catch (error: any) {
      console.error('[msf-console-background] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Job management in persistent console
  registerIPCHandler('msf-console-jobs', async (_event, action?: string, jobId?: number) => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.jobs(action, jobId);
      return result;
    } catch (error: any) {
      // FIX: Silent fail when MSF not available (prevents log spam)
      if (!error.message?.includes('Metasploit not available')) {
        console.error('[msf-console-jobs] Failed:', error);
      }
      return { success: false, error: error.message };
    }
  });

  // Search modules in persistent console
  registerIPCHandler('msf-console-search', async (_event, query: string) => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.search(query);
      return result;
    } catch (error: any) {
      console.error('[msf-console-search] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Get module info in persistent console
  registerIPCHandler('msf-console-info', async (_event, modulePath?: string) => {
    try {
      const msf = await ensureMsfReady();
      const result = await msf.info(modulePath);
      return result;
    } catch (error: any) {
      console.error('[msf-console-info] Failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Get current console state
  registerIPCHandler('msf-console-state', async () => {
    try {
      const msf = await getMsfConsoleManager();
      const state = msf.getState();
      return { success: true, state };
    } catch (error: any) {
      console.error('[msf-console-state] Failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Get buffered output for terminal restoration
  registerIPCHandler('msf-console-get-buffer', async () => {
    try {
      const msf = await getMsfConsoleManager();
      const buffer = msf.getBufferedOutput();

      // The renderer/TerminalService owns replaying the attached PTY buffer.
      // Do not send it through listener-output as well or every remount will
      // duplicate the full history (including the prompt).
      return { success: true, buffer };
    } catch (error: any) {
      console.error('[msf-console-get-buffer] Failed:', error);
      return { success: false, error: error.message, buffer: '' };
    }
  });

  // Restart console if needed
  registerIPCHandler('msf-console-restart', async () => {
    try {
      const msf = await getMsfConsoleManager();
      await msf.restart();
      return { success: true, state: msf.getState() };
    } catch (error: any) {
      console.error('[msf-console-restart] Failed:', error);
      return { success: false, error: error.message };
    }
  });
}
