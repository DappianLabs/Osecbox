// @ts-nocheck
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const os_1 = require("os");
// PERFORMANCE: Lazy load node-pty to avoid blocking startup
// import * as pty from 'node-pty';
const lazy_pty_1 = require("./lazy-pty.cjs");
const fs = __importStar(require("fs/promises"));
const fsPromises = fs;
const platform_service_1 = require("./platform-service.cjs");
// PERFORMANCE: Lazy load heavy services
// import { toolInstaller } from './tool-installer';
// import { AIClient, CONTEXT_EXPANSION_TOOLS, AIConfig } from './ai-client';
const license_manager_1 = require("./license-manager.cjs");
const startup_cache_1 = require("./startup-cache.cjs");
// REFACTORING: Import handler modules
const window_handlers_1 = require("./handlers/window-handlers.cjs");
const update_handlers_1 = require("./handlers/update-handlers.cjs");
const session_handlers_1 = require("./handlers/session-handlers.cjs");
const tool_handlers_1 = require("./handlers/tool-handlers.cjs");
const subdomain_handlers_1 = require("./handlers/subdomain-handlers.cjs");
const ai_handlers_1 = require("./handlers/ai-handlers.cjs");
const metasploit_handlers_1 = require("./handlers/metasploit-handlers.cjs");
const metasploit_command_handlers_1 = require("./handlers/metasploit-command-handlers.cjs");
const terminal_handlers_1 = require("./handlers/terminal-handlers.cjs");
const platform_handlers_1 = require("./handlers/platform-handlers.cjs");
const settings_handlers_1 = require("./handlers/settings-handlers.cjs");
const tool_execution_handlers_1 = require("./handlers/tool-execution-handlers.cjs");
const license_handlers_1 = require("./handlers/license-handlers.cjs");
const command_handlers_1 = require("./handlers/command-handlers.cjs");
const system_handlers_1 = require("./handlers/system-handlers.cjs");
const nmap_scan_handlers_1 = require("./handlers/nmap-scan-handlers.cjs");
const system_command_handlers_1 = require("./handlers/system-command-handlers.cjs");
// Import process manager for cleanup
const process_manager_1 = require("./utils/process-manager.cjs");
const tool_execution_service_1 = require("./services/tool-execution-service.cjs");
const async_timeout_1 = require("./utils/async-timeout.cjs");
const ipc_validator_1 = require("./utils/ipc-validator.cjs");
const security_logger_1 = require("./utils/security-logger.cjs");
// PERFORMANCE: Lazy load terminal and msf services
// import { terminalHistoryService } from './terminal-history-service';
let msfConsoleManager = null;
let terminalHistoryService = null;
async function getMsfConsoleManager() {
    if (!msfConsoleManager) {
        // Use hybrid PTY manager for real-time output + state tracking
        const module = await Promise.resolve().then(() => __importStar(require("./msf-pty-manager.cjs")));
        msfConsoleManager = module.msfPtyManager;
    }
    return msfConsoleManager;
}
async function getTerminalHistoryService() {
    if (!terminalHistoryService) {
        const module = await Promise.resolve().then(() => __importStar(require("./terminal-history-service.cjs")));
        terminalHistoryService = module.terminalHistoryService;
    }
    return terminalHistoryService;
}
const execAsync = (0, util_1.promisify)(child_process_1.exec);
// IPC handler cleanup system with global rate limiting
const ipcHandlerCleanups = [];
const registeredIPCChannels = new Set();
function registerIPCHandler(channel, handler) {
    if (registeredIPCChannels.has(channel)) {
        if (isDev) {
            console.warn(`[IPC] Duplicate registration skipped: ${channel}`);
        }
        return;
    }
    // Wrap handler with origin, payload, and global rate-limit validation.
    const wrappedHandler = async (...args) => {
        if (!(0, ipc_validator_1.validateIPCOrigin)(args[0])) {
            throw new Error(`Unauthorized IPC origin for ${channel}`);
        }
        if (!(0, ipc_validator_1.validatePayloadSize)(args.slice(1))) {
            throw new Error(`IPC payload exceeds the maximum size for ${channel}`);
        }

        // Import rate limiter dynamically to avoid circular dependency
        const { globalIPCRateLimiter } = await Promise.resolve().then(() => __importStar(require("./handlers/rate-limiter.cjs")));
        // Check global rate limit (use channel as identifier)
        const rateLimitCheck = globalIPCRateLimiter.check('global-ipc');
        if (!rateLimitCheck.allowed) {
            console.warn(`[IPC] Global rate limit exceeded for ${channel}`);
            throw new Error(`Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter}s before retrying.`);
        }
        // Call original handler with the original event-first argument list.
        return handler(...args);
    };
    electron_1.ipcMain.handle(channel, wrappedHandler);
    registeredIPCChannels.add(channel);
    ipcHandlerCleanups.push(() => {
        try {
            electron_1.ipcMain.removeHandler(channel);
            registeredIPCChannels.delete(channel);
            console.log(`[IPC Cleanup] Removed handler: ${channel}`);
        }
        catch (e) {
            // Handler might not exist, ignore
        }
    });
}
function registerIPCListener(channel, handler) {
    const wrappedHandler = (...args) => {
        if (!(0, ipc_validator_1.validateIPCOrigin)(args[0])) {
            return;
        }
        if (!(0, ipc_validator_1.validatePayloadSize)(args.slice(1))) {
            return;
        }
        // Preserve the original event-first listener contract.
        return handler(...args);
    };
    electron_1.ipcMain.on(channel, wrappedHandler);
    ipcHandlerCleanups.push(() => {
        try {
            electron_1.ipcMain.removeListener(channel, wrappedHandler);
            console.log(`[IPC Cleanup] Removed listener: ${channel}`);
        }
        catch (e) {
            // Listener might not exist, ignore
        }
    });
}
function cleanupAllIPCHandlers() {
    console.log(`[IPC Cleanup] Cleaning up ${ipcHandlerCleanups.length} handlers`);
    ipcHandlerCleanups.forEach(cleanup => {
        try {
            cleanup();
        }
        catch (e) {
            console.error('[IPC Cleanup] Error during cleanup:', e);
        }
    });
    ipcHandlerCleanups.length = 0; // Clear array
}
// FIX: Increase max listeners to prevent memory leak warnings
const events_1 = require("events");
events_1.EventEmitter.defaultMaxListeners = 50;
// __dirname is available in CommonJS
// const __filename and __dirname are automatically available
let mainWindow = null;
// Use Electron's packaging state instead of NODE_ENV. Installed users can
// inherit environment variables from a launcher, shell, or enterprise policy;
// those variables must never disable production security or update behavior.
const isDev = !electron_1.app.isPackaged;
// Safe IPC send helper to prevent EPIPE errors
function safeSend(channel, ...args) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send(channel, ...args);
        }
        catch (error) {
            if (error.code !== 'EPIPE') {
                console.error(`[IPC] Error sending to ${channel}:`, error);
            }
        }
    }
}
let systemInfo = null;
async function detectSystemInfo() {
    const fs = require('fs').promises;
    const fsSync = require('fs');
    const info = {
        platform: process.platform,
        isAlpine: false,
        isNixOS: false,
        isWSL: false,
        isMusl: false,
        isARM: process.arch === 'arm64' || process.arch === 'arm',
        isWayland: process.env.WAYLAND_DISPLAY !== undefined,
        isSnap: process.env.SNAP !== undefined,
        isFlatpak: process.env.FLATPAK_ID !== undefined,
        hasSELinux: false,
        hasAppArmor: false,
        shell: process.env.SHELL || '/bin/bash',
    };
    if (process.platform === 'linux') {
        // PERFORMANCE: Use Promise.allSettled for parallel async checks
        const checks = await Promise.allSettled([
            // Detect Alpine
            fs.access('/etc/alpine-release').then(() => true).catch(() => false),
            // Detect NixOS
            fs.access('/etc/NIXOS').then(() => true).catch(() => false),
            // Detect WSL
            fs.readFile('/proc/version', 'utf8').then((release) => release.toLowerCase().includes('microsoft') ||
                release.toLowerCase().includes('wsl')).catch(() => false),
            // Detect musl libc
            Promise.all([
                fs.access('/lib/x86_64-linux-gnu/libc.so.6').then(() => true).catch(() => false),
                fs.access('/lib64/libc.so.6').then(() => true).catch(() => false),
                fs.access('/lib/libc.so.6').then(() => true).catch(() => false)
            ]).then(results => !results.some(exists => exists)),
            // Detect SELinux
            fs.access('/etc/selinux/config').then(() => true).catch(() => false),
            // Detect AppArmor
            fs.access('/sys/kernel/security/apparmor').then(() => true).catch(() => false),
            // Detect distro
            fs.readFile('/etc/os-release', 'utf8').then((osRelease) => {
                const match = osRelease.match(/^ID=(.+)$/m);
                return match ? match[1].replace(/"/g, '').toLowerCase() : null;
            }).catch(() => null)
        ]);
        // Extract results
        info.isAlpine = checks[0].status === 'fulfilled' ? checks[0].value : false;
        info.isNixOS = checks[1].status === 'fulfilled' ? checks[1].value : false;
        info.isWSL = checks[2].status === 'fulfilled' ? checks[2].value : false;
        info.isMusl = checks[3].status === 'fulfilled' ? checks[3].value : false;
        info.hasSELinux = checks[4].status === 'fulfilled' ? checks[4].value : false;
        info.hasAppArmor = checks[5].status === 'fulfilled' ? checks[5].value : false;
        if (checks[6].status === 'fulfilled' && checks[6].value) {
            info.distro = checks[6].value;
        }
    }
    // Detect shell
    if (process.platform === 'win32') {
        info.shell = 'cmd.exe';
    }
    else if (info.isAlpine) {
        info.shell = '/bin/ash'; // Alpine uses ash, not bash
    }
    else if (process.env.SHELL) {
        info.shell = process.env.SHELL;
    }
    return info;
}
// UNIVERSAL COMPATIBILITY: Show warnings for edge cases
function showCompatibilityWarnings(info) {
    const warnings = [];
    const os = require('os');
    if (info.isAlpine || info.isMusl) {
        warnings.push('[!] Alpine Linux/musl detected - some features may have limited support');
        warnings.push('[Tip] Install tools via apk: apk add nmap nikto nuclei');
    }
    if (info.isNixOS) {
        warnings.push('[i] NixOS detected - ensure pentesting tools are in your PATH');
        warnings.push('[Tip] Use nix-shell -p nmap nikto nuclei or add to configuration.nix');
    }
    if (info.isSnap || info.isFlatpak) {
        warnings.push('[!] Sandboxed environment detected - system tools may not be accessible');
        warnings.push('[Tip] Install tools outside sandbox or grant additional permissions');
    }
    if (info.isARM) {
        warnings.push('[i] ARM architecture detected - some tools may not be available');
        if (process.platform === 'linux') {
            warnings.push('[Tip] Use native ARM packages when available (apt, yum, pacman)');
        }
        if (process.platform === 'win32') {
            warnings.push('[!] Windows ARM64 - x86 tools will run in emulation (slower)');
        }
    }
    if (info.hasSELinux) {
        try {
            const { execSync } = require('child_process');
            const selinuxMode = execSync('getenforce', { encoding: 'utf-8', timeout: 1000 }).trim();
            if (selinuxMode === 'Enforcing') {
                warnings.push('[!] SELinux is enforcing - some operations may be blocked');
                warnings.push('[Tip] Use setsebool or create custom policies for pentesting tools');
            }
        }
        catch { }
    }
    if (info.hasAppArmor) {
        try {
            const { execSync } = require('child_process');
            const aaStatus = execSync('aa-status --enabled', { encoding: 'utf-8', timeout: 1000 }).trim();
            if (aaStatus === 'Yes') {
                warnings.push('[!] AppArmor is active - some operations may be restricted');
                warnings.push('[Tip] Check aa-status and disable profiles if needed: aa-disable');
            }
        }
        catch { }
    }
    // LINUX: Check for common missing dependencies
    if (process.platform === 'linux') {
        const missingDeps = [];
        const { execSync } = require('child_process');
        try {
            // Check for Python (required by many tools)
            execSync('python3 --version', { timeout: 1000, stdio: 'ignore' });
        }
        catch {
            missingDeps.push('python3');
        }
        try {
            // Check for pip (required for Python tools)
            execSync('pip3 --version', { timeout: 1000, stdio: 'ignore' });
        }
        catch {
            missingDeps.push('python3-pip');
        }
        try {
            // Check for curl (required for many downloads)
            execSync('curl --version', { timeout: 1000, stdio: 'ignore' });
        }
        catch {
            missingDeps.push('curl');
        }
        try {
            // Check for git (required for tool installation)
            execSync('git --version', { timeout: 1000, stdio: 'ignore' });
        }
        catch {
            missingDeps.push('git');
        }
        if (missingDeps.length > 0) {
            warnings.push(`[!] Missing dependencies: ${missingDeps.join(', ')}`);
            if (info.distro?.includes('ubuntu') || info.distro?.includes('debian')) {
                warnings.push(`[Install] sudo apt update && sudo apt install ${missingDeps.join(' ')}`);
            }
            else if (info.distro?.includes('fedora') || info.distro?.includes('rhel') || info.distro?.includes('centos')) {
                warnings.push(`[Install] sudo dnf install ${missingDeps.join(' ')}`);
            }
            else if (info.distro?.includes('arch')) {
                warnings.push(`[Install] sudo pacman -S ${missingDeps.join(' ')}`);
            }
            else if (info.isAlpine) {
                warnings.push(`[Install] sudo apk add ${missingDeps.join(' ')}`);
            }
        }
    }
    // LINUX: Check for Wayland-specific issues
    if (info.isWayland) {
        warnings.push('[i] Wayland detected - some X11-based tools may need XWayland');
    }
    if (process.platform === 'win32') {
        if (os.release().includes('Server')) {
            warnings.push('[i] Windows Server detected - GPU acceleration may be limited');
        }
        // Check for Windows S Mode (can't run .exe files)
        try {
            const { execSync } = require('child_process');
            const edition = execSync('powershell -Command "Get-WindowsEdition -Online | Select-Object -ExpandProperty Edition"', {
                encoding: 'utf-8',
                timeout: 3000,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (edition.includes('SMode') || edition.includes('S Mode')) {
                warnings.push('[CRITICAL] Windows S Mode detected - app may not function properly');
            }
        }
        catch { }
    }
    // Check for low memory
    const totalMemGB = os.totalmem() / (1024 * 1024 * 1024);
    if (totalMemGB < 4) {
        warnings.push(`[!] Low system memory (${totalMemGB.toFixed(1)}GB) - performance may be affected`);
    }
    // Check for SSH session (remote)
    if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT) {
        warnings.push('[i] SSH session detected - running remotely');
    }
    if (warnings.length > 0) {
        console.log('\n' + '='.repeat(70));
        console.log('COMPATIBILITY NOTICES:');
        warnings.forEach(w => console.log('  ' + w));
        console.log('='.repeat(70) + '\n');
    }
}
// UNIVERSAL COMPATIBILITY: Enhanced tool path detection for all distros
async function findToolPath(toolName) {
    const { execSync } = require('child_process');
    const fsSync = require('fs');
    // Ensure system info is loaded
    if (!systemInfo) {
        systemInfo = await detectSystemInfo();
    }
    // LINUX COMPATIBILITY: Enhanced Linux-first tool detection
    if (process.platform === 'linux') {
        // Method 1: Use which with comprehensive PATH
        try {
            const linuxPaths = [
                '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin',
                '/sbin', '/bin', '/snap/bin', '/opt/bin', '/usr/games', '/usr/local/games',
                '/home/linuxbrew/.linuxbrew/bin', '/home/linuxbrew/.linuxbrew/sbin',
                `${process.env.HOME}/go/bin`, `${process.env.HOME}/.local/bin`,
                `${process.env.HOME}/.cargo/bin`, `${process.env.HOME}/bin`
            ].filter(Boolean);
            // ALPINE: Use ash instead of bash
            const shell = systemInfo.isAlpine ? 'ash' : 'bash';
            const pathEnv = linuxPaths.join(':');
            const result = execSync(`${shell} -c "PATH=${pathEnv}:$PATH which ${toolName} 2>/dev/null || echo ''"`, {
                encoding: 'utf-8',
                timeout: 1500,
                stdio: ['pipe', 'pipe', 'ignore'],
            }).trim();
            if (result && result.length > 0 && !result.includes('not found')) {
                console.log(`[Linux] Found ${toolName} at: ${result}`);
                return result;
            }
        }
        catch (error) {
            console.log(`[Linux] 'which' failed for ${toolName}, trying direct paths...`);
        }
        // Method 2: Check Linux-specific paths directly
        const linuxCommonPaths = [
            `/usr/bin/${toolName}`, `/usr/local/bin/${toolName}`, `/usr/sbin/${toolName}`,
            `/usr/local/sbin/${toolName}`, `/sbin/${toolName}`, `/bin/${toolName}`,
            `/snap/bin/${toolName}`, `/opt/bin/${toolName}`, `/usr/games/${toolName}`,
            `/usr/local/games/${toolName}`, `${process.env.HOME}/go/bin/${toolName}`,
            `${process.env.HOME}/.local/bin/${toolName}`, `${process.env.HOME}/.cargo/bin/${toolName}`,
            `${process.env.HOME}/bin/${toolName}`, `/home/linuxbrew/.linuxbrew/bin/${toolName}`,
            `/home/linuxbrew/.linuxbrew/sbin/${toolName}`
        ].filter(Boolean);
        // ALPINE: Additional Alpine-specific paths
        if (systemInfo.isAlpine) {
            linuxCommonPaths.push(`/usr/local/sbin/${toolName}`);
            linuxCommonPaths.push(`/usr/local/libexec/${toolName}`);
        }
        // NIXOS: Check if tool is in current PATH (NixOS requirement)
        if (systemInfo.isNixOS) {
            try {
                const nixResult = execSync(`which ${toolName}`, {
                    encoding: 'utf-8',
                    timeout: 1000,
                    stdio: ['pipe', 'pipe', 'ignore'],
                }).trim();
                if (nixResult && !nixResult.includes('not found')) {
                    console.log(`[NixOS] Found ${toolName} in PATH: ${nixResult}`);
                    return nixResult;
                }
            }
            catch { }
            console.log(`[NixOS] ${toolName} not in PATH - ensure it's installed via nix-env or nix-shell`);
        }
        // Check each path
        for (const path of linuxCommonPaths) {
            try {
                await fsPromises.access(path, fsSync.constants.X_OK);
                console.log(`[Linux] Found executable ${toolName} at: ${path}`);
                return path;
            }
            catch { }
        }
        // Method 3: Try whereis as fallback
        try {
            const shell = systemInfo.isAlpine ? 'ash' : 'bash';
            const whereisResult = execSync(`${shell} -c "whereis -b ${toolName}"`, {
                encoding: 'utf-8',
                timeout: 1000,
                stdio: ['pipe', 'pipe', 'ignore'],
            }).trim();
            const match = whereisResult.match(new RegExp(`${toolName}:\\s+([^\\s]+)`));
            if (match && match[1]) {
                console.log(`[Linux] Found ${toolName} via whereis: ${match[1]}`);
                return match[1];
            }
        }
        catch { }
        console.log(`[Linux] Tool ${toolName} not found in standard locations`);
    }
    // WINDOWS + WSL2: Comprehensive WSL2 detection
    if (process.platform === 'win32') {
        // Try multiple WSL distributions (Kali first since pentesting tools are usually there)
        const wslDistros = ['kali-linux', '', 'Ubuntu', 'Debian', 'Ubuntu-20.04', 'Ubuntu-22.04'];
        for (const distro of wslDistros) {
            try {
                const distroFlag = distro ? `-d ${distro}` : '';
                // Method 1: Use which with full PATH
                try {
                    const wslResult = execSync(`wsl ${distroFlag} bash -c "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:/opt/bin:$HOME/go/bin:$HOME/.local/bin which ${toolName} 2>/dev/null || echo ''"`, {
                        encoding: 'utf-8',
                        timeout: 2000, // Reduced from 5000ms to 2000ms
                        stdio: ['pipe', 'pipe', 'ignore'],
                        windowsHide: true,
                    }).trim();
                    if (wslResult && wslResult.length > 0 && !wslResult.includes('not found')) {
                        console.log(`[Compatibility] Found ${toolName} in WSL2${distro ? ` (${distro})` : ''} at: ${wslResult}`);
                        return wslResult;
                    }
                }
                catch { }
                // Method 2: Check common paths directly
                const commonWSLPaths = [
                    `/usr/bin/${toolName}`,
                    `/usr/local/bin/${toolName}`,
                    `/usr/sbin/${toolName}`,
                    `/usr/local/sbin/${toolName}`,
                    `/sbin/${toolName}`,
                    `/bin/${toolName}`,
                    `/snap/bin/${toolName}`,
                    `/opt/bin/${toolName}`,
                    `~/.local/bin/${toolName}`,
                    `~/go/bin/${toolName}`,
                    `/usr/games/${toolName}`,
                    `/usr/local/games/${toolName}`,
                ];
                for (const path of commonWSLPaths) {
                    try {
                        const testResult = execSync(`wsl ${distroFlag} bash -c "test -f ${path} && echo ${path} || echo ''"`, {
                            encoding: 'utf-8',
                            timeout: 2000,
                            stdio: ['pipe', 'pipe', 'ignore'],
                            windowsHide: true,
                        }).trim();
                        if (testResult && testResult.length > 0) {
                            console.log(`[Compatibility] Found ${toolName} in WSL2${distro ? ` (${distro})` : ''} at: ${testResult}`);
                            return testResult;
                        }
                    }
                    catch { }
                }
                // Method 3: Try whereis as fallback
                try {
                    const whereisResult = execSync(`wsl ${distroFlag} whereis -b ${toolName}`, {
                        encoding: 'utf-8',
                        timeout: 1500, // Reduced from 3000ms to 1500ms
                        stdio: ['pipe', 'pipe', 'ignore'],
                        windowsHide: true,
                    }).trim();
                    // whereis output: "nmap: /usr/bin/nmap /usr/share/nmap"
                    const match = whereisResult.match(new RegExp(`${toolName}:\\s+([^\\s]+)`));
                    if (match && match[1]) {
                        console.log(`[Compatibility] Found ${toolName} via whereis in WSL2${distro ? ` (${distro})` : ''}: ${match[1]}`);
                        return match[1];
                    }
                }
                catch { }
            }
            catch (error) {
                // Try next distro
                continue;
            }
        }
        console.log(`[Compatibility] Tool ${toolName} not found in any WSL2 distribution`);
    }
    try {
        // Method 1: Use 'which' (works on most Unix-like systems)
        const command = process.platform === 'win32' ? 'where' : 'which';
        // FIX: Add PATH to environment to ensure tools are found
        const envWithPath = {
            ...process.env,
            PATH: process.env.PATH
                ? `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:${process.env.HOME}/go/bin`
                : '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin',
        };
        const result = execSync(`${command} ${toolName}`, {
            encoding: 'utf-8',
            timeout: 1500, // Reduced from 3000ms to 1500ms
            stdio: ['pipe', 'pipe', 'ignore'],
            env: envWithPath
        }).trim();
        const foundPath = result.split('\n')[0];
        if (foundPath && foundPath.length > 0 && !foundPath.includes('not found')) {
            console.log(`[Compatibility] Found ${toolName} at: ${foundPath}`);
            return foundPath;
        }
    }
    catch (error) {
        console.log(`[Compatibility] 'which' failed for ${toolName}, trying common paths...`);
    }
    // Method 2: Check common locations based on OS/distro
    const commonPaths = [];
    // Standard Linux paths
    if (process.platform === 'linux') {
        commonPaths.push(`/usr/bin/${toolName}`);
        commonPaths.push(`/usr/local/bin/${toolName}`);
        commonPaths.push(`/opt/bin/${toolName}`);
        commonPaths.push(`/bin/${toolName}`);
        commonPaths.push(`/usr/local/sbin/${toolName}`);
        commonPaths.push(`/usr/sbin/${toolName}`);
        // Go binaries (common for subfinder, amass, etc.)
        if (process.env.HOME) {
            commonPaths.push(`${process.env.HOME}/go/bin/${toolName}`);
        }
        // Homebrew on Linux
        commonPaths.push(`/home/linuxbrew/.linuxbrew/bin/${toolName}`);
        // Alpine-specific
        if (systemInfo.isAlpine) {
            commonPaths.push(`/usr/local/sbin/${toolName}`);
        }
        // NixOS: Don't check /nix/store, must be in PATH
        if (systemInfo.isNixOS) {
            console.log(`[Compatibility] NixOS detected - ${toolName} must be in PATH`);
        }
    }
    // BSD paths
    if (process.platform === 'freebsd' || process.platform === 'openbsd') {
        commonPaths.push(`/usr/local/bin/${toolName}`);
        commonPaths.push(`/usr/pkg/bin/${toolName}`);
    }
    // macOS paths
    if (process.platform === 'darwin') {
        commonPaths.push(`/usr/local/bin/${toolName}`);
        commonPaths.push(`/opt/homebrew/bin/${toolName}`); // Apple Silicon
        commonPaths.push(`/opt/local/bin/${toolName}`); // MacPorts
        commonPaths.push(`/sw/bin/${toolName}`); // Fink
        if (process.env.HOME) {
            commonPaths.push(`${process.env.HOME}/go/bin/${toolName}`);
        }
    }
    // Windows paths
    if (process.platform === 'win32') {
        commonPaths.push(`C:\\Program Files (x86)\\Nmap\\${toolName}.exe`);
        commonPaths.push(`C:\\Program Files\\${toolName}\\${toolName}.exe`);
        commonPaths.push(`C:\\Tools\\${toolName}\\${toolName}.exe`);
        commonPaths.push(`C:\\ProgramData\\chocolatey\\bin\\${toolName}.exe`);
        commonPaths.push(`C:\\msys64\\usr\\bin\\${toolName}.exe`);
    }
    // Check each path
    for (const path of commonPaths) {
        try {
            await fsPromises.access(path);
            console.log(`[Compatibility] Found ${toolName} at: ${path}`);
            return path;
        }
        catch { }
    }
    // Method 3: Fallback - return tool name and hope it's in PATH
    console.warn(`[Compatibility] ${toolName} not found in common locations, using name only`);
    return toolName;
}
// Nmap path detection (legacy fallback)
function getNmapPath() {
    const os = (0, os_1.platform)();
    switch (os) {
        case 'win32':
            return 'C:\\Program Files (x86)\\Nmap\\nmap.exe';
        case 'darwin':
            return '/usr/local/bin/nmap';
        case 'linux':
            return '/usr/bin/nmap';
        default:
            return 'nmap';
    }
}
let nmapPath = getNmapPath();
const activeScans = new Map();
const activeScansTTL = new Map();
const SCAN_TTL = 30 * 60 * 1000; // 30 minutes TTL
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
// TTL cleanup function
const cleanupInactiveScans = () => {
    const now = Date.now();
    const toCleanup = [];
    for (const [scanId, entry] of activeScansTTL.entries()) {
        // PTYs back interactive terminals and listener/tunnel sessions. An idle
        // prompt is not stale user work, so it must never be reclaimed by the
        // regular scan TTL.
        if (entry.type === 'pty')
            continue;
        const age = now - entry.lastActivity;
        if (age > SCAN_TTL) {
            console.warn(`[TTL-Cleanup] Cleaning up inactive scan: ${scanId} (age: ${Math.round(age / 1000)}s)`);
            toCleanup.push(scanId);
        }
    }
    // Cleanup expired scans
    for (const scanId of toCleanup) {
        const entry = activeScansTTL.get(scanId);
        if (entry) {
            try {
                // Clean up the process
                if (entry.type === 'pty' && 'kill' in entry.process) {
                    entry.process.removeAllListeners();
                    entry.process.kill('SIGTERM');
                }
                else if ('kill' in entry.process) {
                    entry.process.kill('SIGTERM');
                }
            }
            catch (error) {
                console.warn(`[TTL-Cleanup] Error cleaning up ${scanId}:`, error);
            }
            // Remove from both maps
            activeScans.delete(scanId);
            activeScansTTL.delete(scanId);
        }
    }
    if (toCleanup.length > 0) {
        console.log(`[TTL-Cleanup] Cleaned up ${toCleanup.length} inactive scans`);
    }
};
// TTL cleanup interval will be started in app.whenReady()
// DO NOT start it here - it must start after app is ready
// Helper function to register scan with TTL tracking
const registerScanWithTTL = (scanId, process, type = 'regular') => {
    const now = Date.now();
    activeScans.set(scanId, process);
    activeScansTTL.set(scanId, {
        process,
        createdAt: now,
        lastActivity: now,
        type
    });
    console.log(`[TTL-Tracking] Registered scan: ${scanId} (type: ${type})`);
};
// Helper function to update activity timestamp
const updateScanActivity = (scanId) => {
    const entry = activeScansTTL.get(scanId);
    if (entry) {
        entry.lastActivity = Date.now();
    }
};
const maxConcurrentScans = 5;
const scanTimeout = 300000; // 5 minutes
// Cleanup lock to prevent race conditions
let isCleaningUp = false;
let cleanupProcessesPromise = null;
// Shared cleanup function to prevent race conditions
async function cleanupProcessesInternal() {
    if (isCleaningUp) {
        console.log('[cleanup] Already in progress, skipping');
        return;
    }
    isCleaningUp = true;
    console.log('[cleanup] Starting cleanup of', activeScans.size, 'processes');
    try {
        // METASPLOIT: Cleanup persistent console
        console.log('[cleanup] Cleaning up Metasploit console...');
        if (msfConsoleManager) {
            msfConsoleManager.cleanup();
        }
        const killPromises = Array.from(activeScans.entries()).map(([scanId, childProcess]) => {
            return new Promise((resolve) => {
                try {
                    const pid = childProcess.pid;
                    const isPty = activeScansTTL.get(scanId)?.type === 'pty';
                    if (isPty) {
                        // PTYs and ChildProcesses both expose kill(), so use the
                        // explicit registration type rather than duck-typing.
                        childProcess.removeAllListeners?.();
                        childProcess.kill?.();
                        resolve();
                    }
                    else if (typeof childProcess.kill === 'function') {
                        // Proper zombie process handling: graceful termination,
                        // followed by a bounded force-kill fallback.
                        childProcess.kill('SIGTERM');
                        const gracefulTimeout = setTimeout(() => {
                            try {
                                if (pid) {
                                    childProcess.kill(0);
                                    console.warn(`[cleanup] Process ${scanId} (PID ${pid}) didn't exit gracefully, force killing`);
                                    childProcess.kill('SIGKILL');
                                    setTimeout(() => {
                                        try {
                                            if (process.platform !== 'win32') {
                                                require('child_process').execSync(`kill -9 ${pid}`, { timeout: 1000 });
                                            }
                                        }
                                        catch {
                                            // Process is dead or we don't have permission.
                                        }
                                    }, 500);
                                }
                            }
                            catch {
                                // Process already dead (kill(0) threw error).
                            }
                            resolve();
                        }, 2000);
                        childProcess.once?.('exit', () => {
                            clearTimeout(gracefulTimeout);
                            resolve();
                        });
                    }
                    else {
                        resolve();
                    }
                }
                catch (error) {
                    console.error('[cleanup] Failed to kill process:', error);
                    resolve();
                }
            });
        });
        // Generic tool children are tracked separately from active scan/PTY
        // sessions. Stop both sets before clearing the scan registries.
        await Promise.all([
            Promise.all(killPromises),
            tool_execution_service_1.toolExecutionService.killAllProcesses(),
        ]);
        activeScans.clear();
        activeScansTTL.clear();
        console.log('[cleanup] Complete');
    }
    finally {
        isCleaningUp = false;
    }
}
function cleanupProcesses() {
    if (cleanupProcessesPromise) {
        console.log('[cleanup] Already in progress, sharing the existing cleanup');
        return cleanupProcessesPromise;
    }
    const cleanupPromise = cleanupProcessesInternal();
    cleanupProcessesPromise = cleanupPromise;
    cleanupPromise.then(() => {
        if (cleanupProcessesPromise === cleanupPromise)
            cleanupProcessesPromise = null;
    }, () => {
        if (cleanupProcessesPromise === cleanupPromise)
            cleanupProcessesPromise = null;
    });
    return cleanupPromise;
}
// Auto-updater configuration
electron_updater_1.autoUpdater.autoDownload = false; // Don't auto-download, let user decide
electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
// Keep updater diagnostics out of the startup console. UI events and the
// explicit error handler below still report actionable update state.
electron_updater_1.autoUpdater.logger = null;
// Auto-updater event handlers
electron_updater_1.autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
});
electron_updater_1.autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    safeSend('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
    });
});
electron_updater_1.autoUpdater.on('update-not-available', () => {
    console.log('[Updater] No updates available');
    safeSend('update-not-available');
});
electron_updater_1.autoUpdater.on('download-progress', (progress) => {
    console.log(`[Updater] Download progress: ${progress.percent}%`);
    safeSend('update-download-progress', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
    });
});
electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    safeSend('update-downloaded', {
        version: info.version,
    });
});
electron_updater_1.autoUpdater.on('error', (error) => {
    const updaterError = error;
    const message = updaterError.message || String(error);
    const isUnpublishedBuild = updaterError.code === 'ERR_XML_MISSED_ELEMENT' ||
        message.toLowerCase().includes('no published versions');
    if (isUnpublishedBuild) {
        console.warn('[Updater] No published release available yet');
    }
    else {
        console.error('[Updater] Error:', error);
    }
    safeSend('update-error', {
        message,
    });
});
// Parse Metasploit search output
// Moved to utils/parsing.ts with error handling
// Parse Metasploit module options
// Moved to utils/parsing.ts with error handling
// Parse Metasploit payloads output
// Moved to utils/parsing.ts with error handling
// Parse Metasploit sessions output
// Moved to utils/parsing.ts with error handling
// Parse Metasploit handlers/jobs output
// Moved to utils/parsing.ts with error handling
// SECURITY: Input validation functions
function validateTarget(target) {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
    const rangeRegex = /^(\d{1,3}\.){3}\d{1,3}-\d{1,3}$/;
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (/[;&|`$(){}[\]<>\\]/.test(target)) {
        return false;
    }
    return ipRegex.test(target) || cidrRegex.test(target) || rangeRegex.test(target) || hostnameRegex.test(target);
}
function validateFlags(flags) {
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
function createWindow() {
    // RESPONSIVE: Adapt window size to screen resolution
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    // Calculate an optimal window size without exceeding small laptop, remote
    // desktop, or accessibility display work areas. The old fixed 1024x768
    // minimum could open a window larger than the user's screen.
    const availableWidth = Math.max(320, screenWidth - 24);
    const availableHeight = Math.max(420, screenHeight - 48);
    const minimumWidth = Math.min(1024, availableWidth);
    const minimumHeight = Math.min(768, availableHeight);
    const optimalWidth = Math.min(Math.max(Math.floor(screenWidth * 0.8), minimumWidth), availableWidth);
    const optimalHeight = Math.min(Math.max(Math.floor(screenHeight * 0.85), minimumHeight), availableHeight);
    console.log(`[Electron] Screen: ${screenWidth}x${screenHeight}, Window: ${optimalWidth}x${optimalHeight}`);
    mainWindow = new electron_1.BrowserWindow({
        width: optimalWidth,
        height: optimalHeight,
        minWidth: minimumWidth,
        minHeight: minimumHeight,
        backgroundColor: '#0f0f14',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path_1.default.join(__dirname, 'preload.cjs'),
            // COMPATIBILITY: Let Chromium decide WebGL based on GPU
            // availability; no legacy WebSQL toggle is required.
            // SECURITY: Enable web security (only disable if you have CORS issues)
            webSecurity: !isDev, // Disabled in dev for hot reload, enabled in production
            // SECURITY: Enable sandbox
            sandbox: true,
            // SECURITY: Disable node integration in workers
            nodeIntegrationInWorker: false,
            // SECURITY: Disable node integration in subframes
            nodeIntegrationInSubFrames: false,
            // REMOVED: enableRemoteModule is deprecated in Electron 14+
        },
        frame: false,
        titleBarStyle: 'hidden',
        icon: path_1.default.join(__dirname, '../public/osecbox-icon.png'),
    });
    let hasShownMainWindow = false;
    let firstPaintFallback = null;
    const showMainWindow = () => {
        if (hasShownMainWindow || !mainWindow || mainWindow.isDestroyed())
            return;
        hasShownMainWindow = true;
        if (firstPaintFallback)
            clearTimeout(firstPaintFallback);
        mainWindow.show();
        console.log('[Electron] Window shown at first paint');
    };
    // ready-to-show reveals the static renderer loading shell as soon as the
    // first frame is ready. The fallback prevents a GPU/remote-desktop quirk
    // from leaving users with a hidden window forever.
    mainWindow.once('ready-to-show', showMainWindow);
    firstPaintFallback = setTimeout(showMainWindow, 1000);
    // Remove menu bar completely
    mainWindow.setMenu(null);
    // SECURITY: Set Content Security Policy
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    isDev
                        ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:* data: blob:;"
                        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.groq.com https://*.groq.com; font-src 'self' data:;"
                ],
                'X-Content-Type-Options': ['nosniff'],
                'X-Frame-Options': ['DENY'],
                'X-XSS-Protection': ['1; mode=block'],
                'Referrer-Policy': ['strict-origin-when-cross-origin'],
            }
        });
    });
    // Load the app
    if (isDev) {
        // FIX: Electron 32+ bug - DevTools opens in light mode
        // Workaround: Toggle nativeTheme when DevTools opens
        // Reference: https://github.com/electron/electron/issues/43367
        const { nativeTheme } = require('electron');
        // Set initial theme
        nativeTheme.themeSource = 'dark';
        // Apply workaround when DevTools opens
        mainWindow.webContents.on('devtools-opened', () => {
            // Toggle theme to force DevTools to respect dark mode
            nativeTheme.themeSource = 'light';
            setTimeout(() => {
                nativeTheme.themeSource = 'dark';
            }, 300);
        });
        // Log any console errors
        mainWindow.webContents.on('console-message', (_event, level, message) => {
            if (level === 3) { // Error level
                console.error('[Renderer Error]:', message);
            }
        });
        // Log page load errors
        mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
            console.error('[Load Failed]:', errorCode, errorDescription);
        });
        // PERFORMANCE: Show window immediately when loaded, open DevTools later
        mainWindow.webContents.on('did-finish-load', () => {
            // Show window immediately for fast startup
            showMainWindow();
            console.log('[Electron] Window shown');
            // CRITICAL OPTIMIZATION: Open DevTools after 5s to not block UI
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.openDevTools({
                        mode: 'detach',
                        activate: true
                    });
                    console.log('[Electron] DevTools opened');
                }
            }, 5000); // 5 seconds - user is already interacting with UI
        });
        mainWindow.loadURL('http://localhost:5002');
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../public/index.html'));
        mainWindow.webContents.on('did-finish-load', () => {
            showMainWindow();
            // Don't open DevTools in production
            console.log('[Electron] Window loaded successfully');
        });
    }
    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    // SECURITY: Keep the main renderer on the application origin/file. A
    // compromised page must not navigate the privileged BrowserWindow to an
    // attacker-controlled origin and then invoke the exposed preload bridge.
    const isAllowedRendererNavigation = (url) => {
        try {
            if (isDev) {
                const target = new URL(url);
                return target.protocol === 'http:'
                    && (target.hostname === 'localhost' || target.hostname === '127.0.0.1')
                    && target.port === '5002';
            }
            const fileURLToPath = require('url').fileURLToPath;
            const targetPath = path_1.default.resolve(fileURLToPath(url));
            const appPath = path_1.default.resolve(path_1.default.join(__dirname, '../public/index.html'));
            return targetPath === appPath;
        }
        catch {
            return false;
        }
    };
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (isAllowedRendererNavigation(url)) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) {
            electron_1.shell.openExternal(url).catch(() => undefined);
        }
    });
    // Intercept window close to check for unsaved work. A renderer that is
    // still loading or a process that refuses to exit must never hold the
    // native close event open indefinitely.
    let closeCheckInFlight = false;
    const closeAfterCleanup = async () => {
        try {
            await (0, async_timeout_1.withTimeout)(cleanupProcesses(), 2500, 'window close cleanup');
        }
        catch (error) {
            console.error('[Close] Cleanup error; destroying window:', error);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy();
        }
    };
    mainWindow.on('close', async (e) => {
        if (!mainWindow)
            return;
        // Prevent default
        e.preventDefault();
        if (closeCheckInFlight)
            return;
        closeCheckInFlight = true;
        // Ask renderer if there's unsaved work
        try {
            const response = await (0, async_timeout_1.withTimeout)(mainWindow.webContents.executeJavaScript(`
        (function() {
          const nmapState = window.__nmapContextState;
          const hasWork = nmapState?.tabs?.length > 0 ||
                          localStorage.getItem('nikto-history') ||
                          localStorage.getItem('nuclei-history') ||
                          localStorage.getItem('dirbuster-history');
          return hasWork;
        })()
      `), 1500, 'renderer close-state check');
            if (response) {
                // Has unsaved work - send event to show dialog
                mainWindow.webContents.send('request-save-before-close');
            }
            else {
                // No unsaved work - close immediately
                await closeAfterCleanup();
            }
        }
        catch (error) {
            console.error('[Close] Error checking for unsaved work:', error);
            // On error, close rather than trapping the user in a prevented close event.
            await closeAfterCleanup();
        }
        finally {
            closeCheckInFlight = false;
        }
    });
    mainWindow.on('closed', () => {
        if (firstPaintFallback)
            clearTimeout(firstPaintFallback);
        mainWindow = null;
    });
    // Set main window for Metasploit terminal integration
    (0, metasploit_handlers_1.setMetasploitMainWindow)(mainWindow);
}
// PERFORMANCE: Electron optimization flags. Keep only flags that preserve
// terminal responsiveness; disabling site isolation/CORS globally weakens
// Chromium security and causes compatibility surprises on user machines.
electron_1.app.commandLine.appendSwitch('disable-background-timer-throttling');
electron_1.app.commandLine.appendSwitch('disable-renderer-backgrounding');
// Limit V8 heap size (512MB is plenty for this app)
electron_1.app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
// Disable DevTools in production
if (!isDev) {
    electron_1.app.commandLine.appendSwitch('disable-devtools');
}
// UNIVERSAL COMPATIBILITY: Enhanced GPU detection for all OS
async function detectGPU() {
    try {
        // Ensure system info is loaded
        if (!systemInfo) {
            systemInfo = await detectSystemInfo();
        }
        // Headless environments
        if (process.env.OSECBOX_HEADLESS === 'true' ||
            process.env.CI === 'true') {
            console.log('[Compatibility] Headless/CI environment detected');
            return false;
        }
        // Sandboxed environments (limited GPU access)
        if (systemInfo.isSnap || systemInfo.isFlatpak) {
            console.log('[Compatibility] Sandboxed environment - disabling GPU for stability');
            return false;
        }
        // Alpine/musl - GPU may not work properly with Electron
        if (systemInfo.isAlpine || systemInfo.isMusl) {
            console.log('[Compatibility] Alpine/musl detected - disabling GPU for stability');
            return false;
        }
        // Linux-specific checks
        if (process.platform === 'linux') {
            // No display server
            if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
                console.log('[Compatibility] No display server detected');
                return false;
            }
            // Remote display (X11 forwarding)
            if (process.env.DISPLAY) {
                const display = process.env.DISPLAY;
                // :0 = local, :1+ = remote or VNC
                if (display.includes(':') && !display.startsWith(':0')) {
                    console.log('[Compatibility] Remote display detected:', display);
                    return false;
                }
            }
            // SSH session
            if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT) {
                console.log('[Compatibility] SSH session detected - disabling GPU');
                return false;
            }
            // Check for GPU drivers (optional, don't fail if missing)
            try {
                (0, child_process_1.exec)('which glxinfo', (error) => {
                    if (!error) {
                        console.log('[Compatibility] GPU tools available (glxinfo found)');
                    }
                });
            }
            catch {
                // glxinfo not available, but that's okay
            }
        }
        // Windows-specific checks
        if (process.platform === 'win32') {
            const os = require('os');
            // Windows Server often has no GPU
            if (os.release().includes('Server')) {
                console.log('[Compatibility] Windows Server detected - disabling GPU');
                return false;
            }
            // Remote Desktop session
            if (process.env.SESSIONNAME && process.env.SESSIONNAME.toUpperCase().includes('RDP')) {
                console.log('[Compatibility] Remote Desktop session detected');
                return false;
            }
        }
        // macOS - usually has GPU
        if (process.platform === 'darwin') {
            console.log('[Compatibility] macOS detected - GPU available');
            return true;
        }
        // On Windows/Mac, assume GPU available
        // (Can't easily detect without native modules)
        console.log('[Compatibility] GPU assumed available');
        return true;
    }
    catch (error) {
        console.warn('[Compatibility] GPU detection failed, assuming no GPU:', error);
        return false;
    }
}
// Production Windows builds default to software rendering because an
// unavailable or incompatible GPU driver can terminate Chromium before the
// first window is usable. Advanced users can opt in with OSECBOX_ENABLE_GPU=true.
const useWindowsGpu = process.platform !== 'win32' || isDev || process.env.OSECBOX_ENABLE_GPU === 'true';
if (!useWindowsGpu) {
    console.log('[Compatibility] Windows production build: using software rendering');
    electron_1.app.disableHardwareAcceleration();
    electron_1.app.commandLine.appendSwitch('disable-gpu');
    electron_1.app.commandLine.appendSwitch('disable-gpu-compositing');
    electron_1.app.commandLine.appendSwitch('in-process-gpu');
    electron_1.app.commandLine.appendSwitch('use-angle', 'swiftshader');
}
else {
    // Chromium is allowed to choose the best raster path when GPU rendering is
    // enabled; forcing GPU rasterization is unsafe on older drivers and VMs.
    detectGPU().then(hasGPU => {
        if (!hasGPU) {
            console.log('[Compatibility] Disabling GPU acceleration for compatibility');
            electron_1.app.disableHardwareAcceleration();
            electron_1.app.commandLine.appendSwitch('disable-gpu');
            electron_1.app.commandLine.appendSwitch('disable-gpu-compositing');
        }
        else {
            console.log('[Compatibility] Using Chromium default graphics settings');
        }
    });
}
// ============================================================================
// ENCRYPTED MODULE HANDLERS
// ============================================================================
// Import module decryptor
const module_decryptor_1 = require("./module-decryptor.cjs");
// Check if Ultra modules are available
registerIPCHandler('is-ultra-available', async () => {
    try {
        return await module_decryptor_1.moduleDecryptor.isUltraAvailable();
    }
    catch (error) {
        console.error('[IPC] is-ultra-available failed:', error);
        return false;
    }
});
// Decrypt and execute Ultra module
registerIPCHandler('decrypt-ultra-module', async (_event, moduleName) => {
    try {
        if (typeof moduleName !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(moduleName)) {
            throw new Error('Invalid encrypted module name');
        }
        console.log(`[IPC] Decrypting Ultra module: ${moduleName}`);
        return await module_decryptor_1.moduleDecryptor.executeModule(moduleName);
    }
    catch (error) {
        console.error(`[IPC] decrypt-ultra-module failed for ${moduleName}:`, error);
        throw new Error(`Failed to decrypt module: ${error.message}`);
    }
});
// ============================================================================
electron_1.app.whenReady().then(async () => {
    console.log('[Startup] App ready - initializing...');
    const startupStart = Date.now();
    // Store all timer references for cleanup
    const appTimers = {};
    // Start TTL-based process cleanup and store reference
    appTimers.cleanupInterval = setInterval(cleanupInactiveScans, CLEANUP_INTERVAL);
    console.log(`[TTL-Cleanup] Started with ${SCAN_TTL / 1000}s TTL, checking every ${CLEANUP_INTERVAL / 1000}s`);
    // Comprehensive cleanup function. Each slow subsystem has its own short
    // deadline, and the quit path also has a hard overall deadline.
    const SHUTDOWN_TIMEOUT_MS = 6000;
    const runCleanupStep = async (label, task, timeoutMs) => {
        try {
            await (0, async_timeout_1.withTimeout)(task, timeoutMs, label);
        }
        catch (error) {
            console.error(`[App] ${label} failed:`, error);
        }
    };
    const performComprehensiveCleanup = async () => {
        console.log('[App] Starting comprehensive cleanup...');
        try {
            // 1. Stop all timers
            if (appTimers.cleanupInterval) {
                clearInterval(appTimers.cleanupInterval);
                appTimers.cleanupInterval = undefined;
            }
            if (appTimers.memoryMonitor) {
                clearInterval(appTimers.memoryMonitor);
                appTimers.memoryMonitor = undefined;
            }
            if (appTimers.autoUpdater) {
                clearTimeout(appTimers.autoUpdater);
                appTimers.autoUpdater = undefined;
            }
            // 2. Cleanup all IPC handlers FIRST to prevent new operations
            cleanupAllIPCHandlers();
            // 3. Cleanup rate limiters
            await runCleanupStep('rate limiter cleanup', (async () => {
                const { cleanupAllRateLimiters } = await Promise.resolve().then(() => __importStar(require("./handlers/rate-limiter.cjs")));
                cleanupAllRateLimiters();
            })(), 1000);
            // 4. Cleanup MSF console manager
            try {
                if (msfConsoleManager) {
                    msfConsoleManager.cleanup();
                }
            }
            catch (error) {
                console.error('[App] Metasploit cleanup failed:', error);
            }
            // 5. Cleanup process manager
            process_manager_1.processManager.stop();
            await runCleanupStep('process manager shutdown', Promise.resolve().then(() => process_manager_1.processManager.killAll()), 2000);
            // 6. Cleanup all active processes
            await runCleanupStep('active process shutdown', Promise.resolve().then(() => cleanupProcesses()), 2500);
            // 7. Close history only after process teardown has stopped all
            // producers. Closing never deletes the durable transcript.
            await runCleanupStep('terminal history shutdown', (async () => {
                const historyService = await getTerminalHistoryService();
                await (historyService.closeAll ? historyService.closeAll() : historyService.cleanupAll());
            })(), 2500);
            // 8. Flush security audit records after all event producers stop.
            await runCleanupStep('security logger shutdown', security_logger_1.securityLogger.shutdown(), 1000);
            console.log('[App] Comprehensive cleanup complete');
        }
        catch (error) {
            console.error('[App] Cleanup error:', error);
        }
    };
    // Both quit events share one promise. Re-entrant Electron events are
    // prevented while the first cleanup is running, then a forced app.exit()
    // guarantees a stuck child or filesystem flush cannot trap the user.
    let shutdownPromise = null;
    let appExitIssued = false;
    const requestQuit = async (event) => {
        event.preventDefault();
        if (!shutdownPromise) {
            shutdownPromise = (async () => {
                await (0, async_timeout_1.withTimeout)(performComprehensiveCleanup(), SHUTDOWN_TIMEOUT_MS, 'application shutdown');
            })();
        }
        try {
            await shutdownPromise;
        }
        finally {
            if (!appExitIssued) {
                appExitIssued = true;
                electron_1.app.exit(0);
            }
        }
    };
    electron_1.app.on('before-quit', requestQuit);
    electron_1.app.on('will-quit', requestQuit);
    // Final cleanup on quit (last resort)
    electron_1.app.on('quit', () => {
        console.log('[App] quit - final cleanup');
        // Synchronous cleanup only (app is already quitting)
        if (appTimers.cleanupInterval)
            clearInterval(appTimers.cleanupInterval);
        if (appTimers.memoryMonitor)
            clearInterval(appTimers.memoryMonitor);
        if (appTimers.autoUpdater)
            clearTimeout(appTimers.autoUpdater);
    });
    // PERFORMANCE: Load cache immediately (non-blocking)
    startup_cache_1.startupCache.load().catch(err => console.warn('[Cache] Load failed:', err));
    // SECURITY: Setup Content Security Policy
    try {
        const { setupContentSecurityPolicy, setupSecurityHeaders } = require("./security/csp.cjs");
        setupContentSecurityPolicy();
        setupSecurityHeaders();
        console.log('[Security] CSP configured');
    }
    catch (error) {
        console.warn('[Security] CSP setup failed:', error);
    }
    // 1. Ensure critical environment variables (fast, synchronous)
    if (!process.env.PATH || process.env.PATH.length < 10) {
        process.env.PATH = process.platform === 'win32'
            ? 'C:\\Windows\\System32;C:\\Windows'
            : '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    }
    if (!process.env.HOME) {
        process.env.HOME = require('os').homedir();
    }
    if (!process.env.USER && !process.env.USERNAME) {
        process.env.USER = require('os').userInfo().username;
    }
    if (!process.env.LANG) {
        process.env.LANG = 'en_US.UTF-8';
        process.env.LC_ALL = 'en_US.UTF-8';
    }
    // 2. Ã¢Å“â€¦ PERFORMANCE: Skip node-pty check - load lazily when needed
    // This saves 2-5 seconds on startup
    console.log('[Startup] node-pty will load on first terminal creation');
    // 3. Check write permission (fast, async)
    const fs = require('fs').promises;
    const testFile = path_1.default.join(electron_1.app.getPath('userData'), '.write-test');
    fs.writeFile(testFile, 'test')
        .then(() => fs.unlink(testFile))
        .then(() => console.log('[Startup] Write permission OK'))
        .catch((error) => {
        console.error('[Startup] Write permission failed:', error.message);
    });
    // 4. Detect and use system proxy (fast)
    const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY ||
        process.env.http_proxy || process.env.https_proxy;
    if (proxyUrl) {
        const { session } = require('electron');
        session.defaultSession.setProxy({ proxyRules: proxyUrl }).catch(() => { });
    }
    // Remove menu globally
    if (process.platform !== 'darwin') {
        electron_1.app.applicationMenu = null;
    }
    // PERFORMANCE: Create window IMMEDIATELY - no blocking operations before this
    createWindow();
    const windowCreated = Date.now();
    console.log(`[Startup] Window created in ${windowCreated - startupStart}ms`);
    // CRITICAL OPTIMIZATION: All heavy work happens AFTER window is visible
    setImmediate(async () => {
        console.log('[Background] Starting background initialization...');
        // PERFORMANCE: Defer native PTY loading until after the first paint.
        // The first terminal shares this cached promise, while startup remains
        // responsive even on slower Windows machines and packaged installs.
        setTimeout(() => (0, lazy_pty_1.preloadPTY)(), 1500);
        // PERFORMANCE: Preload terminal history service immediately (user sees terminal first)
        getTerminalHistoryService().then(() => {
            console.log('[Background] Terminal history service loaded');
        });
        // CRITICAL OPTIMIZATION: Use cached data FIRST, refresh in background
        const cachedSystemInfo = startup_cache_1.startupCache.get('systemInfo');
        const cachedPlatformInfo = startup_cache_1.startupCache.get('platformInfo');
        if (cachedSystemInfo) {
            systemInfo = cachedSystemInfo;
            console.log('[Cache] Using cached system info');
        }
        // CRITICAL OPTIMIZATION: Refresh cache in background (parallel, non-blocking)
        // Don't await - let it run in background
        Promise.allSettled([
            // System info detection - run in background
            detectSystemInfo().then(info => {
                systemInfo = info;
                startup_cache_1.startupCache.set('systemInfo', info);
                console.log('[Background] System info refreshed');
                // Only show warnings if not cached (first run)
                if (!cachedSystemInfo) {
                    showCompatibilityWarnings(info);
                }
                return info;
            }),
            // Platform detection - use cache first
            (async () => {
                if (!cachedPlatformInfo) {
                    platform_service_1.platformService.clearCache();
                }
                const platformInfo = await platform_service_1.platformService.getPlatformInfo(true);
                startup_cache_1.startupCache.set('platformInfo', platformInfo);
                console.log('[Background] Platform info refreshed');
                return platformInfo;
            })()
        ]).then(() => {
            const totalTime = Date.now() - startupStart;
            console.log(`[Startup] Complete in ${totalTime}ms (window: ${windowCreated - startupStart}ms, background: ${totalTime - (windowCreated - startupStart)}ms)`);
            // CRITICAL OPTIMIZATION: Load the Metasploit manager after the
            // critical startup work, but do not add an artificial first-use
            // delay. This only loads the singleton and event bridge; it does
            // not spawn msfconsole until the Exploit section requests it.
            setTimeout(() => {
                console.log('[Background] Preloading secondary services...');
                // Preload MSF console manager (user navigates to Exploit tab later)
                getMsfConsoleManager().then(msf => {
                    msf.on('ready', (state) => safeSend('msf-console-ready', state));
                    msf.on('stateChange', (state) => safeSend('msf-console-state-change', state));
                    msf.on('close', (code) => safeSend('msf-console-closed', code));
                    msf.on('error', (error) => safeSend('msf-console-error', error.message));
                    console.log('[Background] MSF console manager loaded');
                });
                // AI client will load on first use (when user configures API key)
            }, 0);
        });
    });
    // PERFORMANCE: Memory monitoring in development
    if (isDev) {
        appTimers.memoryMonitor = setInterval(() => {
            const mem = process.memoryUsage();
            const rssMB = Math.round(mem.rss / 1024 / 1024);
            if (rssMB > 300) {
                console.warn('[!] HIGH MEMORY:', rssMB, 'MB');
            }
        }, 30000);
    }
    // Check for updates (deferred)
    if (!isDev) {
        appTimers.autoUpdater = setTimeout(() => {
            electron_updater_1.autoUpdater.checkForUpdates().catch((error) => {
                console.warn('[Updater] Update check skipped:', error?.message || error);
            });
        }, 3000);
    }
    // REFACTORING: Register all handler modules
    console.log('[Handlers] Registering IPC handlers...');
    // Helper functions for handlers
    const getMainWindow = () => mainWindow;
    const getSystemInfo = async () => {
        if (!systemInfo) {
            systemInfo = await detectSystemInfo();
        }
        return systemInfo;
    };
    const registerScanWithTTL = (scanId, process, type = 'regular') => {
        activeScans.set(scanId, process);
        // Interactive PTYs are user-owned sessions, not disposable scans. They can
        // sit at an idle prompt for longer than the regular-process TTL without
        // being stale, so only regular tool jobs enter the inactivity map.
        if (type === 'pty')
            return;
        activeScansTTL.set(scanId, {
            process,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            type
        });
    };
    const updateScanActivity = (scanId) => {
        const entry = activeScansTTL.get(scanId);
        if (entry) {
            entry.lastActivity = Date.now();
        }
    };
    const unregisterScan = (scanId, process) => {
        const activeProcess = activeScans.get(scanId);
        if (!process || activeProcess === process) {
            activeScans.delete(scanId);
        }
        const ttlEntry = activeScansTTL.get(scanId);
        if (!process || ttlEntry?.process === process) {
            activeScansTTL.delete(scanId);
        }
    };
    // Register all handlers (modularized)
    (0, window_handlers_1.registerWindowHandlers)(registerIPCListener, getMainWindow, async () => {
        await (0, async_timeout_1.withTimeout)(cleanupProcesses(), 2500, 'window confirm-close cleanup');
    });
    (0, update_handlers_1.registerUpdateHandlers)(registerIPCHandler);
    (0, session_handlers_1.registerSessionHandlers)(registerIPCHandler);
    (0, tool_handlers_1.registerToolHandlers)(registerIPCHandler, getSystemInfo, terminal_handlers_1.clearTerminalPlatformCache);
    (0, subdomain_handlers_1.registerSubdomainHandlers)(registerIPCHandler);
    (0, ai_handlers_1.registerAIHandlers)(registerIPCHandler, getMainWindow);
    (0, metasploit_handlers_1.registerMetasploitHandlers)(registerIPCHandler, registerIPCListener); // Persistent console handlers
    (0, metasploit_command_handlers_1.registerMetasploitCommandHandlers)(registerIPCHandler); // One-off Metasploit commands
    (0, terminal_handlers_1.registerTerminalHandlers)(registerIPCHandler, registerIPCListener, getMainWindow, activeScans, registerScanWithTTL, updateScanActivity, getSystemInfo, unregisterScan);
    (0, platform_handlers_1.registerPlatformHandlers)(registerIPCHandler, terminal_handlers_1.clearTerminalPlatformCache);
    (0, settings_handlers_1.registerSettingsHandlers)(registerIPCHandler);
    (0, tool_execution_handlers_1.registerToolExecutionHandlers)(registerIPCHandler);
    (0, license_handlers_1.registerLicenseHandlers)(registerIPCHandler);
    (0, command_handlers_1.registerCommandHandlers)(registerIPCHandler, getMainWindow);
    (0, system_handlers_1.registerSystemHandlers)(registerIPCHandler, getSystemInfo);
    (0, nmap_scan_handlers_1.registerNmapScanHandlers)(registerIPCHandler, getMainWindow, activeScans);
    (0, system_command_handlers_1.registerSystemCommandHandlers)(registerIPCHandler, getMainWindow, activeScans, registerScanWithTTL);
    // All inline handlers moved to dedicated modules above
    console.log('[Handlers] All IPC handlers registered');
    // DUPLICATE HANDLERS REMOVED - Now in dedicated handler modules
    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    // LICENSE MANAGEMENT
    // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
    // License management (controlled by feature flags)
    registerIPCHandler('activate-license', async (_event, key) => {
        return await license_manager_1.licenseManager.activateLicense(key);
    });
    // Check if user has Pro tier (controlled by feature flags)
    registerIPCHandler('is-pro', async () => {
        return await license_manager_1.licenseManager.isPro();
    });
    // Get license info (controlled by feature flags)
    registerIPCHandler('get-license-info', () => {
        return license_manager_1.licenseManager.getLicenseInfo();
    });
    // Check if feature is available (controlled by feature flags)
    registerIPCHandler('has-feature', async (_event, feature) => {
        return await license_manager_1.licenseManager.hasFeature(feature);
    });
    // Deactivate license (controlled by feature flags)
    registerIPCHandler('deactivate-license', async () => {
        await license_manager_1.licenseManager.deactivate();
        return { success: true };
    });
    // Open upgrade URL (controlled by feature flags)
    registerIPCHandler('open-upgrade-url', () => {
        return { success: true };
    });
    // Automation result persistence. The renderer can request an explicit
    // directory, but the filename is always reduced to a basename here so a
    // malformed target cannot escape that directory.
    registerIPCHandler('save-automation-result', async (_event, args) => {
        try {
            const directory = String(args?.directory || '').trim();
            const content = typeof args?.content === 'string' ? args.content : '';
            if (!directory || !content) {
                return { success: false, error: 'A save directory and non-empty content are required' };
            }
            const safeFilename = path_1.default.basename(String(args.filename || 'automation-result.txt'))
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'automation-result.txt';
            const resolvedDirectory = path_1.default.resolve(directory);
            await fs.mkdir(resolvedDirectory, { recursive: true });
            const filePath = path_1.default.join(resolvedDirectory, safeFilename);
            await fs.writeFile(filePath, content, 'utf-8');
            return { success: true, filePath };
        }
        catch (error) {
            console.error('[Automation] Failed to save result:', error);
            return { success: false, error: error?.message || 'Failed to save automation result' };
        }
    });
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', async () => {
    // Use the same deadline as the native close path so a child process cannot
    // block app.quit() indefinitely.
    await (0, async_timeout_1.withTimeout)(cleanupProcesses(), 2500, 'window-all-closed cleanup');
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
