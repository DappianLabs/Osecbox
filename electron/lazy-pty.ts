/**
 * Lazy loading for node-pty native module
 * 
 * node-pty is a heavy native module that takes 2-5 seconds to load.
 * This module defers loading until the first terminal is actually created.
 */

import type * as pty from 'node-pty';
import fs from 'fs';
import path from 'path';

let ptyModule: typeof pty | null = null;
let loadPromise: Promise<typeof pty> | null = null;
let loadError: Error | null = null;

function hasNativeBinary(packageRoot: string): boolean {
  const platformArch = `${process.platform}-${process.arch}`;
  const candidates = process.platform === 'win32'
    ? ['conpty.node', 'pty.node']
    : ['pty.node'];

  return candidates.some((fileName) => (
    fs.existsSync(path.join(packageRoot, 'build', 'Release', fileName)) ||
    fs.existsSync(path.join(packageRoot, 'build', 'Debug', fileName)) ||
    fs.existsSync(path.join(packageRoot, 'prebuilds', platformArch, fileName))
  ));
}

/**
 * Resolve node-pty across both the standard npm layout and the nested layout
 * produced by some existing node-pty installs in this workspace. The latter
 * keeps native files under node-pty/node-pty/prebuilds, while node-pty's own
 * loader only checks the package root.
 */
function loadInstalledPTY(): typeof pty {
  const packageRoot = path.dirname(require.resolve('node-pty/package.json'));
  const nestedRoot = path.join(packageRoot, 'node-pty');

  if (!hasNativeBinary(packageRoot) && hasNativeBinary(nestedRoot)) {
    console.warn('[LazyPTY] Using nested node-pty native layout');
    return require(path.join(nestedRoot, 'lib', 'index.js')) as typeof pty;
  }

  return require('node-pty') as typeof pty;
}

/**
 * Load node-pty module (lazy, cached)
 */
export async function loadPTY(): Promise<typeof pty> {
  // Already loaded
  if (ptyModule) {
    return ptyModule;
  }

  // Already failed
  if (loadError) {
    throw loadError;
  }

  // Already loading
  if (loadPromise) {
    return loadPromise;
  }

  // Start loading
  console.log('[LazyPTY] Loading node-pty module...');
  const startTime = Date.now();

  loadPromise = (async () => {
    try {
      // Resolve only when needed so startup stays light, while supporting both
      // standard and nested native-module layouts in packaged installations.
      const module = loadInstalledPTY();
      ptyModule = module;
      
      const loadTime = Date.now() - startTime;
      console.log(`[LazyPTY] Loaded successfully in ${loadTime}ms`);
      
      return module;
    } catch (error: any) {
      loadError = error;
      console.error('[LazyPTY] Failed to load:', error.message);
      throw error;
    }
  })();

  return loadPromise;
}

/**
 * Check if node-pty is loaded
 */
export function isPTYLoaded(): boolean {
  return ptyModule !== null;
}

/**
 * Get loaded PTY module (throws if not loaded)
 */
export function getPTY(): typeof pty {
  if (!ptyModule) {
    throw new Error('node-pty not loaded yet. Call loadPTY() first.');
  }
  return ptyModule;
}

/**
 * Preload node-pty in background (non-blocking)
 */
export function preloadPTY(): void {
  if (!ptyModule && !loadPromise) {
    loadPTY().catch(error => {
      console.error('[LazyPTY] Preload failed:', error);
    });
  }
}
