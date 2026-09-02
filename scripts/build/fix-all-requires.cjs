/**
 * Fix ALL local require statements to use .cjs extension
 * This is a comprehensive fix for the ES module issue
 */

const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', '..', 'dist', 'electron');

// Node.js built-in modules to skip
const BUILTIN_MODULES = new Set([
  'electron', 'fs', 'path', 'os', 'crypto', 'http', 'https', 'net', 'tls', 'dns',
  'child_process', 'stream', 'util', 'events', 'buffer', 'url', 'querystring',
  'zlib', 'readline', 'repl', 'vm', 'assert', 'timers', 'console',
  'fs/promises', 'stream/promises', 'timers/promises', 'node-pty', 'ws',
  'electron-store', 'electron-updater'
]);

function isBuiltinOrNodeModule(modulePath) {
  // Check if it's a built-in module
  if (BUILTIN_MODULES.has(modulePath)) return true;
  
  // Check if it's a node_modules import (doesn't start with . or /)
  if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) return true;
  
  return false;
}

function fixRequiresInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Match all require statements with single or double quotes
  const requireRegex = /require\(["']([^"']+)["']\)/g;
  
  content = content.replace(requireRegex, (match, modulePath) => {
    // Skip if already has .cjs extension
    if (modulePath.endsWith('.cjs')) {
      return match;
    }

    // Skip if it's a built-in or node_modules import
    if (isBuiltinOrNodeModule(modulePath)) {
      return match;
    }

    // Skip if it's not a local import (doesn't start with . or /)
    if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) {
      return match;
    }

    // Add .cjs extension
    modified = true;
    return `require("${modulePath}.cjs")`;
  });

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }

  return false;
}

function processDirectory(dir) {
  let fixedCount = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      fixedCount += processDirectory(fullPath);
    } else if (entry.name.endsWith('.cjs')) {
      if (fixRequiresInFile(fullPath)) {
        fixedCount++;
        console.log(`  ✓ ${path.relative(DIST_DIR, fullPath)}`);
      }
    }
  }

  return fixedCount;
}

function main() {
  console.log('🔧 Fixing all require statements in dist/electron...\n');

  if (!fs.existsSync(DIST_DIR)) {
    console.log('⚠️  dist/electron directory not found');
    return;
  }

  const fixedCount = processDirectory(DIST_DIR);

  console.log(`\n✅ Fixed ${fixedCount} files`);
  console.log('🎉 Done!\n');
}

main();
