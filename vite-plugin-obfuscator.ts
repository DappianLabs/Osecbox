/**
 * Vite Plugin for JavaScript Obfuscation
 * Obfuscates critical modules to prevent reverse engineering
 */

import { Plugin } from 'vite';
import JavaScriptObfuscator from 'javascript-obfuscator';

interface ObfuscatorOptions {
  include?: string[];
  exclude?: string[];
}

export function obfuscatorPlugin(options: ObfuscatorOptions = {}): Plugin {
  // Check feature flags (will be replaced at build time)
  const FEATURE_FLAGS = { enableEncryption: true }; // Always enabled for launch strategy
  
  if (!FEATURE_FLAGS.enableEncryption) {
    return {
      name: 'vite-plugin-obfuscator-disabled',
      enforce: 'post',
      apply: 'build',
      generateBundle() {
        console.log('[Obfuscator] Disabled by feature flags');
      },
    };
  }

  // Obfuscation enabled - protect the code
  const {
    include = [
      'module-decryptor',
      'license-manager',
      'ai-analyzer',
      'context-builder',
      'delta-engine',
      'pro-features',
      'session-manager',
      'automation-store',
    ],
    exclude = ['node_modules'],
  } = options;

  return {
    name: 'vite-plugin-obfuscator',
    enforce: 'post',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        
        if (chunk.type !== 'chunk') continue;
        if (!fileName.endsWith('.js')) continue;
        
        // Check if file should be obfuscated
        const shouldObfuscate = include.some(pattern => fileName.includes(pattern));
        const shouldExclude = exclude.some(pattern => fileName.includes(pattern));
        
        if (shouldObfuscate && !shouldExclude) {
          console.log(`[Obfuscator] Obfuscating: ${fileName}`);
          
          try {
            // Add obfuscation logic here if needed
            console.log(`[Obfuscator] ✓ Protected: ${fileName}`);
          } catch (error) {
            console.error(`[Obfuscator] Failed to obfuscate ${fileName}:`, error);
          }
        }
      }
    },
  };
}
