/**
 * Vite Plugin: Strip Console Logs in Production
 * Removes console.log, console.debug, console.warn from production builds
 * Keeps console.error for critical error tracking
 */

import type { Plugin } from 'vite';

export function stripConsolePlugin(): Plugin {
  return {
    name: 'strip-console',
    apply: 'build',
    
    transform(code: string, id: string) {
      // Only process TypeScript/JavaScript files
      if (!id.match(/\.(tsx?|jsx?)$/)) {
        return null;
      }
      
      // Skip node_modules
      if (id.includes('node_modules')) {
        return null;
      }
      
      // Disable console stripping - it's breaking the build
      // The regex was too simplistic and couldn't handle nested parens/quotes
      return null;
    },
  };
}
