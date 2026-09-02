/**
 * Tool discovery and installation guidance.
 *
 * All executable checks go through platformService so native Windows, WSL2,
 * Linux, and macOS use the same validation and timeout behavior.
 */

import * as fs from 'fs/promises';
import { platformService } from '../platform-service';
import { settingsService } from '../services/settings-service';
import { normalizeWordlistName } from '../utils/wsl-path';

interface CachedResult {
  result: any;
  timestamp: number;
}

const toolCheckCache = new Map<string, CachedResult>();
const toolPathCache = new Map<string, { path: string; timestamp: number }>();
// Tool availability can change after WSL recovery or an installation. A
// day-long negative cache turns a transient service failure into a false
// permanent "missing" state, so keep this cache short and re-checkable.
const TOOL_CACHE_DURATION = 5 * 60 * 1000;
const TOOL_PATH_CACHE_DURATION = 5 * 60 * 1000;
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function normalizeToolName(tool: unknown): string | null {
  const normalized = typeof tool === 'string' ? tool.trim() : '';
  return TOOL_NAME_PATTERN.test(normalized) ? normalized : null;
}

function platformCacheKey(
  toolName: string,
  platformInfo: Awaited<ReturnType<typeof platformService.getPlatformInfo>>,
  requiresLinux = false,
): string {
  return [
    toolName,
    platformInfo.platform,
    platformInfo.wsl2Status,
    platformInfo.defaultDistro || '',
    requiresLinux ? 'linux-runtime' : 'native-runtime',
  ].join('|');
}

async function findToolPath(toolName: string): Promise<string> {
  const normalizedToolName = normalizeToolName(toolName);
  if (!normalizedToolName) return toolName;

  try {
    const platformInfo = await platformService.getPlatformInfo();
    // On Windows with WSL2 available, terminal and tool execution are routed
    // into WSL. Check that environment first; a native Windows installation
    // must not make the title bar green when the selected Linux runtime is
    // missing the binary.
    const useWSL = platformInfo.isWindows && platformInfo.wsl2Status === 'available';
    const result = await platformService.checkToolAvailability(normalizedToolName, useWSL);

    return result.available && result.path ? result.path : toolName;
  } catch (error: any) {
    console.warn(`[ToolCheck] Failed to locate ${normalizedToolName}:`, error?.message || error);
    return toolName;
  }
}

async function getToolPath(toolName: string): Promise<string> {
  const platformInfo = await platformService.getPlatformInfo();
  const cacheKey = platformCacheKey(
    toolName,
    platformInfo,
    platformInfo.isWindows && platformInfo.wsl2Status === 'available',
  );
  const now = Date.now();
  const cached = toolPathCache.get(cacheKey);

  if (cached && now - cached.timestamp < TOOL_PATH_CACHE_DURATION) {
    return cached.path;
  }

  const path = await findToolPath(toolName);
  toolPathCache.set(cacheKey, { path, timestamp: now });
  return path;
}

