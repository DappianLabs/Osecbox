import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TERMINAL_CONSTANTS } from '@/lib/constants';

export interface AppSettings {
  // Nmap
  nmapPath: string;
  maxConcurrentScans: number;
  defaultTimeout: number;
  
  // Subdomain Tools
  subfinderPath: string;
  amassPath: string;
  assetfinderPath: string;
  ffufPath: string;
  subdomainTimeout: number;
  // Subfinder options
  subfinderAllSources: boolean;
  subfinderRecursive: boolean;
  // Amass options
  amassMode: 'passive' | 'active';
  amassBruteForce: boolean;
  // ffuf options
  ffufThreads: number;
  ffufWordlist: string;
  // General subdomain options
  subdomainAutoResolve: boolean;
  subdomainRemoveDuplicates: boolean;
  subdomainVerifyAlive: boolean;
  
  // Nikto
  niktoPath: string;
  niktoTimeout: number;
  niktoSSL: boolean;
  niktoAggressive: boolean;
  
  // Nuclei
  nucleiPath: string;
  nucleiTemplatesPath: string;
  nucleiConcurrency: number;
  nucleiRateLimit: number;
  nucleiAutoUpdate: boolean;
  
  // DirBuster/Gobuster
  gobusterPath: string;
  wordlistPath: string;
  dirThreads: number;
  dirTimeout: number;
  dirFollowRedirects: boolean;
  
  // Metasploit
  msfconsolePath: string;
  msfvenomPath: string;
  lhost: string;
  lport: number;
  msfAutoStartDB: boolean;
  
  // WSL2 Settings (Windows only)
  wsl2Distro: string;  // WSL2 distro to use (empty = default)
  wsl2User: string;    // WSL2 user to run as (empty = default)
  wsl2ExtraPaths: string[]; // Additional PATH directories to inject
  
  // General
  autoSaveResults: boolean;
  enableNotifications: boolean;
  darkMode: boolean;
  verboseOutput: boolean;
  saveHistory: boolean;
  maxHistoryItems: number;
  exportPath: string;
  persistWorkspace: boolean;
  
  // AI
  aiApiKey: string;  // RENAMED: Universal API key for all providers
  apiEndpoint: string;
  selectedModel: string;
  provider: string;
  cloudflareAccountId?: string; // For Cloudflare Workers AI
  
  // AI Context Settings (Simple & User-Friendly)
  aiTokenLimit: number;              // Max tokens per AI query (based on model's limit)
  aiContextMode: 'ultra' | 'compact'; // Ultra: full outputs (60-180K), Compact: delta-based (10-30K)
  
  // Terminal Settings
  terminalBufferSize: number;        // Max recovery buffer per terminal in MB (0 = managed)
  terminalScrollback: number;        // Max scrollback lines (xterm.js setting)
  terminalMaxTerminals: number;      // Max number of terminals allowed
}

interface SettingsStore {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

function hasDesktopBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electron?.invoke);
}

