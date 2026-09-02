// Modularized Nmap handler - extracted from main.ts
// This is an example of how to refactor the 1269-line main.ts file

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { scanRateLimiter } from './rate-limiter';
import { platformService } from '../platform-service';
import { BoundedOutput } from '../utils/bounded-output';
import { OutputStreamBatcher } from '../utils/output-stream-batcher';

const execAsync = promisify(exec);
const activeScans = new Map<string, any>();
const maxConcurrentScans = 5;
const scanTimeout = 300000; // 5 minutes
// Start with tool name, will be found via PATH or detection
let nmapPath = 'nmap';

// Dynamic nmap path detection
async function detectNmapPath(): Promise<string> {
  const { execSync } = require('child_process');
  
  try {
    // Use 'which' on Unix, 'where' on Windows
    const command = process.platform === 'win32' ? 'where' : 'which';
    const result = execSync(`${command} nmap`, { 
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    
    const foundPath = result.split('\n')[0];
    console.log(`[NmapHandler] Found nmap at: ${foundPath}`);
    return foundPath;
  } catch {
    // Fallback: just use 'nmap' and hope it's in PATH
    console.warn('[NmapHandler] nmap not found via which/where, using name only');
    return 'nmap';
  }
}

// Initialize nmap path on module load
detectNmapPath().then(path => {
  nmapPath = path;
});

// SECURITY: Input validation functions
function validateTarget(target: string): boolean {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  const rangeRegex = /^(\d{1,3}\.){3}\d{1,3}-\d{1,3}$/;
  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (/[;&|`$(){}[\]<>\\]/.test(target)) {
    return false;
  }
  
  return ipRegex.test(target) || cidrRegex.test(target) || rangeRegex.test(target) || hostnameRegex.test(target);
}

function validateFlags(flags: string[]): boolean {
  const allowedFlags = [
    '-sS', '-sT', '-sU', '-sY', '-sn', '-sA', '-sW', '-sM', '-sF', '-sN', '-sX',
    '-p', '-F', '-T0', '-T1', '-T2', '-T3', '-T4', '-T5',
    '-sV', '-O', '-A', '-sC', '--traceroute', '--version-intensity', '--version-light', '--version-all',
    '--script', '--min-rate', '--max-rate', '--host-timeout', '--top-ports', '--exclude-ports', '--exclude',
    '-f', '-D', '-S', '--spoof-mac', '--data-length', '--randomize-hosts', '--badsum', '--mtu',
    '-oN', '-oX', '-oG', '-oA', '--append-output', '-v', '-vv', '-d', '--reason', '--open',
    '--packet-trace', '--iflist', '--log-errors', '--stats-every', '-6', '-n', '-R', '--system-dns',
    '--dns-servers', '-Pn', '-PS', '-PA', '-PU', '-PY', '-PE', '-PP', '-PM', '-PO', '-PR', '--disable-arp-ping'
  ];
  
  return flags.every(flag => {
    if (/[;&|`$(){}[\]<>\\]/.test(flag)) {
      return false;
    }
    return allowedFlags.some(allowed => flag.startsWith(allowed) || flag === allowed);
  });
}

