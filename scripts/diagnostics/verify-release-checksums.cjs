'use strict';

/**
 * Verify SHA-256 checksums in a release directory.
 *
 * The manifest is an integrity check, not a signature. Authenticity still
 * depends on obtaining both the manifest and artifacts from a trusted release.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const releaseDir = path.resolve(process.argv[2] || 'release');
const manifestPath = path.join(releaseDir, 'SHA256SUMS.txt');

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function parseManifest(manifest) {
  const entries = [];
  const seen = new Set();

  for (const [index, rawLine] of manifest.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/i);
    if (!match) {
      throw new Error(`Invalid checksum entry on line ${index + 1}`);
    }

    const name = match[2].trim();
    if (
      !name ||
      name === '.' ||
      name === '..' ||
      path.isAbsolute(name) ||
      name.includes('/') ||
      name.includes('\\') ||
      seen.has(name)
    ) {
      throw new Error(`Invalid or duplicate artifact name in checksum entry: ${name}`);
    }

    seen.add(name);
    entries.push({ name, expected: match[1].toLowerCase() });
  }

  if (entries.length === 0) {
    throw new Error('Checksum manifest contains no artifacts');
  }
  return entries;
}

async function main() {
  if (!fs.existsSync(releaseDir) || !fs.statSync(releaseDir).isDirectory()) {
    throw new Error(`Release directory does not exist: ${releaseDir}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Checksum manifest does not exist: ${manifestPath}`);
  }

  const entries = parseManifest(fs.readFileSync(manifestPath, 'utf8'));
  for (const entry of entries) {
    const filePath = path.join(releaseDir, entry.name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Artifact listed in checksum manifest is missing: ${entry.name}`);
    }

    const actual = await sha256(filePath);
    if (actual !== entry.expected) {
      throw new Error(`Checksum mismatch for ${entry.name}`);
    }
  }

  console.log(`[Checksums] Verified ${entries.length} artifact(s) in ${path.relative(process.cwd(), releaseDir) || '.'}`);
}

main().catch((error) => {
  console.error(`[Checksums] Verification failed: ${error.message}`);
  process.exitCode = 1;
});
