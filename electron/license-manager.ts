/**
 * License Manager
 * Handles Pro license validation and activation
 * Controlled by feature flags - currently disabled for free version
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// Import feature flags (will be bundled at build time)
const FEATURE_FLAGS = {
  enableMonetization: false,  // Master switch for all pro features
};

interface LicenseInfo {
  key?: string;
  tier: 'free' | 'pro';
  status: 'active' | 'expired' | 'invalid';
  expiresAt?: string;
  activatedAt?: string;
}

class LicenseManager {
  private license: LicenseInfo | null = null;
  private readonly VALIDATION_URL = 'https://license.osecbox.com/validate';
  private readonly LICENSE_FILE = path.join(app.getPath('userData'), 'license.json');

  constructor() {
    this.loadStoredLicense();
  }

  /**
   * Check if user has Pro tier
   */
  async isPro(): Promise<boolean> {
    // Master switch - if monetization disabled, everyone is "pro" (free access)
    if (!FEATURE_FLAGS.enableMonetization) {
      return true;
    }

    if (!this.license) {
      return false;
    }

    // Monetization enabled - validate license
    const validation = await this.validateLicense();
    return validation.valid && validation.tier === 'pro';
  }

  /**
   * Check if feature is available
   */
  async hasFeature(feature: string): Promise<boolean> {
    // Master switch - if monetization disabled, all features available
    if (!FEATURE_FLAGS.enableMonetization) {
      return true;
    }

    return await this.isPro();
  }

  /**
   * Activate license key
   */
  async activateLicense(key: string): Promise<{ success: boolean; message: string; tier?: string }> {
    // Master switch - if monetization disabled, fake success
    if (!FEATURE_FLAGS.enableMonetization) {
      return { 
        success: true, 
        message: 'All features are free in this version!',
        tier: 'free'
      };
    }

    try {
      const response = await fetch(this.VALIDATION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, action: 'activate' })
      });

      const result = await response.json() as any;

      if (result.valid) {
        this.license = {
          key,
          tier: result.tier,
          status: 'active',
          expiresAt: result.expiresAt,
          activatedAt: new Date().toISOString()
        };

        await this.saveStoredLicense();
        return { success: true, message: 'License activated successfully!', tier: result.tier };
      } else {
        return { success: false, message: result.error || 'Invalid license key' };
      }
    } catch (error: any) {
      return { success: false, message: `Activation failed: ${error.message}` };
    }
  }

  /**
   * Get license info
   */
  getLicenseInfo(): LicenseInfo {
    // Master switch - if monetization disabled, return free tier
    if (!FEATURE_FLAGS.enableMonetization) {
      return {
        tier: 'free',
        status: 'active',
        activatedAt: new Date().toISOString()
      };
    }

    return this.license || {
      tier: 'free',
      status: 'active'
    };
  }

  /**
   * Deactivate license
   */
  async deactivate(): Promise<void> {
    this.license = null;
    try {
      await fs.promises.unlink(this.LICENSE_FILE);
    } catch {}
  }

  /**
   * Validate license with server
   */
  private async validateLicense(): Promise<{ valid: boolean; tier: string; error?: string }> {
    if (!this.license?.key) {
      return { valid: false, tier: 'free', error: 'No license key' };
    }

    try {
      const response = await fetch(this.VALIDATION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: this.license.key, action: 'validate' })
      });

      return await response.json() as { valid: boolean; tier: string; error?: string };
    } catch (error: any) {
      console.error('[LicenseManager] Validation failed:', error);
      return { valid: false, tier: 'free', error: error.message };
    }
  }

  /**
   * Load stored license
   */
  private async loadStoredLicense(): Promise<void> {
    try {
      const data = await fs.promises.readFile(this.LICENSE_FILE, 'utf8');
      this.license = JSON.parse(data);
    } catch (error) {
      // File doesn't exist or can't be read, that's fine
    }
  }

  /**
   * Save license to disk
   */
  private async saveStoredLicense(): Promise<void> {
    try {
      await fs.promises.writeFile(this.LICENSE_FILE, JSON.stringify(this.license, null, 2));
    } catch (error) {
      console.error('[LicenseManager] Failed to save license:', error);
    }
  }
}

export const licenseManager = new LicenseManager();