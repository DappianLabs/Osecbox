/**
 * Platform Detection Service
 * 
 * Centralized service for detecting OS platform, WSL2 availability,
 * and providing platform-specific command execution strategies.
 * 
 * @module platform-service
 */

import { execFile } from 'child_process';
import { promises as dnsPromises } from 'node:dns';
import { createServer } from 'node:net';
import { homedir as osHomedir, platform as osPlatform } from 'os';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { buildWslPath, shellQuotePathSegment } from './utils/wsl-path';
import {
  classifyDnsDiagnostic,
  DnsDiagnostic,
  DnsProbeResult,
  DnsRuntime,
  formatDnsDiagnosticFailure,
  normalizeDnsHostname,
  DNS_PUBLIC_PROBE,
} from './utils/dns-diagnostics';
import { classifyLigoloRole, LigoloRole } from './utils/ligolo-role';
import { formatPwncatReadinessFailure } from './utils/tool-readiness';

const execFileAsync = promisify(execFile);
const WSL_EXECUTABLE = 'wsl.exe';

export type Platform = 'windows' | 'linux' | 'darwin' | 'unknown';
export type WSL2Status = 'available' | 'unavailable' | 'not-installed' | 'not-applicable' | 'checking';

export interface PlatformInfo {
  platform: Platform;
  isWindows: boolean;
  isLinux: boolean;
  isMac: boolean;
  wsl2Status: WSL2Status;
  wsl2Version?: string;
  wsl2Distros?: string[];
  defaultDistro?: string;
  wsl2Error?: string;
}

export interface CommandExecutionStrategy {
  shouldUseWSL: boolean;
  commandPrefix: string[];
  shellCommand: string;
  homeDir: string;
}

export interface ToolAvailability {
  available: boolean;
  path?: string;
  version?: string;
  usedWSL: boolean;
  error?: string;
  /** Role detected for Ligolo-compatible binaries when help output is available. */
  role?: 'proxy' | 'agent' | 'unknown';
}

export type PortAvailabilityStatus =
  | 'available'
  | 'occupied'
  | 'permission-denied'
  | 'runtime-unavailable'
  | 'diagnostic-unavailable'
  | 'invalid';

export interface PortAvailability {
  available: boolean;
  status: PortAvailabilityStatus;
  port: number;
  host: string;
  runtime: DnsRuntime;
  verification?: 'bind' | 'occupancy-only';
  message: string;
}

class PlatformService {
  private cachedPlatformInfo: PlatformInfo | null = null;
  private detectionPromise: Promise<PlatformInfo> | null = null;
  private lastCheckTime: number = 0;
  private readonly CACHE_DURATION = 60000; // 1 minute cache
  private wslUserCache = new Map<string, { available: boolean; expiresAt: number }>();
  private readonly WSL_USER_CACHE_DURATION = 30000;

  /**
   * Get current platform information with caching
   */
  async getPlatformInfo(forceRefresh = false): Promise<PlatformInfo> {
    const now = Date.now();
    
    // Return cached result if valid
    if (
      !forceRefresh &&
      this.cachedPlatformInfo &&
      now - this.lastCheckTime < this.CACHE_DURATION
    ) {
      return this.cachedPlatformInfo;
    }

    // If detection is in progress, wait for it
    if (this.detectionPromise) {
      return this.detectionPromise;
    }

    // Start new detection
    this.detectionPromise = this.detectPlatform();
    
    try {
      this.cachedPlatformInfo = await this.detectionPromise;
      this.lastCheckTime = now;
      return this.cachedPlatformInfo;
    } finally {
      this.detectionPromise = null;
    }
  }

  /**
   * Detect platform and WSL2 availability
   */
  private async detectPlatform(): Promise<PlatformInfo> {
    const rawPlatform = osPlatform();
    const platform = this.normalizePlatform(rawPlatform);
    
    const info: PlatformInfo = {
      platform,
      isWindows: platform === 'windows',
      isLinux: platform === 'linux',
      isMac: platform === 'darwin',
      wsl2Status: 'checking',
    };

    // Only check WSL2 on Windows
    if (info.isWindows) {
      const wsl2Info = await this.detectWSL2();
      info.wsl2Status = wsl2Info.status;
      info.wsl2Version = wsl2Info.version;
      info.wsl2Distros = wsl2Info.distros;
      info.defaultDistro = wsl2Info.defaultDistro;
      info.wsl2Error = wsl2Info.error;
    } else {
      info.wsl2Status = 'not-applicable';
    }

    return info;
  }

