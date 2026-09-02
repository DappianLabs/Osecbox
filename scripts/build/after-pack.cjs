'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Keep only the node-pty native payload needed by the current artifact.
 *
 * The source dependency contains prebuilds for several operating systems and
 * CPU architectures. Shipping all of them makes the installer larger and
 * increases the number of native binaries an endpoint has to trust. This
 * hook only touches electron-builder's generated app directory; it never
 * mutates node_modules in the working tree.
 */
module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName;
  // electron-builder exposes Arch as a numeric enum in afterPack context
  // (x64=1, arm64=3), even though artifact names use string labels.
  const arch = typeof context.arch === 'string'
    ? context.arch
    : ({ 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }[context.arch] || String(context.arch));
  const requiredPrebuild = `${platform}-${arch}`;
  const prebuildRoot = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds',
  );

  if (!fs.existsSync(prebuildRoot)) {
    return;
  }

  const entries = fs.readdirSync(prebuildRoot, { withFileTypes: true });
  const requiredEntry = entries.find(
    entry => entry.isDirectory() && entry.name === requiredPrebuild,
  );

  // Linux builds may use build/Release instead of a prebuild directory. If
  // the expected prebuild is absent, leave the generated payload intact so a
  // native fallback is not accidentally removed from a valid artifact.
  if (!requiredEntry) {
    console.warn(`[afterPack] ${requiredPrebuild} was not found; leaving node-pty prebuilds unchanged`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === requiredPrebuild) continue;
    fs.rmSync(path.join(prebuildRoot, entry.name), { recursive: true, force: true });
  }

  const requiredPath = path.join(prebuildRoot, requiredPrebuild);
  for (const entry of fs.readdirSync(requiredPath, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdb')) {
      fs.rmSync(path.join(requiredPath, entry.name), { force: true });
    }
  }

  console.log(`[afterPack] Retained node-pty native payload: ${requiredPrebuild}`);
};
