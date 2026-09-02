#!/usr/bin/env node
'use strict';

/**
 * Release-time platform audit.
 *
 * This is intentionally dependency-free so it can run before the Electron
 * build on Windows, Linux, CI runners, and developer machines with or without
 * WSL2. Missing pentesting tools are reported as warnings; broken packaging or
 * broken platform contracts fail the audit.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const failures = [];
const warnings = [];

function check(label, condition, detail) {
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}${suffix}`);
  if (!condition) failures.push(label);
}

function warn(label, detail) {
  console.log(`WARN ${label}${detail ? ` — ${detail}` : ''}`);
  warnings.push(label);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function commandAvailable(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 4000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return !result.error && result.status === 0;
}

console.log(`\nOsecBox platform audit — ${process.platform}/${process.arch} — Node ${process.version}`);

const builder = JSON.parse(read('electron-builder.json'));
const platformService = read('electron/platform-service.ts');
const platformHandlers = read('electron/handlers/platform-handlers.ts');
const toolHandlers = read('electron/handlers/tool-handlers.ts');
const toolInstaller = read('electron/tool-installer.ts');
const wslPathHelpers = read('electron/utils/wsl-path.ts');
const toolStatusUi = read('client/src/components/layout/ToolStatusChecker.tsx');
const terminalHandlers = read('electron/handlers/terminal-handlers.ts');
const msfPtyManager = read('electron/msf-pty-manager.ts');
const systemCommandHandlers = read('electron/handlers/system-command-handlers.ts');
const sessionHandlers = read('electron/handlers/session-handlers.ts');
const settingsService = read('electron/services/settings-service.ts');
const settingsStore = read('client/src/lib/settings-store.ts');
const updateHandlers = read('electron/handlers/update-handlers.ts');
const windowHandlers = read('electron/handlers/window-handlers.ts');
const preload = read('electron/preload.ts');
const ideLayout = read('client/src/components/layout/IdeLayout.tsx');

check('Windows targets configured',
  Array.isArray(builder.win?.target) && builder.win.target.includes('nsis') && builder.win.target.includes('portable'));
check('Linux targets configured',
  Array.isArray(builder.linux?.target) && ['AppImage', 'deb', 'tar.gz'].every(target => builder.linux.target.includes(target)));
check('Linux desktop metadata configured', Boolean(builder.linux?.category && builder.linux?.executableName));
check('macOS targets configured',
  Array.isArray(builder.mac?.target) && builder.mac.target.includes('dmg') && builder.mac.target.includes('zip'));
check('macOS entitlements file exists', fs.existsSync(path.join(root, 'build', 'entitlements.mac.plist')));
const appIconPaths = ['build/icon.png', 'build/icon.ico', 'build/icon.icns'];
check('Application icon assets are present and non-empty',
  appIconPaths.every((relativePath) => {
    const filePath = path.join(root, relativePath);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  }),
  appIconPaths.join(', '));
check('Electron builder does not rebuild native modules during packaging', builder.npmRebuild === false);
check('Packaged native PTY payload is pruned after packaging', builder.afterPack === 'scripts/build/after-pack.cjs');
check('Encrypted runtime modules are packaged outside app.asar',
  Array.isArray(builder.extraResources) && builder.extraResources.some(resource =>
    resource?.from === 'encrypted-modules' && resource?.to === 'encrypted-modules'
  ));
check('WSL detection uses structured execution', platformService.includes("execFileAsync(WSL_EXECUTABLE"));
check('WSL2 detection requires a version-2 distro', platformService.includes("entry.version === '2'"));
check('Renderer IPC contract returns platformInfo', platformHandlers.includes('platformInfo: info'));
check('Native Windows PATH is not polluted with POSIX separators',
  !terminalHandlers.includes('process.env.PATH}:/usr/local') &&
  !systemCommandHandlers.includes('process.env.PATH}:/usr/local'));
check('WSL command prefix is reused by terminals', terminalHandlers.includes('cachedStrategy.commandPrefix'));
check('WSL terminals start in the selected Linux home directory',
  platformService.includes("commandPrefix.push('--cd', '~')") &&
  terminalHandlers.includes('ptyCwd = homeDir') &&
  msfPtyManager.includes('cwd: strategy.homeDir || process.cwd()'),
  'avoids inheriting the packaged app/repository cwd');
check('Windows installer is per-user by default', builder.nsis?.perMachine === false,
  'does not require administrator rights for the normal install path');
check('WSL tool PATH includes user Go and local binary directories',
  wslPathHelpers.includes("'$HOME/go/bin'") &&
  wslPathHelpers.includes("'$HOME/.local/bin'"));
check('Tool installer covers checked and session tools',
  ['assetfinder', 'ffuf', 'msfvenom', 'ssh', 'python3', 'python', 'ligolo-ng']
    .every(tool => toolInstaller.includes(`'${tool}'`)));
check('Missing-tool setup script is exposed through the IPC/UI contract',
  toolHandlers.includes("'get-install-script'") && toolStatusUi.includes('getInstallScript'));
check('Linux-only tool checks default to the selected runtime',
  toolHandlers.includes("'check-tool-installed', async (_event, tool: string, requiresLinux = true)") &&
  toolHandlers.includes("'check-tools-installed', async (_event, tools: unknown, requiresLinux = true)"));
check('Sessions use Electron userData and migrate legacy saves',
  sessionHandlers.includes("app.getPath('userData')") &&
  sessionHandlers.includes('migrateLegacySessions'));
check('Session saves await directory initialization and validate JSON',
  sessionHandlers.includes('await ensureSessionDir()') &&
  sessionHandlers.includes('JSON.parse(data)'));
check('Provider credentials use OS storage and are excluded from desktop renderer persistence',
  settingsService.includes("safeStorage.encryptString") &&
  settingsService.includes('readTextFileWithRecovery') &&
  settingsService.includes('writeTextFileAtomic') &&
  settingsStore.includes('partialize:') &&
  settingsStore.includes('aiApiKey: \'\''),
  'AI keys remain in memory for the active provider session');
check('Installed update checks use app.isPackaged', updateHandlers.includes('!app.isPackaged'));
check('Custom close uses the renderer confirmation bridge',
  windowHandlers.includes("'window-confirm-close'") &&
  preload.includes("'window-confirm-close'"));
check('Missing-tool commands reach the in-app terminal view',
  terminalHandlers.includes("'open-terminal-tab'") &&
  preload.includes("onOpenTerminalTab") &&
  ideLayout.includes('terminalService.writeWhenReady'));
const firewallMutationPattern = /\b(?:netsh\s+advfirewall\s+(?:set|add|delete)|(?:New|Set|Add|Remove|Disable|Enable)-NetFirewall(?:Rule|Profile)|Set-NetFirewallProfile)\b/i;
check('Application does not modify Windows Firewall rules automatically',
  !firewallMutationPattern.test([
    platformService,
    platformHandlers,
    toolHandlers,
    systemCommandHandlers,
    terminalHandlers,
  ].join('\n')),
  'firewall state remains an OS/user responsibility; OsecBox only reports runtime and connection failures');
check('Tagged native release workflow is present',
  fs.existsSync(path.join(root, '.github', 'workflows', 'release.yml')));

if (process.platform === 'win32') {
  check('Windows shell is available', commandAvailable('cmd.exe', ['/d', '/c', 'exit 0']));
  check('PowerShell is available', commandAvailable('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', 'exit 0']));
  check('wsl.exe is discoverable', commandAvailable('where.exe', ['wsl.exe']));

  const wsl = spawnSync('wsl.exe', ['--list', '--verbose'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 8000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${wsl.stdout || ''}\n${wsl.stderr || ''}`
    .replace(/\x00/g, '')
    .replace(/\r\n/g, '\n');
  const distroRows = output.split('\n').filter(line => /^(\*)?\s*[^\s]+\s+.+\s+[12]\s*$/.test(line.trim()));
  const wsl2Rows = distroRows.filter(line => /\s2\s*$/.test(line.trim()));
  if (wsl.error || wsl.status !== 0) {
    warn('WSL2 enumeration unavailable', wsl.error?.code || `exit ${wsl.status}`);
  } else if (wsl2Rows.length === 0) {
    warn('No usable WSL2 distro detected', 'native Windows mode must remain functional');
  } else {
    console.log(`INFO WSL2 distros detected: ${wsl2Rows.length}`);
  }
} else if (process.platform === 'linux' || process.platform === 'darwin') {
  check('POSIX shell is available', fs.existsSync('/bin/sh'));
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    warn('No display server detected', 'expected on headless CI; Electron GUI smoke test is skipped');
  }
}

function containsNativeModule(directory) {
  if (!fs.existsSync(directory)) return false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith('.node')) return true;
    if (entry.isDirectory() && containsNativeModule(entryPath)) return true;
  }
  return false;
}

const nativePtyRoot = path.join(root, 'node_modules', 'node-pty');
const platformKey = `${process.platform}-${process.arch}`;
const nativePtyCandidates = [
  path.join(nativePtyRoot, 'build', 'Release'),
  path.join(nativePtyRoot, 'build', 'Debug'),
  path.join(nativePtyRoot, 'prebuilds', platformKey),
  path.join(nativePtyRoot, 'node-pty', 'build', 'Release'),
  path.join(nativePtyRoot, 'node-pty', 'build', 'Debug'),
  path.join(nativePtyRoot, 'node-pty', 'prebuilds', platformKey),
];
if (nativePtyCandidates.some(containsNativeModule)) {
  console.log(`INFO node-pty native artifacts are present for ${platformKey}`);
} else {
  warn(`node-pty native artifacts not present for ${platformKey}`, 'run npm run rebuild:native before packaging');
}

console.log(`\nAudit complete: ${failures.length} failures, ${warnings.length} warnings.`);
if (failures.length) process.exitCode = 1;
