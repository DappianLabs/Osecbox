/**
 * Settings schema validation with Zod
 * Prevents corrupted settings from crashing the app
 */

import { z } from 'zod';

// SECURITY: Custom validators for paths and sensitive fields
const safePath = z.string().refine(
  (path) => {
    // Prevent directory traversal
    if (path.includes('..')) return false;
    // Prevent null bytes
    if (path.includes('\0')) return false;
    return true;
  },
  { message: 'Invalid path: contains dangerous characters' }
);

const safePort = z.number().int().min(1).max(65535);

const safeThreadCount = z.number().int().min(1).max(100);

// Define the settings schema
export const AppSettingsSchema = z.object({
  // Tool Paths - ✅ SECURITY: Validate paths
  nmapPath: safePath,
  subfinderPath: safePath,
  amassPath: safePath,
  assetfinderPath: safePath,
  ffufPath: safePath,
  niktoPath: safePath,
  nucleiPath: safePath,
  gobusterPath: safePath,
  msfconsolePath: safePath,
  msfvenomPath: safePath,
  
  // WSL2 Settings
  wsl2Distro: z.string(),
  wsl2User: z.string(),
  wsl2ExtraPaths: z.array(z.string()),
  
  // Nmap Settings
  maxConcurrentScans: z.number().int().min(1).max(10),
  defaultTimeout: z.number().int().min(10).max(3600),
  
  // Subdomain Settings
  subdomainTimeout: z.number().int().min(60).max(3600),
  subfinderAllSources: z.boolean(),
  subfinderRecursive: z.boolean(),
  amassMode: z.enum(['passive', 'active']),
  amassBruteForce: z.boolean(),
  ffufThreads: safeThreadCount,
  ffufWordlist: safePath,
  subdomainAutoResolve: z.boolean(),
  subdomainRemoveDuplicates: z.boolean(),
  subdomainVerifyAlive: z.boolean(),
  
  // Nikto Settings
  niktoTimeout: z.number().int().min(60).max(7200),
  niktoSSL: z.boolean(),
  niktoAggressive: z.boolean(),
  
  // Nuclei Settings
  nucleiTemplatesPath: safePath,
  nucleiConcurrency: safeThreadCount,
  nucleiRateLimit: z.number().int().min(1).max(1000),
  nucleiAutoUpdate: z.boolean(),
  
  // Directory Brute Force Settings
  wordlistPath: safePath,
  dirThreads: safeThreadCount,
  dirTimeout: z.number().int().min(1).max(60),
  dirFollowRedirects: z.boolean(),
  
  // Metasploit Settings
  lhost: z.string(),
  lport: safePort,
  msfAutoStartDB: z.boolean(),
  
  // General Settings
  autoSaveResults: z.boolean(),
  enableNotifications: z.boolean(),
  darkMode: z.boolean(),
  verboseOutput: z.boolean(),
  saveHistory: z.boolean(),
  maxHistoryItems: z.number().int().min(10).max(1000),
  exportPath: safePath,
  persistWorkspace: z.boolean(),
  
  // AI Settings
  aiApiKey: z.string(),
  apiEndpoint: z.string().url().or(z.literal('')).or(z.literal('cloudflare')),
  selectedModel: z.string(),
  provider: z.string(),
  cloudflareAccountId: z.string().optional(),
  aiTokenLimit: z.number().int().min(1000).max(200000), // SECURITY: Increased max for larger models
  aiContextMode: z.enum(['ultra', 'compact']),
  
  // Terminal Settings
  terminalBufferSize: z.number().int().min(0).max(1000000),
  terminalScrollback: z.number().int().min(100).max(100000),
  terminalMaxTerminals: z.number().int().min(1).max(100),
}).strict(); // SECURITY: Reject unknown properties

export type AppSettings = z.infer<typeof AppSettingsSchema>;

/**
 * Validate and sanitize settings
 */
export function validateSettings(data: unknown): { valid: boolean; settings?: AppSettings; errors?: string[] } {
  try {
    const settings = AppSettingsSchema.parse(data);
    return { valid: true, settings };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      return { valid: false, errors };
    }
    return { valid: false, errors: ['Unknown validation error'] };
  }
}

/**
 * Merge settings with defaults (for partial updates)
 */
export function mergeWithDefaults(partial: Partial<AppSettings>, defaults: AppSettings): AppSettings {
  return { ...defaults, ...partial };
}
