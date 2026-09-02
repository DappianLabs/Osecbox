/**
 * Electron Constants
 * Extract magic numbers to named constants
 */

// License Management
export const LICENSE_CONSTANTS = {
  CACHE_DURATION: 3600000, // 1 hour
  OFFLINE_GRACE_PERIOD: 7 * 24 * 60 * 60 * 1000, // 7 days
  VALIDATION_TIMEOUT: 10000, // 10s timeout
} as const;

// Process Management
export const PROCESS_CONSTANTS = {
  TTL_CLEANUP_INTERVAL: 30 * 60 * 1000, // 30 minutes
  SCAN_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  MAX_CONCURRENT_SCANS: 5,
  CPU_LIMIT_SECONDS: 300, // 5 minutes
  MEMORY_LIMIT_BYTES: 536870912, // 512MB
} as const;

// Platform Detection
export const PLATFORM_CONSTANTS = {
  WSL_TIMEOUT: 500, // 500ms WSL detection timeout
  TOOL_CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours
} as const;

// Rate Limiting
export const RATE_LIMIT_CONSTANTS = {
  SCAN_WINDOW_MS: 60000, // 1 minute
  SCAN_MAX_REQUESTS: 20, // 20 scans per minute
  COMMAND_WINDOW_MS: 1000, // 1 second
  COMMAND_MAX_REQUESTS: 10, // 10 commands per second
  AI_WINDOW_MS: 60000, // 1 minute
  AI_MAX_REQUESTS: 30, // 30 AI requests per minute
} as const;

// Build Configuration
export const BUILD_CONSTANTS = {
  ENCRYPTION_ALGORITHM: 'aes-256-gcm',
  BACKUP_DIR: '.plaintext-backup',
  ENCRYPTED_DIR: 'encrypted-modules',
  MAX_LOG_SIZE: 5 * 1024 * 1024, // 5MB
  MAX_LOG_FILES: 5,
} as const;