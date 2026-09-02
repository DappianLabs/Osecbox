/**
 * Pro Features Management - PROPER LIMITS SYSTEM
 * Encryption always ON, specific features have 3/day limits when monetization enabled
 */

import { isMonetizationEnabled } from './feature-flags';

export interface UsageStats {
  sessionSaves: number;
  sessionLoads: number;
  automationCreated: number;
  timelineAccess: number;
  date: string;
}

export class ProFeatures {
  private static USAGE_KEY = 'osecbox-usage-stats';
  private static DAILY_LIMITS = {
    sessionSaves: 3,      // 3 session saves per day
    sessionLoads: 3,      // 3 session loads per day  
    automationCreated: 3, // 3 automations per day
    timelineAccess: 3     // 3 timeline views per day
  };

  // PERFORMANCE: Cache usage stats to avoid repeated localStorage reads
  private static usageCache: UsageStats | null = null;
  private static cacheDate: string | null = null;

  /**
   * Check if user can save session
   */
  static async canSaveSession(): Promise<{ allowed: boolean; message?: string }> {
    if (!isMonetizationEnabled()) {
      return { allowed: true };
    }

    const isPro = await this.checkProStatus();
    if (isPro) {
      return { allowed: true };
    }

    const usage = this.getDailyUsage();
    
    if (usage.sessionSaves >= this.DAILY_LIMITS.sessionSaves) {
      return {
        allowed: false,
        message: `You've saved ${usage.sessionSaves}/3 sessions today. Upgrade to Pro for unlimited session saves.`
      };
    }

    return { allowed: true };
  }

  /**
   * Check if user can load session
   */
  static async canLoadSession(): Promise<{ allowed: boolean; message?: string }> {
    if (!isMonetizationEnabled()) {
      return { allowed: true };
    }

    const isPro = await this.checkProStatus();
    if (isPro) {
      return { allowed: true };
    }

    const usage = this.getDailyUsage();
    
    if (usage.sessionLoads >= this.DAILY_LIMITS.sessionLoads) {
      return {
        allowed: false,
        message: `You've loaded ${usage.sessionLoads}/3 sessions today. Upgrade to Pro for unlimited session loads.`
      };
    }

    return { allowed: true };
  }

  /**
   * Check if user can create automation
   */
  static async canCreateAutomation(): Promise<{ allowed: boolean; message?: string }> {
    if (!isMonetizationEnabled()) {
      return { allowed: true };
    }

    const isPro = await this.checkProStatus();
    if (isPro) {
      return { allowed: true };
    }

    const usage = this.getDailyUsage();
    
    if (usage.automationCreated >= this.DAILY_LIMITS.automationCreated) {
      return {
        allowed: false,
        message: `You've created ${usage.automationCreated}/3 automations today. Upgrade to Pro for unlimited automation.`
      };
    }

    return { allowed: true };
  }

  /**
   * Check if user can access timeline
   */
  static async canAccessTimeline(): Promise<{ allowed: boolean; message?: string }> {
    if (!isMonetizationEnabled()) {
      return { allowed: true };
    }

    const isPro = await this.checkProStatus();
    if (isPro) {
      return { allowed: true };
    }

    const usage = this.getDailyUsage();
    
    if (usage.timelineAccess >= this.DAILY_LIMITS.timelineAccess) {
      return {
        allowed: false,
        message: `You've accessed timeline ${usage.timelineAccess}/3 times today. Upgrade to Pro for unlimited timeline access.`
      };
    }

    return { allowed: true };
  }

  /**
   * Record session save - OPTIMIZED
   */
  static recordSessionSave(): void {
    if (!isMonetizationEnabled()) {
      return;
    }

    const usage = this.getDailyUsage();
    usage.sessionSaves++;
    
    // PERFORMANCE: Update cache and localStorage together
    this.usageCache = usage;
    localStorage.setItem(this.USAGE_KEY, JSON.stringify(usage));
  }

  /**
   * Record session load - OPTIMIZED
   */
  static recordSessionLoad(): void {
    if (!isMonetizationEnabled()) {
      return;
    }

    const usage = this.getDailyUsage();
    usage.sessionLoads++;
    
    // PERFORMANCE: Update cache and localStorage together
    this.usageCache = usage;
    localStorage.setItem(this.USAGE_KEY, JSON.stringify(usage));
  }

  /**
   * Record automation creation - OPTIMIZED
   */
  static recordAutomationCreated(): void {
    if (!isMonetizationEnabled()) {
      return;
    }

    const usage = this.getDailyUsage();
    usage.automationCreated++;
    
    // PERFORMANCE: Update cache and localStorage together
    this.usageCache = usage;
    localStorage.setItem(this.USAGE_KEY, JSON.stringify(usage));
  }

  /**
   * Record timeline access - OPTIMIZED
   */
  static recordTimelineAccess(): void {
    if (!isMonetizationEnabled()) {
      return;
    }

    const usage = this.getDailyUsage();
    usage.timelineAccess++;
    
    // PERFORMANCE: Update cache and localStorage together
    this.usageCache = usage;
    localStorage.setItem(this.USAGE_KEY, JSON.stringify(usage));
  }

  /**
   * Get daily usage stats - CACHED for performance
   */
  static getDailyUsage(): UsageStats {
    const today = new Date().toDateString();
    
    // PERFORMANCE: Return cached data if same day
    if (this.usageCache && this.cacheDate === today) {
      return this.usageCache;
    }
    
    const stored = localStorage.getItem(this.USAGE_KEY);
    
    if (stored) {
      try {
        const usage = JSON.parse(stored);
        if (usage.date === today) {
          // PERFORMANCE: Cache valid usage data
          this.usageCache = usage;
          this.cacheDate = today;
          return usage;
        }
      } catch (error) {
        console.warn('[ProFeatures] Failed to parse usage stats:', error);
      }
    }
    
    // Reset for new day
    const newUsage: UsageStats = { 
      sessionSaves: 0,
      sessionLoads: 0,
      automationCreated: 0,
      timelineAccess: 0,
      date: today 
    };
    
    // PERFORMANCE: Cache and save new usage
    this.usageCache = newUsage;
    this.cacheDate = today;
    localStorage.setItem(this.USAGE_KEY, JSON.stringify(newUsage));
    return newUsage;
  }

  /**
   * Clear usage stats (for testing) - INVALIDATES CACHE
   */
  static clearUsage(): void {
    localStorage.removeItem(this.USAGE_KEY);
    // PERFORMANCE: Clear cache when usage is cleared
    this.usageCache = null;
    this.cacheDate = null;
  }

  /**
   * Check pro status - CACHED for performance
   */
  private static proStatusCache: { isPro: boolean; timestamp: number } | null = null;
  private static PRO_CACHE_DURATION = 30000; // 30 seconds cache for pro status

  private static async checkProStatus(): Promise<boolean> {
    if (!isMonetizationEnabled()) {
      return true;
    }

    const now = Date.now();
    
    // PERFORMANCE: Return cached pro status if within cache duration
    if (this.proStatusCache && (now - this.proStatusCache.timestamp) < this.PRO_CACHE_DURATION) {
      return this.proStatusCache.isPro;
    }

    try {
      let isPro = false;
      if (typeof window !== 'undefined' && window.electron?.isPro) {
        isPro = await window.electron.isPro();
      }
      
      // Cache the result
      this.proStatusCache = {
        isPro,
        timestamp: now
      };
      
      return isPro;
    } catch (error) {
      console.error('[ProFeatures] Failed to check pro status:', error);
      return false;
    }
  }
}