  /**
   * Detect WSL2 installation and configuration
   * Handles all edge cases - slow systems, encoding issues, partial installs
   */
  private async detectWSL2(): Promise<{
    status: WSL2Status;
    version?: string;
    distros?: string[];
    defaultDistro?: string;
    error?: string;
  }> {
    const clean = (value: unknown): string => String(value ?? '')
      .replace(/\x00/g, '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .trim();
    const describeError = (error: any): string => [error?.stderr, error?.stdout, error?.message]
      .map(clean)
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240) || 'WSL command failed without an error message';

    try {
      console.log('[PlatformService] Detecting WSL2...');

      let rawListOutput = '';
      try {
        const result = await execFileAsync(WSL_EXECUTABLE, ['--list', '--verbose'], {
          timeout: 5000,
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        });
        rawListOutput = clean(result.stdout);
        const stderr = clean(result.stderr);
        if (stderr) rawListOutput = `${rawListOutput}\n${stderr}`.trim();
      } catch (error: any) {
        const message = describeError(error);
        if (error?.code === 'ENOENT' || /not recognized|not found/i.test(message)) {
          console.log('[PlatformService] WSL command not found (not installed)');
          return { status: 'not-installed' };
        }

        // A distro list is not proof that the service can execute a process.
        // Keep this distinct from "not installed" so the UI can explain the
        // host failure instead of reporting every Linux tool as missing.
        console.warn('[PlatformService] WSL distro enumeration failed:', message);
        return { status: 'unavailable', version: '2', error: message };
      }

      if (!rawListOutput) {
        return { status: 'unavailable', version: '2', error: 'WSL returned no status output' };
      }

      const lowerOutput = rawListOutput.toLowerCase();
      const serviceFailure = /access denied|e_accessdenied|e_unexpected|catastrophic failure|error code:\s*wsl\//i.test(rawListOutput);
      if (serviceFailure) {
        const message = describeError({ stdout: rawListOutput });
        console.warn('[PlatformService] WSL reported a service failure:', message);
        return { status: 'unavailable', version: '2', error: message };
      }
      if (lowerOutput.includes('no installed distributions') ||
          lowerOutput.includes('no distributions found')) {
        console.log('[PlatformService] WSL installed but no distributions');
        return { status: 'not-installed', version: '2', distros: [] };
      }

      console.log('[PlatformService] WSL command succeeded, parsing output...');
      const entries = this.parseWSLDistroEntries(rawListOutput);
      const candidates = entries.filter(entry =>
        entry.version === '2' && !/installing|converting/i.test(entry.state),
      );
      const candidateDistros = candidates.map(entry => entry.name);

      if (candidateDistros.length === 0) {
        console.log('[PlatformService] WSL output parsed but no valid distros found');
        console.log('[PlatformService] Raw output:', rawListOutput.substring(0, 200));
        return { status: 'not-installed', version: '2', distros: [] };
      }

      const defaultEntry = candidates.find(entry => entry.isDefault);
      const probeOrder = [...new Set([
        defaultEntry?.name,
        ...candidateDistros,
      ].filter((name): name is string => Boolean(name)))];
      // This real execution probe catches the reported Wsl/Service failures.
      // Probe candidates in parallel: the old sequential loop made a machine
      // with several distros wait one full timeout per distro before the UI
      // could show Ready or a terminal could start.
      const probeResults = await Promise.all(probeOrder.map(async (distro) => {
        try {
          await execFileAsync(WSL_EXECUTABLE, ['-d', distro, '--exec', 'true'], {
            timeout: 10000,
            windowsHide: true,
            encoding: 'utf8',
            maxBuffer: 256 * 1024,
          });
          return { distro, error: '' };
        } catch (error: any) {
          const message = describeError(error);
          console.warn(`[PlatformService] WSL distro probe failed for ${distro}:`, message);
          return { distro, error: message };
        }
      }));
      const workingDistros = probeResults
        .filter(result => !result.error)
        .map(result => result.distro);
      const probeErrors = probeResults
        .filter(result => result.error)
        .map(result => `${result.distro}: ${result.error}`);

      if (workingDistros.length === 0) {
        const message = probeErrors[0] || 'No WSL distribution could execute a command';
        console.warn('[PlatformService] WSL is installed but unavailable:', message);
        return {
          status: 'unavailable',
          version: '2',
          distros: candidateDistros,
          defaultDistro: defaultEntry?.name || candidateDistros[0],
          error: message,
        };
      }

      const selectedDistro = defaultEntry && workingDistros.includes(defaultEntry.name)
        ? defaultEntry.name
        : workingDistros[0];
      console.log('[PlatformService] WSL2 available:', {
        distros: workingDistros,
        defaultDistro: selectedDistro,
        totalFound: candidateDistros.length,
        workingCount: workingDistros.length,
      });

      return {
        status: 'available',
        version: '2',
        distros: workingDistros,
        defaultDistro: selectedDistro,
      };
    } catch (error: any) {
      const message = describeError(error);
      console.error('[PlatformService] WSL detection failed with exception:', message);
      return { status: 'unavailable', version: '2', error: message };
    }
  }

  private async detectWSL2Legacy(): Promise<{
    status: WSL2Status;
    version?: string;
    distros?: string[];
    defaultDistro?: string;
  }> {
    try {
      // ENCODING FIX: WSL commands return UTF-16 LE with BOM, need comprehensive cleaning
      const cleanWSLOutput = (str: string): string => {
        return str
          .replace(/\x00/g, '') // Remove null bytes (UTF-16 artifacts)
          .replace(/^\uFEFF/, '') // Remove BOM (Byte Order Mark)
          .replace(/\r\n/g, '\n') // Normalize line endings
          .trim();
      };

      console.log('[PlatformService] Detecting WSL2...');

      // STEP 1: Check if WSL command exists
      let rawListOutput: string;
      let stderr: string;
      
      try {
        const result = await execFileAsync(WSL_EXECUTABLE, ['--list', '--verbose'], {
          timeout: 5000, // Generous timeout for slow systems
          windowsHide: true,
          encoding: 'utf8', // Explicit encoding
          maxBuffer: 1024 * 1024,
        });
        rawListOutput = result.stdout;
        stderr = result.stderr;
      } catch (execError: any) {
        // EDGE CASE: Command not found vs execution error
        if (execError.code === 'ENOENT' || execError.message.includes('not found')) {
          console.log('[PlatformService] WSL command not found (not installed)');
          return { status: 'not-installed' };
        }
        
        // EDGE CASE: Timeout on slow system
        if (execError.code === 'ETIMEDOUT' || execError.message.includes('timeout')) {
          console.warn('[PlatformService] WSL detection timed out - system may be slow');
          return { status: 'not-installed' };
        }
        
        // EDGE CASE: Permission denied
        if (execError.code === 'EACCES' || execError.message.includes('permission')) {
          console.error('[PlatformService] WSL permission denied');
          return { status: 'not-installed' };
        }
        
        // Unknown error - treat as not installed
        console.error('[PlatformService] WSL detection error:', execError.message);
        return { status: 'not-installed' };
      }
      
      // STEP 2: Validate stderr for errors
      if (stderr) {
        const stderrLower = stderr.toLowerCase();
        
        // EDGE CASE: Command not recognized (WSL not installed)
        if (stderrLower.includes('not recognized') || 
            stderrLower.includes('is not recognized') ||
            stderrLower.includes('not found')) {
          console.log('[PlatformService] WSL command not recognized');
          return { status: 'not-installed' };
        }
        
        // EDGE CASE: WSL service not running
        if (stderrLower.includes('service') && stderrLower.includes('not running')) {
          console.warn('[PlatformService] WSL service not running');
          return { status: 'not-installed' };
        }
        
        // EDGE CASE: WSL needs update
        if (stderrLower.includes('update') || stderrLower.includes('upgrade')) {
          console.warn('[PlatformService] WSL may need update, but continuing...');
          // Don't return - try to parse output anyway
        }
      }
      
      // STEP 3: Clean and validate output
      const listOutput = cleanWSLOutput(rawListOutput);
      
      if (!listOutput || listOutput.length === 0) {
        console.log('[PlatformService] WSL returned empty output');
        return { status: 'not-installed' };
      }
      
      // EDGE CASE: Check for "no distributions" message
      if (listOutput.toLowerCase().includes('no installed distributions') ||
          listOutput.toLowerCase().includes('no distributions found')) {
        console.log('[PlatformService] WSL installed but no distributions');
        return { 
          status: 'not-installed',
          version: '2',
          distros: [],
        };
      }

      console.log('[PlatformService] WSL command succeeded, parsing output...');

      // STEP 4: Parse distributions
      const distroEntries = this.parseWSLDistroEntries(listOutput);
      const distros = distroEntries
        .filter(entry => entry.version === '2')
        .map(entry => entry.name);
      const defaultEntry = distroEntries.find(entry => entry.version === '2' && entry.isDefault);
      const defaultDistro = defaultEntry?.name;

      // STEP 5: Validate we found actual distros
      if (distros.length === 0) {
        console.log('[PlatformService] WSL output parsed but no valid distros found');
        console.log('[PlatformService] Raw output:', listOutput.substring(0, 200));
        return { 
          status: 'not-installed',
          version: '2',
          distros: [],
        };
      }

      // STEP 6: Verify at least one distro is running/stopped (not installing)
      const validDistros = distros.filter(d => {
        const line = listOutput.split('\n').find(l => l.includes(d));
        if (!line) return false;
        
        // Check if distro is in a valid state (not installing/converting)
        const isInstalling = line.toLowerCase().includes('installing');
        const isConverting = line.toLowerCase().includes('converting');
        
        return !isInstalling && !isConverting;
      });
      
      if (validDistros.length === 0) {
        console.log('[PlatformService] WSL distros found but all are installing/converting');
        return { status: 'checking' };
      }

      console.log('[PlatformService] ✅ WSL2 available:', {
        distros: validDistros,
        defaultDistro,
        totalFound: distros.length,
        validCount: validDistros.length,
      });

      return {
        status: 'available',
        version: '2',
        distros: validDistros,
        defaultDistro: validDistros.includes(defaultDistro || '') ? defaultDistro : validDistros[0],
      };
    } catch (error: any) {
      // FINAL CATCH: Log comprehensive error info
      console.error('[PlatformService] WSL detection failed with exception:', {
        message: error.message,
        code: error.code,
        stack: error.stack?.split('\n')[0],
      });
      
      return { status: 'not-installed' };
    }
  }

