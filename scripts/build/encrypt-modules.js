/**
 * Encrypt Ultra Mode Modules
 * Encrypts attack-chain engine and Ultra AI logic at build time
 * Decrypted only in memory with valid license
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Modules to encrypt (CRITICAL: These are the Pro features)
const MODULES_TO_ENCRYPT = [
  // Runtime modules that may be packaged in encrypted form.
  'client/src/lib/attack-state/delta-engine.ts',
  'client/src/components/nmap/AiSidebar.tsx',
  'client/src/lib/attack-state/state-manager.ts',
  
  // Pro feature logic (MUST encrypt to prevent patching)
  'client/src/lib/pro-features.ts',                           // Pro limits & validation
  'client/src/lib/session-manager.ts',                        // Session save/load/export
];

// Output directory
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'encrypted-modules');

/**
 * Generate encryption key from license server secret
 * This must match the key derivation in license server
 * 
 * SECURITY WARNING:
 * - BUILD_ENCRYPTION_SECRET must be a strong 256-bit random key
 * - Store in CI/CD secrets, NEVER commit to repo
 * - Rotate with each major release
 * 
 * Generate strong key:
 *   openssl rand -hex 32
 */
function generateEncryptionKey() {
  const buildSecret = process.env.BUILD_ENCRYPTION_SECRET?.trim();

  if (!buildSecret) {
    throw new Error(
      'BUILD_ENCRYPTION_SECRET is required. Generate one with: openssl rand -hex 32'
    );
  }

  if (!/^[a-f0-9]{64}$/i.test(buildSecret)) {
    throw new Error(
      'BUILD_ENCRYPTION_SECRET must be exactly 64 hexadecimal characters'
    );
  }

  return crypto.createHash('sha256').update(buildSecret).digest();
}

/**
 * Encrypt file content using AES-256-GCM with PBKDF2 key derivation
 * Use proper key derivation with salt and iterations
 */
function encryptModule(content, key) {
  // Generate random salt for each encryption
  const salt = crypto.randomBytes(16);
  
  // Use PBKDF2 for key stretching (100k iterations)
  const derivedKey = crypto.pbkdf2Sync(
    key,
    salt,
    100000, // 100k iterations (OWASP recommendation)
    32, // 256 bits
    'sha256'
  );
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  
  let encrypted = cipher.update(content, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    salt: salt.toString('hex'), // Store salt with encrypted data
  };
}

/**
 * Create module manifest
 */
function createManifest(modules) {
  return {
    version: '1.0.0',
    encrypted_at: new Date().toISOString(),
    modules: modules.map(m => ({
      name: m.name,
      hash: m.hash,
      size: m.size
    }))
  };
}

/**
 * Main encryption process (controlled by feature flags)
 */
async function encryptModules() {
  // Check feature flags (will be replaced at build time)
  const FEATURE_FLAGS = { enableEncryption: true }; // Always enabled for launch strategy
  
  if (!FEATURE_FLAGS.enableEncryption) {
    console.log('[Encrypt] Encryption disabled by feature flags');
    console.log('[Encrypt] All modules remain in plaintext');
    return;
  }

  // Encryption enabled - protect the code without mutating source files.
  // The package builder excludes these source paths and copies only the
  // generated encrypted output into the final resources directory.
  console.log('[Encrypt] Starting module encryption...');
  console.log('[Encrypt] Mode: non-destructive package preparation');

  const key = generateEncryptionKey();
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const encryptedModules = [];

  for (const modulePath of MODULES_TO_ENCRYPT) {
    const fullPath = path.join(PROJECT_ROOT, modulePath);
    
    if (!fs.existsSync(fullPath)) {
      const existingEncryptedPath = path.join(OUTPUT_DIR, `${path.basename(modulePath)}.enc`);
      if (!fs.existsSync(existingEncryptedPath)) {
        console.warn(`[Encrypt] Module source unavailable: ${modulePath}`);
      }
      continue;
    }
    
    console.log(`[Encrypt] Encrypting: ${modulePath}`);
    
    // Read module content
    const content = fs.readFileSync(fullPath, 'utf8');
    
    // Encrypt
    const { encrypted, iv, authTag, salt } = encryptModule(content, key);
    
    // Calculate hash
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    
    // Save encrypted module
    const outputName = path.basename(modulePath) + '.enc';
    const outputPath = path.join(OUTPUT_DIR, outputName);
    
    fs.writeFileSync(outputPath, JSON.stringify({
      encrypted,
      iv,
      authTag,
      salt,
      originalPath: modulePath
    }));
    
    encryptedModules.push({
      name: outputName,
      hash,
      size: content.length
    });
    
    console.log(`[Encrypt] ✓ ${outputName} (${content.length} bytes)`);
  }
  
  // Create manifest
  const manifest = createManifest(encryptedModules);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`[Encrypt] ✓ Encrypted ${encryptedModules.length} modules`);
  console.log(`[Encrypt] ✓ Manifest created`);
  console.log(`[Encrypt] Output: ${OUTPUT_DIR}/`);
}

// CLI handling
const args = process.argv.slice(2);
const command = args[0];

if (command === 'restore') {
  console.log('[Encrypt] No restore is needed: source files are never modified by packaging.');
} else {
  // Both the default and legacy "production" command are non-destructive.
  encryptModules().catch((error) => {
    console.error('[Encrypt] Failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