export function registerToolHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void,
  getSystemInfo: () => Promise<any>,
  onPlatformCacheCleared?: () => void,
) {
  // Tool discovery and terminal execution both depend on WSL settings. Clear
  // their caches as soon as the user changes distro, user, or extra PATHs so
  // the UI never reports the previous environment for five minutes.
  settingsService.addListener(() => {
    toolCheckCache.clear();
    toolPathCache.clear();
    onPlatformCacheCleared?.();
  });

  const resolveInstallContext = async () => {
    const [systemInfo, platformInfo] = await Promise.all([
      getSystemInfo(),
      platformService.getPlatformInfo(),
    ]);
    await settingsService.waitUntilReady();

    const useWSL = platformInfo.isWindows && platformInfo.wsl2Status === 'available';
    const configuredDistro = settingsService.getSettings().wsl2Distro?.trim();
    const selectedDistro = configuredDistro && (platformInfo.wsl2Distros || [])
      .find(name => name.toLowerCase() === configuredDistro.toLowerCase());
    if (useWSL && configuredDistro && !selectedDistro) {
      throw new Error(`Configured WSL distro is unavailable: ${configuredDistro}`);
    }
    const distro = useWSL
      ? selectedDistro || platformInfo.defaultDistro || platformInfo.wsl2Distros?.[0]
      : systemInfo.distro || (platformInfo.isMac ? 'darwin' : platformInfo.isWindows ? 'win32' : undefined);
    if (!distro) throw new Error('No supported execution distro was detected');
    const runtime: 'wsl2' | 'linux' | 'darwin' | 'windows' = platformInfo.isWindows
      ? (useWSL ? 'wsl2' : 'windows')
      : platformInfo.isMac
        ? 'darwin'
        : 'linux';

    return { platformInfo, useWSL, distro, runtime };
  };

  registerIPCHandler('get-install-command', async (_event, tool: string) => {
    const normalizedTool = normalizeToolName(tool);
    if (!normalizedTool) return { success: false, error: 'Invalid tool name' };

    try {
      const { toolInstaller } = await import('../tool-installer');
      const { distro, useWSL, platformInfo } = await resolveInstallContext();

      const info = toolInstaller.getInstallCommand(normalizedTool, distro);
      if (useWSL) {
        info.notes = [
          `Run this in the OsecBox Linux terminal (WSL2: ${distro}).`,
          info.notes,
        ].filter(Boolean).join(' ');
      } else if (platformInfo.isWindows) {
        info.notes = [
          'WSL2 is required for OsecBox Linux security tools. Install or enable WSL2 before running this command.',
          info.notes,
        ].filter(Boolean).join(' ');
      }

      console.log(`[ToolInstaller] Install command for ${normalizedTool} on ${distro}:`, info.command);
      return { success: true, info };
    } catch (error: any) {
      console.error('[ToolInstaller] Error getting install command:', error);
      return { success: false, error: error.message };
    }
  });

  registerIPCHandler('get-install-script', async (_event, tools: unknown) => {
    const requestedTools = Array.isArray(tools) ? tools : [];
    const normalizedTools = [...new Set(requestedTools
      .map(tool => normalizeToolName(tool))
      .filter((tool): tool is string => Boolean(tool)))].slice(0, 32);

    if (normalizedTools.length === 0) {
      return { success: false, error: 'No valid tools were selected' };
    }

    try {
      const { toolInstaller } = await import('../tool-installer');
      const { distro, runtime } = await resolveInstallContext();
      if (runtime === 'windows') {
        return {
          success: false,
          error: 'OsecBox security tools require a Linux runtime. Install or enable WSL2, then recheck tools.',
        };
      }

      const bundle = toolInstaller.getInstallScript(normalizedTools, distro, runtime);
      if (bundle.tools.length === 0) {
        return { success: false, error: 'No supported installer is available for the selected tools' };
      }

      return {
        success: true,
        runtime: bundle.runtime,
        shell: bundle.shell,
        distro: bundle.distro,
        tools: bundle.tools,
        script: bundle.script,
      };
    } catch (error: any) {
      console.error('[ToolInstaller] Error generating install script:', error);
      return { success: false, error: error?.message || 'Install script generation failed' };
    }
  });

  registerIPCHandler('check-tool-installed', async (_event, tool: string, requiresLinux = true) => {
    const normalizedTool = normalizeToolName(tool);
    if (!normalizedTool) return { installed: false, error: 'Invalid tool name' };

    try {
      const platformInfo = await platformService.getPlatformInfo();
      const cacheKey = platformCacheKey(normalizedTool, platformInfo, requiresLinux);
      const cached = toolCheckCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < TOOL_CACHE_DURATION) {
        return cached.result;
      }

      const availability = await platformService.checkToolAvailability(normalizedTool, requiresLinux);
      const linuxRuntimeBlocked = platformInfo.isWindows && requiresLinux && platformInfo.wsl2Status !== 'available';

      const result = {
        installed: availability.available,
        path: availability.path,
        version: availability.version,
        error: !availability.available && linuxRuntimeBlocked
          ? `WSL2 unavailable: ${platformInfo.wsl2Error || 'the WSL service could not execute a command'}`
          : undefined,
      };
      toolCheckCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch (error: any) {
      console.error(`[ToolCheck] Error checking ${normalizedTool}:`, error?.message || error);
      return { installed: false, error: error?.message || 'Tool check failed' };
    }
  });

  registerIPCHandler('check-tools-installed', async (_event, tools: unknown, requiresLinux = true) => {
    const requestedTools = Array.isArray(tools) ? tools : [];
    const normalizedTools = [...new Set(requestedTools
      .map(tool => normalizeToolName(tool))
      .filter((tool): tool is string => Boolean(tool)))].slice(0, 64);

    if (normalizedTools.length === 0) {
      return { success: true, tools: {} };
    }

    try {
      const platformInfo = await platformService.getPlatformInfo();
      const cacheKeyFor = (tool: string) => platformCacheKey(tool, platformInfo, requiresLinux);
      const now = Date.now();
      const results: Record<string, any> = {};
      const missing: string[] = [];

      for (const tool of normalizedTools) {
        const cached = toolCheckCache.get(cacheKeyFor(tool));
        if (cached && now - cached.timestamp < TOOL_CACHE_DURATION) {
          results[tool] = cached.result;
        } else {
          missing.push(tool);
        }
      }

      if (missing.length > 0) {
        const availability = await platformService.checkToolAvailabilityBatch(missing, requiresLinux);
        const linuxRuntimeBlocked = platformInfo.isWindows && requiresLinux && platformInfo.wsl2Status !== 'available';
        for (const tool of missing) {
          const result = availability[tool] || { available: false, usedWSL: linuxRuntimeBlocked };
          const normalizedResult = {
            installed: result.available,
            path: result.path,
            version: result.version,
            error: !result.available && linuxRuntimeBlocked
              ? `WSL2 unavailable: ${platformInfo.wsl2Error || 'the WSL service could not execute a command'}`
              : undefined,
          };
          results[tool] = normalizedResult;
          toolCheckCache.set(cacheKeyFor(tool), { result: normalizedResult, timestamp: Date.now() });
        }
      }

      return { success: true, tools: results };
    } catch (error: any) {
      console.error('[ToolCheck] Batch check failed:', error?.message || error);
      return { success: false, error: error?.message || 'Tool check failed', tools: {} };
    }
  });

  registerIPCHandler('clear-tool-cache', async () => {
    toolCheckCache.clear();
    toolPathCache.clear();
    platformService.clearCache();
    onPlatformCacheCleared?.();
    return { success: true };
  });

  registerIPCHandler('detect-tool-paths', async () => {
    try {
      const tools = [
        'nmap', 'subfinder', 'amass', 'assetfinder', 'ffuf',
        'sublist3r',
        'nikto', 'nuclei', 'gobuster', 'msfconsole', 'msfvenom',
      ];
      const entries = await Promise.all(
        tools.map(async tool => [tool, await getToolPath(tool)] as const),
      );
      return {
        success: true,
        paths: Object.fromEntries(entries),
      };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Tool path detection failed' };
    }
  });

  registerIPCHandler('find-wordlist', async (_event, wordlistName: string) => {
    const normalizedName = normalizeWordlistName(wordlistName);
    if (!normalizedName) {
      return { success: false, error: 'Invalid wordlist name' };
    }

    const commonLocations = [
      `/usr/share/wordlists/${normalizedName}`,
      `/usr/share/seclists/${normalizedName}`,
      `/usr/local/share/wordlists/${normalizedName}`,
      `/opt/wordlists/${normalizedName}`,
      `${process.env.HOME || process.cwd()}/wordlists/${normalizedName}`,
      `./wordlists/${normalizedName}`,
    ];

    for (const location of commonLocations) {
      try {
        const stats = await fs.stat(location);
        if (stats.isFile()) return { success: true, path: location };
      } catch {
        // Continue through the known locations.
      }
    }

    return { success: false, error: 'Wordlist was not found in the known locations' };
  });
}
