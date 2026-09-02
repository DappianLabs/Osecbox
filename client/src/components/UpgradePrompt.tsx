/**
 * Upgrade Prompt Component - DISABLED
 * All features are free - this component is hidden by feature flags
 */

import React from 'react';
import { isMonetizationEnabled } from '@/lib/feature-flags';

interface UpgradePromptProps {
  feature: string;
  onActivate?: () => void;
}

export function UpgradePrompt({ feature, onActivate }: UpgradePromptProps) {
  // Master switch - monetization disabled, never render upgrade prompts
  if (!isMonetizationEnabled()) {
    return null;
  }

  // This component is effectively disabled - all features are free
  return null;
}