#!/usr/bin/env node
'use strict';

/**
 * Verify the filesystem contract of an Electron package.
 *
 * This is intentionally independent of the running GUI. It catches the
 * failures that a successful electron-builder invocation can still hide:
 * missing main/preload files, encrypted modules in the wrong resource root,
 * or a package containing the wrong node-pty native binary.
 */

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..', '..');
const releaseDir = path.join(root, 'release');
const args = process.argv.slice(2);
const targetArg = args.find((arg) => /^--target=(win|linux|mac)$/.test(arg));
const shortTarget = args.find((arg) => /^--(win|linux|mac)$/.test(arg));
const target = targetArg?.split('=')[1] || shortTarget?.slice(2) || ({
  win32: 'win',
  linux: 'linux',
  darwin: 'mac',
}[process.platform] || 'unknown');

const failures = [];

function pass(label, detail = '') {
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
  console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  failures.push(label);
}

function exists(label, filePath) {
  if (fs.existsSync(filePath)) pass(label, path.relative(root, filePath));
  else fail(label, path.relative(root, filePath));
}

function normalize(entry) {
  return entry.replaceAll(String.fromCharCode(92), '/').replace(/^\/+/, '');
}

function unpackedCandidates() {
  switch (target) {
    case 'win': return ['win-unpacked', 'win-arm64-unpacked'];
    case 'linux': return ['linux-unpacked', 'linux-arm64-unpacked'];
    case 'mac': return ['mac', 'mac-arm64', 'mac-x64'];
    default: return [];
  }
}

const unpackedDir = unpackedCandidates()
  .map((name) => path.join(releaseDir, name))
  .find((candidate) => fs.existsSync(path.join(candidate, 'resources', 'app.asar')));

console.log(`\nOsecBox packaged-artifact audit — target=${target}`);

if (!unpackedDir) {
  fail('Unpacked Electron directory exists', `searched ${unpackedCandidates().join(', ')}`);
} else {
  const resourcesDir = path.join(unpackedDir, 'resources');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const unpackedAsarDir = path.join(resourcesDir, 'app.asar.unpacked');
  const entries = asar.listPackage(asarPath).map(normalize);
  const entrySet = new Set(entries);

  for (const required of [
    'dist/electron/main.cjs',
    'dist/electron/preload.cjs',
    'dist/public/index.html',
    'dist/public/osecbox-icon.png',
    'dist/public/favicon.png',
    'package.json',
    'node_modules/node-pty/package.json',
    'node_modules/node-pty/lib/index.js',
  ]) {
    if (entrySet.has(required)) pass(`Packaged entry exists: ${required}`);
    else fail(`Packaged entry exists: ${required}`);
  }

  const encryptedInAsar = entries.filter((entry) => entry.startsWith('encrypted-modules/'));
  if (encryptedInAsar.length) {
    fail('Encrypted modules are outside app.asar', `${encryptedInAsar.length} entries are still inside app.asar`);
  } else {
    pass('Encrypted modules are outside app.asar');
  }

  const encryptedDir = path.join(resourcesDir, 'encrypted-modules');
  exists('External encrypted-module manifest exists', path.join(encryptedDir, 'manifest.json'));
  if (fs.existsSync(encryptedDir)) {
    const encryptedFiles = fs.readdirSync(encryptedDir).filter((name) => name.endsWith('.enc'));
    if (encryptedFiles.length >= 1) pass('External encrypted modules are present', `${encryptedFiles.length} modules`);
    else fail('External encrypted modules are present');
  }

  const forbiddenPtyEntries = entries.filter((entry) => (
    entry.startsWith('node_modules/node-pty/src/') ||
    entry.startsWith('node_modules/node-pty/scripts/') ||
    entry.startsWith('node_modules/node-pty/deps/') ||
    entry.startsWith('node_modules/node-pty/third_party/') ||
    entry.startsWith('node_modules/node-pty/typings/') ||
    entry.endsWith('node_modules/node-pty/binding.gyp')
  ));
  if (forbiddenPtyEntries.length) {
    fail('node-pty development payload is excluded', `${forbiddenPtyEntries.length} source/test entries shipped`);
  } else {
    pass('node-pty development payload is excluded');
  }

  const platformKey = target === 'win'
    ? `win32-${process.arch}`
    : target === 'linux'
      ? `linux-${process.arch}`
      : `darwin-${process.arch}`;
  const nativeRoot = path.join(unpackedAsarDir, 'node_modules', 'node-pty');
  const nativeCandidates = [
    {
      label: `node-pty ${platformKey} prebuild`,
      root: path.join(nativeRoot, 'prebuilds', platformKey),
    },
    {
      label: 'node-pty build/Release',
      root: path.join(nativeRoot, 'build', 'Release'),
    },
  ];
  const requiredNativeFiles = target === 'win'
    ? ['pty.node', 'conpty.node', 'winpty-agent.exe']
    : target === 'mac'
      ? ['pty.node', 'spawn-helper']
      : ['pty.node'];
  const nativeCandidate = nativeCandidates.find((candidate) => (
    requiredNativeFiles.every((file) => fs.existsSync(path.join(candidate.root, file)))
  ));

  if (!nativeCandidate) {
    fail(
      `node-pty ${platformKey} native runtime exists`,
      `expected ${requiredNativeFiles.join(', ')} in a matching prebuild or build/Release`,
    );
  } else {
    pass(`node-pty ${platformKey} native runtime exists`, nativeCandidate.label);
  }
}

console.log(`\nArtifact audit complete: ${failures.length} failures.`);
if (failures.length) process.exitCode = 1;
