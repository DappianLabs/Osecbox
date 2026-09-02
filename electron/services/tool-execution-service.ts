/**
 * Tool Execution Service
 * Executes pentesting tools using settings from SettingsService
 * Ensures all tool execution respects user configuration
 */

import { execFile, spawn, ChildProcess } from 'child_process';
import { settingsService } from './settings-service';
import { platformService } from '../platform-service';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { BoundedOutput } from '../utils/bounded-output';
import {
  buildWslPath,
  shellQuotePathSegment,
  toWslPath,
} from '../utils/wsl-path';

const execFileAsync = promisify(execFile);

export interface ExecutionOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  /** Stream output to the UI without retaining a second full copy. */
  captureOutput?: boolean;
  customFlags?: string; // Custom command-line flags
  onOutput?: (data: string, type: 'stdout' | 'stderr') => void;
  onComplete?: (code: number | null, signal: string | null) => void;
  onError?: (error: Error) => void;
}

export interface ScanResult {
  success: boolean;
  output?: string;
  /** Captured stderr is returned separately so callers can parse diagnostics and findings from both streams. */
  stderr?: string;
  error?: string;
  code?: number;
  duration?: number;
}

class ToolExecutionService {
  private activeProcesses = new Map<string, ChildProcess>();
  // A process id can be reused after Stop -> Start. Keep an identity token so
  // late close/error events from the old child cannot delete or reset the new
  // child that now owns the same id.
  private processTokens = new Map<string, symbol>();
  // A cancel request can arrive while platform/tool validation is still
  // awaiting. Keep that intent until executeCommand reaches the spawn point so
  // a process cannot start after the user already pressed Stop.
  private cancellationRequests = new Set<string>();
  private cancellationTimers = new Map<string, NodeJS.Timeout>();
  private forceKillTimers = new Map<string, { process: ChildProcess; timer: NodeJS.Timeout }>();
  private toolAvailabilityCache = new Map<string, {
    expiresAt: number;
    result: { exists: boolean; error?: string };
  }>();

