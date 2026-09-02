#!/usr/bin/env node
/**
 * Write portable SHA-256 checksums for distributable desktop artifacts.
 *
 * The release directory also contains electron-builder metadata files. Include
 * installable/archive artifacts and updater metadata so the published release
 * can be verified as one consistent set on every CI runner.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const releaseDir = path.join(root, 'release');
const outputPath = path.join(releaseDir, 'SHA256SUMS.txt');
const artifactExtensions = new Set([
  '.appimage',
  '.deb',
  '.dmg',
  '.exe',
  '.rpm',
  '.zip',
]);

function isDistributable(name) {
  const lower = name.toLowerCase();
  return [...artifactExtensions].some((extension) => lower.endsWith(extension))
    || lower.endsWith('.tar.gz')
    || lower.endsWith('.blockmap')
    || /^latest.*\.yml$/.test(lower);
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  if (!fs.existsSync(releaseDir)) {
    throw new Error('release/ does not exist; build an artifact before writing checksums');
  }

  const artifacts = fs.readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isDistributable(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (artifacts.length === 0) {
    throw new Error('No distributable artifacts found in release/');
  }

  const lines = [];
  for (const artifact of artifacts) {
    const digest = await sha256(path.join(releaseDir, artifact));
    lines.push(`${digest}  ${artifact}`);
  }

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[Checksums] Wrote ${path.relative(root, outputPath)} for ${artifacts.length} artifact(s)`);
}

main().catch((error) => {
  console.error(`[Checksums] Failed: ${error.message}`);
  process.exitCode = 1;
});