const defaultSettings: AppSettings = {
  // Nmap
  // Keep executable settings portable. The backend resolves these names in
  // the selected runtime (WSL2, native Windows, Linux, or macOS).
  nmapPath: 'nmap',
  maxConcurrentScans: 3,
  defaultTimeout: 300,
  
  // Subdomain Tools
  subfinderPath: 'subfinder',
  amassPath: 'amass',
  assetfinderPath: 'assetfinder',
  ffufPath: 'ffuf',
  subdomainTimeout: 600,
  subfinderAllSources: true,
  subfinderRecursive: false,
  amassMode: 'passive',
  amassBruteForce: false,
  ffufThreads: 40,
  ffufWordlist: '', // Resolved by the backend when the selected runtime is known
  subdomainAutoResolve: true,
  subdomainRemoveDuplicates: true,
  subdomainVerifyAlive: true,
  
  // Nikto
  niktoPath: 'nikto',
  niktoTimeout: 1800,
  niktoSSL: true,
  niktoAggressive: false,
  
  // Nuclei
  nucleiPath: 'nuclei',
  nucleiTemplatesPath: '~/nuclei-templates',
  nucleiConcurrency: 25,
  nucleiRateLimit: 150,
  nucleiAutoUpdate: true,
  
  // DirBuster/Gobuster
  gobusterPath: 'gobuster',
  wordlistPath: '', // Resolved by the backend when the selected runtime is known
  dirThreads: 10,
  dirTimeout: 10,
  dirFollowRedirects: false,
  
  // Metasploit
  msfconsolePath: 'msfconsole',
  msfvenomPath: 'msfvenom',
  lhost: '',
  lport: 4444,
  msfAutoStartDB: true,
  
  // WSL2 Settings (Windows only)
  wsl2Distro: '',  // Empty = use default distro
  wsl2User: '',    // Empty = use default user
  wsl2ExtraPaths: [], // Additional PATH directories
  
  // General
  autoSaveResults: true,
  enableNotifications: true,
  darkMode: true,
  verboseOutput: false,
  saveHistory: true,
  maxHistoryItems: 100,
  exportPath: '~/nmap-exports',
  persistWorkspace: false,
  
  // AI credentials are configured by the user and stored locally.
  aiApiKey: '',
  apiEndpoint: 'cloudflare',
  selectedModel: '@cf/openai/gpt-oss-120b',
  provider: 'cloudflare',
  cloudflareAccountId: '',
  
  // AI Context Settings (Simple & User-Friendly)
  aiTokenLimit: 30000,       // Default: 30K tokens (increased for 500 commands)
  aiContextMode: 'ultra',    // Ultra: 500 commands with compression (best for HTB boxes)
  
  // Terminal Settings
  terminalBufferSize: 0,     // Default: managed safe cap
  terminalScrollback: 10000, // Default: 10,000 lines
  terminalMaxTerminals: 50,  // Default: 50 terminals max
};

function normalizeTerminalSettings(settings: Partial<AppSettings>): Partial<AppSettings> {
  const normalized = { ...settings };
  const scrollback = Number(normalized.terminalScrollback);
  const maxTerminals = Number(normalized.terminalMaxTerminals);

  if (Number.isFinite(scrollback)) {
    normalized.terminalScrollback = Math.max(
      TERMINAL_CONSTANTS.MIN_SCROLLBACK,
      Math.min(Math.floor(scrollback), TERMINAL_CONSTANTS.MAX_SCROLLBACK),
    );
  }
  if (Number.isFinite(maxTerminals)) {
    normalized.terminalMaxTerminals = Math.max(
      1,
      Math.min(Math.floor(maxTerminals), TERMINAL_CONSTANTS.MAX_TERMINALS),
    );
  }

  return normalized;
}

/**
 * Older renderer state shipped Linux-only absolute defaults. Those values are
 * not portable on Windows/WSL and can survive in localStorage even after the
 * backend has been fixed. Only rewrite the exact defaults that OsecBox used;
 * never overwrite a path the user explicitly configured.
 */
function normalizeLegacyToolDefaults(settings: Partial<AppSettings>): Partial<AppSettings> {
  const normalized = { ...settings };
  const legacyToolDefaults: Record<string, string> = {
    nmapPath: '/usr/bin/nmap',
    subfinderPath: '/usr/bin/subfinder',
    amassPath: '/usr/bin/amass',
    assetfinderPath: '/usr/bin/assetfinder',
    ffufPath: '/usr/bin/ffuf',
    niktoPath: '/usr/bin/nikto',
    nucleiPath: '/usr/bin/nuclei',
    gobusterPath: '/usr/bin/gobuster',
    msfconsolePath: '/usr/bin/msfconsole',
    msfvenomPath: '/usr/bin/msfvenom',
  };

  for (const [key, legacyValue] of Object.entries(legacyToolDefaults)) {
    if ((normalized as Record<string, unknown>)[key] === legacyValue) {
      (normalized as Record<string, unknown>)[key] = (defaultSettings as unknown as Record<string, unknown>)[key];
    }
  }

  if (normalized.ffufWordlist === '/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt') {
    normalized.ffufWordlist = '';
  }
  if (normalized.wordlistPath === '/usr/share/wordlists/dirb/common.txt') {
    normalized.wordlistPath = '';
  }

  return normalized;
}

