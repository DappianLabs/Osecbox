/**
 * Automation Manager - WITH PROPER LIMITS (OPTIMIZED)
 * Full functionality when free, 3/day limits when monetization enabled
 */

import { ProFeatures } from './pro-features';

export class AutomationManager {
  // PERFORMANCE: Cache limit check results to avoid duplicate calls
  private static lastLimitCheck: { result: any; timestamp: number } | null = null;
  private static CACHE_DURATION = 1000; // 1 second cache

  /**
   * Check if user can create automation - CACHED
   */
  static async canAddAutomatedScan(): Promise<boolean> {
    const result = await this.getCachedLimitCheck();
    return result.allowed;
  }
  
  /**
   * Get automation limit message - CACHED
   */
  static async getAutomationLimitMessage(): Promise<string | null> {
    const result = await this.getCachedLimitCheck();
    return result.message || null;
  }
  
  /**
   * Validate automation add (throws if not allowed) - CACHED
   */
  static async validateAutomationAdd(): Promise<void> {
    const result = await this.getCachedLimitCheck();
    if (!result.allowed) {
      throw new Error(result.message || 'Automation limit reached');
    }
  }

  /**
   * Get cached limit check result to prevent duplicate API calls
   */
  private static async getCachedLimitCheck(): Promise<{ allowed: boolean; message?: string }> {
    const now = Date.now();
    
    // PERFORMANCE: Return cached result if within cache duration
    if (this.lastLimitCheck && (now - this.lastLimitCheck.timestamp) < this.CACHE_DURATION) {
      return this.lastLimitCheck.result;
    }
    
    // Perform fresh check
    const result = await ProFeatures.canCreateAutomation();
    
    // Cache the result
    this.lastLimitCheck = {
      result,
      timestamp: now
    };
    
    return result;
  }
  
  /**
   * Record automation creation - INVALIDATES CACHE
   */
  static recordAutomationCreated(): void {
    ProFeatures.recordAutomationCreated();
    
    // PERFORMANCE: Invalidate cache after recording
    this.lastLimitCheck = null;
  }
  
  /**
   * Get current automation count from usage stats
   */
  static getAutomationCount(): number {
    const usage = ProFeatures.getDailyUsage();
    return usage.automationCreated;
  }
  
  /**
   * Get automation limit
   */
  static getAutomationLimit(): number {
    return 3; // 3 per day for free users when monetization enabled
  }
}
