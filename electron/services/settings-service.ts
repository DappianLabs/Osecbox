/**
 * Centralized Settings Service
 * Bridges UI settings with backend execution
 * Ensures all settings are actually used by the system
 */

import { app, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec, execFile } from 'child_process';
import { isValidJson, readTextFileWithRecovery, writeTextFileAtomic } from '../utils/atomic-json';
import { normalizeWordlistName } from '../utils/wsl-path';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const MAX_LIVE_UPDATE_BYTES = 1024 * 1024;
const DANGEROUS_SETTING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeStoredAIModel(provider: string, model: string): string {
  const aliases: Record<string, Record<string, string>> = {
    groq: {
      'llama-3.3-70b-specdec': 'openai/gpt-oss-120b',
      'llama-3.1-70b-versatile': 'openai/gpt-oss-120b',
      'mixtral-8x7b-32768': 'openai/gpt-oss-20b',
      'gemma2-9b-it': 'openai/gpt-oss-20b',
    },
    openai: {
      'chat-latest': 'gpt-4.1',
    },
    anthropic: {
      'claude-4.6-opus': 'claude-opus-4-6',
      'claude-4.5-sonnet': 'claude-sonnet-4-5',
      'claude-4.5-haiku': 'claude-haiku-4-5',
      'claude-4.1-opus': 'claude-opus-4-6',
      'claude-3.7-sonnet': 'claude-sonnet-4-5',
      'claude-opus-5': 'claude-opus-4-6',
      'claude-sonnet-5': 'claude-sonnet-4-5',
    },
    google: {
      'gemini-3-pro-preview': 'gemini-3.5-flash',
      'gemini-2.5-flash-lite': 'gemini-3.5-flash',
      'gemini-2.0-flash-001': 'gemini-3.5-flash',
      'gemini-1.5-pro': 'gemini-2.5-pro',
      'gemini-1.5-flash': 'gemini-2.5-flash',
      'gemini-1.0-pro': 'gemini-2.5-flash',
    },
    openrouter: {
      'anthropic/claude-4.6-opus': 'anthropic/claude-sonnet-4-5',
      'anthropic/claude-4.5-sonnet': 'anthropic/claude-sonnet-4-5',
      '~anthropic/claude-sonnet-latest': 'anthropic/claude-sonnet-4-5',
      '~openai/gpt-latest': 'openai/gpt-4.1',
      'google/gemini-3-pro': 'google/gemini-2.5-pro',
      'meta-llama/llama-3.1-70b-instruct': 'openrouter/free',
      'mistralai/mixtral-8x7b-instruct': 'openrouter/free',
    },
    cloudflare: {
      '@cf/meta/llama-3.1-70b-instruct': '@cf/openai/gpt-oss-120b',
      '@cf/meta/llama-3.1-8b-instruct': '@cf/openai/gpt-oss-20b',
      '@cf/meta/llama-3.1-8b-instruct-fast': '@cf/openai/gpt-oss-20b',
      '@cf/qwen/qwen-2.5-72b-instruct': '@cf/openai/gpt-oss-20b',
    },
  };

  const normalizedProvider = String(provider || '').trim().toLowerCase();
  return aliases[normalizedProvider]?.[model] || model;
}

export interface AppSettings {
  // Tool Paths
  nmapPath: string;
  subfinderPath: string;
  amassPath: string;
  assetfinderPath: string;
  ffufPath: string;
  niktoPath: string;
  nucleiPath: string;
  gobusterPath: string;
  msfconsolePath: string;
  msfvenomPath: string;
  
  // WSL2 Settings (Windows only)
  wsl2Distro: string; // WSL2 distro to use (empty = default)
  wsl2User: string; // WSL2 user to run as (empty = default)
  wsl2ExtraPaths: string[]; // Additional PATH directories to inject
  
  // Nmap Settings
  maxConcurrentScans: number;
  defaultTimeout: number;
  
  // Subdomain Settings
  subdomainTimeout: number;
  subfinderAllSources: boolean;
  subfinderRecursive: boolean;
  amassMode: 'passive' | 'active';
  amassBruteForce: boolean;
  ffufThreads: number;
  ffufWordlist: string;
  subdomainAutoResolve: boolean;
  subdomainRemoveDuplicates: boolean;
  subdomainVerifyAlive: boolean;
  
