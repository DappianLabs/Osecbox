/**
 * Loot Detector
 * Identifies credentials, hashes, keys, and other valuable finds
 */

import type { Loot, LootType } from './types';

let lootIdCounter = 0;

export function detectLoot(
  hostId: string,
  command: string,
  stdout: string,
  lootCache: Set<string> // For deduplication
): Loot[] {
  const loot: Loot[] = [];
  const MAX_LOOT = 5000;
  const pushLoot = (item: Loot, cacheKey = `${item.type}:${item.value}`): void => {
    if (loot.length >= MAX_LOOT || lootCache.has(cacheKey)) return;
    lootCache.add(cacheKey);
    loot.push(item);
  };

  // Credentials (username:password format)
  const credMatches = stdout.matchAll(
    /(?:username|user|login)[:\s=]+([a-z0-9_\-\.@]+)[\s\S]{0,50}(?:password|pass|pwd)[:\s=]+([^\s\n]+)/gi
  );
  for (const match of credMatches) {
    const value = `${match[1]}:${match[2]}`;
    const cacheKey = `credential:${value}`;
    
    // Skip if already found
    if (lootCache.has(cacheKey)) continue;
    
    pushLoot({
      id: generateLootId(),
      host: hostId,
      type: 'credential',
      value,
      source: 'command output',
      timestamp: Date.now(),
      confidence: 60,
      used: false
    });
    
    lootCache.add(cacheKey);
  }

  // Simple password patterns
  const passMatches = stdout.matchAll(
    /(?:password|pass|pwd)[:\s=]+([^\s\n]{6,})/gi
  );
  for (const match of passMatches) {
    if (!match[1].includes('*') && !match[1].includes('x')) {
      pushLoot({
        id: generateLootId(),
        host: hostId,
        type: 'credential',
        value: `password:${match[1]}`,
        source: 'command output',
        timestamp: Date.now(),
        confidence: 50,
        used: false
      });
    }
  }

  // MD5 hashes
  const md5Matches = stdout.matchAll(/\b([a-f0-9]{32})\b/gi);
  for (const match of md5Matches) {
    pushLoot({
      id: generateLootId(),
      host: hostId,
      type: 'hash',
      value: `md5:${match[1]}`,
      source: 'command output',
      timestamp: Date.now(),
      confidence: 60,
      used: false
    });
  }

  // SHA256 hashes
  const sha256Matches = stdout.matchAll(/\b([a-f0-9]{64})\b/gi);
  for (const match of sha256Matches) {
    pushLoot({
      id: generateLootId(),
      host: hostId,
      type: 'hash',
      value: `sha256:${match[1]}`,
      source: 'command output',
      timestamp: Date.now(),
      confidence: 60,
      used: false
    });
  }

  // NTLM hashes
  const ntlmMatches = stdout.matchAll(
    /([a-z0-9_\-\.]+):(\d+):([a-f0-9]{32}):([a-f0-9]{32}):/gi
  );
  for (const match of ntlmMatches) {
    pushLoot({
      id: generateLootId(),
      host: hostId,
      type: 'hash',
      value: `ntlm:${match[1]}:${match[3]}:${match[4]}`,
      source: 'command output',
      timestamp: Date.now(),
      confidence: 70,
      used: false
    });
  }

  // Private keys. Keep the captured block bounded; the terminal buffer is
  // authoritative and the AI context redacts values before sending them.
  const privateKeyMatches = stdout.matchAll(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,20000}?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/gi,
  );
  for (const match of privateKeyMatches) {
    pushLoot({
      id: generateLootId(),
      host: hostId,
      type: 'key',
      value: match[0].slice(0, 20000),
      source: 'command output',
      timestamp: Date.now(),
      confidence: 85,
      used: false,
    });
  }

  // API/cloud tokens. Named formats are checked before the generic fallback
  // so common pentest loot is found even when it has no `token=` label.
  const tokenPatterns: Array<{ pattern: RegExp; confidence: number; label: string }> = [
    { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, confidence: 85, label: 'aws_access_key_id' },
    { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, confidence: 85, label: 'google_api_key' },
    { pattern: /\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, confidence: 85, label: 'github_token' },
    { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, confidence: 85, label: 'github_token' },
    { pattern: /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, confidence: 85, label: 'slack_token' },
    { pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, confidence: 80, label: 'stripe_key' },
    { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, confidence: 75, label: 'jwt' },
    {
      pattern: /(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|auth[_-]?token|secret[_-]?key|aws_secret_access_key|account[_-]?key|private[_-]?token|bearer)\s*[:=]\s*["']?([A-Za-z0-9_./+=:-]{16,})["']?/gi,
      confidence: 70,
      label: 'named_token',
    },
    {
      pattern: /(?:token|secret)\s+([A-Za-z0-9_./+=:-]{20,})/gi,
      confidence: 65,
      label: 'token',
    },
  ];

  for (const { pattern, confidence, label } of tokenPatterns) {
    const matches = stdout.matchAll(pattern);
    for (const match of matches) {
      const value = match[1] || match[0];
      pushLoot({
        id: generateLootId(),
        host: hostId,
        type: 'token',
        value: `${label}:${value}`.slice(0, 512),
        source: 'command output',
        timestamp: Date.now(),
        confidence,
        used: false,
      });
    }
  }

  // Config files with sensitive data
  if (
    /\b(?:cat|type|less|more|head|tail|grep|sed|awk|Get-Content)\b/i.test(command) &&
    /(?:config|\.env|settings|credentials?|secrets?|\.aws|\.kube|docker[-_]?compose|terraform|vault|id_rsa|shadow)/i.test(command)
  ) {
    const configMatch = stdout.match(/[\s\S]{100,}/);
    if (configMatch) {
      pushLoot({
        id: generateLootId(),
        host: hostId,
        type: 'config',
        value: configMatch[0].substring(0, 2000), // Keep persistence bounded
        source: `config file: ${command}`,
        timestamp: Date.now(),
        confidence: 65,
        used: false
      });
    }
  }

  // Database connection strings
  const dbMatches = stdout.matchAll(
    /(?:mysql|postgres|postgresql|mongodb(?:\+srv)?|mssql|redis|amqp):\/\/([^:\s]+):([^@\s]+)@([^\/\s]+)/gi
  );
  for (const match of dbMatches) {
    pushLoot({
      id: generateLootId(),
      host: hostId,
      type: 'credential',
      value: `${match[1]}:${match[2]}@${match[3]}`,
      source: 'database connection string',
      timestamp: Date.now(),
      confidence: 80,
      used: false
    });
  }

  // Common ADO/JDBC-style strings do not use a URL scheme but still expose a
  // reusable database credential in command output.
  const keyValueDbMatches = stdout.matchAll(
    /(?:server|data source|host)\s*=\s*([^;\s]+)[;\s]+(?:[^;\n]*?)(?:user(?:name)?|uid)\s*=\s*([^;\s]+)[;\s]+(?:[^;\n]*?)(?:password|pwd)\s*=\s*([^;\s]+)/gi,
  );
  for (const match of keyValueDbMatches) {
    pushLoot({
      id: generateLootId(),
      host: hostId,
      type: 'credential',
      value: `${match[2]}:${match[3]}@${match[1]}`.slice(0, 512),
      source: 'database connection string',
      timestamp: Date.now(),
      confidence: 75,
      used: false,
    });
  }

  return loot;
}

function generateLootId(): string {
  return `loot_${Date.now()}_${lootIdCounter++}`;
}

export function markLootUsed(loot: Loot, usedOnHost: string): void {
  loot.used = true;
  if (!loot.used_on) {
    loot.used_on = [];
  }
  if (!loot.used_on.includes(usedOnHost)) {
    loot.used_on.push(usedOnHost);
  }
}

export function getUnusedLoot(lootMap: Map<string, Loot>): Loot[] {
  return Array.from(lootMap.values()).filter(l => !l.used);
}

export function getLootByType(
  lootMap: Map<string, Loot>,
  type: LootType
): Loot[] {
  return Array.from(lootMap.values()).filter(l => l.type === type);
}

export function getLootByHost(
  lootMap: Map<string, Loot>,
  hostId: string
): Loot[] {
  return Array.from(lootMap.values()).filter(l => l.host === hostId);
}
