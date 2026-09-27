#!/usr/bin/env node
/**
 * Run electron-builder with a cache outside the ESM project package scope.
 *
 * electron-builder downloads helper JavaScript bundles which use CommonJS.
 * Keeping its cache under a project with "type": "module" makes Node treat
 * those helper files as ESM on some Node versions. A writable OS temp cache
 * is also safer than assuming the user's profile cache is writable.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cachePath = process.env.ELECTRON_BUILDER_CACHE || path.join(os.tmpdir(), 'osecbox-electron-builder-cache');
fs.mkdirSync(cachePath, { recursive: true });

const cliPath = path.join(process.cwd(), 'node_modules', 'electron-builder', 'cli.js');
const requestedArgs = process.argv.slice(2);

// OsecBox publishes through the GitHub Actions release job, never through
// electron-builder itself.  Keep this invariant in the wrapper rather than
// relying on npm to forward a trailing `--publish=never` argument correctly.
// This also prevents electron-builder from entering its GitHub publisher and
// requiring GH_TOKEN during ordinary CI/build runs.
const builderArgs = ['--publish=never'];
for (let index = 0; index < requestedArgs.length; index += 1) {
  const argument = requestedArgs[index];
  if (argument === '--publish') {
    // Normalize both `--publish never` and `--publish always` forms away.
    index += 1;
    continue;
  }
  if (argument === '--publish=never' || argument.startsWith('--publish=')) {
    continue;
  }
  builderArgs.push(argument);
}

const result = spawnSync(process.execPath, [cliPath, ...builderArgs], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_BUILDER_CACHE: cachePath },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error('[ElectronBuilder] Failed to start electron-builder:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