function normalizeProviderModel(settings: Partial<AppSettings>): Partial<AppSettings> {
  const provider = settings.provider;
  const model = settings.selectedModel;
  if (!provider || !model) return settings;

  const replacements: Record<string, Record<string, string>> = {
    groq: {
      'llama-3.3-70b-specdec': 'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile': 'llama-3.3-70b-versatile',
      'mixtral-8x7b-32768': 'openai/gpt-oss-20b',
      'gemma2-9b-it': 'openai/gpt-oss-20b',
    },
    // OpenAI model IDs must pass through unchanged. The catalog and account
    // access change over time, and silently downgrading a user's selected
    // model can make a valid configuration appear broken.
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
      'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
      'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
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

  const replacement = replacements[provider]?.[model];
  return replacement ? { ...settings, selectedModel: replacement } : settings;
}

type SettingKey = keyof AppSettings;

// Renderer mutations are optimistic, but every async result must prove that it
// still belongs to the latest write for its field and workspace epoch before it
// can alter state again.
let settingsMutationEpoch = 0;
const settingRevisions = new Map<SettingKey, number>();

function nextSettingRevision(key: SettingKey): number {
  const revision = (settingRevisions.get(key) || 0) + 1;
  settingRevisions.set(key, revision);
  return revision;
}

// COMPATIBILITY: Auto-detect tool paths on first run
export async function autoDetectToolPaths(): Promise<Partial<AppSettings>> {
  try {
    // @ts-ignore - window.electron is defined in preload
    const result = await window.electron.invoke('detect-tool-paths');
    
    if (result.success) {
      const detected: Partial<AppSettings> = {
        nmapPath: result.paths.nmap || defaultSettings.nmapPath,
        subfinderPath: result.paths.subfinder || defaultSettings.subfinderPath,
        amassPath: result.paths.amass || defaultSettings.amassPath,
        assetfinderPath: result.paths.assetfinder || defaultSettings.assetfinderPath,
        ffufPath: result.paths.ffuf || defaultSettings.ffufPath,
        niktoPath: result.paths.nikto || defaultSettings.niktoPath,
        nucleiPath: result.paths.nuclei || defaultSettings.nucleiPath,
        gobusterPath: result.paths.gobuster || defaultSettings.gobusterPath,
        msfconsolePath: result.paths.msfconsole || defaultSettings.msfconsolePath,
        msfvenomPath: result.paths.msfvenom || defaultSettings.msfvenomPath,
      };
      
      console.log('[Settings] Auto-detected tool paths:', detected);
      return detected;
    }
  } catch (error) {
    console.warn('[Settings] Failed to auto-detect tool paths:', error);
  }
  
  return {};
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      updateSetting: async (key, value) => {
        const epoch = settingsMutationEpoch;
        const revision = nextSettingRevision(key);
        const previousValue = get().settings[key];
        const normalizedValue = key === 'terminalScrollback' || key === 'terminalMaxTerminals'
          ? normalizeTerminalSettings({ [key]: value } as Partial<AppSettings>)[key] as AppSettings[typeof key]
          : value;

        // Update local state immediately for UI responsiveness.
        set((state) => ({
          settings: {
            ...state.settings,
            [key]: normalizedValue,
          },
        }));

        if (!hasDesktopBridge()) return;

        try {
          const result = await window.electron!.invoke('update-setting', key, normalizedValue);
          if (!result.success) {
            console.error('[SettingsStore] Failed to sync setting to backend:', result.error);
            // A late failure may roll back only the write that failed. A newer
            // write to the same field, or a reset, owns the current value.
            if (settingsMutationEpoch === epoch && settingRevisions.get(key) === revision) {
              set((state) => ({
                settings: {
                  ...state.settings,
                  [key]: previousValue,
                },
              }));
            }
          }
        } catch (error) {
          console.error('[SettingsStore] Error syncing setting:', error);
          if (settingsMutationEpoch === epoch && settingRevisions.get(key) === revision) {
            set((state) => ({
              settings: {
                ...state.settings,
                [key]: previousValue,
              },
            }));
          }
        }
      },
      updateSettings: async (updates) => {
        const normalizedUpdates = normalizeTerminalSettings(updates);
        const keys = Object.keys(normalizedUpdates) as SettingKey[];
        if (keys.length === 0) return;

        const epoch = settingsMutationEpoch;
        const previousValues = {} as Partial<AppSettings>;
        const revisions = new Map<SettingKey, number>();
        const currentSettings = get().settings;
        for (const key of keys) {
          (previousValues as any)[key] = currentSettings[key];
          revisions.set(key, nextSettingRevision(key));
        }

        set((state) => ({
          settings: {
            ...state.settings,
            ...normalizedUpdates,
          },
        }));

        if (!hasDesktopBridge()) return;

        try {
          const result = await window.electron!.invoke('update-settings', normalizedUpdates);
          if (!result.success) {
            console.error('[SettingsStore] Failed to sync settings to backend:', result.error);
            if (settingsMutationEpoch === epoch) {
              set((state) => {
                const nextSettings = { ...state.settings };
                for (const key of keys) {
                  if (settingRevisions.get(key) === revisions.get(key)) {
                    (nextSettings as any)[key] = previousValues[key];
                  }
                }
                return { settings: nextSettings };
              });
            }
          }
        } catch (error) {
          console.error('[SettingsStore] Error syncing settings:', error);
          if (settingsMutationEpoch === epoch) {
            set((state) => {
              const nextSettings = { ...state.settings };
              for (const key of keys) {
                if (settingRevisions.get(key) === revisions.get(key)) {
                  (nextSettings as any)[key] = previousValues[key];
                }
              }
              return { settings: nextSettings };
            });
          }
        }
      },
      resetSettings: async () => {
        const resetEpoch = ++settingsMutationEpoch;
        const revisionsAtReset = new Map(settingRevisions);
        const activeApiKey = get().settings.aiApiKey;

        if (!hasDesktopBridge()) {
          set({ settings: { ...defaultSettings, aiApiKey: activeApiKey } });
          return;
        }

        try {
          const result = await window.electron!.invoke('reset-settings');
          if (!result.success) {
            console.error('[SettingsStore] Failed to reset settings:', result.error);
            return;
          }

          // Auto-detect tool paths after reset, but do not let a newer reset or
          // field edit be overwritten by this asynchronous follow-up work.
          const detectedPaths = await autoDetectToolPaths();
          const backendSettings = await window.electron!.invoke('get-settings').catch(() => null);
          if (settingsMutationEpoch !== resetEpoch) return;

          const currentSettings = get().settings;
          const backendValues = backendSettings?.success ? backendSettings.settings : {};
          const newSettings: AppSettings = {
            ...defaultSettings,
            ...normalizeTerminalSettings(normalizeProviderModel(backendValues || {})),
            ...detectedPaths,
            // get-settings intentionally redacts this value. Keep a key already
            // typed in the active renderer session without persisting it.
            aiApiKey: activeApiKey,
          };

          for (const key of Object.keys(newSettings) as SettingKey[]) {
            if (settingRevisions.get(key) !== revisionsAtReset.get(key)) {
              (newSettings as any)[key] = currentSettings[key];
            }
          }
          set({ settings: newSettings });
        } catch (error) {
          console.error('[SettingsStore] Error resetting settings:', error);
          // A failed backend reset must not destroy the user's current
          // renderer state; the main process remains authoritative.
        }
      },
    }),
    {
      name: 'app-settings',
      version: 9, // Portable tool defaults, provider compatibility, terminal limits, and credential persistence
      migrate: (persistedState: any, version: number) => {
        // MIGRATION: Handle version upgrades properly
        if (!persistedState) {
          console.log('[settings-store] No persisted state, using defaults');
          return { settings: defaultSettings };
        }
        
        // v0 -> v1: Initial migration
        if (version < 1) {
          console.log('[settings-store] Migrating from v0 to v1');
          // Merge with defaults to add any new settings
          persistedState.settings = { ...defaultSettings, ...persistedState.settings };
        }
        
        // v1 -> v2: Reverse mode names (compact ↔ ultra)
        if (version < 2 && persistedState?.settings?.aiContextMode) {
          console.log('[settings-store] Migrating from v1 to v2 - swapping aiContextMode names');
          const oldMode = persistedState.settings.aiContextMode;
          
          // Swap the names
          if (oldMode === 'compact') {
            persistedState.settings.aiContextMode = 'ultra';
          } else if (oldMode === 'ultra') {
            persistedState.settings.aiContextMode = 'compact';
          }
        }
        
        // v2 -> v3: Add WSL2 settings
        if (version < 3) {
          console.log('[settings-store] Migrating from v2 to v3 - adding WSL2 settings');
          persistedState.settings = {
            ...persistedState.settings,
            wsl2Distro: persistedState.settings.wsl2Distro ?? '',
            wsl2User: persistedState.settings.wsl2User ?? '',
            wsl2ExtraPaths: persistedState.settings.wsl2ExtraPaths ?? [],
          };
        }
        
        // v3 -> v4: Rename groqApiKey to aiApiKey
        if (version < 4 && persistedState?.settings?.groqApiKey) {
          console.log('[settings-store] Migrating from v3 to v4 - renaming groqApiKey to aiApiKey');
          persistedState.settings.aiApiKey = persistedState.settings.groqApiKey;
          delete persistedState.settings.groqApiKey;
        }

        // v4 -> v5: Fix provider mismatch (Cloudflare key with Groq provider)
        if (version < 5 && persistedState?.settings) {
          console.log('[settings-store] Migrating from v4 to v5 - fixing provider mismatch');
          if (persistedState.settings.provider === 'groq' && 
              persistedState.settings.aiApiKey && 
              persistedState.settings.aiApiKey.startsWith('cfut_')) {
            persistedState.settings.provider = 'cloudflare';
            persistedState.settings.apiEndpoint = 'cloudflare';
            persistedState.settings.selectedModel = '@cf/openai/gpt-oss-120b';
          }
        }

        if (version < 6 && persistedState?.settings) {
          console.log('[settings-store] Migrating provider model identifiers');
          persistedState.settings = normalizeProviderModel(persistedState.settings);
        }

        if (version < 7 && persistedState?.settings) {
          console.log('[settings-store] Migrating Linux-only tool defaults to portable executable names');
          persistedState.settings = normalizeLegacyToolDefaults(persistedState.settings);
        }

        if (version < 8 && persistedState?.settings) {
          console.log('[settings-store] Migrating terminal limits to portable safe bounds');
          persistedState.settings = normalizeTerminalSettings(persistedState.settings);
        }

        if (version < 9 && persistedState?.settings && hasDesktopBridge()) {
          console.log('[settings-store] Removing desktop AI credentials from renderer persistence');
          persistedState.settings.aiApiKey = '';
        }
        
        persistedState.settings = {
          ...defaultSettings,
          ...normalizeTerminalSettings(normalizeLegacyToolDefaults(normalizeProviderModel(persistedState.settings || {}))),
        };
        return persistedState;
      },
      // The Electron main process owns the provider credential. Keep it in
      // renderer memory for the active session, but never mirror it into
      // desktop localStorage where browser extensions, crash snapshots, or
      // copied profiles could expose it. Browser-only mode retains its legacy
      // local behavior because it has no secure main-process credential store.
      partialize: (state) => ({
        settings: hasDesktopBridge()
          ? { ...state.settings, aiApiKey: '' }
          : state.settings,
      }),
      // Sync with backend on load
      onRehydrateStorage: () => async (state) => {
        if (!state || !hasDesktopBridge()) return;

        const hydrationEpoch = settingsMutationEpoch;
        const revisionsAtHydration = new Map(settingRevisions);
        try {
          const result = await window.electron!.invoke('get-settings');
          if (!result.success || !result.settings) return;

          // PERFORMANCE: Don't auto-detect tool paths on startup. Tools will be
          // detected lazily when first used.
          const backendSettings: AppSettings = {
            ...defaultSettings,
            ...normalizeTerminalSettings(
              normalizeLegacyToolDefaults(normalizeProviderModel(result.settings || {})),
            ),
          };
          const currentState = useSettingsStore.getState();
          if (settingsMutationEpoch !== hydrationEpoch) return;

          const mergedSettings: AppSettings = {
            ...currentState.settings,
            ...backendSettings,
          };

          // Preserve optimistic renderer edits made while get-settings was in
          // flight. This also preserves the redacted credential in the active
          // renderer session without ever receiving plaintext from Electron.
          for (const key of Object.keys(backendSettings) as SettingKey[]) {
            if (settingRevisions.get(key) !== revisionsAtHydration.get(key)) {
              (mergedSettings as any)[key] = currentState.settings[key];
            }
          }
          if (!backendSettings.aiApiKey && currentState.settings.aiApiKey) {
            mergedSettings.aiApiKey = currentState.settings.aiApiKey;
          }

          useSettingsStore.setState({ settings: mergedSettings });
          console.log('[SettingsStore] Settings loaded from backend');
        } catch (error) {
          // Hydration failures should leave the already-available persisted or
          // default state intact; replacing it with defaults loses user edits.
          console.error('[SettingsStore] Failed to load settings from backend:', error);
        }
      },
    }
  )
);

