// Rate limiter for IPC handlers to prevent DoS attacks

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RequestRecord {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private requests = new Map<string, RequestRecord>();
  private config: RateLimitConfig;
  // Store interval reference for cleanup
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RateLimitConfig = { windowMs: 1000, maxRequests: 10 }) {
    this.config = config;
    
    // Store interval reference
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  check(identifier: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const record = this.requests.get(identifier);

    if (!record || now > record.resetTime) {
      // New window
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
      return { allowed: true };
    }

    if (record.count >= this.config.maxRequests) {
      // Rate limit exceeded
      return {
        allowed: false,
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      };
    }

    // Increment count
    record.count++;
    return { allowed: true };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  reset(identifier: string) {
    this.requests.delete(identifier);
  }
  
  // Add destroy method to clear interval
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.requests.clear();
  }
}

// SECURITY: Comprehensive rate limiting for all sensitive operations
export const rateLimiters = {
  // Global IPC rate limiter to prevent DoS
  global: new RateLimiter({
    windowMs: 1000, // 1 second
    maxRequests: 100, // Max 100 IPC calls per second (across all channels)
  }),
  
  // Command execution
  systemCommand: new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 10, // Max 10 system commands per minute
  }),
  
  // Subdomain tools
  subdomainTool: new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 5, // Max 5 subdomain scans per minute
  }),
  
  // Session operations
  sessionSave: new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 20, // Max 20 saves per minute
  }),
  
  sessionLoad: new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 30, // Max 30 loads per minute
  }),
  
  // AI operations
  aiChat: new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 10, // Max 10 AI chats per minute (reduced from 20)
  }),
  
  aiAnalyze: new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 15, // Max 15 analyses per minute
  }),
  
  // Settings operations
  settingsUpdate: new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 30, // Max 30 updates per minute
  }),
  
  settingsImport: new RateLimiter({
    windowMs: 300000, // 5 minutes
    maxRequests: 3, // Max 3 imports per 5 minutes
  }),
  
  // File operations
  fileWrite: new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 50, // Max 50 writes per minute
  }),
  
  // Scan operations
  scan: new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 20, // Max 20 scans per minute
  }),
};

// Legacy exports for backward compatibility
export const globalIPCRateLimiter = rateLimiters.global;
export const scanRateLimiter = rateLimiters.scan;
export const commandRateLimiter = rateLimiters.systemCommand;
export const aiRateLimiter = rateLimiters.aiChat;

// Export cleanup function for app exit
export function cleanupAllRateLimiters() {
  Object.values(rateLimiters).forEach(limiter => limiter.destroy());
}
