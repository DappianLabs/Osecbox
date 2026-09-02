/**
 * Intelligent caching for expensive startup operations
 * 
 * This module caches:
 * - System information (OS, distro, architecture)
 * - Tool paths (nmap, nikto, nuclei, etc.)
 * - Platform detection (WSL2, native Linux, etc.)
 * 
 * Cache TTL: 24 hours (configurable)
 * Cache location: Electron's per-user application data directory
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  version: string; // App version for cache invalidation
}

interface StartupCache {
  systemInfo?: CacheEntry<any>;
  platformInfo?: CacheEntry<any>;
  // toolPaths removed - tools should always be detected fresh
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_VERSION = app.getVersion(); // Use app version for cache invalidation
const IS_DEV = !app.isPackaged; // Development mode detection

class StartupCacheManager {
  private cacheFilePath: string;
  private cache: StartupCache = {};
  private isLoaded = false;

  constructor() {
    this.cacheFilePath = path.join(
      app.getPath('userData'),
      'startup-cache.json'
    );
  }

  /**
   * Load cache from disk (async, non-blocking)
   */
  async load(): Promise<void> {
    if (this.isLoaded) return;

    try {
      // In development mode, always start fresh
      if (IS_DEV) {
        console.log('[Cache] Development mode - starting with fresh cache');
        this.cache = {};
        this.isLoaded = true;
        return;
      }

      const data = await fs.readFile(this.cacheFilePath, 'utf-8');
      this.cache = JSON.parse(data);
      this.isLoaded = true;
      console.log('[Cache] Loaded startup cache');
    } catch (error) {
      // Cache doesn't exist or is corrupted - start fresh
      this.cache = {};
      this.isLoaded = true;
      console.log('[Cache] No existing cache found, starting fresh');
    }
  }

  /**
   * Get cached value if valid, otherwise return null
   */
  get<T>(key: keyof StartupCache): T | null {
    const entry = this.cache[key] as CacheEntry<T> | undefined;
    
    if (!entry) {
      return null;
    }

    // Check version
    if (entry.version !== CACHE_VERSION) {
      console.log(`[Cache] Version mismatch for ${key}, invalidating`);
      return null;
    }

    // Check TTL
    const age = Date.now() - entry.timestamp;
    if (age > CACHE_TTL) {
      console.log(`[Cache] Expired cache for ${key} (age: ${Math.round(age / 1000)}s)`);
      return null;
    }

    console.log(`[Cache] Hit for ${key} (age: ${Math.round(age / 1000)}s)`);
    return entry.data;
  }

  /**
   * Set cache value and persist to disk (async, non-blocking)
   */
  async set<T>(key: keyof StartupCache, data: T): Promise<void> {
    // Don't persist cache in development mode
    if (IS_DEV) {
      console.log(`[Cache] Development mode - not persisting ${key}`);
      return;
    }

    this.cache[key] = {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    } as any;

    // Persist to disk (fire and forget)
    this.persist().catch(error => {
      console.warn('[Cache] Failed to persist cache:', error);
    });
  }

  /**
   * Persist cache to disk
   */
  private async persist(): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
      
      // Write cache
      await fs.writeFile(
        this.cacheFilePath,
        JSON.stringify(this.cache, null, 2),
        'utf-8'
      );
      
      console.log('[Cache] Persisted to disk');
    } catch (error) {
      console.error('[Cache] Failed to persist:', error);
    }
  }

  /**
   * Invalidate specific cache entry
   */
  async invalidate(key: keyof StartupCache): Promise<void> {
    delete this.cache[key];
    await this.persist();
    console.log(`[Cache] Invalidated ${key}`);
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.cache = {};
    await this.persist();
    console.log('[Cache] Cleared all cache');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const stats: Record<string, any> = {};
    
    for (const [key, entry] of Object.entries(this.cache)) {
      if (entry && 'timestamp' in entry) {
        const age = Date.now() - entry.timestamp;
        const isValid = age < CACHE_TTL && entry.version === CACHE_VERSION;
        
        stats[key] = {
          age: Math.round(age / 1000),
          valid: isValid,
          version: entry.version,
        };
      }
    }
    
    return stats;
  }
}

// Singleton instance
export const startupCache = new StartupCacheManager();
