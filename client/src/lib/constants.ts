/**
 * Application Constants
 * Extract magic numbers to named constants
 */

// Terminal Configuration
export const TERMINAL_CONSTANTS = {
  MAX_BUFFER_CHARS: 1048576, // 1MB
  MAX_BUFFER_CHARS_LIMIT: 10485760, // 10MB hard limit
  BUFFER_TRIM_THRESHOLD: 0.75, // Trim at 75% of max
  BUFFER_KEEP_RATIO: 0.5, // Keep 50% after trim
  OUTPUT_BATCH_INTERVAL: 250, // 250ms batching
  OUTPUT_BATCH_SIZE: 24576, // 24KB batch size
  CHUNK_SIZE: 16384, // 16KB chunks for large writes
  SCROLL_DEBOUNCE: 50, // 50ms scroll debounce
  FIT_DEBOUNCE: 300, // FIX: Increased from 100ms to 300ms for stability during drag
  // Hard renderer ceiling. The user setting can lower this value, but never
  // raise it past a limit that keeps xterm scrollback predictable on modest
  // laptops and VMs.
  MAX_TERMINALS: 50,
  MAX_PTYS: 50, // Maximum PTY instances
  DEFAULT_SCROLLBACK: 10000,
  MIN_SCROLLBACK: 1000,
  MAX_SCROLLBACK: 50000,
  ATTACH_DEBOUNCE: 0, // No debounce for immediate attach
  RESIZE_DEBOUNCE: 300, // FIX: Increased from 100ms to 300ms to prevent resize spam
  // FIX: New constants for reflow prevention
  MIN_DIMENSION_CHANGE: 5, // Ignore resize events smaller than 5px
  REFLOW_COOLDOWN: 100, // Min 100ms between reflows per terminal
} as const;

// IPC Health Monitoring
export const IPC_HEALTH_CONSTANTS = {
  PING_INTERVAL: 30000, // 30s between pings (reduced frequency to avoid spam)
  PONG_TIMEOUT: 45000, // 45s to wait for pong
  MAX_FAILED_PINGS: 5, // 5 failed pings = offline
  DEGRADED_LATENCY: 10000, // >10s latency = degraded (high threshold for WSL2 + sync file ops)
  CLEANUP_INTERVAL: 60000, // 1 minute cleanup
} as const;

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
  RETRY_COUNT: 5, // Max retries for Electron detection
  RETRY_INTERVAL: 100, // 100ms between retries
} as const;

// Error Management
export const ERROR_CONSTANTS = {
  MAX_ERROR_AGE: 24 * 60 * 60 * 1000, // 24 hours
  NOTIFICATION_DURATION_ERROR: 8000, // 8s for errors
  NOTIFICATION_DURATION_DEFAULT: 5000, // 5s for others
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

// AI Configuration
export const AI_CONSTANTS = {
  TOKEN_ESTIMATE_RATIO: 4, // 1 token ≈ 4 chars (rough estimate)
  CONTEXT_CACHE_TTL: 30000, // 30 seconds
  MAX_CONTEXT_SIZE: 100000, // 100KB max context
} as const;

// Build Configuration
export const BUILD_CONSTANTS = {
  ENCRYPTION_ALGORITHM: 'aes-256-gcm',
  BACKUP_DIR: '.plaintext-backup',
  ENCRYPTED_DIR: 'encrypted-modules',
  MAX_LOG_SIZE: 5 * 1024 * 1024, // 5MB
  MAX_LOG_FILES: 5,
} as const;
