/**
 * Optional encrypted-module boundary.
 *
 * The public build ships its local implementations. Licensed bundles may add
 * encrypted modules at packaging time without changing the callers below.
 */

/**
 * Load a packaged encrypted module.
 */
export async function loadEncryptedModule(moduleName: string): Promise<any> {
  if (typeof window === 'undefined' || typeof window.electron?.decryptUltraModule !== 'function') {
    throw new Error(`Encrypted modules require the Electron runtime: ${moduleName}`);
  }

  return window.electron.decryptUltraModule(moduleName);
}

/**
 * Check whether the current build and license can use encrypted modules.
 */
export async function isEncryptedModuleAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof window.electron?.isUltraAvailable !== 'function') {
    return false;
  }

  try {
    return await window.electron.isUltraAvailable();
  } catch {
    return false;
  }
}

/**
 * Load a packaged module when available and fall back to the local version.
 */
export async function loadModuleWithFallback<T>(
  moduleName: string, 
  liteModule: () => Promise<T>
): Promise<T> {
  if (await isEncryptedModuleAvailable()) {
    try {
      return (await loadEncryptedModule(moduleName)) as T;
    } catch {
      // The local implementation remains the safe fallback for development
      // and for packages without the optional encrypted module.
    }
  }

  return liteModule();
}
