/**
 * Production Build Script
 * Handles encryption, building, and packaging for production
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const targetFlag = process.argv.slice(2).find((arg) => /^--(win|linux|mac)$/.test(arg));

/**
 * Run command and wait for completion
 */
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n[Build] Running: ${command} ${args.join(' ')}`);

    const isWindowsCmd = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
    const executable = isWindowsCmd ? (process.env.ComSpec || 'cmd.exe') : command;
    const spawnArgs = isWindowsCmd ? ['/d', '/s', '/c', command, ...args] : args;
    
    const proc = spawn(executable, spawnArgs, {
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
      // Invoke Windows command shims through cmd.exe explicitly. This avoids
      // shell=true argument ambiguity while keeping paths with spaces safe.
      shell: false,
      ...options
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}

/**
 * Check if BUILD_ENCRYPTION_SECRET is set
 */
function checkBuildSecret() {
  const buildSecret = process.env.BUILD_ENCRYPTION_SECRET?.trim();

  if (!buildSecret || !/^[a-f0-9]{64}$/i.test(buildSecret)) {
    console.error('\nERROR: BUILD_ENCRYPTION_SECRET must be exactly 64 hexadecimal characters.');
    console.error('Generate one with: openssl rand -hex 32');
    console.error('Set it in the environment or CI/CD secrets.\n');
    process.exit(1);
  }

  console.log('BUILD_ENCRYPTION_SECRET is set');
}

/**
 * Main production build process
 */
async function buildProduction() {
  console.log('[Build] OsecBox production build');
  
  try {
    // Step 1: Check the build encryption secret
    console.log('\n[Step 1/6] Checking BUILD_ENCRYPTION_SECRET...');
    checkBuildSecret();
    
    // Step 2: Validate the native packaging host before changing build output.
    if (targetFlag) {
      await runCommand(process.execPath, ['scripts/build/verify-build-target.cjs', targetFlag]);
    }

    // Step 3: Clean previous builds
    console.log('\n[Step 2/6] Cleaning previous builds...');
    const distDir = path.join(PROJECT_ROOT, 'dist');
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true });
      console.log('✓ Cleaned dist/');
    }
    const releaseDir = path.join(PROJECT_ROOT, 'release');
    if (fs.existsSync(releaseDir)) {
      fs.rmSync(releaseDir, { recursive: true, force: true });
      console.log('✓ Cleaned release/');
    }
    
    // Encryption output is packaged separately from app.asar. Keep source
    // files intact in the working tree; they are not included by the builder.
    console.log('\n[Step 3/6] Generating encrypted runtime modules...');
    await runCommand(process.execPath, ['scripts/build/encrypt-modules.js']);

    // Rebuild node-pty for the actual Electron target before packaging.
    console.log('\n[Step 4/6] Preparing native modules...');
    await runCommand(npmCommand, ['run', 'rebuild:native']);

    // Step 5: Build Vite app
    console.log('\n[Step 5/6] Building Vite app and Electron sources...');
    await runCommand(npmCommand, ['run', 'build']);

    await runCommand(npmCommand, ['run', 'compile:electron']);

    // Step 6: Build Electron package once, for the validated host.
    console.log('\n[Step 6/6] Building Electron package...');
    const builderArgs = ['scripts/build/run-electron-builder.cjs'];
    if (targetFlag) builderArgs.push(targetFlag);
    builderArgs.push('--publish', 'never');
    await runCommand(process.execPath, builderArgs);

    // Treat the produced artifact as a test subject, not just a successful
    // builder exit. This catches missing external resources and ABI files
    // before a release directory is handed to a user.
    const auditArgs = ['scripts/diagnostics/packaged-artifact-audit.cjs'];
    if (targetFlag) auditArgs.push(`--target=${targetFlag.slice(2)}`);
    await runCommand(process.execPath, auditArgs);
    await runCommand(npmCommand, ['run', 'release:checksums']);
    
    console.log('[Build] Production build complete');
    console.log('[Build] Output: release/');
    console.log('[Build] Encrypted modules are stored outside app.asar; source files remain intact in the workspace.');
    
  } catch (error) {
    console.error('\n[Build] Failed:', error.message);
    
    process.exit(1);
  }
}

// Run build
buildProduction();