/**
 * Get internal token budgets based on user's simple settings
 */
export function getTokenBudgets() {
  const settings = useSettingsStore.getState().settings;
  const { aiTokenLimit, aiContextMode } = settings;
  
  if (aiContextMode === 'compact') {
    // Compact mode: Delta-based, symbolic, provenance-tracked (quick queries)
    return {
      knowledge_graph: Math.floor(aiTokenLimit * 0.20),  // 20% for KG
      ring_buffers: Math.floor(aiTokenLimit * 0.40),     // 40% for recent output
      raw_chunks: Math.floor(aiTokenLimit * 0.20),       // 20% for deltas
      scanner_results: Math.floor(aiTokenLimit * 0.20),  // 20% for scanners
      TOTAL_MAX: aiTokenLimit,
      includeRawChunks: false,    // Use deltas instead
      maxRingBufferLines: 5000,   // Moderate lines
      maxMemoryMB: 150,           // Moderate memory
      chunkRetentionHours: 168    // Keep 7 days
    };
  } else {
    // Ultra mode: Full outputs, comprehensive (HTB boxes, normal pentests)
    return {
      knowledge_graph: Math.floor(aiTokenLimit * 0.15),  // 15% for KG
      ring_buffers: Math.floor(aiTokenLimit * 0.50),     // 50% for recent output
      raw_chunks: Math.floor(aiTokenLimit * 0.25),       // 25% for raw chunks
      scanner_results: Math.floor(aiTokenLimit * 0.10),  // 10% for scanners
      TOTAL_MAX: aiTokenLimit,
      includeRawChunks: true,     // Include full outputs
      maxRingBufferLines: 10000,  // More lines
      maxMemoryMB: 200,           // More memory
      chunkRetentionHours: 72     // Keep longer
    };
  }
}
