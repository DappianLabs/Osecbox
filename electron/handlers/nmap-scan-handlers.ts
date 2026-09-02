/**
 * Nmap Scan Handlers
 * Handles nmap-specific operations (check, set path, execute, cancel)
 */

import { spawn, exec } from 'child_process';
import { platformService } from '../platform-service';
import { toolExecutionService } from '../services/tool-execution-service';
import { OutputStreamBatcher } from '../utils/output-stream-batcher';

let nmapPath = 'nmap'; // Default path

export function getNmapPath(): string {
  return nmapPath;
}

export function registerNmapScanHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void,
  getMainWindow: () => any,
  activeScans: Map<string, any>
) {
  console.log('[NmapScanHandlers] Registering nmap scan handlers...');
  
  // Check if nmap is installed
  registerIPCHandler('check-nmap', async () => {
    console.log('[check-nmap] ===== HANDLER CALLED =====');
    console.log('[check-nmap] Starting nmap check...');
    
    // FIX: nmap is a Linux tool, so requiresLinux should be TRUE
    const toolCheck = await platformService.checkToolAvailability('nmap', true);
    const platformInfo = await platformService.getPlatformInfo();
    const wslUnavailableReason = platformInfo.isWindows && platformInfo.wsl2Status !== 'available'
      ? `WSL2 unavailable (${platformInfo.wsl2Status}): ${platformInfo.wsl2Error || 'the Linux runtime could not execute a command'}`
      : undefined;
    
    console.log('[check-nmap] Platform service result:', JSON.stringify(toolCheck, null, 2));
    
    if (toolCheck.available) {
      const result = { 
        installed: true, 
        path: toolCheck.path, 
        version: toolCheck.version,
        usedWSL: toolCheck.usedWSL 
      };
      console.log('[check-nmap] Returning SUCCESS:', JSON.stringify(result, null, 2));
      return result;
    }
    
    console.log('[check-nmap] Tool not available, evaluating fallback...');

    // Nmap is a Linux-required tool. On Windows, every WSL state other than
    // available is a runtime block; a native Windows nmap cannot make the
    // scanner executable and must never turn the UI green.
    if (platformInfo.isWindows && platformInfo.wsl2Status !== 'available') {
      return {
        installed: false,
        path: null,
        version: null,
        usedWSL: true,
        error: wslUnavailableReason || 'WSL2 is unavailable for Linux tool execution',
      };
    }

    if (platformInfo.isWindows && platformInfo.wsl2Status === 'available') {
      return {
        installed: false,
        path: null,
        version: null,
        usedWSL: true,
        error: 'Nmap was not found in the selected WSL2 distribution',
      };
    }
    
    // Fallback to native detection only on non-Windows hosts.
    return new Promise((resolve) => {
      exec(`"${nmapPath}" --version`, (error, stdout) => {
        if (error) {
          // Try 'nmap' in PATH as fallback
          exec('nmap --version', (err2, stdout2) => {
            if (err2) {
              resolve({ installed: false, path: null, version: null, usedWSL: false, error: wslUnavailableReason });
            } else {
              nmapPath = 'nmap';
              const version = stdout2.match(/Nmap version ([\d.]+)/)?.[1] || 'unknown';
              resolve({ installed: true, path: 'nmap', version, usedWSL: false });
            }
          });
        } else {
          const version = stdout.match(/Nmap version ([\d.]+)/)?.[1] || 'unknown';
          resolve({ installed: true, path: nmapPath, version, usedWSL: false });
        }
      });
    });
  });

  // Set custom nmap path
  registerIPCHandler('set-nmap-path', async (_event, pathToValidate: string) => {
    // SECURITY: Validate path before using
    if (!pathToValidate || typeof pathToValidate !== 'string') {
      return { success: false, error: 'Invalid path' };
    }
    
    return new Promise((resolve) => {
      // Use spawn instead of exec to avoid shell injection
      const proc = spawn(pathToValidate, ['--version'], { shell: false });
      
      let output = '';
      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      
      proc.on('close', (code: number) => {
        if (code === 0 && output.includes('Nmap')) {
          nmapPath = pathToValidate;
          resolve({ success: true });
        } else {
          resolve({ success: false, error: 'Invalid nmap path' });
        }
      });
      
      proc.on('error', () => {
        resolve({ success: false, error: 'Invalid nmap path' });
      });
    });
  });

  // Execute nmap scan with settings integration
  registerIPCHandler('execute-nmap', async (_event, args: { 
    target: string; 
    flags: string[]; 
    scanId: string;
    captureOutput?: boolean;
  }) => {
    const { target, flags, scanId } = args;
    
    let outputBatcher: OutputStreamBatcher | null = null;
    try {
      const mainWindow = getMainWindow();
      outputBatcher = new OutputStreamBatcher((data, type) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('nmap-output', { scanId, data, type });
        }
      });
      const result = await toolExecutionService.executeNmap(target, flags, scanId, {
        onOutput: (data, type) => {
          outputBatcher?.push(data, type);
        },
        captureOutput: args.captureOutput !== false,
        onComplete: (code) => {
          outputBatcher?.flush();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('nmap-complete', { scanId, code });
          }
        }
      });
      outputBatcher?.dispose();
      
      return { success: result.success, output: result.output, error: result.error, scanId };
    } catch (error: any) {
      outputBatcher?.dispose();
      return { success: false, error: error.message, scanId };
    }
  });

  // Cancel scan
  registerIPCHandler('cancel-scan', async (_event, scanId: string) => {
    // Scheduler/automation scans are owned by ToolExecutionService rather
    // than the legacy main-process activeScans map. Record cancellation there
    // first so a pending validation cannot spawn after Stop is pressed.
    const cancelledTool = toolExecutionService.cancelProcess(scanId);
    const process = activeScans.get(scanId);
    if (process) {
      try {
        process.kill('SIGTERM');
      } catch {
        // The process may have exited between lookup and cancellation.
      }
      activeScans.delete(scanId);
      return { success: true, cancelledTool: true };
    }
    return cancelledTool
      ? { success: true }
      : { success: false, error: 'Scan not found' };
  });
}
