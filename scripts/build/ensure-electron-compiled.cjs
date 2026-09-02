#!/usr/bin/env node
/**
 * Ensure Electron is compiled before starting
 * This prevents the "Cannot find module" error
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const mainFile = path.join(projectRoot, 'dist', 'electron', 'main.cjs');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log('🔍 Checking if Electron is compiled...');

if (!fs.existsSync(mainFile)) {
  console.log('❌ Electron not compiled! Compiling now...');
  console.log('⚙️  Running: npm run compile:electron');
  
  try {
    console.log('📦 Running the Electron compilation pipeline...');
    execSync(`${npmCommand} run compile:electron`, {
      stdio: 'inherit',
      cwd: projectRoot
    });
    
    console.log('✅ Compilation complete!');
  } catch (error) {
    console.error('❌ Compilation failed:', error.message);
    process.exit(1);
  }
} else {
  console.log('✅ Electron already compiled!');
}
