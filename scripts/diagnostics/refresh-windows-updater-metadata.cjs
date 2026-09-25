'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const releaseDir = path.join(process.cwd(), 'release');
const metadataPath = path.join(releaseDir, 'latest.yml');
function fail(message) { throw new Error('[Updater metadata] ' + message); }
function main() {
  if (!fs.existsSync(metadataPath)) fail('release/latest.yml does not exist');
  const lines = fs.readFileSync(metadataPath, 'utf8').split(/\r?\n/);
  const installerEntry = lines.find((line) => {
    const match = line.match(/^\s*-?\s*url:\s*(.+)$/);
    return match && /-Setup\.exe$/i.test(match[1].trim());
  });
  if (!installerEntry) fail('could not find the NSIS installer entry in latest.yml');
  const installerName = installerEntry.match(/^\s*-?\s*url:\s*(.+)$/)[1].trim();
  const installerPath = path.join(releaseDir, installerName);
  if (!fs.existsSync(installerPath)) fail('installer referenced by latest.yml is missing: ' + installerName);
  const digest = crypto.createHash('sha512').update(fs.readFileSync(installerPath)).digest('base64');
  const size = fs.statSync(installerPath).size;
  let currentFile = null;
  let installerShaUpdated = false;
  let installerSizeUpdated = false;
  let topLevelPathMatches = false;
  let topLevelShaUpdated = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const urlMatch = line.match(/^(\s*)-\s*url:\s*(.+)$/);
    if (urlMatch) currentFile = urlMatch[2].trim();
    if (/^path:\s*/.test(line)) topLevelPathMatches = line.slice('path:'.length).trim() === installerName;
    if (currentFile === installerName && /^\s+sha512:\s*/.test(line)) {
      lines[index] = line.replace(/(sha512:\s*).*/, '$1' + digest);
      installerShaUpdated = true;
    }
    if (currentFile === installerName && /^\s+size:\s*/.test(line)) {
      lines[index] = line.replace(/(size:\s*).*/, '$1' + size);
      installerSizeUpdated = true;
    }
    if (topLevelPathMatches && /^sha512:\s*/.test(line)) {
      lines[index] = line.replace(/(sha512:\s*).*/, '$1' + digest);
      topLevelShaUpdated = true;
    }
  }
  if (!installerShaUpdated || !installerSizeUpdated) fail('could not update installer sha512/size in latest.yml');
  if (lines.some((line) => /^path:\s*/.test(line)) && !topLevelShaUpdated) fail('legacy top-level sha512 was not updated');
  fs.writeFileSync(metadataPath, lines.join('\n'), 'utf8');
  console.log('[Updater metadata] Refreshed ' + installerName + ' (' + size + ' bytes)');
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
