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
const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
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
