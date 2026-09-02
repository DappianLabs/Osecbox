/**
 * Feature Flags Configuration
 * 
 * STRATEGY:
 * - Launch: Free app with encryption (prevents code theft)
 * - Future: Flip ONE flag to enable specific feature limits
 */

export interface FeatureFlags {
  enableMonetization: boolean;  // Master switch - controls specific feature limits
  enableEncryption: boolean;    // Always enabled to protect code
}

// Free app with encrypted code protection
export const FEATURE_FLAGS: FeatureFlags = {
  enableMonetization: false,  // 🔥 FLIP TO TRUE WHEN READY FOR LIMITS
  enableEncryption: true,     // 🔒 ALWAYS ON - protects your code from crackers
};

// Helper functions - all controlled by single monetization flag
export const isMonetizationEnabled = () => FEATURE_FLAGS.enableMonetization;
export const isEncryptionEnabled = () => FEATURE_FLAGS.enableEncryption;

// When monetization is enabled, specific limits activate:
export const isProFeaturesEnabled = () => FEATURE_FLAGS.enableMonetization;
export const isLicenseValidationEnabled = () => FEATURE_FLAGS.enableMonetization;
export const isUpgradePromptsEnabled = () => FEATURE_FLAGS.enableMonetization;
export const isDailyLimitsEnabled = () => FEATURE_FLAGS.enableMonetization;

/**
 * 🚀 LAUNCH VERSION (enableMonetization: false):
 * - All features FREE and unlimited
 * - Code ENCRYPTED (anti-piracy protection)
 * - No upgrade prompts
 * - No daily limits
 * 
 * 💰 MONETIZATION VERSION (enableMonetization: true):
 * - Session saves: 3/day for free users
 * - Session loads: 3/day for free users
 * - Automation creation: 3/day for free users
 * - Timeline access: 3/day for free users
 * - Upgrade prompts shown for limits
 * - Pro users get unlimited access
 * - Code still encrypted
 */