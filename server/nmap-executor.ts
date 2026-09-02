import { spawn, exec } from 'child_process';
import { platform } from 'os';

export interface NmapExecutionOptions {
  target: string;
  flags: string[];
  onOutput?: (data: string) => void;
  onError?: (error: string) => void;
  onComplete?: (code: number) => void;
}

export class NmapExecutor {
  private nmapPath: string;
  private activeProcesses: Map<string, any> = new Map();
  private readonly maxConcurrentScans = 5;
  private readonly scanTimeout = 300000; // 5 minutes

  // Whitelist of allowed nmap flags
  private readonly allowedFlags = [
    '-sS', '-sT', '-sU', '-sY', '-sn', '-sA', '-sW', '-sM', '-sF', '-sN', '-sX',
    '-p', '-F', '-T0', '-T1', '-T2', '-T3', '-T4', '-T5',
    '-sV', '-O', '-A', '-sC', '--traceroute', '--version-intensity', '--version-light', '--version-all',
    '--script', '--min-rate', '--max-rate', '--host-timeout', '--top-ports', '--exclude-ports', '--exclude',
    '-f', '-D', '-S', '--spoof-mac', '--data-length', '--randomize-hosts', '--badsum', '--mtu',
    '-oN', '-oX', '-oG', '-oA', '--append-output', '-v', '-vv', '-d', '--reason', '--open',
    '--packet-trace', '--iflist', '--log-errors', '--stats-every', '-6', '-n', '-R', '--system-dns',
    '--dns-servers', '-Pn', '-PS', '-PA', '-PU', '-PY', '-PE', '-PP', '-PM', '-PO', '-PR', '--disable-arp-ping'
  ];

  constructor() {
    // Start with tool name, will be detected
    this.nmapPath = 'nmap';
    this.initializePath();
  }

  // Dynamic nmap path detection
  private async initializePath() {
    this.nmapPath = await this.detectNmapPath();
  }

  private async detectNmapPath(): Promise<string> {
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
      console.log(`[NmapExecutor] Found nmap at: ${foundPath}`);
      return foundPath;
    } catch {
      // Fallback: just use 'nmap' and hope it's in PATH
      console.warn('[NmapExecutor] nmap not found via which/where, using name only');
      return 'nmap';
    }
  }

  private validateTarget(target: string): boolean {
    // Allow: IP addresses, CIDR notation, IP ranges, hostnames
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    const rangeRegex = /^(\d{1,3}\.){3}\d{1,3}-\d{1,3}$/;
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    
    // Check for shell metacharacters
    if (/[;&|`$(){}[\]<>\\]/.test(target)) {
      return false;
    }
    
    return ipRegex.test(target) || cidrRegex.test(target) || rangeRegex.test(target) || hostnameRegex.test(target);
  }

  private validateFlags(flags: string[]): boolean {
    return flags.every(flag => {
      // Check if flag starts with any allowed prefix
      const isAllowed = this.allowedFlags.some(allowed => {
        if (allowed.includes('=')) {
          return flag.startsWith(allowed.split('=')[0]);
        }
        return flag.startsWith(allowed) || flag === allowed;
      });
      
      // Additional check: no shell metacharacters
      if (/[;&|`$(){}[\]<>\\]/.test(flag)) {
        return false;
      }
      
      return isAllowed;
    });
  }

  async checkNmapInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      exec(`${this.nmapPath} --version`, (error) => {
        resolve(!error);
      });
    });
  }

  async executeNmap(options: NmapExecutionOptions): Promise<string> {
    const { target, flags, onOutput, onError, onComplete } = options;
    
    // SECURITY: Validate inputs
    if (!this.validateTarget(target)) {
      throw new Error('Invalid target format. Only IP addresses, CIDR notation, and valid hostnames are allowed.');
    }
    
    if (!this.validateFlags(flags)) {
      throw new Error('Invalid or dangerous flags detected. Only whitelisted nmap flags are allowed.');
    }
    
    // Check concurrent scan limit
    if (this.activeProcesses.size >= this.maxConcurrentScans) {
      throw new Error(`Maximum concurrent scans (${this.maxConcurrentScans}) reached. Please wait for a scan to complete.`);
    }

    // Python validation as safety net
    const fullCommand = `nmap ${flags.join(' ')} ${target}`;
    const pythonValidation = await this.validateWithPython(fullCommand);
    if (!pythonValidation.valid) {
      throw new Error(`Validation failed: ${pythonValidation.message}`);
    }
    
    return new Promise((resolve, reject) => {
      const args = [...flags, target];
      const nmapProcess = spawn(this.nmapPath, args);
      
      // Set timeout
      const timeout = setTimeout(() => {
        nmapProcess.kill('SIGTERM');
        this.activeProcesses.delete(target);
        reject(new Error('Scan timeout exceeded (5 minutes)'));
      }, this.scanTimeout);
      
      let output = '';
      let errorOutput = '';

      nmapProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        if (onOutput) onOutput(text);
      });

      nmapProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        if (onError) onError(text);
      });

      nmapProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (onComplete) onComplete(code || 0);
        
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Nmap exited with code ${code}: ${errorOutput}`));
        }
      });

      nmapProcess.on('error', (error) => {
        reject(error);
      });

      // Store process for potential cancellation
      this.activeProcesses.set(target, nmapProcess);
    });
  }

  cancelScan(target: string): boolean {
    const process = this.activeProcesses.get(target);
    if (process) {
      process.kill('SIGTERM');
      this.activeProcesses.delete(target);
      return true;
    }
    return false;
  }

  setNmapPath(path: string) {
    this.nmapPath = path;
  }

  private async validateWithPython(command: string): Promise<{ valid: boolean; message: string }> {
    return new Promise((resolve) => {
      const pythonScript = platform() === 'win32' 
        ? 'python server/nmap-validator.py'
        : 'python3 server/nmap-validator.py';
      
      exec(`${pythonScript} "${command}"`, (error, stdout, stderr) => {
        if (error) {
          resolve({ valid: false, message: stderr.trim() || 'Validation failed' });
        } else {
          resolve({ valid: true, message: stdout.trim() });
        }
      });
    });
  }
}

export const nmapExecutor = new NmapExecutor();