export function registerNmapHandlers(mainWindow: Electron.BrowserWindow | null) {
  // Check if nmap is installed
  ipcMain.handle('check-nmap', async () => {
    try {
      // Get platform info to check WSL2
      const platformInfo = await platformService.getPlatformInfo();
      
      // On Windows, check WSL2 first
      if (platformInfo.isWindows && platformInfo.wsl2Status === 'available') {
        try {
          const { stdout } = await execAsync('wsl bash -c "nmap --version"', { timeout: 5000 });
          const version = stdout.match(/Nmap version ([\d.]+)/)?.[1] || 'unknown';
          return { installed: true, path: 'wsl nmap', version, usedWSL: true };
        } catch (wslError) {
          console.log('[check-nmap] Nmap not found in WSL2');
        }
      }
      
      // Try direct execution (Linux/Mac or Windows fallback)
      try {
        const { stdout } = await execAsync(`"${nmapPath}" --version`, { timeout: 5000 });
        const version = stdout.match(/Nmap version ([\d.]+)/)?.[1] || 'unknown';
        return { installed: true, path: nmapPath, version, usedWSL: false };
      } catch (error) {
        // Try 'nmap' in PATH as fallback
        try {
          const { stdout } = await execAsync('nmap --version', { timeout: 5000 });
          nmapPath = 'nmap';
          const version = stdout.match(/Nmap version ([\d.]+)/)?.[1] || 'unknown';
          return { installed: true, path: 'nmap', version, usedWSL: false };
        } catch (err2) {
          return { installed: false, path: null, version: null, usedWSL: false };
        }
      }
    } catch (error) {
      console.error('[check-nmap] Error:', error);
      return { installed: false, path: null, version: null, usedWSL: false };
    }
  });

  // Set custom nmap path
  ipcMain.handle('set-nmap-path', async (_event, pathToValidate: string) => {
    return new Promise((resolve) => {
      // SECURITY: Validate path before using in exec
      if (!pathToValidate || typeof pathToValidate !== 'string') {
        resolve({ success: false, error: 'Invalid path' });
        return;
      }
      
      // Use spawn instead of exec to avoid shell injection
      const { spawn } = require('child_process');
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

  // Execute nmap scan with rate limiting
  ipcMain.handle('execute-nmap', async (event: IpcMainInvokeEvent, args: { target: string; flags: string[]; scanId: string }) => {
    const { target, flags, scanId } = args;
    
    // RATE LIMITING: Check rate limit
    const rateLimitCheck = scanRateLimiter.check(event.sender.id.toString());
    if (!rateLimitCheck.allowed) {
      return Promise.reject({ 
        success: false, 
        error: `Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds before starting another scan.`,
        scanId 
      });
    }
    
    // SECURITY: Validate inputs
    if (!validateTarget(target)) {
      return Promise.reject({ 
        success: false, 
        error: 'Invalid target format. Only IP addresses, CIDR notation, and valid hostnames are allowed.',
        scanId 
      });
    }
    
    if (!validateFlags(flags)) {
      return Promise.reject({ 
        success: false, 
        error: 'Invalid or dangerous flags detected.',
        scanId 
      });
    }
    
    // Check concurrent scan limit
    if (activeScans.size >= maxConcurrentScans) {
      return Promise.reject({ 
        success: false, 
        error: `Maximum concurrent scans (${maxConcurrentScans}) reached.`,
        scanId 
      });
    }
    
    return new Promise((resolve, reject) => {
      const nmapArgs = [...flags, target];
      const nmapProcess = spawn(nmapPath, nmapArgs);
      
      // Set timeout
      const timeout = setTimeout(() => {
        nmapProcess.kill('SIGTERM');
        activeScans.delete(scanId);
        reject({ success: false, error: 'Scan timeout exceeded (5 minutes)', scanId });
      }, scanTimeout);
      
      activeScans.set(scanId, nmapProcess);
      
      const output = new BoundedOutput();
      const errorOutput = new BoundedOutput(2 * 1024 * 1024);
      const outputBatcher = new OutputStreamBatcher((data, type) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('nmap-output', { scanId, data, type });
        }
      });

      nmapProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output.append(text);
        outputBatcher.push(text, 'stdout');
      });

      nmapProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput.append(text);
        outputBatcher.push(text, 'stderr');
      });

      nmapProcess.on('close', (code) => {
        clearTimeout(timeout);
        activeScans.delete(scanId);
        outputBatcher.dispose();
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('nmap-complete', { scanId, code });
        }
        
        if (code === 0) {
          resolve({ success: true, output: output.toString(), scanId });
        } else {
          reject({ success: false, error: errorOutput.toString() || 'Scan failed', code, scanId });
        }
      });

      nmapProcess.on('error', (error) => {
        outputBatcher.dispose();
        activeScans.delete(scanId);
        reject({ success: false, error: error.message, scanId });
      });
    });
  });

  // Cancel scan
  ipcMain.handle('cancel-scan', async (_event, scanId: string) => {
    const process = activeScans.get(scanId);
    if (process) {
      process.kill('SIGTERM');
      activeScans.delete(scanId);
      return { success: true };
    }
    return { success: false, error: 'Scan not found' };
  });
}

// Export for cleanup
export function cleanupNmapScans() {
  activeScans.forEach((process) => {
    try {
      process.kill('SIGTERM');
    } catch (error) {
      console.error('Failed to kill nmap process:', error);
    }
  });
  activeScans.clear();
}
