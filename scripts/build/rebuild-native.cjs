#!/usr/bin/env node
/**
 * Rebuild native modules for Electron
 * Ensures node-pty works across all platforms
 */

const path = require('path');
const fs = require('fs');

const electronVersion = require('electron/package.json').version;

console.log(`[Rebuild] Electron version: ${electronVersion}`);
console.log(`[Rebuild] Host Node ABI: ${process.versions.modules}`);

const nodePtyRoot = path.join(process.cwd(), 'node_modules', 'node-pty');

function hasNativeModule(directory) {
  if (!fs.existsSync(directory)) return false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith('.node')) return true;
    if (entry.isDirectory() && hasNativeModule(entryPath)) return true;
  }
  return false;
}

const currentPlatformPrebuild = path.join(
  nodePtyRoot,
  'prebuilds',
  `${process.platform}-${process.arch}`,
);

if (hasNativeModule(currentPlatformPrebuild)) {
  console.log(`[Rebuild] Using bundled node-pty prebuild: ${currentPlatformPrebuild}`);
  process.exit(0);
}

async function rebuildNativeModule() {
  // node-pty publishes platform/architecture prebuilds. Use the exact
  // current artifact when it exists; rebuilding a working prebuild wastes
  // time and requires a compiler toolchain on the user's machine.
  if (hasNativeModule(currentPlatformPrebuild)) {
    console.log(`[Rebuild] Using bundled node-pty prebuild: ${currentPlatformPrebuild}`);
    return;
  }

  try {
    // Use the supported Electron Rebuild API instead of spawning npm.cmd.
    // Spawning a .cmd file through execFileSync is rejected with EINVAL on
    // some Windows Node installations and made clean packaging unreliable.
    const { rebuild } = await import('@electron/rebuild');
    console.log('[Rebuild] Rebuilding node-pty for Electron...');

    const rebuildResult = rebuild({
      buildPath: process.cwd(),
      electronVersion,
      platform: process.platform,
      arch: process.arch,
      onlyModules: ['node-pty'],
      force: true,
      buildFromSource: true,
      headerURL: 'https://www.electronjs.org/headers',
    });

    rebuildResult.lifecycle.on('module-found', (moduleName) => {
      console.log(`[Rebuild] Found native module: ${moduleName}`);
    });
    rebuildResult.lifecycle.on('module-skip', (moduleName) => {
      console.log(`[Rebuild] Skipped native module: ${moduleName}`);
    });

    await rebuildResult;
    console.log('[Rebuild] ✅ node-pty rebuilt successfully');
  } catch (error) {
    console.error('[Rebuild] ❌ Failed to rebuild node-pty:', error?.message || error);
    process.exitCode = 1;
    return;
  }

  const releasePath = path.join(nodePtyRoot, 'build', 'Release');
  if (hasNativeModule(releasePath)) {
    console.log(`[Rebuild] ✅ Native module found in ${releasePath}`);
    return;
  }

  console.error('[Rebuild] ❌ Rebuild completed without a native node-pty module');
  process.exitCode = 1;
}

rebuildNativeModule().catch((error) => {
  console.error('[Rebuild] ❌ Unexpected native rebuild failure:', error?.message || error);
  process.exitCode = 1;
});