  /**
   * Parse WSL distro list output
   * Handles multiple output formats and edge cases
   */
  private parseWSLDistroEntries(output: string): Array<{
    name: string;
    state: string;
    version: '1' | '2';
    isDefault: boolean;
  }> {
    const entries: Array<{
      name: string;
      state: string;
      version: '1' | '2';
      isDefault: boolean;
    }> = [];

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || /^(NAME|STATE|VERSION|[-=\s]+)$/i.test(trimmed)) continue;

      // Keep the state column opaque so localized WSL output still parses.
      // The final column of --list --verbose is always the distro version.
      const match = trimmed.match(/^(\*)?\s*([^\s]+)\s+(.+?)\s+([12])\s*$/);
      if (!match) continue;

      entries.push({
        name: match[2],
        state: match[3],
        version: match[4] as '1' | '2',
        isDefault: Boolean(match[1]),
      });
    }

    return [...new Map(entries.map(entry => [entry.name, entry])).values()];
  }

  private parseWSLDistros(output: string): string[] {
    const distros: string[] = [];
    const lines = output.split('\n');
    
    // EDGE CASE: Detect output format (verbose vs simple)
    const hasVerboseHeaders = lines.some(l => 
      l.includes('NAME') && l.includes('STATE') && l.includes('VERSION')
    );

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines
      if (!trimmed) continue;
      
      // Skip header lines (multiple formats)
      if (trimmed.includes('NAME') || 
          trimmed.includes('STATE') || 
          trimmed.includes('VERSION') ||
          trimmed.match(/^[-=]+$/)) {
        continue;
      }
      
      // EDGE CASE: Skip "Windows Subsystem for Linux" title line
      if (trimmed.toLowerCase().includes('windows subsystem') ||
          trimmed.toLowerCase().includes('distributions')) {
        continue;
      }

      // Extract distro name (handles * for default, and various formats)
      // Format 1: "* Ubuntu-20.04    Running    2"
      // Format 2: "  Debian          Stopped    2"
      // Format 3: "Ubuntu" (simple format)
      let match = trimmed.match(/^\*?\s*([^\s]+)/);
      
      if (match) {
        const distroName = match[1].trim();
        
        // VALIDATION: Ensure it's a valid distro name
        // - Not a number (version column)
        // - Not a state (Running, Stopped, etc.)
        // - Not empty
        if (distroName && 
            !distroName.match(/^\d+$/) &&
            !['Running', 'Stopped', 'Installing', 'Converting'].includes(distroName)) {
          distros.push(distroName);
        }
      }
    }

    // DEDUPLICATION: Remove duplicates while preserving order
    return [...new Set(distros)];
  }

  /**
   * Find default WSL distro (marked with *)
   * Smart fallback logic for pentesting
   */
  private findDefaultDistro(output: string): string | undefined {
    const lines = output.split('\n');
    
    // STEP 1: Look for * marker (official default)
    for (const line of lines) {
      if (line.trim().startsWith('*')) {
        const match = line.match(/^\s*\*\s*([^\s]+)/);
        if (match) {
          const defaultDistro = match[1].trim();
          console.log('[PlatformService] Found default distro (marked):', defaultDistro);
          return defaultDistro;
        }
      }
    }

    // STEP 2: No default marked - use smart fallback
    const distros = this.parseWSLDistros(output);
    
    if (distros.length === 0) {
      return undefined;
    }
    
    // PRIORITY 1: Kali Linux (best for pentesting)
    const kaliDistro = distros.find(d => 
      d.toLowerCase().includes('kali')
    );
    if (kaliDistro) {
      console.log('[PlatformService] Using Kali Linux as default (pentesting optimized)');
      return kaliDistro;
    }
    
    // PRIORITY 2: Parrot OS (also pentesting-focused)
    const parrotDistro = distros.find(d => 
      d.toLowerCase().includes('parrot')
    );
    if (parrotDistro) {
      console.log('[PlatformService] Using Parrot OS as default (pentesting optimized)');
      return parrotDistro;
    }
    
    // PRIORITY 3: Ubuntu (most common, good tool support)
    const ubuntuDistro = distros.find(d => 
      d.toLowerCase().includes('ubuntu')
    );
    if (ubuntuDistro) {
      console.log('[PlatformService] Using Ubuntu as default (common choice)');
      return ubuntuDistro;
    }
    
    // PRIORITY 4: Debian (stable, good tool support)
    const debianDistro = distros.find(d => 
      d.toLowerCase().includes('debian')
    );
    if (debianDistro) {
      console.log('[PlatformService] Using Debian as default');
      return debianDistro;
    }
    
    // FALLBACK: First available distro
    console.log('[PlatformService] Using first available distro:', distros[0]);
    return distros[0];
  }

  /**
   * Normalize platform string
   */
  private normalizePlatform(raw: string): Platform {
    switch (raw) {
      case 'win32':
        return 'windows';
      case 'linux':
        return 'linux';
      case 'darwin':
        return 'darwin';
      default:
        return 'unknown';
    }
  }

  private getUnixShell(): string {
    const configured = process.env.SHELL?.trim();
    if (configured && existsSync(configured)) return configured;
    if (existsSync('/bin/bash')) return '/bin/bash';
    if (existsSync('/usr/bin/bash')) return '/usr/bin/bash';
    return '/bin/sh';
  }

  /**
   * A saved WSL user can outlive a distro reinstallation or a username change.
   * Validate it before adding `-u`; otherwise one stale setting makes every
   * WSL terminal fail with a generic service error on a new machine.
   */
  private async isWslUserAvailable(distro: string | undefined, user: string): Promise<boolean> {
    const cacheKey = `${distro || '(default)'}|${user}`;
    const cached = this.wslUserCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.available;

    const args = [
      ...(distro ? ['-d', distro] : []),
      '-u', user,
      '--exec', 'id', '-u',
    ];

    try {
      await execFileAsync(WSL_EXECUTABLE, args, {
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf8',
      });
      this.wslUserCache.set(cacheKey, {
        available: true,
        expiresAt: Date.now() + this.WSL_USER_CACHE_DURATION,
      });
      return true;
    } catch (error: any) {
      const message = [error?.stderr, error?.stdout, error?.message]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 180);
      console.warn('[PlatformService] Configured WSL user is unavailable; using the distro default user:', {
        distro: distro || '(default)',
        user,
        error: message,
      });
      this.wslUserCache.set(cacheKey, {
        available: false,
        expiresAt: Date.now() + this.WSL_USER_CACHE_DURATION,
      });
      return false;
    }
  }

  /**
   * Get command execution strategy based on platform and tool requirements
   */
  async getExecutionStrategy(toolRequiresLinux = false): Promise<CommandExecutionStrategy> {
    const platformInfo = await this.getPlatformInfo();

    console.log('[PlatformService] getExecutionStrategy:', {
      toolRequiresLinux,
      platform: platformInfo.platform,
      isWindows: platformInfo.isWindows,
      wsl2Status: platformInfo.wsl2Status,
      defaultDistro: platformInfo.defaultDistro,
    });

    // Linux/Mac/BSD: Direct execution
    if (platformInfo.isLinux || platformInfo.isMac || 
        process.platform === 'freebsd' || process.platform === 'openbsd') {
      return {
        shouldUseWSL: false,
        commandPrefix: [],
        shellCommand: this.getUnixShell(),
        homeDir: process.env.HOME || osHomedir() || process.cwd(),
      };
    }

    // Windows: Check if tool requires Linux
    if (platformInfo.isWindows) {
      // CONTROLLED EXECUTION: Single-user model with explicit PATH injection
      if (toolRequiresLinux && platformInfo.wsl2Status === 'available') {
        // Import settings service dynamically to avoid circular dependency
        const { settingsService } = await import('./services/settings-service');
        await settingsService.waitUntilReady();
        const settings = settingsService.getSettings();
        
        // Build WSL command prefix
        const commandPrefix: string[] = [WSL_EXECUTABLE];
        
        // Validate a configured distro against the actual WSL installation.
        // A stale setting must not make every terminal fail to start after a
        // distro was renamed or removed.
        const configuredDistro = settings.wsl2Distro?.trim();
        const availableDistros = platformInfo.wsl2Distros || [];
        const distro = configuredDistro && /^[a-zA-Z0-9._-]+$/.test(configuredDistro)
          ? availableDistros.find(name => name.toLowerCase() === configuredDistro.toLowerCase())
          : undefined;
        if (configuredDistro && !distro) {
          throw new Error(`Configured WSL distro is unavailable: ${configuredDistro}`);
        }
        if (distro) commandPrefix.push('-d', distro);
        
        // 🔒 Validate and add user flag if custom user specified
        const user = settings.wsl2User?.trim();
        let selectedUser: string | undefined;
        if (user) {
          if (!/^[a-zA-Z0-9._-]+$/.test(user)) {
            console.error('[PlatformService] Invalid user name:', user);
          } else if (await this.isWslUserAvailable(distro || platformInfo.defaultDistro, user)) {
            commandPrefix.push('-u', user);
            selectedUser = user;
          }
        }
        
        // Always start Linux work in the selected user's home directory. If
        // this is omitted, wsl.exe inherits Electron's Windows cwd, which can
        // be the install directory (or a read-only Program Files path) on a
        // fresh machine. That makes the prompt confusing and can break tools
        // that create relative files. `~` is resolved by WSL for the selected
        // distro/user and is safe to pass as a structured argument.
        commandPrefix.push('--cd', '~');

        // Use WSL's explicit exec mode so the command is launched inside the
        // selected distro/user instead of being reinterpreted by the Windows
        // command shell. The bash -c wrapper keeps PATH and quoting under our
        // control for tool detection and PTY launches.
        commandPrefix.push('--exec', 'bash', '-c');
        
        console.log('[PlatformService] Using WSL2 controlled execution:', {
          distro: distro || '(default)',
          user: selectedUser || '(default)',
          extraPaths: settings.wsl2ExtraPaths || [],
          commandPrefix,
        });
        
        return {
          shouldUseWSL: true,
          commandPrefix,
          shellCommand: 'wsl',
          homeDir: process.env.USERPROFILE || osHomedir() || process.cwd(),
        };
      }

      console.log('[PlatformService] NOT using WSL2 - toolRequiresLinux:', toolRequiresLinux, 'wsl2Status:', platformInfo.wsl2Status);

      // Native Windows execution
      return {
        shouldUseWSL: false,
        commandPrefix: [],
        shellCommand: 'powershell.exe',
        homeDir: process.env.USERPROFILE || osHomedir() || process.cwd(),
      };
    }

    // Fallback
    return {
      shouldUseWSL: false,
      commandPrefix: [],
      shellCommand: 'sh',
      homeDir: process.env.HOME || osHomedir() || process.cwd(),
    };
  }

  /**
   * Check if a specific tool is available
   * Multi-method detection with comprehensive PATH search
   */
  async checkToolAvailability(toolName: string, requiresLinux = false): Promise<ToolAvailability> {
    // FIX: Don't use getExecutionStrategy for tool checking - use direct commands
    // getExecutionStrategy adds 'bash -c' wrapper which breaks 'which' command
    const platformInfo = await this.getPlatformInfo();
    const normalizedToolName = typeof toolName === 'string' ? toolName.trim() : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalizedToolName)) {
      return { available: false, usedWSL: false };
    }

    // Use the structured, shell-free path for all supported platforms.
    const availability = await this.checkToolAvailabilitySafe(normalizedToolName, requiresLinux, platformInfo);
    if (
      availability.available &&
      (normalizedToolName === 'ligolo-ng' || normalizedToolName === 'proxy' || normalizedToolName === 'ligolo-proxy')
    ) {
      return {
        ...availability,
        role: await this.detectLigoloRole(availability.path!, requiresLinux, platformInfo),
      };
    }
    if (availability.available && normalizedToolName === 'pwncat-cs') {
      const readinessError = await this.checkPwncatReadiness(availability.path!, requiresLinux, platformInfo);
      if (readinessError) {
        return { ...availability, available: false, error: readinessError };
      }
    }
    return availability;
  }

  /**
   * Check a local bind port in the same runtime that will execute a Linux
   * listener/tunnel. The probe binds and immediately closes the socket; it
   * never accepts a connection and never contacts a remote host.
   */
  async checkLocalPortAvailability(
    port: number,
    host = '0.0.0.0',
    requiresLinux = false,
  ): Promise<PortAvailability> {
    const normalizedPort = Number(port);
    const normalizedHost = typeof host === 'string' ? host.trim() : '';
    const validHost = ['0.0.0.0', '127.0.0.1', '::', '::1'].includes(normalizedHost);
    const platformInfo = await this.getPlatformInfo();
    const runtime: DnsRuntime = platformInfo.isWindows
      ? (requiresLinux ? 'wsl2' : 'windows')
      : platformInfo.isLinux
        ? 'linux'
        : platformInfo.isMac
          ? 'darwin'
          : 'unknown';

    if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535 || !validHost) {
      return {
        available: false,
        status: 'invalid',
        port: normalizedPort,
        host: normalizedHost,
        runtime,
        message: 'A local port check requires a port from 1 to 65535 and a loopback/all-interface bind address.',
      };
    }

    if (platformInfo.isWindows && requiresLinux && platformInfo.wsl2Status !== 'available') {
      return {
        available: false,
        status: 'runtime-unavailable',
        port: normalizedPort,
        host: normalizedHost,
        runtime,
        message: `WSL2 is unavailable, so port ${normalizedPort} could not be checked in the Linux runtime. ${platformInfo.wsl2Error || 'Start or repair WSL2, then retry.'}`,
      };
    }

    if (platformInfo.isWindows && requiresLinux) {
      try {
        const strategy = await this.getExecutionStrategy(true);
        if (!strategy.shouldUseWSL) {
          return {
            available: false,
            status: 'runtime-unavailable',
            port: normalizedPort,
            host: normalizedHost,
            runtime,
            message: 'The selected WSL2 execution strategy is unavailable; the Windows host port is not a substitute for the Linux runtime port.',
          };
        }

        const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
        const pythonProbe = [
          'import socket',
          `host = ${JSON.stringify(normalizedHost)}`,
          `port = ${normalizedPort}`,
          'family = socket.AF_INET6 if ":" in host else socket.AF_INET',
          'sock = socket.socket(family, socket.SOCK_STREAM)',
          'try:',
          '    sock.bind((host, port))',
          'except OSError as exc:',
          '    print("OSECBOX_PORT_ERROR:%s:%s" % (getattr(exc, "errno", "unknown"), exc), flush=True)',
          '    raise SystemExit(2)',
          'else:',
          '    print("OSECBOX_PORT_OK", flush=True)',
          'finally:',
          '    sock.close()',
        ].join('\n');
        const script = [
          `if command -v python3 >/dev/null 2>&1; then python3 -c ${shellQuote(pythonProbe)}`,
          `elif command -v ss >/dev/null 2>&1; then if ss -H -ltn "sport = :${normalizedPort}" 2>/dev/null | grep -q .; then printf '%s\\n' OSECBOX_PORT_OCCUPIED; else printf '%s\\n' OSECBOX_PORT_NOT_OCCUPIED; fi`,
          `else printf '%s\\n' OSECBOX_PORT_DIAGNOSTIC_UNAVAILABLE >&2; exit 127; fi`,
        ].join('; ');
        const result = await this.runRuntimeScript(script, true, strategy);
        const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        if (/OSECBOX_PORT_OK/.test(combined)) {
          return {
            available: true,
            status: 'available',
            port: normalizedPort,
            host: normalizedHost,
            runtime,
            verification: 'bind',
            message: `Port ${normalizedPort} is available in WSL2 (${normalizedHost}); the probe bound and closed it successfully.`,
          };
        }
        if (/OSECBOX_PORT_NOT_OCCUPIED/.test(combined)) {
          return {
            available: true,
            status: 'available',
            port: normalizedPort,
            host: normalizedHost,
            runtime,
            verification: 'occupancy-only',
            message: `Port ${normalizedPort} is not reported as occupied in WSL2. Python3 was unavailable, so permission to bind was not independently tested.`,
          };
        }
        if (/OSECBOX_PORT_OCCUPIED|Address already in use|Errno 98|Errno 10048/i.test(combined)) {
          return {
            available: false,
            status: 'occupied',
            port: normalizedPort,
            host: normalizedHost,
            runtime,
            message: `Port ${normalizedPort} is already in use in WSL2 on ${normalizedHost}. Stop the owning local listener or choose another port.`,
          };
        }
        if (/Permission denied|Errno 13|Errno 10013/i.test(combined)) {
          return {
            available: false,
            status: 'permission-denied',
            port: normalizedPort,
            host: normalizedHost,
            runtime,
            message: `WSL2 denied binding port ${normalizedPort} on ${normalizedHost}. Use a non-privileged port above 1024 or run the authorized tool with the required local privilege.`,
          };
        }
        return {
          available: false,
          status: 'diagnostic-unavailable',
          port: normalizedPort,
          host: normalizedHost,
          runtime,
          message: `WSL2 port preflight could not determine whether port ${normalizedPort} is usable. ${combined || 'Install python3 or ss in the selected distro, then retry.'}`,
        };
      } catch (error: any) {
        return {
          available: false,
          status: 'diagnostic-unavailable',
          port: normalizedPort,
          host: normalizedHost,
          runtime,
          message: `WSL2 port preflight failed for port ${normalizedPort}: ${this.cleanCommandOutput(error?.message || error)}`,
        };
      }
    }

    return new Promise<PortAvailability>((resolve) => {
      const server = createServer();
      let settled = false;
      const finish = (result: PortAvailability) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      server.once('error', (error: NodeJS.ErrnoException) => {
        const code = error.code || '';
        const status: PortAvailabilityStatus = code === 'EADDRINUSE'
          ? 'occupied'
          : code === 'EACCES'
            ? 'permission-denied'
            : 'diagnostic-unavailable';
        finish({
          available: false,
          status,
          port: normalizedPort,
          host: normalizedHost,
          runtime,
          message: status === 'occupied'
            ? `Port ${normalizedPort} is already in use in ${runtime} on ${normalizedHost}. Stop the owning local listener or choose another port.`
            : status === 'permission-denied'
              ? `The ${runtime} runtime denied binding port ${normalizedPort} on ${normalizedHost}. Use a non-privileged port above 1024 or provide the required local privilege.`
              : `The ${runtime} runtime could not check port ${normalizedPort}: ${error.message}`,
        });
      });

      server.listen({ host: normalizedHost, port: normalizedPort, exclusive: true }, () => {
        server.close(() => finish({
          available: true,
          status: 'available',
          port: normalizedPort,
          host: normalizedHost,
          runtime,
          verification: 'bind',
          message: `Port ${normalizedPort} is available in ${runtime} (${normalizedHost}); the probe bound and closed it successfully.`,
        }));
      });
    });
  }

  /**
   * Check a group of tools with one WSL shell invocation. The title-bar
   * status only needs availability/path; resolving every tool's version with
   * three separate WSL processes made startup needlessly serial and slow.
   */
  async checkToolAvailabilityBatch(
    toolNames: string[],
    requiresLinux = false,
  ): Promise<Record<string, ToolAvailability>> {
    const normalizedTools = [...new Set((Array.isArray(toolNames) ? toolNames : [])
      .map(tool => typeof tool === 'string' ? tool.trim() : '')
      .filter(tool => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(tool)))];
    const results: Record<string, ToolAvailability> = {};
    if (normalizedTools.length === 0) return results;

    const platformInfo = await this.getPlatformInfo();
    const useWSL = platformInfo.isWindows && requiresLinux && platformInfo.wsl2Status === 'available';

    if (!useWSL) {
      const checked = await Promise.all(normalizedTools.map(async tool => [
        tool,
        await this.checkToolAvailabilitySafe(tool, requiresLinux, platformInfo),
      ] as const));
      return Object.fromEntries(checked);
    }

    try {
      const strategy = await this.getExecutionStrategy(true);
      const { settingsService } = await import('./services/settings-service');
      await settingsService.waitUntilReady();
      const settings = settingsService.getSettings();
      const pathString = buildWslPath(settings.wsl2ExtraPaths || []);
      const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
      const probeScript = [
        `export PATH=${pathString}`,
        normalizedTools
          .map(tool => `printf '%s\\t' ${shellQuote(tool)}; command -v ${shellQuote(tool)} 2>/dev/null || true; printf '\\n';`)
          .join(' '),
      ].join('; ');
      const result = await execFileAsync(strategy.commandPrefix[0], [
        ...strategy.commandPrefix.slice(1),
        probeScript,
      ], { timeout: 5000, windowsHide: true, encoding: 'utf8', maxBuffer: 512 * 1024 });

      for (const line of `${result.stdout || ''}`.split(/\r?\n/)) {
        const separator = line.indexOf('\t');
        if (separator < 1) continue;
        const tool = line.slice(0, separator);
        const path = line.slice(separator + 1).trim();
        if (!normalizedTools.includes(tool)) continue;
        results[tool] = path.startsWith('/')
          ? { available: true, path, usedWSL: true }
          : { available: false, usedWSL: true };
      }
    } catch {
      // Preserve the existing per-tool behavior as a fallback if the single
      // probe shell fails for a transient WSL reason.
      const checked = await Promise.all(normalizedTools.map(async tool => [
        tool,
        await this.checkToolAvailabilitySafe(tool, requiresLinux, platformInfo),
      ] as const));
      return Object.fromEntries(checked);
    }

    for (const tool of normalizedTools) {
      if (!results[tool]) results[tool] = { available: false, usedWSL: true };
    }
    return results;
  }
  
  /**
   * Get tool version with smart parsing
   * Handles multiple version output formats
   */
  private async checkToolAvailabilitySafe(
    toolName: string,
    requiresLinux: boolean,
    platformInfo: PlatformInfo,
  ): Promise<{ available: boolean; path?: string; version?: string; usedWSL: boolean }> {
    // A native Windows binary must not make a Linux-only tool appear healthy:
    // the execution path for these tools is WSL2, so report the runtime block
    // instead of probing a different environment with where.exe.
    if (platformInfo.isWindows && requiresLinux && platformInfo.wsl2Status !== 'available') {
      return { available: false, usedWSL: true };
    }

    const useWSL = platformInfo.isWindows && requiresLinux && platformInfo.wsl2Status === 'available';

    try {
      let path: string | undefined;

      if (useWSL) {
        const strategy = await this.getExecutionStrategy(true);
        const { settingsService } = await import('./services/settings-service');
        await settingsService.waitUntilReady();
        const settings = settingsService.getSettings();
        const pathString = buildWslPath(settings.wsl2ExtraPaths || []);
        const result = await execFileAsync(strategy.commandPrefix[0], [
          ...strategy.commandPrefix.slice(1),
          `export PATH=${pathString}; command -v ${shellQuotePathSegment(toolName)}`,
        ], { timeout: 5000, windowsHide: true, encoding: 'utf8' });
        path = `${result.stdout || ''}`.split(/\r?\n/).map(line => line.trim()).find(Boolean);
        if (path && !path.startsWith('/')) path = undefined;
      } else if (platformInfo.isWindows) {
        const result = await execFileAsync('where.exe', [toolName], {
          timeout: 3000,
          windowsHide: true,
          encoding: 'utf8',
        });
        path = `${result.stdout || ''}`.split(/\r?\n/).map(line => line.trim()).find(Boolean);
      } else {
        try {
          const result = await execFileAsync('which', [toolName], {
            timeout: 3000,
            encoding: 'utf8',
          });
          path = `${result.stdout || ''}`.split(/\r?\n/).map(line => line.trim()).find(Boolean);
        } catch {
          // Minimal distros (notably Alpine images) may not ship `which`.
          const result = await execFileAsync(this.getUnixShell(), ['-lc', `command -v ${toolName}`], {
            timeout: 3000,
            encoding: 'utf8',
          });
          path = `${result.stdout || ''}`.split(/\r?\n/).map(line => line.trim()).find(Boolean);
        }
      }

      if (!path) return { available: false, usedWSL: useWSL };
      const version = await this.getToolVersionSafe(path, useWSL);
      return { available: true, path, version, usedWSL: useWSL };
    } catch {
      return { available: false, usedWSL: useWSL };
    }
  }

  private async detectLigoloRole(
    path: string,
    requiresLinux: boolean,
    platformInfo: PlatformInfo,
  ): Promise<LigoloRole> {
    const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    try {
      const useWSL = platformInfo.isWindows && requiresLinux && platformInfo.wsl2Status === 'available';
      let output = '';
      if (useWSL) {
        const strategy = await this.getExecutionStrategy(true);
        const result = await execFileAsync(strategy.commandPrefix[0], [
          ...strategy.commandPrefix.slice(1),
          `${shellQuote(path)} -h`,
        ], { timeout: 4000, windowsHide: true, encoding: 'utf8', maxBuffer: 128 * 1024 });
        output = `${result.stdout || ''}\n${result.stderr || ''}`;
      } else {
        const result = await execFileAsync(path, ['-h'], {
          timeout: 4000,
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 128 * 1024,
        });
        output = `${result.stdout || ''}\n${result.stderr || ''}`;
      }

      return classifyLigoloRole(output);
    } catch (error: any) {
      const output = `${error?.stdout || ''}\n${error?.stderr || ''}\n${error?.message || ''}`;
      return classifyLigoloRole(output);
    }
  }

  private async checkPwncatReadiness(
    path: string,
    requiresLinux: boolean,
    platformInfo: PlatformInfo,
  ): Promise<string | null> {
    const useWSL = platformInfo.isWindows && requiresLinux && platformInfo.wsl2Status === 'available';
    if (platformInfo.isWindows && requiresLinux && !useWSL) {
      return 'WSL2 is unavailable, so pwncat-cs could not be initialized in its Linux runtime.';
    }

    const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    const strategy = useWSL ? await this.getExecutionStrategy(true) : null;
    // --list initializes pwncat's command/plugin manager but does not open a
    // listener or connect to a victim. This catches Python/package breakage
    // before the listener UI marks a session as running.
    const result = await this.runRuntimeScript(`${shellQuote(path)} --list`, useWSL, strategy);
    if (result.code === 0) return null;

    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return formatPwncatReadinessFailure(combined);
  }

  private async getToolVersionSafe(path: string, useWSL: boolean): Promise<string | undefined> {
    const flags = ['--version', '-v', 'version'];
    const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

    for (const flag of flags) {
      try {
        let stdout = '';
        let stderr = '';

        if (useWSL) {
          const strategy = await this.getExecutionStrategy(true);
          const result = await execFileAsync(strategy.commandPrefix[0], [
            ...strategy.commandPrefix.slice(1),
            `${shellQuote(path)} ${flag}`,
          ], { timeout: 4000, windowsHide: true, encoding: 'utf8' });
          stdout = `${result.stdout || ''}`;
          stderr = `${result.stderr || ''}`;
        } else if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(path)) {
          const result = await execFileAsync(process.env.ComSpec || 'cmd.exe', [
            '/d', '/s', '/c', `"${path}" ${flag}`,
          ], { timeout: 4000, windowsHide: true, encoding: 'utf8' });
          stdout = `${result.stdout || ''}`;
          stderr = `${result.stderr || ''}`;
        } else {
          const result = await execFileAsync(path, [flag], {
            timeout: 4000,
            windowsHide: true,
            encoding: 'utf8',
          });
          stdout = `${result.stdout || ''}`;
          stderr = `${result.stderr || ''}`;
        }

        const firstLine = `${stdout}\n${stderr}`
          .split(/\r?\n/)
          .map(line => line.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '').trim())
          .find(Boolean);
        if (firstLine) {
          const match = firstLine.match(/\b(?:version\s+|v)?([0-9]+(?:\.[0-9A-Za-z-]+)+)/i);
          return match?.[1] || firstLine.replace(/\s*\(.*?\)\s*/g, '').slice(0, 80);
        }
      } catch {
        // Try the next conventional version flag.
      }
    }

    return undefined;
  }

  /**
   * Get WSL2 setup instructions
   */
  getWSL2SetupInstructions(): string[] {
    return [
      '1. Open PowerShell as Administrator',
      '2. Run: wsl --install -d Ubuntu (or choose Debian/Kali)',
      '3. Restart your computer',
      '4. Open the Linux distribution you installed from the Start menu',
      '5. Create a username and password',
      '6. Set it as default if needed: wsl --set-default <DistroName>',
      '7. Install tools from the setup scripts or the commands shown by the app',
    ];
  }

  /**
   * Check DNS in the same runtime that Linux security tools will use.
   *
   * Windows-side DNS success is not sufficient evidence for a WSL2 tool. The
   * WSL path deliberately uses the selected distro/user and reads its own
   * resolver state. This method is read-only and never edits resolv.conf or
   * any host networking configuration.
   */
  async diagnoseDns(target?: string): Promise<DnsDiagnostic> {
    const platformInfo = await this.getPlatformInfo();
    const isWindows = platformInfo.isWindows;
    const runtime: DnsRuntime = isWindows
      ? 'wsl2'
      : platformInfo.isLinux
        ? 'linux'
        : platformInfo.isMac
          ? 'darwin'
          : 'unknown';

    if (isWindows && platformInfo.wsl2Status !== 'available') {
      return classifyDnsDiagnostic({
        runtime,
        runtimeAvailable: false,
        target,
        publicProbe: { ok: false, available: false, error: platformInfo.wsl2Error },
      });
    }

    let useWSL = false;
    let strategy: CommandExecutionStrategy | null = null;
    try {
      if (runtime === 'wsl2') {
        strategy = await this.getExecutionStrategy(true);
        useWSL = strategy.shouldUseWSL;
      }

      const [publicProbe, targetProbe, evidence] = await Promise.all([
        this.runDnsProbe(DNS_PUBLIC_PROBE, useWSL, strategy),
        normalizeDnsHostname(target)
          ? this.runDnsProbe(normalizeDnsHostname(target)!, useWSL, strategy)
          : Promise.resolve(undefined),
        this.readDnsEvidence(useWSL, strategy),
      ]);

      return classifyDnsDiagnostic({
        runtime,
        runtimeAvailable: runtime !== 'unknown' && (runtime !== 'wsl2' || useWSL),
        target,
        publicProbe,
        targetProbe,
        resolverEvidence: evidence.resolverEvidence,
        routeEvidence: evidence.routeEvidence,
      });
    } catch (error: any) {
      const message = this.cleanCommandOutput(error?.message || error);
      return classifyDnsDiagnostic({
        runtime,
        runtimeAvailable: false,
        target,
        publicProbe: { ok: false, available: false, error: message },
      });
    }
  }

  /** Format a DNS failure for tool results and renderer error panels. */
  formatDnsFailure(diagnostic: DnsDiagnostic): string {
    return formatDnsDiagnosticFailure(diagnostic);
  }

  private cleanCommandOutput(value: unknown): string {
    return String(value ?? '')
      .replace(/\x00/g, '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  private async runRuntimeScript(
    script: string,
    useWSL: boolean,
    strategy: CommandExecutionStrategy | null,
  ): Promise<{ stdout: string; stderr: string; code?: number }> {
    const executable = useWSL && strategy ? strategy.commandPrefix[0] : 'sh';
    const args = useWSL && strategy
      ? [...strategy.commandPrefix.slice(1), script]
      : ['-lc', script];

    try {
      const result = await execFileAsync(executable, args, {
        timeout: 8000,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 128 * 1024,
      });
      return {
        stdout: this.cleanCommandOutput(result.stdout),
        stderr: this.cleanCommandOutput(result.stderr),
        code: 0,
      };
    } catch (error: any) {
      return {
        stdout: this.cleanCommandOutput(error?.stdout),
        stderr: this.cleanCommandOutput(error?.stderr || error?.message),
        code: typeof error?.code === 'number' ? error.code : undefined,
      };
    }
  }

  private async runDnsProbe(
    hostname: string,
    useWSL: boolean,
    strategy: CommandExecutionStrategy | null,
  ): Promise<DnsProbeResult> {
    const quotedHostname = shellQuotePathSegment(hostname);
    const script = [
      'if ! command -v timeout >/dev/null 2>&1; then printf "%s\\n" OSECBOX_DNS_TIMEOUT_MISSING >&2; exit 125; fi',
      `if command -v getent >/dev/null 2>&1; then timeout 6s getent ahosts ${quotedHostname}`,
      `elif command -v nslookup >/dev/null 2>&1; then timeout 6s nslookup -timeout=4 -retry=1 ${quotedHostname}`,
      `elif command -v dig >/dev/null 2>&1; then timeout 6s dig +time=4 +tries=1 +short ${quotedHostname}`,
      'else printf "%s\\n" OSECBOX_DNS_TOOL_MISSING >&2; exit 127; fi',
    ].join('; ');

    if (!useWSL) {
      try {
        const addresses = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
        return {
          ok: addresses.length > 0,
          available: true,
          output: addresses.map(address => address.address).join('\n'),
        };
      } catch (error: any) {
        return {
          ok: false,
          available: true,
          error: this.cleanCommandOutput(error?.message || error),
        };
      }
    }

    const result = await this.runRuntimeScript(script, useWSL, strategy);
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const diagnosticUnavailable = /OSECBOX_DNS_(TIMEOUT|TOOL)_MISSING/i.test(combined)
      || result.code === 125
      || result.code === 127;

    return {
      ok: result.code === 0 && Boolean(result.stdout.trim()),
      available: !diagnosticUnavailable,
      output: result.stdout || undefined,
      error: result.code === 0 ? undefined : combined || 'DNS lookup failed',
    };
  }

  private async readDnsEvidence(
    useWSL: boolean,
    strategy: CommandExecutionStrategy | null,
  ): Promise<{ resolverEvidence?: string; routeEvidence?: string }> {
    if (!useWSL && process.platform === 'win32') {
      return {};
    }

    const script = [
      'printf "__OSECBOX_RESOLVER_START__\\n"',
      '(cat /etc/resolv.conf 2>/dev/null || true)',
      '(if command -v resolvectl >/dev/null 2>&1; then resolvectl status --no-pager 2>/dev/null || true; fi)',
      'printf "__OSECBOX_RESOLVER_END__\\n"',
      'printf "__OSECBOX_ROUTE_START__\\n"',
      '(if command -v ip >/dev/null 2>&1; then ip route show default 2>/dev/null || true; printf "__OSECBOX_ROUTE_CHECKED__\\n"; fi)',
      'printf "__OSECBOX_ROUTE_END__\\n"',
    ].join('; ');
    const result = await this.runRuntimeScript(script, useWSL, strategy);
    const evidence = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const resolverMatch = evidence.match(/__OSECBOX_RESOLVER_START__\n([\s\S]*?)\n__OSECBOX_RESOLVER_END__/);
    const routeMatch = evidence.match(/__OSECBOX_ROUTE_START__\n([\s\S]*?)\n__OSECBOX_ROUTE_END__/);

    return {
      resolverEvidence: resolverMatch?.[1]?.trim(),
      routeEvidence: routeMatch?.[1]?.trim(),
    };
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cachedPlatformInfo = null;
    this.lastCheckTime = 0;
    this.wslUserCache.clear();
  }
}

// Singleton instance
export const platformService = new PlatformService();
