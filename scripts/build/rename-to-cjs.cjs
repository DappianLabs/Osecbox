/**
 * Rename all .js files to .cjs in dist/electron
 * This ensures Node treats them as CommonJS modules when package.json has "type": "module"
 */

const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', '..', 'dist', 'electron');

/**
 * Recursively rename all .js files to .cjs
 */
function renameJsToCjs(dir) {
  if (!fs.existsSync(dir)) {
    console.log(`⚠️  Directory not found: ${dir}`);
    return 0;
  }

  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      count += renameJsToCjs(fullPath);
    } else if (entry.name.endsWith('.js')) {
      const newPath = fullPath.replace(/\.js$/, '.cjs');
      
      // Delete .cjs if it already exists (from previous run)
      if (fs.existsSync(newPath)) {
        fs.unlinkSync(newPath);
      }
      
      fs.renameSync(fullPath, newPath);
      count++;
      console.log(`  ✓ ${path.relative(DIST_DIR, fullPath)} → ${path.basename(newPath)}`);
    }
  }

  return count;
}

/**
 * Main execution
 */
function main() {
  console.log('🔄 Renaming .js files to .cjs in dist/electron...\n');

  const count = renameJsToCjs(DIST_DIR);

  console.log(`\n✅ Renamed ${count} files`);
  console.log('🎉 Done!\n');
}

main();