  // Nikto Settings
  niktoTimeout: number;
  niktoSSL: boolean;
  niktoAggressive: boolean;
  
  // Nuclei Settings
  nucleiTemplatesPath: string;
  nucleiConcurrency: number;
  nucleiRateLimit: number;
  nucleiAutoUpdate: boolean;
  
  // Directory Brute Force Settings
  wordlistPath: string;
  dirThreads: number;
  dirTimeout: number;
  dirFollowRedirects: boolean;
  
  // Metasploit Settings
  lhost: string;
  lport: number;
  msfAutoStartDB: boolean;
  
  // General Settings
  autoSaveResults: boolean;
  enableNotifications: boolean;
  darkMode: boolean;
  verboseOutput: boolean;
  saveHistory: boolean;
  maxHistoryItems: number;
  exportPath: string;
  persistWorkspace: boolean;
  
  // AI Settings
  aiApiKey: string;
  apiEndpoint: string;
  selectedModel: string;
  provider: string;
  aiTokenLimit: number;
  aiContextMode: 'ultra' | 'compact';
  cloudflareAccountId?: string; // For Cloudflare Workers AI
  
  // Terminal Settings
  terminalBufferSize: number;
  terminalScrollback: number;
  terminalMaxTerminals: number;
}

class SettingsService {
  private settings: AppSettings | null = null;
  private settingsPath: string;
  private readonly loadPromise: Promise<void>;
  private settingsUpdateQueue: Promise<void> = Promise.resolve();
  private listeners: Set<(settings: AppSettings) => void> = new Set();

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.loadPromise = this.loadSettings();
  }

  private async waitForSecureStorage(): Promise<void> {
    // Electron's OS credential backend is not guaranteed to be initialized
    // before app.ready. Waiting here keeps first-run settings loading correct
    // without blocking module import or the first window paint.
    if (!app.isReady()) await app.whenReady();
  }

  private isSecureStorageAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private decryptStoredApiKey(value: unknown): { apiKey: string; failed: boolean } {
    if (typeof value !== 'string' || !value.trim()) return { apiKey: '', failed: false };
    try {
      const encrypted = Buffer.from(value, 'base64');
      if (!encrypted.length || !this.isSecureStorageAvailable()) {
        return { apiKey: '', failed: true };
      }
      return { apiKey: safeStorage.decryptString(encrypted).trim(), failed: false };
    } catch (error) {
      console.error('[SettingsService] Stored AI credential could not be decrypted; re-enter it in Settings.', error);
      return { apiKey: '', failed: true };
    }
  }

  async waitUntilReady(): Promise<void> {
    await this.loadPromise;
  }

  /**
   * Load settings from disk with validation
   */
  private async loadSettings(): Promise<void> {
    try {
      await this.waitForSecureStorage();
      const data = await readTextFileWithRecovery(this.settingsPath, isValidJson);
      if (data) {
        const rawParsed = JSON.parse(data);
        const encryptedKey = rawParsed?.aiApiKeyEncrypted;
        const legacyPlaintextKey = typeof rawParsed?.aiApiKey === 'string' ? rawParsed.aiApiKey : '';
        const decrypted = this.decryptStoredApiKey(encryptedKey);
        const parsed = { ...rawParsed, aiApiKey: encryptedKey ? decrypted.apiKey : legacyPlaintextKey };
        delete parsed.aiApiKeyEncrypted;
        
        // Validate settings schema
        const { validateSettings } = await import('../utils/settings-schema');
        const validation = validateSettings(parsed);
        
        if (validation.valid && validation.settings) {
          const defaults = await this.getDefaultSettings();
          const savedSettings = {
            ...validation.settings,
            selectedModel: normalizeStoredAIModel(validation.settings.provider, validation.settings.selectedModel),
          };

          // Preserve saved Cloudflare credentials while filling missing fields
          // from the current defaults. Empty credential defaults stay empty.
          this.settings = savedSettings.provider === 'cloudflare'
            ? {
                ...savedSettings,
                aiApiKey: savedSettings.aiApiKey || defaults.aiApiKey,
                cloudflareAccountId: savedSettings.cloudflareAccountId || defaults.cloudflareAccountId,
                apiEndpoint: savedSettings.apiEndpoint || 'cloudflare',
              }
            : savedSettings;
          if (
            savedSettings.selectedModel !== validation.settings.selectedModel ||
            (Boolean(legacyPlaintextKey) && this.isSecureStorageAvailable() && !decrypted.failed)
          ) {
            await this.saveSettings();
          }
          console.log('[SettingsService] Settings loaded and validated');
        } else {
          console.error('[SettingsService] Invalid settings:', validation.errors);
          console.log('[SettingsService] Using defaults due to validation failure');
          this.settings = await this.getDefaultSettings();
          await this.saveSettings(); // Overwrite corrupted settings
        }
      } else {
        this.settings = await this.getDefaultSettings();
        await this.saveSettings();
        console.log('[SettingsService] Default settings created');
      }
    } catch (error) {
      console.error('[SettingsService] Failed to load settings:', error);
      this.settings = await this.getDefaultSettings();
      // Try to save defaults
      try {
        await this.saveSettings();
      } catch (saveError) {
        console.error('[SettingsService] Failed to save default settings:', saveError);
      }
    }
  }

  /**
   * Get default settings with auto-detected tool paths
   */
  private async getDefaultSettings(): Promise<AppSettings> {
    // PERFORMANCE: Don't detect tool paths on startup
    // Use default paths, tools will be detected lazily on first use
    const detectedPaths: Record<string, string> = {};
    
    return {
      // Tool Paths (auto-detected)
      nmapPath: detectedPaths.nmap || 'nmap',
      subfinderPath: detectedPaths.subfinder || 'subfinder',
      amassPath: detectedPaths.amass || 'amass',
      assetfinderPath: detectedPaths.assetfinder || 'assetfinder',
      ffufPath: detectedPaths.ffuf || 'ffuf',
      niktoPath: detectedPaths.nikto || 'nikto',
      nucleiPath: detectedPaths.nuclei || 'nuclei',
      gobusterPath: detectedPaths.gobuster || 'gobuster',
      msfconsolePath: detectedPaths.msfconsole || 'msfconsole',
      msfvenomPath: detectedPaths.msfvenom || 'msfvenom',
      
      // WSL2 Settings (Windows only)
      wsl2Distro: '', // Empty = use default distro
      wsl2User: '', // Empty = use default user
      wsl2ExtraPaths: [], // Additional PATH directories
      
      // Nmap Settings
      maxConcurrentScans: 3,
      defaultTimeout: 300,
      
      // Subdomain Settings
      subdomainTimeout: 600,
      subfinderAllSources: true,
      subfinderRecursive: false,
      amassMode: 'passive',
      amassBruteForce: false,
      ffufThreads: 40,
      ffufWordlist: await this.findWordlist('subdomains-top1million-5000.txt'),
      subdomainAutoResolve: true,
      subdomainRemoveDuplicates: true,
      subdomainVerifyAlive: true,
      
      // Nikto Settings
      niktoTimeout: 1800,
      niktoSSL: true,
      niktoAggressive: false,
      
      // Nuclei Settings
      nucleiTemplatesPath: '~/nuclei-templates',
      nucleiConcurrency: 25,
      nucleiRateLimit: 150,
      nucleiAutoUpdate: true,
      
      // Directory Brute Force Settings
      wordlistPath: await this.findWordlist('common.txt'),
      dirThreads: 10,
      dirTimeout: 10,
      dirFollowRedirects: false,
      
      // Metasploit Settings
      lhost: '',
      lport: 4444,
      msfAutoStartDB: true,
      
      // General Settings
      autoSaveResults: true,
      enableNotifications: true,
      darkMode: true,
      verboseOutput: false,
      saveHistory: true,
      maxHistoryItems: 100,
      exportPath: path.join(require('os').homedir(), 'osecbox-exports'),
      persistWorkspace: false,
      
      // AI settings. Credentials are entered by the user and stored locally.
      aiApiKey: '',
      apiEndpoint: 'cloudflare',
      selectedModel: '@cf/openai/gpt-oss-120b',
      provider: 'cloudflare',
      cloudflareAccountId: '',
      aiTokenLimit: 30000,
      aiContextMode: 'ultra',
      
      // Terminal Settings
      terminalBufferSize: 0,
      terminalScrollback: 10000,
      terminalMaxTerminals: 50,
    };
  }

  /**
   * Auto-detect tool paths (for manual refresh only)
   */
  async refreshToolPaths(): Promise<Record<string, string>> {
    return this.detectToolPaths();
  }

  /**
   * Auto-detect tool paths
   */
  private async detectToolPaths(): Promise<Record<string, string>> {
    const tools = [
      'nmap', 'subfinder', 'amass', 'assetfinder', 'ffuf', 
      'nikto', 'nuclei', 'gobuster', 'msfconsole', 'msfvenom'
    ];
    
    const detected: Record<string, string> = {};
    
    for (const tool of tools) {
      try {
        const command = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await execAsync(`${command} ${tool}`, { 
          timeout: 2000,
          env: process.env
        });
        
        const foundPath = stdout.trim().split('\n')[0];
        if (foundPath && foundPath !== '') {
          detected[tool] = foundPath;
          console.log(`[SettingsService] Found ${tool} at: ${foundPath}`);
        }
      } catch (error) {
        console.log(`[SettingsService] ${tool} not found in PATH`);
      }
    }
    
    return detected;
  }

  /**
   * Find wordlist in common locations
   */
  private async findWordlist(filename: string): Promise<string> {
    const normalizedName = normalizeWordlistName(filename);
    if (!normalizedName) return '';

    const commonLocations = [
      `/usr/share/wordlists/${normalizedName}`,
      `/usr/share/seclists/Discovery/DNS/${normalizedName}`,
      `/usr/share/dirb/wordlists/${normalizedName}`,
      `/usr/local/share/wordlists/${normalizedName}`,
      `/opt/wordlists/${normalizedName}`,
      `${require('os').homedir()}/wordlists/${normalizedName}`,
      `./wordlists/${normalizedName}`,
    ];

    for (const location of commonLocations) {
      try {
        const stats = await fs.promises.stat(location);
        if (stats.isFile()) {
          console.log(`[SettingsService] Found wordlist at: ${location}`);
          return location;
        }
      } catch {
        continue;
      }
    }

    console.log(`[SettingsService] Wordlist ${normalizedName} not found, using filename`);
    return normalizedName;
  }

  /**
   * Get current settings
   */
  getSettings(): AppSettings {
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }
    return {
      ...this.settings,
      wsl2ExtraPaths: [...this.settings.wsl2ExtraPaths],
    };
  }

  private isPlainSettingsObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private queueSettingsMutation(operation: () => Promise<void>): Promise<void> {
    const queuedOperation = this.settingsUpdateQueue.then(operation);
    this.settingsUpdateQueue = queuedOperation.catch(() => undefined);
    return queuedOperation;
  }

  private queueSettingsUpdate(updates: Record<string, unknown>): Promise<void> {
    return this.queueSettingsMutation(() => this.applySettingsUpdate(updates));
  }

  private async applySettingsUpdate(updates: Record<string, unknown>): Promise<void> {
    await this.waitUntilReady();
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }

    const ownKeys = Reflect.ownKeys(updates);
    if (ownKeys.length > Object.keys(this.settings).length) {
      throw new Error('Too many settings keys');
    }

    const allowedKeys = new Set(Object.keys(this.settings));
    const safeUpdates: Record<string, unknown> = Object.create(null);
    for (const key of ownKeys) {
      if (typeof key !== 'string' || DANGEROUS_SETTING_KEYS.has(key) || !allowedKeys.has(key)) {
        throw new Error(`Unknown setting key: ${String(key)}`);
      }

      const descriptor = Object.getOwnPropertyDescriptor(updates, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error(`Invalid setting value for: ${key}`);
      }
      safeUpdates[key] = descriptor.value;
    }

    let serializedUpdates: string;
    try {
      serializedUpdates = JSON.stringify(safeUpdates);
    } catch {
      throw new Error('Settings update must contain JSON-compatible values');
    }
    if (serializedUpdates.length > MAX_LIVE_UPDATE_BYTES) {
      throw new Error('Settings update too large');
    }

    const candidate = {
      ...this.settings,
      wsl2ExtraPaths: [...this.settings.wsl2ExtraPaths],
    } as AppSettings;
    for (const key of Object.keys(safeUpdates)) {
      (candidate as unknown as Record<string, unknown>)[key] = safeUpdates[key];
    }

    const { validateSettings } = await import('../utils/settings-schema');
    const validation = validateSettings(candidate);
    if (!validation.valid || !validation.settings) {
      throw new Error(`Invalid settings: ${validation.errors?.join(', ') || 'schema validation failed'}`);
    }

    // Validate the complete merged candidate before changing the live object.
    // saveSettings() receives the candidate directly so a failed persistence
    // operation leaves the in-memory settings untouched.
    await this.saveSettings(validation.settings);
    this.settings = validation.settings;
    this.notifyListeners();
  }

  /**
   * Update a specific setting
   */
  async updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    if (typeof key !== 'string') {
      throw new Error('Invalid setting key');
    }

    const update: Record<string, unknown> = Object.create(null);
    update[key] = value;
    await this.queueSettingsUpdate(update);
  }

  /**
   * Update multiple settings at once
   */
  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    if (!this.isPlainSettingsObject(updates)) {
      throw new Error('Settings update must be a plain object');
    }
    await this.queueSettingsUpdate(updates as Record<string, unknown>);
  }

  /**
   * Save settings to disk
   */
  private async saveSettings(settingsToSave: AppSettings | null = this.settings): Promise<void> {
    try {
      await this.waitForSecureStorage();
      if (!settingsToSave) {
        throw new Error('Settings not loaded');
      }

      const persistedSettings: Record<string, unknown> = { ...settingsToSave };
      const apiKey = typeof persistedSettings.aiApiKey === 'string'
        ? persistedSettings.aiApiKey.trim()
        : '';

      if (apiKey && this.isSecureStorageAvailable()) {
        persistedSettings.aiApiKey = '';
        persistedSettings.aiApiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64');
      } else if (apiKey) {
        // Linux installations without a secret-service/keyring still need to
        // work. Keep this compatibility fallback explicit and visible; normal
        // Windows/macOS installations use DPAPI/Keychain-backed encryption.
        console.warn('[SettingsService] OS credential storage is unavailable; AI key remains in the userData settings file on this host.');
      }

      const data = JSON.stringify(persistedSettings, null, 2);
      await writeTextFileAtomic(this.settingsPath, data);
      console.log('[SettingsService] Settings saved to disk');
    } catch (error) {
      console.error('[SettingsService] Failed to save settings:', error);
      throw error;
    }
  }

  /**
   * Validate tool path exists and is executable
   */
  async validateToolPath(toolPath: string): Promise<{ valid: boolean; error?: string }> {
    if (typeof toolPath !== 'string') {
      return { valid: false, error: 'Invalid tool path' };
    }

    const candidate = toolPath.trim();
    if (!candidate) {
      return { valid: false, error: 'Invalid tool path' };
    }
    if (candidate.length > 4096) {
      return { valid: false, error: 'Tool path too long' };
    }
    if (/[\u0000-\u001f\u007f]/.test(candidate)) {
      return { valid: false, error: 'Invalid tool path' };
    }

    const looksLikePath = path.isAbsolute(candidate)
      || /[\\/]/.test(candidate)
      || /^[a-zA-Z]:/.test(candidate);
    const isWslPath = process.platform === 'win32' && candidate.startsWith('/');

    if (looksLikePath && !isWslPath) {
      try {
        const stats = await fs.promises.stat(candidate);
        if (!stats.isFile()) {
          return { valid: false, error: 'Path is not a file' };
        }
      } catch {
        return { valid: false, error: 'File does not exist' };
      }
    }

    const probe = async (executable: string, prefixArgs: string[] = []): Promise<boolean> => {
      for (const flag of ['--version', '--help']) {
        try {
          await execFileAsync(executable, [...prefixArgs, flag], {
            timeout: 5000,
            maxBuffer: 512 * 1024,
            windowsHide: true,
            env: process.env,
          });
          return true;
        } catch {
          // Some legitimate tools only support one of these probes.
        }
      }
      return false;
    };

    // Bare names and POSIX paths are executed in the selected WSL runtime on
    // Windows. Reuse the platform strategy so distro, user, --cd, and the
    // shared configured PATH all match actual tool execution.
    const isBareCommand = !looksLikePath && !/\s/.test(candidate);
    const shouldProbeWsl = process.platform === 'win32' && (isBareCommand || isWslPath);
    if (shouldProbeWsl) {
      try {
        const { platformService } = await import('../platform-service');
        const { buildWslPath, shellQuotePathSegment } = await import('../utils/wsl-path');
        const platformInfo = await platformService.getPlatformInfo();
        if (platformInfo.isWindows && platformInfo.wsl2Status !== 'available') {
          return {
            valid: false,
            error: `WSL2 unavailable (${platformInfo.wsl2Status}): ${platformInfo.wsl2Error || 'the Linux runtime could not execute a command'}`,
          };
        }

        const strategy = await platformService.getExecutionStrategy(true);
        if (!strategy.shouldUseWSL) {
          return {
            valid: false,
            error: 'Linux tool validation requires an available WSL2 execution strategy',
          };
        }

        await this.waitUntilReady();
        const settings = this.getSettings();
        const quotedCandidate = shellQuotePathSegment(candidate);
        const pathString = buildWslPath(settings.wsl2ExtraPaths || []);
        const availabilityCheck = isWslPath
          ? `test -x ${quotedCandidate}`
          : `command -v ${quotedCandidate} >/dev/null 2>&1`;
        const probeScript = `export PATH=${pathString}; ${availabilityCheck} && (${quotedCandidate} --version >/dev/null 2>&1 || ${quotedCandidate} --help >/dev/null 2>&1)`;
        await execFileAsync(strategy.commandPrefix[0], [
          ...strategy.commandPrefix.slice(1),
          probeScript,
        ], {
          timeout: 5000,
          maxBuffer: 512 * 1024,
          windowsHide: true,
          env: process.env,
        });
        return { valid: true };
      } catch (error: any) {
        const reason = typeof error?.message === 'string'
          ? error.message.replace(/\s+/g, ' ').trim().slice(0, 240)
          : '';
        return {
          valid: false,
          error: reason ? `WSL2 tool validation failed: ${reason}` : 'WSL2 tool validation failed',
        };
      }
    }

    if (await probe(candidate)) {
      return { valid: true };
    }

    return { valid: false, error: 'Tool is not executable or not responding' };
  }

  /**
   * Get tool-specific configuration for execution
   */
  getToolConfig(toolName: string): any {
    const settings = this.getSettings();
    
    switch (toolName) {
      case 'nmap':
        return {
          path: settings.nmapPath,
          timeout: settings.defaultTimeout * 1000,
          maxConcurrent: settings.maxConcurrentScans
        };
        
      case 'subfinder':
        return {
          path: settings.subfinderPath,
          timeout: settings.subdomainTimeout * 1000,
          allSources: settings.subfinderAllSources,
          recursive: settings.subfinderRecursive
        };
        
      case 'amass':
        return {
          path: settings.amassPath,
          timeout: settings.subdomainTimeout * 1000,
          mode: settings.amassMode,
          bruteForce: settings.amassBruteForce
        };
        
      case 'ffuf':
        return {
          path: settings.ffufPath,
          timeout: settings.subdomainTimeout * 1000,
          threads: settings.ffufThreads,
          wordlist: settings.ffufWordlist
        };
        
      case 'nikto':
        return {
          path: settings.niktoPath,
          timeout: settings.niktoTimeout * 1000,
          ssl: settings.niktoSSL,
          aggressive: settings.niktoAggressive
        };
        
      case 'nuclei':
        return {
          path: settings.nucleiPath,
          timeout: settings.defaultTimeout * 1000,
          templatesPath: settings.nucleiTemplatesPath,
          concurrency: settings.nucleiConcurrency,
          rateLimit: settings.nucleiRateLimit,
          autoUpdate: settings.nucleiAutoUpdate
        };
        
      case 'gobuster':
        return {
          path: settings.gobusterPath,
          wordlist: settings.wordlistPath,
          threads: settings.dirThreads,
          timeout: settings.dirTimeout,
          followRedirects: settings.dirFollowRedirects
        };
        
      case 'msfconsole':
        return {
          path: settings.msfconsolePath,
          autoStartDB: settings.msfAutoStartDB
        };
        
      case 'msfvenom':
        return {
          path: settings.msfvenomPath,
          lhost: settings.lhost,
          lport: settings.lport
        };
        
      default:
        return { path: toolName };
    }
  }

  /**
   * Add settings change listener
   */
  addListener(callback: (settings: AppSettings) => void): void {
    this.listeners.add(callback);
  }

  /**
   * Remove settings change listener
   */
  removeListener(callback: (settings: AppSettings) => void): void {
    this.listeners.delete(callback);
  }

  /**
   * Notify all listeners of settings changes
   */
  private notifyListeners(): void {
    if (this.settings) {
      this.listeners.forEach(callback => {
        try {
          callback(this.getSettings());
        } catch (error) {
          console.error('[SettingsService] Listener error:', error);
        }
      });
    }
  }

  /**
   * Reset settings to defaults
   */
  async resetToDefaults(): Promise<void> {
    await this.queueSettingsMutation(async () => {
      await this.waitUntilReady();
      const defaults = await this.getDefaultSettings();
      await this.saveSettings(defaults);
      this.settings = defaults;
      this.notifyListeners();
    });
  }

  /**
   * Export settings to file
   */
  async exportSettings(filePath: string): Promise<void> {
    if (!this.settings) {
      throw new Error('Settings not loaded');
    }

    // SECURITY: Validate path to prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.endsWith('.json')) {
      throw new Error('Invalid file extension - must be .json');
    }

    const exportedSettings: Record<string, unknown> = { ...(this.settings as AppSettings), aiApiKey: '' };
    await writeTextFileAtomic(resolvedPath, JSON.stringify(exportedSettings, null, 2));
  }

  /**
   * Import settings from file with validation
   */
  async importSettings(filePath: string): Promise<void> {
    // SECURITY: Validate path to prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.endsWith('.json')) {
      throw new Error('Invalid file extension - must be .json');
    }
    
    // SECURITY: Check file size before reading (10MB limit)
    const stats = await fs.promises.stat(resolvedPath);
    if (stats.size > 10 * 1024 * 1024) {
      throw new Error('Settings file too large (max 10MB)');
    }
    
    const data = await fs.promises.readFile(resolvedPath, 'utf-8');
    
    // SECURITY: Safe JSON parsing to prevent prototype pollution
    let importedSettings: any;
    try {
      importedSettings = JSON.parse(data);
      
      // Remove dangerous properties
      delete importedSettings.__proto__;
      delete importedSettings.constructor;
      delete importedSettings.prototype;
      
      // Recursively clean nested objects
      function cleanObject(obj: any): any {
        if (obj === null || typeof obj !== 'object') {
          return obj;
        }
        
        if (Array.isArray(obj)) {
          return obj.map(cleanObject);
        }
        
        const cleaned: any = {};
        for (const key of Object.keys(obj)) {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
          }
          cleaned[key] = cleanObject(obj[key]);
        }
        return cleaned;
      }
      
      importedSettings = cleanObject(importedSettings);
    } catch (error) {
      throw new Error('Invalid JSON format');
    }
    
    // Validate and apply inside the same mutation queue as live updates and
    // reset operations. This prevents a late import from overwriting a newer
    // setting update that completed while the file was being read.
    const { validateSettings, mergeWithDefaults } = await import('../utils/settings-schema');
    const defaultSettings = await this.getDefaultSettings();
    await this.queueSettingsMutation(async () => {
      await this.waitUntilReady();
      // Settings exports intentionally omit provider credentials. Keep the
      // current in-memory key when importing a portable configuration, while a
      // user can still clear it explicitly from the AI settings screen.
      const merged = mergeWithDefaults(importedSettings, {
        ...defaultSettings,
        aiApiKey: this.settings?.aiApiKey || defaultSettings.aiApiKey,
      });

      const validation = validateSettings(merged);
      if (!validation.valid || !validation.settings) {
        throw new Error(`Invalid settings file: ${validation.errors?.join(', ')}`);
      }

      await this.saveSettings(validation.settings);
      this.settings = validation.settings;
      this.notifyListeners();
    });
  }
}

// Singleton instance
export const settingsService = new SettingsService();