  private validateCustomFlags(flags: string): void {
    // Values commonly include Linux paths, URLs, ports, commas, or header
    // separators. They are still passed as argv entries (never through a
    // native shell), so reject shell metacharacters while allowing those
    // legitimate flag-value characters.
    if (!/^[-a-zA-Z0-9_./:=+@%,\s]+$/.test(flags)) {
      throw new Error('Invalid custom flags: contains illegal characters');
    }
    if (/[;&|`$(){}[\]<>\\]/.test(flags)) {
      throw new Error('Invalid custom flags: contains shell metacharacters');
    }
  }

  private async toolMissingResult(toolPath: string, label: string): Promise<ScanResult | null> {
    const check = await this.validateToolExists(toolPath);
    if (check.exists) return null;

    return {
      success: false,
      error: `${label} was not found in the selected execution environment${check.error ? `: ${check.error}` : '.'}\n\nInstall it in WSL2/Linux or configure its executable path in Settings, then use Recheck Tools.`,
    };
  }

  /**
   * Verify DNS in the exact runtime that will execute a network tool. This is
   * intentionally a read-only lookup: it never edits resolver or networking
   * configuration and it returns a machine-specific remediation when the
   * failure is outside OsecBox's control.
   */
  private async dnsPreflightFailure(
    label: string,
    target?: string,
    options: { allowTargetUnresolved?: boolean } = {},
  ): Promise<ScanResult | null> {
    const diagnostic = await platformService.diagnoseDns(target);
    if (diagnostic.ok || (options.allowTargetUnresolved && diagnostic.status === 'target-unresolved')) {
      return null;
    }

    return {
      success: false,
      error: `${label} was not started because OsecBox could not verify DNS in the selected tool runtime.\n\n${platformService.formatDnsFailure(diagnostic)}`,
    };
  }

  /**
   * Resolve a configured file/directory in the same execution environment as
   * the tool. On Windows the Node process sees NTFS while the tool sees WSL's
   * Linux filesystem, so fs.access() alone gives a false "missing" result.
   */
  private async resolveResourcePath(
    resourcePath: string,
    kind: 'file' | 'directory',
  ): Promise<string | null> {
    const configured = typeof resourcePath === 'string' ? resourcePath.trim() : '';
    if (!configured) return null;

    const strategy = await platformService.getExecutionStrategy(true);
    if (!strategy.shouldUseWSL) {
      try {
        const stats = await fs.promises.stat(configured);
        return (kind === 'file' ? stats.isFile() : stats.isDirectory()) ? configured : null;
      } catch {
        return null;
      }
    }

    const normalized = toWslPath(configured).replace(/^~(?=\/|$)/, '$HOME');
    const basename = path.posix.basename(normalized.replace(/^\$HOME\//, ''));
    const candidates = [
      normalized,
      ...(basename ? [
        `/usr/share/wordlists/${basename}`,
        `/usr/share/seclists/Discovery/DNS/${basename}`,
        `/usr/share/dirb/wordlists/${basename}`,
        `/usr/local/share/wordlists/${basename}`,
        `/opt/wordlists/${basename}`,
        `$HOME/wordlists/${basename}`,
        `$HOME/${basename}`,
      ] : []),
    ].filter(Boolean);
    const uniqueCandidates = [...new Set(candidates)];
    const testFlag = kind === 'file' ? 'f' : 'd';
    const candidateArgs = uniqueCandidates.map(shellQuotePathSegment).join(' ');
    const script = `for candidate in ${candidateArgs}; do if [ -${testFlag} "$candidate" ]; then printf '%s' "$candidate"; exit 0; fi; done`;

    try {
      const result = await execFileAsync(
        strategy.commandPrefix[0],
        [...strategy.commandPrefix.slice(1), script],
        { timeout: 5000, windowsHide: true, encoding: 'utf8' },
      );
      const resolved = `${result.stdout || ''}`.split(/\r?\n/).map(line => line.trim()).find(Boolean);
      return resolved || null;
    } catch {
      return null;
    }
  }

  /**
   * Execute nmap with user settings
   */
  async executeNmap(
    target: string, 
    flags: string[], 
    scanId: string, 
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('nmap');
    const settings = settingsService.getSettings();

    const unavailable = await this.toolMissingResult(config.path, 'Nmap');
    if (unavailable) return unavailable;
    
    // Validate target
    if (!this.validateTarget(target)) {
      throw new Error('Invalid target format');
    }

    // Validate flags
    if (!this.validateNmapFlags(flags)) {
      throw new Error('Invalid or dangerous flags detected');
    }

    const dnsFailure = await this.dnsPreflightFailure('Nmap', target);
    if (dnsFailure) return dnsFailure;

    // Check concurrent scan limit
    const activeNmapScans = Array.from(this.activeProcesses.keys())
      .filter(id => id.startsWith('nmap-')).length;
    
    if (activeNmapScans >= settings.maxConcurrentScans) {
      throw new Error(`Maximum concurrent scans (${settings.maxConcurrentScans}) reached`);
    }

    const args = [...flags, target];
    const timeout = options.timeout || config.timeout;

    return this.executeCommand(config.path, args, scanId, {
      ...options,
      timeout,
      env: {
        ...process.env,
        ...options.env
      } as Record<string, string>
    });
  }

  /**
   * Execute subfinder with user settings
   */
  async executeSubfinder(
    domain: string,
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('subfinder');
    
    // Validate tool exists before execution
    const toolCheck = await this.validateToolExists(config.path);
    if (!toolCheck.exists) {
      return {
        success: false,
        error: `Subfinder not found in PATH.\n\n` +
               `📦 Install it:\n` +
               `• go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest\n` +
               `• Or: sudo apt install subfinder\n\n` +
               `🔧 If already installed in a custom location:\n` +
               `1. Go to Settings → Platform & WSL2\n` +
               `2. Add the directory to "Extra Paths"\n` +
               `   Example: /home/kali/tools or /home/kali/go/bin\n` +
               `3. Restart the application`
      };
    }
    
    if (!this.validateDomain(domain)) {
      throw new Error('Invalid domain format');
    }

    const dnsFailure = await this.dnsPreflightFailure('Subfinder', domain, { allowTargetUnresolved: true });
    if (dnsFailure) return dnsFailure;

    const args = ['-d', domain, '-silent'];
    
    // Apply user settings
    if (config.allSources) {
      args.push('-all');
    }
    
    if (config.recursive) {
      args.push('-recursive');
    }
    
    // Add custom flags if provided
    if (options.customFlags) {
      this.validateCustomFlags(options.customFlags);
      const customArgs = options.customFlags.trim().split(/\s+/);
      args.push(...customArgs);
    }

    return this.executeCommand(config.path, args, toolId, {
      ...options,
      timeout: config.timeout
    });
  }

  /**
   * Execute amass with user settings
   */
  async executeAmass(
    domain: string,
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('amass');
    
    // Validate tool exists before execution
    const toolCheck = await this.validateToolExists(config.path);
    if (!toolCheck.exists) {
      return {
        success: false,
        error: `Amass not found in PATH.\n\n` +
               `📦 Install it:\n` +
               `• go install -v github.com/owasp-amass/amass/v4/...@master\n` +
               `• Or: sudo apt install amass\n\n` +
               `🔧 If already installed in a custom location:\n` +
               `1. Go to Settings → Platform & WSL2\n` +
               `2. Add the directory to "Extra Paths"\n` +
               `   Example: /home/kali/tools or /home/kali/go/bin\n` +
               `3. Restart the application`
      };
    }
    
    if (!this.validateDomain(domain)) {
      throw new Error('Invalid domain format');
    }

    const dnsFailure = await this.dnsPreflightFailure('Amass', domain, { allowTargetUnresolved: true });
    if (dnsFailure) return dnsFailure;

    const args = ['enum', '-d', domain];
    
    // Apply user settings
    if (config.mode === 'passive') {
      args.push('-passive');
    } else {
      args.push('-active');
    }
    
    if (config.bruteForce) {
      args.push('-brute');
    }
    
    // Add custom flags if provided
    if (options.customFlags) {
      this.validateCustomFlags(options.customFlags);
      const customArgs = options.customFlags.trim().split(/\s+/);
      args.push(...customArgs);
    }

    return this.executeCommand(config.path, args, toolId, {
      ...options,
      timeout: config.timeout
    });
  }

  /**
   * Execute ffuf with user settings
   */
  async executeFFUF(
    domain: string,
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('ffuf');
    
    // Validate tool exists before execution
    const toolCheck = await this.validateToolExists(config.path);
    if (!toolCheck.exists) {
      return {
        success: false,
        error: `FFUF not found in PATH.\n\n` +
               `📦 Install it:\n` +
               `• go install github.com/ffuf/ffuf/v2@latest\n` +
               `• Or: sudo apt install ffuf\n\n` +
               `🔧 If already installed in a custom location:\n` +
               `1. Go to Settings → Platform & WSL2\n` +
               `2. Add the directory to "Extra Paths"\n` +
               `   Example: /home/kali/tools or /home/kali/go/bin\n` +
               `3. Restart the application`
      };
    }
    
    if (!this.validateDomain(domain)) {
      throw new Error('Invalid domain format');
    }

    const dnsFailure = await this.dnsPreflightFailure('FFUF', domain, { allowTargetUnresolved: true });
    if (dnsFailure) return dnsFailure;

    // Validate the wordlist in the environment that will execute ffuf. On
    // Windows this is normally WSL, not the Electron host filesystem.
    // A blank renderer setting means "auto-detect". Resolve the standard
    // filename inside the selected runtime instead of failing before WSL can
    // search its mounted wordlist locations.
    const configuredWordlist = typeof config.wordlist === 'string' && config.wordlist.trim()
      ? config.wordlist.trim()
      : 'subdomains-top1million-5000.txt';
    const wordlist = await this.resolveResourcePath(configuredWordlist, 'file');
    if (!wordlist) {
      return {
        success: false,
        error: `Wordlist not found in the selected execution environment: ${configuredWordlist}\n\nConfigure a Linux/WSL wordlist path in Settings, or install SecLists/dirb wordlists.`
      };
    }

    const args = [
      '-w', wordlist,
      '-u', `https://FUZZ.${domain}`,
      '-mc', '200',
      '-t', config.threads.toString()
    ];
    
    // Add custom flags if provided
    if (options.customFlags) {
      this.validateCustomFlags(options.customFlags);
      const customArgs = options.customFlags.trim().split(/\s+/);
      args.push(...customArgs);
    }

    return this.executeCommand(config.path, args, toolId, {
      ...options,
      timeout: config.timeout
    });
  }

  /**
   * Execute assetfinder with user settings
   */
  async executeAssetfinder(
    domain: string,
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('assetfinder');
    
    // Validate tool exists before execution
    const toolCheck = await this.validateToolExists(config?.path || 'assetfinder');
    if (!toolCheck.exists) {
      return {
        success: false,
        error: `Assetfinder not found in PATH.\n\n` +
               `📦 Install it:\n` +
               `• go install github.com/tomnomnom/assetfinder@latest\n` +
               `• Or: sudo apt install assetfinder\n\n` +
               `🔧 If already installed in a custom location:\n` +
               `1. Go to Settings → Platform & WSL2\n` +
               `2. Add the directory to "Extra Paths"\n` +
               `   Example: /home/kali/tools or /home/kali/go/bin\n` +
               `3. Restart the application`
      };
    }
    
    if (!this.validateDomain(domain)) {
      throw new Error('Invalid domain format');
    }

    const dnsFailure = await this.dnsPreflightFailure('Assetfinder', domain, { allowTargetUnresolved: true });
    if (dnsFailure) return dnsFailure;

    const args = ['--subs-only', domain];
    
    // Add custom flags if provided
    if (options.customFlags) {
      this.validateCustomFlags(options.customFlags);
      const customArgs = options.customFlags.trim().split(/\s+/);
      args.push(...customArgs);
    }

    return this.executeCommand(config?.path || 'assetfinder', args, toolId, {
      ...options,
      timeout: config?.timeout || 300000
    });
  }

  /**
   * Execute sublist3r with user settings
   */
  async executeSublist3r(
    domain: string,
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('sublist3r');
    
    // Validate tool exists before execution
    const toolCheck = await this.validateToolExists(config?.path || 'sublist3r');
    if (!toolCheck.exists) {
      return {
        success: false,
        error: `Sublist3r not found in PATH.\n\n` +
               `📦 Install it:\n` +
               `• git clone https://github.com/aboul3la/Sublist3r.git\n` +
               `• cd Sublist3r && pip install -r requirements.txt\n` +
               `• sudo ln -s $(pwd)/sublist3r.py /usr/local/bin/sublist3r\n` +
               `• Or: sudo apt install sublist3r\n\n` +
               `🔧 If already installed in a custom location:\n` +
               `1. Go to Settings → Platform & WSL2\n` +
               `2. Add the directory to "Extra Paths"\n` +
               `   Example: /home/kali/tools or /opt/Sublist3r\n` +
               `3. Restart the application`
      };
    }
    
    if (!this.validateDomain(domain)) {
      throw new Error('Invalid domain format');
    }

    const dnsFailure = await this.dnsPreflightFailure('Sublist3r', domain, { allowTargetUnresolved: true });
    if (dnsFailure) return dnsFailure;

    const args = ['-d', domain];
    
    // Add custom flags if provided
    if (options.customFlags) {
      this.validateCustomFlags(options.customFlags);
      const customArgs = options.customFlags.trim().split(/\s+/);
      args.push(...customArgs);
    }

    return this.executeCommand(config?.path || 'sublist3r', args, toolId, {
      ...options,
      timeout: config?.timeout || 300000
    });
  }

  /**
   * Execute nikto with user settings
   */
  async executeNikto(
    target: string,
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('nikto');

    const unavailable = await this.toolMissingResult(config.path, 'Nikto');
    if (unavailable) return unavailable;
    
    if (!this.validateTarget(target)) {
      throw new Error('Invalid target format');
    }

    const dnsFailure = await this.dnsPreflightFailure('Nikto', target);
    if (dnsFailure) return dnsFailure;

    const args = ['-h', target, '-Format', 'txt'];
    
    // Apply user settings
    if (config.ssl) {
      args.push('-ssl');
    }
    
    if (config.aggressive) {
      args.push('-evasion', '1');
    }

    return this.executeCommand(config.path, args, toolId, {
      ...options,
      timeout: config.timeout
    });
  }

  /**
   * Execute nuclei with user settings
   */
  async executeNuclei(
    target: string,
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('nuclei');

    const unavailable = await this.toolMissingResult(config.path, 'Nuclei');
    if (unavailable) return unavailable;
    
    if (!this.validateTarget(target)) {
      throw new Error('Invalid target format');
    }

    const dnsFailure = await this.dnsPreflightFailure('Nuclei', target);
    if (dnsFailure) return dnsFailure;

    const args = [
      '-u', target,
      '-c', config.concurrency.toString(),
      '-rl', config.rateLimit.toString()
    ];
    
    // Add templates path only when it exists in the tool's execution
    // environment. A Windows fs.access() cannot validate a WSL directory.
    if (config.templatesPath) {
      const templatesPath = await this.resolveResourcePath(config.templatesPath, 'directory');
      if (templatesPath) {
        args.push('-t', templatesPath);
      }
    }
    
    // Auto-update templates if enabled
    if (config.autoUpdate) {
      args.push('-update-templates');
    }

    return this.executeCommand(config.path, args, toolId, {
      ...options,
      timeout: options.timeout || config.timeout,
    });
  }

  /**
   * Execute gobuster with user settings
   */
  async executeGobuster(
    target: string,
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('gobuster');

    const unavailable = await this.toolMissingResult(config.path, 'Gobuster');
    if (unavailable) return unavailable;
    
    if (!this.validateTarget(target)) {
      throw new Error('Invalid target format');
    }

    const dnsFailure = await this.dnsPreflightFailure('Gobuster', target);
    if (dnsFailure) return dnsFailure;

    // Keep the blank setting portable: resolve the common filename in WSL or
    // the native working directory rather than requiring a machine-specific
    // absolute path in the saved workspace.
    const configuredWordlist = typeof config.wordlist === 'string' && config.wordlist.trim()
      ? config.wordlist.trim()
      : 'common.txt';
    const wordlist = await this.resolveResourcePath(configuredWordlist, 'file');
    if (!wordlist) {
      throw new Error(`Wordlist not found in the selected execution environment: ${configuredWordlist}`);
    }

    const args = [
      'dir',
      '-u', target,
      '-w', wordlist,
      '-t', config.threads.toString(),
      '--timeout', `${config.timeout}s`
    ];
    
    if (config.followRedirects) {
      args.push('-r');
    }

    return this.executeCommand(config.path, args, toolId, {
      ...options,
      timeout: options.timeout || config.timeout * 1000,
    });
  }

  /**
   * Execute msfconsole with user settings
   */
  async executeMsfconsole(
    commands: string[],
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('msfconsole');
    const unavailable = await this.toolMissingResult(config.path, 'Metasploit console');
    if (unavailable) return unavailable;
    
    const args = ['-q', '-x', commands.join('; ')];

    return this.executeCommand(config.path, args, toolId, options);
  }

  /**
   * Execute msfvenom with user settings
   */
  async executeMsfvenom(
    payload: string,
    format: string,
    outputFile: string,
    toolId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    await settingsService.waitUntilReady();
    const config = settingsService.getToolConfig('msfvenom');
    const unavailable = await this.toolMissingResult(config.path, 'MSFVenom');
    if (unavailable) return unavailable;
    
    if (!config.lhost) {
      throw new Error('LHOST not configured in settings');
    }

    const args = [
      '-p', payload,
      `LHOST=${config.lhost}`,
      `LPORT=${config.lport}`,
      '-f', format,
      '-o', outputFile
    ];

    return this.executeCommand(config.path, args, toolId, options);
  }

  /**
   * Generic command execution with proper error handling and timeout
   */
  private async executeCommand(
    command: string,
    args: string[],
    processId: string,
    options: ExecutionOptions = {}
  ): Promise<ScanResult> {
    return new Promise(async (resolve, reject) => {
      const startTime = Date.now();
      
      try {
        // Get execution strategy (WSL2 wrapping if needed)
        const strategy = await platformService.getExecutionStrategy(true);
        
        let actualCommand: string;
        let actualArgs: string[];
        
         if (strategy.shouldUseWSL) {
          // Safe escaping + PATH injection
          const { settingsService } = await import('./settings-service');
          const settings = settingsService.getSettings();
          
          // Build comprehensive PATH with common tool locations
          // ⚠️ DON'T use $PATH - it contains Windows paths with parentheses that break bash
          const extraPaths = settings.wsl2ExtraPaths || [];
          const pathString = buildWslPath(extraPaths);
          
          // 🔒 Validate command name (prevent injection)
          if (!/^[a-zA-Z0-9._/-]+$/.test(command)) {
            throw new Error(`Invalid command name: ${command}`);
          }
          
          // 🔒 Escape args safely using single-quote strategy
          const escapeArg = (arg: string): string => {
            // If no special chars, return as-is
            if (!/[\s"'$`\\!|&;<>(){}[\]*?~]/.test(arg)) {
              return arg;
            }
            // Escape single quotes and wrap in single quotes
            return `'${arg.replace(/'/g, "'\\''")}'`;
          };
          
          const escapedArgs = args.map(escapeArg).join(' ');
          
          // Build full command with PATH injection (NO QUOTES around pathString)
          const fullCommand = `export PATH=${pathString}; ${command} ${escapedArgs}`;
          
          // commandPrefix may target a configured distro/user or the default WSL distro.
          // spawn() receives the prefix as arguments and appends the complete command.
          actualCommand = strategy.commandPrefix[0]; // 'wsl'
          actualArgs = [
            ...strategy.commandPrefix.slice(1), // ['-d', 'Ubuntu', '-u', 'kali', 'bash', '-lc']
            fullCommand // Single string argument for bash -lc
          ];
          
          console.log(`[ToolExecution] WSL execution prepared: ${command} (${args.length} args)`);
        } else {
          // Native execution
          actualCommand = command;
          actualArgs = args;
         }

        if (this.cancellationRequests.has(processId)) {
          this.clearCancellationRequest(processId);
          resolve({
            success: false,
            error: 'Process cancelled before it started',
          });
          return;
        }

        if (this.activeProcesses.has(processId)) {
          resolve({
            success: false,
            error: `A process with id ${processId} is already running`,
          });
          return;
        }

        // This output is rendered into an already-idle shell PTY. Start on a
        // fresh line so it never overwrites the shell's live prompt, and only
        // emit it after the cancellation gate has allowed the spawn.
        if (options.onOutput) {
          const displayCommand = [command, ...args].join(' ');
          options.onOutput(`\r\n$ ${displayCommand}\r\n`, 'stdout');
        }

        console.log(`[ToolExecution] Executing:`, actualCommand);
        console.log(`[ToolExecution] Starting ${actualCommand} with ${actualArgs.length} args`);

        const childProcess = spawn(actualCommand, actualArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...options.env
          },
          cwd: options.cwd
        });

        const processToken = Symbol(processId);
        this.activeProcesses.set(processId, childProcess);
        this.processTokens.set(processId, processToken);

        const ownsProcess = () => this.processTokens.get(processId) === processToken;
        let settled = false;
        let completionNotified = false;

        const captureOutput = options.captureOutput !== false;
        const output = captureOutput ? new BoundedOutput() : null;
        const errorOutput = new BoundedOutput(2 * 1024 * 1024);

        // Set up timeout
        let timeoutHandle: NodeJS.Timeout | null = null;
        if (options.timeout && options.timeout > 0) {
          timeoutHandle = setTimeout(() => {
            if (settled) return;
            try {
              childProcess.kill('SIGTERM');
            } catch {
              // The child may have exited between the timeout and kill call.
            }
            this.scheduleForceKill(processId, childProcess);
            settled = true;
            reject(new Error(`Command timeout after ${options.timeout}ms`));
          }, options.timeout);
        }

        // Handle stdout
        childProcess.stdout?.on('data', (data: any) => {
          const text = data.toString();
          output?.append(text);
          options.onOutput?.(text, 'stdout');
        });

        // Handle stderr
        childProcess.stderr?.on('data', (data: any) => {
          const text = data.toString();
          errorOutput.append(text);
          options.onOutput?.(text, 'stderr');
        });

        // Handle process completion
        childProcess.on('close', (code: any, signal: any) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          // Only the current generation may mutate the shared process maps.
          // An older child can close after a fast Stop -> Start and must not
          // remove the replacement process or its cancellation state.
          if (ownsProcess()) {
            this.activeProcesses.delete(processId);
            this.processTokens.delete(processId);
            this.clearForceKillTimer(processId, childProcess);
            this.clearCancellationRequest(processId);
          }
          const duration = Date.now() - startTime;

          if (!completionNotified) {
            completionNotified = true;
            options.onComplete?.(code, signal);
          }

          if (settled) return;
          settled = true;

          const stdoutText = output?.toString() || '';
          const stderrText = errorOutput.toString();
          if (code === 0) {
            resolve({
              success: true,
              output: stdoutText,
              stderr: stderrText || undefined,
              duration
            });
          } else {
            resolve({
              success: false,
              output: stdoutText,
              stderr: stderrText || undefined,
              error: stderrText || `Process exited with code ${code}`,
              code,
              duration
            });
          }
        });

        // Handle process errors
        childProcess.on('error', (error: any) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          if (ownsProcess()) {
            this.activeProcesses.delete(processId);
            this.processTokens.delete(processId);
            this.clearForceKillTimer(processId, childProcess);
            this.clearCancellationRequest(processId);
          }
          options.onError?.(error);
          
          // Provide user-friendly error messages
          let errorMessage = error.message;
          if (error.code === 'ENOENT') {
            errorMessage = `Tool not found: ${actualCommand}\n\nThe tool may not be installed or not in your system PATH.\nPlease install it or configure the correct path in Settings.`;
          } else if (error.code === 'EACCES') {
            errorMessage = `Permission denied: ${actualCommand}\n\nCheck file permissions or try running with appropriate privileges.`;
          }
          
          if (!settled) {
            settled = true;
            reject(new Error(errorMessage));
          }
        });

      } catch (error: any) {
        this.clearCancellationRequest(processId);
        reject(new Error(`Execution setup failed: ${error.message}`));
      }
    });
  }

  /**
   * Validate that a tool exists and is executable
   */
  private async validateToolExists(toolPath: string): Promise<{ exists: boolean; error?: string }> {
    const cached = this.toolAvailabilityCache.get(toolPath);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result };
    }

    return new Promise(async (resolve) => {
      try {
        const platformInfo = await platformService.getPlatformInfo();
        if (platformInfo.isWindows && platformInfo.wsl2Status !== 'available') {
          resolve({
            exists: false,
            error: `WSL2 unavailable${platformInfo.wsl2Error ? `: ${platformInfo.wsl2Error}` : ''}`,
          });
          return;
        }

        // Get execution strategy for proper command construction
        const strategy = await platformService.getExecutionStrategy(true);
        
        let actualCommand: string;
        let actualArgs: string[];
        
        if (strategy.shouldUseWSL) {
          // Secure validation with proper escaping
          const { validateCommandName } = await import('../utils/validation');
          const { settingsService } = await import('./settings-service');
          await settingsService.waitUntilReady();
          const settings = settingsService.getSettings();
          
          // Validate tool name
          const validation = validateCommandName(toolPath);
          if (!validation.valid) {
            resolve({ exists: false, error: validation.error });
            return;
          }
          
          const extraPaths = settings.wsl2ExtraPaths || [];
          const pathString = buildWslPath(extraPaths);
          
          // Build validation command
          const fullCommand = `export PATH=${pathString}; ${shellQuotePathSegment(toolPath)} --version`;
          
          actualCommand = strategy.commandPrefix[0];
          actualArgs = [
            ...strategy.commandPrefix.slice(1),
            fullCommand
          ];
        } else {
          // Native: toolPath --version
          actualCommand = toolPath;
          actualArgs = ['--version'];
        }
        
        console.log(`[ToolValidation] Checking:`, actualCommand);
            console.log(`[ToolValidation] Running ${actualCommand} with ${actualArgs.length} args`);
        
        const checkProcess = spawn(actualCommand, actualArgs, { 
          stdio: 'pipe',
          timeout: 5000 
        });
        
        let resolved = false;
        const errorOutput = new BoundedOutput(256 * 1024);
        const finish = (result: { exists: boolean; error?: string }) => {
          if (resolved) return;
          resolved = true;
          this.toolAvailabilityCache.set(toolPath, {
            // Cache failures briefly so installing a tool can recover quickly.
            expiresAt: Date.now() + (result.exists ? 30_000 : 5_000),
            result,
          });
          resolve(result);
        };
        
        checkProcess.stderr?.on('data', (data) => {
          errorOutput.append(data.toString());
        });
        
        checkProcess.on('error', (error: any) => {
          if (!resolved) {
            console.log(`[ToolValidation] Error for ${toolPath}:`, error.message);
            if (error.code === 'ENOENT') {
              finish({ exists: false, error: 'Tool not found in PATH' });
            } else {
              finish({ exists: false, error: error.message });
            }
          }
        });
        
        checkProcess.on('close', (code) => {
          if (!resolved) {
            console.log(`[ToolValidation] ${toolPath} exited with code ${code}`);
            const errorText = errorOutput.toString();
            if (errorText) {
              console.log(`[ToolValidation] stderr received (${errorText.length} chars)`);
            }
            // A real executable may legitimately return non-zero for a version
            // probe, but shell exit 127 and the standard command-not-found
            // messages mean the configured binary is absent. The old code
            // treated every WSL `bash -c` close as present, which made missing
            // tools look installed until the actual scan failed.
            const missing = code === 127 || /command not found|no such file or directory|not recognized/i.test(errorText);
            finish(missing
              ? { exists: false, error: 'Tool not found in the selected execution environment' }
              : { exists: true });
          }
        });
        
        // Timeout fallback (reduced from 5s to 2s for faster validation)
        setTimeout(() => {
          if (!resolved) {
            checkProcess.kill();
            console.log(`[ToolValidation] Timeout for ${toolPath}`);
            finish({ exists: false, error: 'Validation timeout' });
          }
        }, 2000);
      } catch (error: any) {
        console.log(`[ToolValidation] Exception for ${toolPath}:`, error.message);
        const result = { exists: false, error: error.message };
        this.toolAvailabilityCache.set(toolPath, { expiresAt: Date.now() + 5_000, result });
        resolve(result);
      }
    });
  }

  /**
   * Cancel a running process
   */
  cancelProcess(processId: string): boolean {
    const process = this.activeProcesses.get(processId);
    if (process) {
      // The child is already registered, so a second process with the same id
      // must not inherit a stale pending-cancel request after Stop -> Start.
      this.clearCancellationRequest(processId);
      this.activeProcesses.delete(processId);
      this.processTokens.delete(processId);
      try {
        process.kill('SIGTERM');
      } catch {
        // The process may have exited between lookup and kill.
      }
      this.scheduleForceKill(processId, process);
      return true;
    }

    // The process may still be resolving its platform/tool strategy. Record
    // the cancellation so it cannot spawn after the user pressed Stop.
    this.requestCancellation(processId);
    return true;
  }

  private requestCancellation(processId: string): void {
    this.cancellationRequests.add(processId);
    const existingTimer = this.cancellationTimers.get(processId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      this.cancellationRequests.delete(processId);
      this.cancellationTimers.delete(processId);
    }, 60_000);
    this.cancellationTimers.set(processId, timer);
  }

  private clearCancellationRequest(processId: string): void {
    this.cancellationRequests.delete(processId);
    const timer = this.cancellationTimers.get(processId);
    if (timer) clearTimeout(timer);
    this.cancellationTimers.delete(processId);
  }

  private scheduleForceKill(processId: string, process: ChildProcess): void {
    this.clearForceKillTimer(processId, process);
    const timer = setTimeout(() => {
      const current = this.forceKillTimers.get(processId);
      if (!current || current.process !== process) return;
      this.forceKillTimers.delete(processId);
      if (process.exitCode !== null || process.signalCode !== null) return;
      try {
        process.kill('SIGKILL');
      } catch {
        // The process exited before escalation.
      }
    }, 2000);
    this.forceKillTimers.set(processId, { process, timer });
  }

  private clearForceKillTimer(processId: string, process?: ChildProcess): void {
    const current = this.forceKillTimers.get(processId);
    if (!current || (process && current.process !== process)) return;
    clearTimeout(current.timer);
    this.forceKillTimers.delete(processId);
  }

  /**
   * Get list of active processes
   */
  getActiveProcesses(): string[] {
    return Array.from(this.activeProcesses.keys());
  }

  /**
   * Kill all active processes
   */
  async killAllProcesses(): Promise<void> {
    const entries = Array.from(this.activeProcesses.entries());
    this.activeProcesses.clear();
    this.processTokens.clear();
    this.forceKillTimers.forEach(({ timer }) => clearTimeout(timer));
    this.forceKillTimers.clear();
    this.cancellationTimers.forEach((timer) => clearTimeout(timer));
    this.cancellationTimers.clear();
    this.cancellationRequests.clear();

    await Promise.all(entries.map(([, childProcess]) => new Promise<void>((resolve) => {
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolve();
      };

      childProcess.once('close', finish);
      childProcess.once('error', finish);
      try {
        childProcess.kill('SIGTERM');
      } catch {
        finish();
        return;
      }

      forceKillTimer = setTimeout(() => {
        if (settled) return;
        try {
          if (childProcess.exitCode === null && childProcess.signalCode === null) {
            childProcess.kill('SIGKILL');
          }
        } catch {
          // The child may have exited between the liveness check and kill.
        }
        setTimeout(finish, 500);
      }, 2000);
    })));
  }

  // Validation methods
  private validateTarget(target: string): boolean {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    const rangeRegex = /^(\d{1,3}\.){3}\d{1,3}-\d{1,3}$/;
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    
    if (/[;&|`$(){}[\]<>\\]/.test(target)) {
      return false;
    }
    
    return ipRegex.test(target) || cidrRegex.test(target) || rangeRegex.test(target) || hostnameRegex.test(target);
  }

  private validateDomain(domain: string): boolean {
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return domainRegex.test(domain) && !/[;&|`$(){}[\]<>\\]/.test(domain);
  }

  private validateNmapFlags(flags: string[]): boolean {
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
}


// Singleton instance
export const toolExecutionService = new ToolExecutionService();
