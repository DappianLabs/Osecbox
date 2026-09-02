/**
 * Obfuscate Electron Main Process Code
 * Makes reverse engineering much harder
 */

import JavaScriptObfuscator from 'javascript-obfuscator';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ELECTRON_DIST = path.join(__dirname, '../../dist/electron');

const FILES_TO_OBFUSCATE = [
  'main.cjs',
  'preload.cjs',
  'license-manager.cjs',
  'module-decryptor.cjs',
];

console.log('[Obfuscator] Starting Electron code obfuscation...\n');

for (const file of FILES_TO_OBFUSCATE) {
  const filePath = path.join(ELECTRON_DIST, file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`[Obfuscator] ⚠️  File not found: ${file}`);
    continue;
  }
  
  console.log(`[Obfuscator] Obfuscating: ${file}`);
  
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    
    const obfuscated = JavaScriptObfuscator.obfuscate(code, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      debugProtection: false,
      debugProtectionInterval: 0,
      disableConsoleOutput: false,
      identifierNamesGenerator: 'hexadecimal',
      log: false,
      numbersToExpressions: true,
      renameGlobals: false,
      selfDefending: true,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 10,
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayEncoding: ['base64'],
      stringArrayIndexShift: true,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayWrappersCount: 2,
      stringArrayWrappersChainedCalls: true,
      stringArrayWrappersParametersMaxCount: 4,
      stringArrayWrappersType: 'function',
      stringArrayThreshold: 0.75,
      transformObjectKeys: true,
      unicodeEscapeSequence: false,
      target: 'node',
    });
    
    fs.writeFileSync(filePath, obfuscated.getObfuscatedCode());
    console.log(`[Obfuscator] ✓ ${file} (${code.length} → ${obfuscated.getObfuscatedCode().length} bytes)`);
  } catch (error) {
    console.error(`[Obfuscator] ✗ Failed to obfuscate ${file}:`, error.message);
  }
}

console.log('\n[Obfuscator] ✓ Electron obfuscation complete');
