#!/usr/bin/env node

/**
 * Clear Electron Cache Script
 * 
 * Clears all Electron app cache, session data, storage, AND localStorage
 * to force a fresh start and verify fixes are working.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Support both the current product name and the legacy data directory.
const APP_NAMES = ['osecbox', 'offsecbox'];

// List of localStorage keys to clear
const LOCALSTORAGE_KEYS = [
  'subdomain-store',
  'foothold-store',
  'tunneling-store',
  'metasploit-store',
  'scanner-store',
  'panel-layout-store',
  'terminal-debug',
  'react-resizable-panels:*', // Wildcard for all panel layouts
];

function getElectronCachePaths() {
  const platform = os.platform();
  const home = os.homedir();
  
  const paths = [];
  
  if (platform === 'win32') {
    // Windows paths
    for (const appName of APP_NAMES) {
      paths.push(
        path.join(home, 'AppData', 'Roaming', appName),
        path.join(home, 'AppData', 'Local', appName),
        path.join(home, 'AppData', 'Local', 'Temp', appName)
      );
    }
  } else if (platform === 'darwin') {
    // macOS paths
    for (const appName of APP_NAMES) {
      paths.push(
        path.join(home, 'Library', 'Application Support', appName),
        path.join(home, 'Library', 'Caches', appName),
        path.join(home, 'Library', 'Logs', appName)
      );
    }
  } else {
    // Linux paths
    for (const appName of APP_NAMES) {
      paths.push(
        path.join(home, '.config', appName),
        path.join(home, '.cache', appName),
        path.join(home, '.local', 'share', appName)
      );
    }
  }
  
  return paths;
}

function deleteFolderRecursive(folderPath) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const curPath = path.join(folderPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(folderPath);
  }
}

function clearLocalStorageFiles() {
  console.log('\n🗑️  Clearing localStorage files...\n');
  
  const cachePaths = getElectronCachePaths();
  let clearedCount = 0;
  
  cachePaths.forEach((cachePath) => {
    // Look for Local Storage directory
    const localStoragePath = path.join(cachePath, 'Local Storage');
    const levelDbPath = path.join(localStoragePath, 'leveldb');
    
    if (fs.existsSync(levelDbPath)) {
      console.log(`📁 Found localStorage: ${levelDbPath}`);
      try {
        deleteFolderRecursive(levelDbPath);
        console.log(`✅ Cleared localStorage: ${levelDbPath}\n`);
        clearedCount++;
      } catch (error) {
        console.error(`❌ Failed to clear ${levelDbPath}:`, error.message, '\n');
      }
    }
  });
  
  return clearedCount;
}

function clearCache() {
  console.log('🧹 NUCLEAR CACHE CLEAR - Clearing EVERYTHING...\n');
  console.log('This will clear:');
  console.log('  - Electron app cache');
  console.log('  - Session data');
  console.log('  - localStorage (subdomain data, panel layouts, etc.)');
  console.log('  - IndexedDB');
  console.log('  - All persisted Zustand stores\n');
  
  const cachePaths = getElectronCachePaths();
  let clearedCount = 0;
  
  // Clear main cache directories
  cachePaths.forEach((cachePath) => {
    if (fs.existsSync(cachePath)) {
      console.log(`📁 Found cache: ${cachePath}`);
      try {
        deleteFolderRecursive(cachePath);
        console.log(`✅ Cleared: ${cachePath}\n`);
        clearedCount++;
      } catch (error) {
        console.error(`❌ Failed to clear ${cachePath}:`, error.message, '\n');
      }
    } else {
      console.log(`⏭️  Not found: ${cachePath}\n`);
    }
  });
  
  // Clear localStorage specifically
  const localStorageCleared = clearLocalStorageFiles();
  clearedCount += localStorageCleared;
  
  if (clearedCount > 0) {
    console.log(`\n✅ Successfully cleared ${clearedCount} cache location(s)`);
    console.log('\n🔄 IMPORTANT: Restart the application to see changes.');
    console.log('\n📝 What was cleared:');
    console.log('  ✅ Subdomain data (www.sherinfolab.in, etc.)');
    console.log('  ✅ Panel layouts and sizes');
    console.log('  ✅ Terminal history');
    console.log('  ✅ All Zustand store data');
    console.log('  ✅ Electron cache and session data');
  } else {
    console.log('\n⚠️  No cache found to clear.');
    console.log('\n💡 TIP: Make sure the app is closed before running this script.');
  }
}

// Run the cache clearing
clearCache();
