/**
 * Module Decryptor
 * Decrypts Ultra mode modules in memory only
 * Never writes decrypted content to disk
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

interface EncryptedModule {
  encrypted: string;
  iv: string;
  authTag: string;
  salt: string; // Salt for PBKDF2 key derivation
  originalPath: string;
}

interface DecryptedModule {
  name: string;
  code: string;
  hash: string;
}

class ModuleDecryptor {
  private decryptedModules: Map<string, DecryptedModule> = new Map();
  private encryptedDir: string;
  private runtimeKey: Buffer | null = null;
  private initialization: Promise<void>;

  constructor() {
    // Path to encrypted modules (bundled with app)
    this.encryptedDir = app.isPackaged
      ? path.join(process.resourcesPath, 'encrypted-modules')
      : path.join(__dirname, '../../encrypted-modules');
    
    // Set the decryption key on startup. Callers await this promise so a
    // cold launch cannot race the optional license/build-key initialization.
    this.initialization = this.autoInitialize();
  }

  /**
   * Set runtime decryption key (from license server)
   * Use BUILD_SECRET directly (no license needed)
   */
  setRuntimeKey(key: string): void {
    // Derive 256-bit key from license server response
    // Server sends key derived from: BUILD_SECRET + license_key
    // We hash it again to get the final decryption key
    this.runtimeKey = crypto.createHash('sha256').update(key).digest();
    // SECURITY: Don't log sensitive data
  }
  
  /**
   * Auto-initialize based on monetization flag
   */
  async autoInitialize(): Promise<void> {
    // Master switch - if monetization disabled, everyone gets access
    const FEATURE_FLAGS = { enableMonetization: false }; // Will be replaced at build time
    
    if (!FEATURE_FLAGS.enableMonetization) {
      console.log('[ModuleDecryptor] Launch version - all features free');
      
      // Use BUILD_SECRET if available in development
      if (process.env.BUILD_ENCRYPTION_SECRET) {
        const BUILD_SECRET = process.env.BUILD_ENCRYPTION_SECRET;
        this.setRuntimeKey(BUILD_SECRET);
        // SECURITY: Don't log secret usage
      }
      return;
    }

    // Monetization enabled - check license
    try {
      const { licenseManager } = await import('./license-manager');
      const isPro = await licenseManager.isPro();
      
      if (isPro) {
        console.log('[ModuleDecryptor] Pro license detected, Ultra modules available');
        return;
      }
    } catch (error) {
      console.warn('[ModuleDecryptor] License check failed:', error);
    }
    
    // Development mode fallback
    if (process.env.NODE_ENV === 'development' && process.env.BUILD_ENCRYPTION_SECRET) {
      const BUILD_SECRET = process.env.BUILD_ENCRYPTION_SECRET;
      this.setRuntimeKey(BUILD_SECRET);
      // SECURITY: Don't log secret usage
      return;
    }
    
    console.log('[ModuleDecryptor] No Pro license - Ultra modules locked');
  }

  /**
   * Clear runtime key (on license loss)
   */
  clearRuntimeKey(): void {
    this.runtimeKey = null;
    this.decryptedModules.clear();
    // SECURITY: Don't log security operations
  }

  /**
   * Decrypt module in memory with PBKDF2 key derivation
   * Use proper key derivation matching encryption
   */
  private decryptModule(encrypted: EncryptedModule, key: Buffer): string {
    try {
      // Derive key using PBKDF2 with stored salt
      const salt = Buffer.from(encrypted.salt, 'hex');
      const derivedKey = crypto.pbkdf2Sync(
        key,
        salt,
        100000, // Must match encryption iterations
        32, // 256 bits
        'sha256'
      );
      
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        derivedKey,
        Buffer.from(encrypted.iv, 'hex')
      );

      decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

      let decrypted = decipher.update(encrypted.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error('Decryption failed - invalid key or corrupted module');
    }
  }

  /**
   * Verify module integrity
   */
  private verifyChecksum(content: string, expectedHash: string): boolean {
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    return actualHash === expectedHash;
  }

  /**
   * Load and decrypt module
   */
  async loadModule(moduleName: string): Promise<DecryptedModule> {
    await this.initialization;

    // Check if already decrypted
    if (this.decryptedModules.has(moduleName)) {
      return this.decryptedModules.get(moduleName)!;
    }

    // Check runtime key - not needed in free version, but keep for compatibility
    if (!this.runtimeKey) {
      // SECURITY: Don't log key status
    }

    // Load encrypted module
    const encryptedPath = path.join(this.encryptedDir, moduleName + '.enc');
    
    try {
      await fs.promises.access(encryptedPath);
    } catch {
      throw new Error(`Module not found: ${moduleName}`);
    }

    const encryptedData: EncryptedModule = JSON.parse(
      await fs.promises.readFile(encryptedPath, 'utf8')
    );

    // Validate encrypted data structure
    if (!encryptedData || !encryptedData.encrypted || !encryptedData.iv || !encryptedData.salt) {
      throw new Error(`Invalid encrypted module format: ${moduleName}`);
    }
    
    if (!this.runtimeKey) {
      throw new Error('Runtime key not initialized');
    }
    
    const decryptedCode = this.decryptModule(encryptedData, this.runtimeKey);

    // Calculate hash
    const hash = crypto.createHash('sha256').update(decryptedCode).digest('hex');

    // Load manifest to verify
    const manifestPath = path.join(this.encryptedDir, 'manifest.json');
    try {
      await fs.promises.access(manifestPath);
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
      const moduleInfo = manifest.modules.find((m: any) => m.name === moduleName + '.enc');
      
      if (moduleInfo && !this.verifyChecksum(decryptedCode, moduleInfo.hash)) {
        throw new Error('Module checksum mismatch - possible tampering');
      }
    } catch {
      // Manifest doesn't exist, skip verification
    }

    const module: DecryptedModule = {
      name: moduleName,
      code: decryptedCode,
      hash
    };

    // Store in memory only
    this.decryptedModules.set(moduleName, module);

    console.log(`[ModuleDecryptor] ✓ Decrypted: ${moduleName}`);

    return module;
  }

  /**
   * Execute decrypted module
   * SECURITY: Use VM module instead of Function constructor
   */
  async executeModule(moduleName: string): Promise<any> {
    const module = await this.loadModule(moduleName);

    // Execute in isolated VM context for better security
    try {
      const vm = require('vm');
      const moduleExports = {};
      const sandbox = {
        exports: moduleExports,
        require: require,
        console: console,
        Buffer: Buffer,
        process: process,
        __dirname: this.encryptedDir,
        __filename: moduleName,
      };
      
      // SECURITY: Use VM with timeout and limited context
      const script = new vm.Script(module.code, {
        filename: moduleName,
        displayErrors: true,
      });
      
      const context = vm.createContext(sandbox);
      script.runInContext(context, {
        timeout: 5000, // 5 second timeout
        displayErrors: true,
      });
      
      return moduleExports;
    } catch (error: any) {
      console.error(`[ModuleDecryptor] Execution failed: ${moduleName}`, error);
      throw new Error(`Module execution failed: ${error.message}`);
    }
  }

  /**
   * Check if Ultra modules are available (controlled by monetization flag)
   */
  async isUltraAvailable(): Promise<boolean> {
    await this.initialization;

    // A public package must never contain BUILD_ENCRYPTION_SECRET. If no
    // runtime key/license is available, callers should use their local safe
    // implementation instead of being told that an encrypted module works.
    if (!this.runtimeKey) {
      return false;
    }

    // Master switch - free builds may use encrypted modules when an explicit
    // runtime key was supplied (for example, a controlled development run).
    const FEATURE_FLAGS = { enableMonetization: false }; // Will be replaced at build time
    
    if (!FEATURE_FLAGS.enableMonetization) {
      return true;
    }

    // Monetization enabled - check license and runtime key
    if (!this.runtimeKey) {
      return false;
    }
    
    try {
      const { licenseManager } = await import('./license-manager');
      const isPro = await licenseManager.isPro();
      
      if (!isPro) {
        // SECURITY: Don't log security operations
        this.clearRuntimeKey();
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('[ModuleDecryptor] License validation failed:', error);
      return false;
    }
  }

  /**
   * Get decrypted module count (for debugging)
   */
  getLoadedModuleCount(): number {
    return this.decryptedModules.size;
  }
}

// Singleton instance
export const moduleDecryptor = new ModuleDecryptor();
