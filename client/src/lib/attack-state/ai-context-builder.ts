/**
 * Unified AI Context Builder
 * Merges enhanced + ultra builders into single implementation
 * Eliminates 600+ lines of duplicate code
 */

import type { WorkingSession as Session } from './types';
import type { CommandContextScope, CommandOutputStore } from './command-output-store';
import { targetsMatch } from './command-output-store';
import {
  redactSensitiveText,
  summarizeSensitiveEvidence,
} from '../ai-data-policy';
import { cleanANSIForDisplay } from '../utils/ansi-cleaner';

// Import parsers for scan compression
import {
  parseNmap,
  parseNikto,
  parseNuclei,
  parseGobuster,
  parseFfuf,
  parseWfuzz,
  parseSubfinder,
  parseAmass,
} from '../parsers';
import { parseSubdomainOutput } from '../subdomain-parser';

export type ContextMode = 'ultra' | 'compact';
export type AIContextScope = CommandContextScope;

interface ContextBuildOptions {
  /** Optional provider-specific context budget. Output tokens are separate. */
  maxTokens?: number;
}

/**
 * Build AI context - single unified implementation
 * Handles OSCP/CRTX exam chaos with smart compression
 */
export function buildAIContext(
  session: Session,
  commandOutputStore: CommandOutputStore,
  mode: ContextMode = 'ultra',
  question?: string,
  activeTerminal?: string,
  contextScope?: AIContextScope,
  options: ContextBuildOptions = {},
): string {
  // Session might exist but not be fully initialized yet
  // Also guard against Promise objects if getSession() was called before it was awaited
  if (!session || typeof session !== 'object' || session instanceof Promise) {
    console.warn('[ContextBuilder] Session is not ready or is a Promise, returning empty context');
    return '═══ ATTACK STATE ═══\nSession initializing...\n\n═══ COMMAND HISTORY ═══\n(no commands yet)';
  }
  
  const scope: AIContextScope | undefined = contextScope || (activeTerminal
    ? { terminalId: activeTerminal, target: session?.target_ip }
    : undefined);
  const allOutputs = scope
    ? commandOutputStore.getScopedOutputs(scope)
    : commandOutputStore.getAllOutputs();
  const allHosts = session?.hosts ? Array.from(session.hosts.values()) : [];
  const hosts = getScopedHosts(allHosts, scope, allOutputs);
  const allLoot = session?.loot ? Array.from(session.loot.values()) : [];
  const loot = getScopedLoot(allLoot, hosts, scope, allOutputs);
  
  // Add header showing which terminal is active
  let contextHeader = '';
  if (activeTerminal) {
    contextHeader = `🎯 USER IS VIEWING: ${activeTerminal} terminal\n(But you can see ALL terminals - mention if they ask about other scans)\n\n`;
  }
  if (scope?.target) {
    contextHeader += `ACTIVE TARGET SCOPE: ${scope.target}\n(Do not combine evidence from another target unless the user explicitly asks for a cross-target comparison.)\n\n`;
  }
  
  // Get relevant commands based on question
  const commands = question
    ? findRelevantCommands(question, allOutputs)
    : allOutputs.slice(-500);
  
  // Different strategies for each mode
  let processedCommands: any[];
  
  if (mode === 'compact') {
    // COMPACT: Aggressive compression + critical extraction
    processedCommands = commands.map(compressCommand);
  } else {
    // ULTRA: Smart truncation per command type, keep more data
    processedCommands = commands.map(cmd => {
      // Still apply per-command limits to prevent token explosion
      const outputType = detectOutputType(cmd.command, cmd.output);
      
      switch (outputType) {
        case 'file_dump':
          return compressFileDump(cmd, cmd.output.split('\n'));
        case 'network_scan':
          // Keep full network scans in ultra mode
          return cmd;
        case 'process_list':
          // Keep full process lists in ultra mode
          return cmd;
        case 'docker_output':
          return compressDockerOutput(cmd, cmd.output.split('\n'));
        default:
          // Generic: Keep more data in ultra mode
          if (cmd.output.length > 20000) {
            const lines = cmd.output.split('\n');
            const truncated = [
              ...lines.slice(0, 500),
              `\n...[${lines.length - 1000} lines truncated]...\n`,
              ...lines.slice(-500)
            ].join('\n');
            return { ...cmd, output: truncated };
          }
          return cmd;
      }
    });
  }
  
  // Keep a deterministic context ceiling. The provider request layer applies
  // a second model-window check, but this bound prevents five concurrent scans
  // or a hundred noisy terminals from creating an unbounded renderer payload.
  // Keep room for the system prompt, conversation history, tools, and output.
  // The analyzer performs a second model-specific budget check before sending.
  // Compact mode is the interactive path. Keep enough evidence for a senior
  // judgement while avoiding multi-second uploads and slow first tokens.
  const configuredBudget = Number(options.maxTokens);
  const defaultBudget = mode === 'compact' ? 3500 : 12000;
  const maxTokens = Number.isFinite(configuredBudget) && configuredBudget > 0
    ? Math.min(mode === 'compact' ? 6000 : 18000, Math.max(1200, Math.floor(configuredBudget)))
    : defaultBudget;
  const limitedCommands = applyTokenLimit(processedCommands, Math.max(1200, maxTokens - (mode === 'compact' ? 900 : 1600)));
  const securitySignals = buildSecuritySignals(allOutputs, mode);
  
  // Build context sections
  const sections = [
    contextHeader, // Show which terminal is active
    buildCriticalFindingsSafe(loot),
    buildAttackState(session, hosts, loot, allOutputs.length, scope),
    securitySignals,
    buildCommandHistory(limitedCommands),
  ].filter(Boolean);
  
  const context = fitContextToBudget(sections, maxTokens);
  
  // Use conservative token estimation to prevent API errors
  // Edge cases handled:
  // 1. Code-heavy content (2.5 chars/token)
  // 2. Special characters (2 chars/token)
  // 3. Mixed content (3 chars/token average)
  // 4. Model-specific variations (conservative estimate works for all)
  // 
  // Reality: Token ratio varies by content type:
  // - English text: ~4 chars/token
  // - Code: ~2.5 chars/token
  // - Special chars: ~2 chars/token
  // - Mixed: ~3 chars/token
  //
  // Using 2.5 chars/token (conservative) prevents exceeding model limits
  const estimatedTokens = Math.floor(context.length / 2.5);
  console.log(`[ContextBuilder] Built ${mode} context: ${context.length.toLocaleString()} chars, ~${estimatedTokens.toLocaleString()} tokens (conservative), ${limitedCommands.length}/${commands.length} commands, ${allOutputs.length} records indexed`);
  
  return context;
}

/**
 * Apply token limit to commands
 * IMPROVED: Smarter allocation with priority system
 */
function applyTokenLimit(commands: any[], maxTokens: number): any[] {
  const maxChars = Math.max(2400, Math.floor(maxTokens * 2.35));
  if (commands.length === 0) return [];
  
  // STRATEGY: Prioritize recent + high-value commands
  const scored = commands.map((cmd, idx) => {
    let score = 0;
    
    // Recency (most important)
    score += (idx / commands.length) * 100;
    
    // Exit code (failures are interesting)
    if (cmd.exitCode !== 0) score += 20;
    
    // Command type (high-value tools)
    const highValueTools = ['nmap', 'masscan', 'gobuster', 'ffuf', 'nikto', 'nuclei', 'subfinder', 'amass', 'linpeas', 'winpeas', 'sqlmap', 'hydra', 'metasploit', 'msfconsole', 'docker', 'kubectl'];
    if (highValueTools.some(tool => cmd.command.toLowerCase().includes(tool))) {
      score += 30;
    }
    
    // Output has critical findings
    const lower = cmd.output.toLowerCase();
    if (lower.includes('root') || lower.includes('password') || lower.includes('credential') || lower.includes('secret') || lower.includes('token') || lower.includes('api_key') || lower.includes('private key') || lower.includes('cve-')) score += 55;
    if (lower.includes('open') || lower.includes('listen') || lower.includes('established') || lower.includes('docker') || lower.includes('kubernetes') || lower.includes('cloud') || lower.includes('config') || lower.includes('connection')) score += 25;
    
    return { cmd, score };
  });
  
  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score);
  
  // Take commands until token limit. A single 150K record must never consume
  // the entire budget, and every terminal gets a chance to contribute.
  let totalChars = 0;
  const limited: any[] = [];
  const selectedIds = new Set<string>();
  const perCommandChars = Math.max(900, Math.min(9000, Math.floor(maxChars / Math.max(8, Math.min(commands.length, 24)))));

  const boundedCommand = (cmd: any): any => {
    const serializedSize = JSON.stringify(cmd).length;
    if (serializedSize <= perCommandChars) return cmd;
    const outputBudget = Math.max(500, perCommandChars - String(cmd.command || '').length - String(cmd.stderr || '').length - 220);
    const output = boundEvidenceText(String(cmd.output || ''), outputBudget);
    const stderr = boundEvidenceText(String(cmd.stderr || ''), Math.min(1600, Math.floor(outputBudget * 0.2)));
    return { ...cmd, output, stderr };
  };

  const terminalKey = (cmd: any): string => String(cmd.terminalId || cmd.tabId || cmd.target || cmd.host || 'global');
  const recordKey = (cmd: any): string => String(cmd.liveKey || cmd.num);

  // First reserve one bounded record per terminal/tab so one chatty listener
  // cannot starve the other four scans or the foothold/tunnel consoles.
  const newestByTerminal = new Map<string, any>();
  for (const entry of scored) newestByTerminal.set(terminalKey(entry.cmd), entry.cmd);
  for (const cmd of Array.from(newestByTerminal.values())) {
    const bounded = boundedCommand(cmd);
    const size = JSON.stringify(bounded).length;
    if (totalChars + size > maxChars && limited.length > 0) continue;
    limited.push(bounded);
    selectedIds.add(recordKey(cmd));
    totalChars += size;
  }

  for (const { cmd } of scored) {
    if (selectedIds.has(recordKey(cmd))) continue;
    const bounded = boundedCommand(cmd);
    const cmdSize = JSON.stringify(bounded).length;

    if (totalChars + cmdSize > maxChars && limited.length > 0) continue;

    limited.push(bounded);
    selectedIds.add(recordKey(cmd));
    totalChars += cmdSize;
  }
  
  // Sort back to chronological order
  limited.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || (a.num || 0) - (b.num || 0));
  
  console.log(`[ContextBuilder] Token limit: selected ${limited.length}/${commands.length} commands (${totalChars.toLocaleString()} chars)`);
  
  return limited;
}

function boundEvidenceText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const head = Math.max(120, Math.floor(maxChars * 0.45));
  const tail = Math.max(120, Math.floor(maxChars * 0.4));
  return `${value.slice(0, head)}\n...[${value.length - head - tail} chars hidden; query the scoped terminal for more]...\n${value.slice(-tail)}`;
}

function fitContextToBudget(sections: string[], maxTokens: number): string {
  const maxChars = Math.max(5000, Math.floor(maxTokens * 2.5));
  const joined = sections.join('\n\n');
  if (joined.length <= maxChars) return joined;

  const commandIndex = sections.findIndex(section => section.includes('COMMAND HISTORY'));
  if (commandIndex < 0) return boundEvidenceText(joined, maxChars);

  const fixed = sections.filter((_, index) => index !== commandIndex).join('\n\n');
  const commandBudget = Math.max(1800, maxChars - fixed.length - 8);
  const boundedCommand = boundEvidenceText(sections[commandIndex], commandBudget);
  const result = sections
    .map((section, index) => index === commandIndex ? boundedCommand : section)
    .join('\n\n');
  return result.length <= maxChars ? result : boundEvidenceText(result, maxChars);
}

/**
 * Find commands relevant to a question without dropping other evidence
 * classes. A query such as "credentials and open ports" should not return
 * only the first matching category and hide the second one.
 */
function findRelevantCommands(
  question: string,
  allOutputs: any[],
): any[] {
  const query = question.toLowerCase();
  const broadQuery = /\b(all|everything|full|complete|audit|overview|missed|important)\b/i.test(query);
  if (broadQuery) {
    console.log(`[ContextBuilder] Comprehensive query detected, indexing all ${allOutputs.length} records`);
    return allOutputs;
  }

  const selected = new Map<string, any>();
  const outputKey = (record: any): string => String(record.liveKey || record.num);
  const add = (predicate: (record: any) => boolean) => {
    for (const record of allOutputs) {
      if (predicate(record)) selected.set(outputKey(record), record);
    }
  };

  const terms = query.split(/[^a-z0-9_.-]+/i).filter(term => term.length >= 3);
  add(record => {
    const haystack = `${record.command}\n${record.output}\n${record.stderr || ''}`.toLowerCase();
    return terms.some(term => haystack.includes(term));
  });

  if (/port|service|network|socket|listen|scan|exposure/.test(query)) {
    add(record => /nmap|masscan|rustscan|netstat|ss\s|listening|open\s+port|\d{1,5}\/(?:tcp|udp)/i.test(`${record.command}\n${record.output}`));
  }
  if (/credential|password|secret|token|api|key|auth|login|cookie|config|sensitive|loot/.test(query)) {
    add(record => /password|passwd|credential|secret|token|api[_-]?key|private key|authorization|cookie|\.env|\.ssh|shadow|access[_-]?key|client[_-]?secret|connection[_-]?string/i.test(`${record.command}\n${record.output}`));
  }
  if (/docker|container|kubernetes|k8s|cloud|aws|azure|gcp|secops|pipeline|registry/.test(query)) {
    add(record => /docker|containerd|podman|kubernetes|\bk8s\b|aws|azure|gcp|terraform|helm|registry|jenkins|gitlab|github actions/i.test(`${record.command}\n${record.output}`));
  }
  if (/root|sudo|suid|capabilit|privesc|escalat|writable|pivot|lateral/.test(query)) {
    add(record => /root|sudo|suid|capabilit|privilege|writable|setuid|pivot|lateral/i.test(`${record.command}\n${record.output}`));
  }
  if (/exploit|vuln|cve|attack|metasploit|msf|payload/.test(query)) {
    add(record => /exploit|vulnerab|cve-\d{4}-\d+|metasploit|msfconsole|payload|shell/i.test(`${record.command}\n${record.output}`));
  }
  if (/subdomain|domain|dns|web|http|directory|endpoint/.test(query)) {
    add(record => /subfinder|amass|assetfinder|sublist3r|dns|subdomain|gobuster|ffuf|dirbuster|http|endpoint/i.test(`${record.command}\n${record.output}`));
  }

  if (selected.size === 0) {
    const recent = allOutputs.slice(-500);
    console.log(`[ContextBuilder] No targeted records; using ${recent.length} recent records`);
    return recent;
  }

  // Keep the latest context window alongside matching evidence so the model
  // understands what happened immediately before the question.
  for (const record of allOutputs.slice(-24)) selected.set(outputKey(record), record);
  const result = Array.from(selected.values()).sort((a, b) => (a.timestamp || a.num || 0) - (b.timestamp || b.num || 0));
  console.log(`[ContextBuilder] Selected ${result.length}/${allOutputs.length} records across evidence classes`);
  return result;
}

function getScopedHosts(
  hosts: any[],
  scope?: AIContextScope,
  scopedOutputs: any[] = [],
): any[] {
  const target = scope?.target;
  const identityScoped = Boolean(scope?.tabId || scope?.terminalId);
  const evidenceValues = scopedOutputs
    .flatMap(output => [output?.target, output?.host])
    .filter(Boolean)
    .map(String);

  return hosts.filter(host => {
    if (host?.role === 'local') return true;
    const values = [host?.id, host?.ip, host?.hostname].filter(Boolean).map(String);
    if (target && !values.some(value => targetsMatch(target, value))) return false;

    // Host/loot models are engagement-level in older persisted sessions. When
    // newer records carry tab/terminal provenance, enforce it; otherwise use
    // the already-scoped command evidence as a conservative identity bridge.
    const hostTab = host?.tab_id || host?.tabId;
    const hostTerminal = host?.terminal_id || host?.terminalId;
    if (scope?.tabId && hostTab && hostTab !== scope.tabId) return false;
    if (scope?.terminalId && hostTerminal && hostTerminal !== scope.terminalId) return false;
    if (identityScoped && !hostTab && !hostTerminal && evidenceValues.length > 0) {
      return values.some(value => evidenceValues.some(evidence => targetsMatch(value, evidence)));
    }
    return true;
  });
}

function getScopedLoot(
  loot: any[],
  hosts: any[],
  scope?: AIContextScope,
  scopedOutputs: any[] = [],
): any[] {
  const target = scope?.target;
  if (!target && !scope?.tabId && !scope?.terminalId) return loot;
  const allowedHostValues = hosts
    .flatMap(host => [host?.id, host?.ip, host?.hostname])
    .filter(Boolean)
    .map(value => String(value).toLowerCase());
  const evidenceValues = scopedOutputs
    .flatMap(output => [output?.target, output?.host])
    .filter(Boolean)
    .map(value => String(value).toLowerCase());

  return loot.filter(item => {
    const itemTab = item?.tab_id || item?.tabId;
    const itemTerminal = item?.terminal_id || item?.terminalId;
    if (scope?.tabId && itemTab && itemTab !== scope.tabId) return false;
    if (scope?.terminalId && itemTerminal && itemTerminal !== scope.terminalId) return false;

    const host = item?.host ? String(item.host) : '';
    const exactHostMatch = allowedHostValues.includes(host.toLowerCase());
    const targetMatch = Boolean(target && targetsMatch(target, host));
    const evidenceMatch = evidenceValues.some(value => targetsMatch(value, host));
    if (target && !targetMatch && !exactHostMatch && !evidenceMatch) return false;
    if ((scope?.tabId || scope?.terminalId) && !itemTab && !itemTerminal
      && evidenceValues.length > 0 && !evidenceMatch && !exactHostMatch) return false;
    return true;
  });
}

function redactSensitiveValue(value: unknown, type?: string): string {
  const text = String(value ?? '');
  const sensitiveType = ['credential', 'token', 'key', 'hash', 'config'].includes(String(type || '').toLowerCase());
  if (sensitiveType) return '[REDACTED SECRET]';
  return redactSensitiveText(text);
}

function redactCommandOutput(output: unknown): string {
  return redactSensitiveText(cleanANSIForDisplay(String(output ?? '')));
}

/**
 * Index high-value signals from every retained record before command-budget
 * selection. This is what prevents an old config dump or a quiet listener
 * from disappearing merely because a newer scan produced more lines.
 */
function buildSecuritySignals(outputs: any[], mode: ContextMode): string {
  const maxEntries = mode === 'compact' ? 80 : 180;
  const maxChars = mode === 'compact' ? 6500 : 13000;
  const entries: string[] = [];
  const seen = new Set<string>();
  const grouped = new Map<string, any[]>();
  for (const record of outputs) {
    const key = String(record.terminalId || record.tabId || record.tool || 'unattributed');
    const group = grouped.get(key) || [];
    group.push(record);
    grouped.set(key, group);
  }
  const interleaved: any[] = [];
  const groups = Array.from(grouped.values());
  const largestGroup = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < largestGroup; index += 1) {
    for (const group of groups) {
      if (group[index]) interleaved.push(group[index]);
    }
  }

  for (const record of interleaved) {
    const command = String(record.command || '');
    const combined = `${command}\n${String(record.output || '')}\n${String(record.stderr || '')}`;
    const lower = combined.toLowerCase();
    const labels: string[] = [];

    labels.push(...summarizeSensitiveEvidence(combined));

    const ports = Array.from(new Set(
      combined.match(/\b\d{1,5}\/(?:tcp|udp)\s+(?:open|closed|filtered)(?:\s+[^\s]+)?/gi) || [],
    )).slice(0, 12);
    if (ports.length > 0) labels.push(`ports: ${ports.map(port => redactSensitiveText(port)).join(', ')}`);

    const boundEndpoints = Array.from(new Set(
      combined.match(/(?:0\.0\.0\.0|127\.0\.0\.1|localhost|\[?::\]?):\d{1,5}\b/gi) || [],
    )).slice(0, 12);
    if (boundEndpoints.length > 0) {
      labels.push(`bound endpoints: ${boundEndpoints.map(endpoint => redactSensitiveText(endpoint)).join(', ')}`);
    }

    const paths = Array.from(new Set([
      ...(combined.match(/(?:\/|~\/|\.\/)[^\s'"`<>]*(?:\.env|\.ssh|shadow|passwd|password|secret|config|\.pem|\.key|backup|\.sql|\.db)[^\s'"`<>]*/gi) || []),
      ...(combined.match(/(?:^|[\s'"`])(?:\.env(?:\.[a-z0-9_-]+)?|\.aws[\\/]credentials|\.kube[\\/]config|docker-compose\.ya?ml|kubeconfig|id_rsa(?:\.pub)?|authorized_keys|wp-config\.php|application\.(?:ya?ml|properties)|\.git[\\/]config)(?=$|[\s'"`])/gim) || []),
    ])).slice(0, 8);
    if (paths.length > 0) labels.push(`sensitive paths: ${paths.map(path => redactSensitiveText(path)).join(', ')}`);

    const infrastructure = Array.from(new Set(
      lower.match(/\b(?:docker|containerd|podman|kubernetes|k8s|kubectl|helm|aws|azure|gcp|terraform|cloud|jenkins|gitlab|github actions|registry|vault|consul)\b/gi) || [],
    )).slice(0, 10);
    if (infrastructure.length > 0) labels.push(`infrastructure: ${infrastructure.join(', ')}`);

    const executionSignals = Array.from(new Set(
      lower.match(/\b(?:whoami|hostname|uname|id|env|printenv|ps|top|htop|systemctl|service|mount|find|crontab|sudo\s+-l|linpeas|winpeas|capsh|netstat|ss|ip\s+(?:addr|route)|route\s+-n)\b/gi) || [],
    )).slice(0, 12);
    if (executionSignals.length > 0) labels.push(`execution/discovery: ${executionSignals.join(', ')}`);

    const privilegeSignals = Array.from(new Set(
      lower.match(/\b(?:uid=0|gid=0|root|sudo|suid|setuid|capabilit(?:y|ies)|writable|privilege escalation|cron|scheduled task)\b/gi) || [],
    )).slice(0, 12);
    if (privilegeSignals.length > 0) labels.push(`privilege indicators: ${privilegeSignals.join(', ')}`);

    const errors = Array.from(new Set(
      combined.split(/\r?\n/)
        .filter(line => /permission denied|access denied|command not found|no such file|connection refused|timed out|timeout|forbidden|unauthorized|failed|error|unexpected/i.test(line))
        .map(line => redactSensitiveText(line.trim()).slice(0, 220))
        .filter(Boolean),
    )).slice(0, 4);
    if (errors.length > 0) labels.push(`constraints/errors: ${errors.join(' | ')}`);

    if (labels.length === 0) continue;

    const terminal = String(record.terminalId || record.tabId || record.tool || 'unattributed');
    const identity = `${record.num}|${terminal}|${labels.join('|')}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const target = String(record.target || record.host || 'unknown-target');
    const safeCommand = redactSensitiveText(command).slice(0, 220);
    entries.push(`- [${record.live ? 'LIVE' : (record.num ?? '?')}] ${record.live ? 'ACTIVE ' : ''}${target} [${terminal}] ${safeCommand}\n  ${labels.join(' | ')}`);
    if (entries.length >= maxEntries || entries.join('\n').length >= maxChars) break;
  }

  const header = `SECURITY EVIDENCE INDEX (derived from ${outputs.length} retained records; values are redacted)`;
  if (entries.length === 0) return `${header}\n- No high-signal credential, network, infrastructure, or constraint markers were observed in retained output.`;
  const body = entries.join('\n');
  return `${header}\n${body}`.slice(0, maxChars);
}

/**
 * Build critical findings section
 */
function buildCriticalFindings(loot: any[]): string {
  const critical = loot.filter(l => 
    l.type === 'credential' || 
    l.type === 'cve' ||
    l.type === 'vulnerability' ||
    String(l.value || '').toLowerCase().includes('root') ||
    String(l.value || '').toLowerCase().includes('password')
  );
  
  if (critical.length === 0) return '';
  
  return `🔴 CRITICAL FINDINGS 🔴\n${critical.map(l => 
    `• ${l.type.toUpperCase()}: ${l.value}`
  ).join('\n')}`;
}

function buildCriticalFindingsSafe(loot: any[]): string {
  const critical = loot.filter(l =>
    l.type === 'credential' ||
    l.type === 'cve' ||
    l.type === 'vulnerability' ||
    String(l.value || '').toLowerCase().includes('root') ||
    String(l.value || '').toLowerCase().includes('password')
  );

  if (critical.length === 0) return '';

  return `CRITICAL FINDINGS\n${critical.map(l =>
    `- ${String(l.type || 'finding').toUpperCase()}: ${redactSensitiveValue(l.value, l.type)}`
  ).join('\n')}`;
}

/**
 * Build attack state summary
 * IMPROVED: Better null handling and formatting
 */
function buildAttackState(
  session: Session,
  hosts: any[],
  loot: any[],
  totalCommands: number,
  scope?: AIContextScope
): string {
  // FIX: Handle both property name variations and undefined values safely
  const target = scope?.target || (session as any)?.target_ip || (session as any)?.target || 'unknown';
  const phase = (session as any)?.current_phase || (session as any)?.phase || 'unknown';
  
  let state = `═══ ATTACK STATE ═══
Target: ${target}
Phase: ${phase}
Commands: ${totalCommands}
Hosts: ${hosts.length}
Loot: ${loot.length}`;

  // Add host details if available
  if (hosts.length > 0) {
    state += '\n\n' + hosts.map(h => {
      const footholds = h.footholds ? Array.from(h.footholds) : [];
      const fs = h.coverage?.filesystem || 0;
      const net = h.coverage?.network || 0;
      
      return `• ${h.ip}${h.hostname ? ` (${h.hostname})` : ''}
  Footholds: ${footholds.join(', ') || 'none'}
  Coverage: FS:${fs}% NET:${net}%
  Blockers: ${h.blockers?.length || 0}`;
    }).join('\n');
    const serviceLines = hosts.flatMap((host: any) =>
      Array.isArray(host.ports)
        ? host.ports.slice(0, 50).map((port: any) =>
          `• ${host.ip}:${port.port}/${port.protocol || 'tcp'} - ${port.service || 'unknown'}${port.version ? ` (${port.version})` : ''}`)
        : []
    );
    const vulnerabilityLines = hosts.flatMap((host: any) =>
      Array.isArray(host.vulnerabilities)
        ? host.vulnerabilities.slice(0, 25).map((vulnerability: any) =>
          `• [${vulnerability.severity || 'unknown'}] ${host.ip}: ${vulnerability.cve || vulnerability.description}`)
        : []
    );
    if (serviceLines.length > 0) state += '\n\nOBSERVED SERVICES / PORTS:\n' + serviceLines.map(normalizeContextBullet).join('\n');
    if (vulnerabilityLines.length > 0) state += '\n\nOBSERVED VULNERABILITIES:\n' + vulnerabilityLines.map(normalizeContextBullet).join('\n');
  }

  // Add loot details if available
  if (loot.length > 0) {
    const safeLoot = loot.map(l => ({ ...l, value: redactSensitiveValue(l.value, l.type) }));
    state += '\n\n' + safeLoot.map(l => 
      `• ${l.type}: ${l.value}${l.used ? ' [USED]' : ''}`
    ).join('\n');
  }
  
  const edges = Array.isArray((session as any)?.edges) ? (session as any).edges : [];
  const allowedHostIds = new Set(hosts.map(host => String(host?.id)));
  const scopedEdges = scope?.target
    ? edges.filter((edge: any) => allowedHostIds.has(String(edge?.from)) || allowedHostIds.has(String(edge?.to)))
    : edges;
  if (scopedEdges.length > 0) {
    state += '\n\nEDGES / RELATIONSHIPS:\n' + scopedEdges.slice(0, 100).map((edge: any) =>
      `- ${edge.from} -> ${edge.to} [${edge.type || 'relationship'}]${edge.method ? ` via ${edge.method}` : ''}`
    ).join('\n');
  }

  return state;
}

function normalizeContextBullet(value: string): string {
  return value.replace(/^[^\x00-\x7F]+\s*/, '- ');
}

/**
 * Check if command is a scan tool (not manual exploitation)
 * Scan tools produce massive output that needs compression
 */
function isScanCommand(command: string): boolean {
  const cmd = command.toLowerCase();
  const scanTools = [
    'nmap', 'masscan', 'nikto', 'nuclei', 'gobuster', 'ffuf', 
    'dirbuster', 'subfinder', 'amass', 'assetfinder', 'sublist3r', 'wfuzz',
    'dirb', 'dirsearch', 'feroxbuster', 'wpscan'
  ];
  return scanTools.some(tool => cmd.includes(tool));
}

/**
 * Compress scan output using parsers
 * Use existing parsers to generate compact summaries
 */
function compressScanOutput(command: string, output: string): string {
  const cmd = command.toLowerCase();
  
  console.log(`[ContextBuilder] 🔧 COMPRESSION CALLED for: ${redactSensitiveText(command).substring(0, 50)}... (${output.length} chars)`);
  
  try {
    // Nikto scanner
    if (cmd.includes('nikto')) {
      console.log('[ContextBuilder] 📊 Compressing NIKTO scan');
      const findings = parseNikto(output);
      console.log(`[ContextBuilder] ✅ Nikto parser returned ${findings.length} findings`);
      
      // Calculate severity counts
      const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 };
      findings.forEach(f => {
        if (f.severity) counts[f.severity]++;
      });
      
      let summary = `[CMD] ${command}\n→ NIKTO SCAN: ${findings.length} findings`;
      if (counts.critical > 0) summary += ` (${counts.critical} critical`;
      if (counts.high > 0) summary += `, ${counts.high} high`;
      if (counts.medium > 0) summary += `, ${counts.medium} medium`;
      if (counts.low > 0) summary += `, ${counts.low} low)`;
      else if (counts.critical > 0 || counts.high > 0 || counts.medium > 0) summary += ')';
      
      // Show top 10 critical/high findings
      const topFindings = findings
        .filter(f => f.severity === 'critical' || f.severity === 'high')
        .slice(0, 10);
      
      if (topFindings.length > 0) {
        summary += '\n  TOP FINDINGS:\n';
        topFindings.forEach(f => {
          summary += `  • [${f.severity?.toUpperCase()}] ${f.title}\n`;
        });
        
        if (findings.length > topFindings.length) {
          summary += `  ... [${findings.length - topFindings.length} more - see GUI]\n`;
        }
      }
      
      console.log(`[ContextBuilder] ✅ Compressed nikto from ${output.length} to ${summary.length} chars (${Math.round((1 - summary.length/output.length) * 100)}% reduction)`);
      return summary;
    }
    
    // Nuclei scanner
    if (cmd.includes('nuclei')) {
      const findings = parseNuclei(output);
      
      const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 };
      const cves: string[] = [];
      
      findings.forEach(f => {
        if (f.severity) counts[f.severity]++;
        // Extract CVEs from title or description
        const cveMatch = (f.title + ' ' + (f.description || '')).match(/CVE-\d{4}-\d+/gi);
        if (cveMatch) cves.push(...cveMatch);
      });
      
      let summary = `[CMD] ${command}\n→ NUCLEI SCAN: ${findings.length} findings`;
      if (counts.critical > 0) summary += ` (${counts.critical} critical`;
      if (counts.high > 0) summary += `, ${counts.high} high`;
      if (counts.medium > 0) summary += `, ${counts.medium} medium)`;
      else if (counts.critical > 0 || counts.high > 0) summary += ')';
      
      if (cves.length > 0) {
        const uniqueCves = [...new Set(cves)];
        summary += `\n  CVEs: ${uniqueCves.slice(0, 5).join(', ')}`;
        if (uniqueCves.length > 5) summary += ` +${uniqueCves.length - 5} more`;
      }
      
      const topFindings = findings
        .filter(f => f.severity === 'critical' || f.severity === 'high')
        .slice(0, 8);
      
      if (topFindings.length > 0) {
        summary += '\n  TOP FINDINGS:\n';
        topFindings.forEach(f => {
          summary += `  • [${f.severity?.toUpperCase()}] ${f.title}\n`;
        });
      }
      
      return summary;
    }
    
    // Nmap scanner
    if (cmd.includes('nmap')) {
      const findings = parseNmap(output);
      
      const hosts = findings.filter(f => f.type === 'host');
      const ports = findings.filter(f => f.type === 'open_port');
      
      let summary = `[CMD] ${command}\n→ NMAP SCAN: ${hosts.length} hosts, ${ports.length} open ports\n`;
      
      if (ports.length > 0) {
        summary += '  OPEN PORTS:\n';
        ports.forEach(p => {
          const data = p.data as any;
          summary += `  • ${data.host || ''}:${data.port}/${data.protocol || 'tcp'} - ${data.service || 'unknown'}${data.version ? ` (${data.version})` : ''}\n`;
        });
      }
      
      return summary;
    }
    
    // Gobuster/directory busting
    if (cmd.includes('gobuster') || cmd.includes('dirbuster')) {
      const findings = parseGobuster(output);
      
      const statusCounts: Record<number, number> = {};
      findings.forEach(f => {
        const code = (f.data as any).statusCode || (f.data as any).status;
        if (code) statusCounts[code] = (statusCounts[code] || 0) + 1;
      });
      
      let summary = `[CMD] ${command}\n→ DIRECTORY SCAN: ${findings.length} paths\n`;
      
      Object.entries(statusCounts)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .forEach(([code, count]) => {
          summary += `  ${code}: ${count} paths\n`;
        });
      
      // Show top 15 interesting paths (200, 403, 401, 302)
      const interesting = findings
        .filter(f => {
          const code = (f.data as any).statusCode || (f.data as any).status;
          return code === 200 || code === 403 || code === 401 || code === 302;
        })
        .slice(0, 15);
      
      if (interesting.length > 0) {
        summary += '  TOP PATHS:\n';
        interesting.forEach(f => {
          const data = f.data as any;
          const code = data.statusCode || data.status;
          const path = data.path || data.url || f.title;
          summary += `  • [${code}] ${path}\n`;
        });
        
        if (findings.length > interesting.length) {
          summary += `  ... [${findings.length - interesting.length} more]\n`;
        }
      }
      
      return summary;
    }
    
    // FFuf/wfuzz. ffuf is used for both directory and subdomain discovery;
    // route the latter through the target-scoped parser so unrelated hosts do
    // not enter AI context and directory output is not parsed as wfuzz.
    if (cmd.includes('ffuf')) {
      const subdomainMatch = cmd.match(/fuzz\.([a-z0-9.-]+\.[a-z]{2,})/i);
      if (subdomainMatch) {
        const result = parseSubdomainOutput('ffuf', output, subdomainMatch[1]);
        let summary = `[CMD] ${command}\n→ SUBDOMAINS: ${result.subdomains.length} found\n`;
        result.subdomains.slice(0, 20).forEach(finding => {
          summary += `  • ${finding.subdomain}${finding.httpStatus ? ` [${finding.httpStatus}]` : ''}\n`;
        });
        if (result.subdomains.length > 20) summary += `  ... [${result.subdomains.length - 20} more]\n`;
        return summary;
      }

      const findings = parseFfuf(output);

      let summary = `[CMD] ${command}\n→ FUZZING: ${findings.length} results\n`;

      const top = findings.slice(0, 15);
      if (top.length > 0) {
        summary += '  TOP RESULTS:\n';
        top.forEach(f => {
          const data = f.data as any;
          const code = data.statusCode || data.status || '?';
          const path = data.path || data.url || f.title;
          summary += `  • [${code}] ${path}\n`;
        });

        if (findings.length > top.length) {
          summary += `  ... [${findings.length - top.length} more]\n`;
        }
      }

      return summary;
    }

    if (cmd.includes('wfuzz')) {
      const findings = parseWfuzz(output);
      
      let summary = `[CMD] ${command}\n→ FUZZING: ${findings.length} results\n`;
      
      const top = findings.slice(0, 15);
      if (top.length > 0) {
        summary += '  TOP RESULTS:\n';
        top.forEach(f => {
          const data = f.data as any;
          const code = data.statusCode || data.status || '?';
          const path = data.path || data.url || f.title;
          summary += `  • [${code}] ${path}\n`;
        });
        
        if (findings.length > top.length) {
          summary += `  ... [${findings.length - top.length} more]\n`;
        }
      }
      
      return summary;
    }
    
    // Target-scoped subdomain enumeration. Use the same strict parser as the
    // Subdomain view so AI context cannot inherit unrelated hosts from noisy
    // tool output. The fallback keeps manually pasted output useful when a
    // command does not expose a parseable target argument.
    if (
      cmd.includes('subfinder') ||
      cmd.includes('amass') ||
      cmd.includes('assetfinder') ||
      cmd.includes('sublist3r')
    ) {
      const target =
        cmd.match(/(?:^|\s)(?:-d|--domain)\s+(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}\.?)/i)?.[1] ||
        cmd.match(/--subs-only\s+([a-z0-9.-]+\.[a-z]{2,}\.?)/i)?.[1];
      const scopedResult = target
        ? parseSubdomainOutput(
          cmd.includes('subfinder')
            ? 'subfinder'
            : cmd.includes('amass')
              ? 'amass'
              : cmd.includes('assetfinder')
                ? 'assetfinder'
                : 'sublist3r',
          output,
          target,
        )
        : null;
      const findings = scopedResult
        ? scopedResult.subdomains.map(finding => ({
          title: finding.subdomain,
          httpStatus: finding.httpStatus,
        }))
        : cmd.includes('subfinder')
          ? parseSubfinder(output)
          : parseAmass(output);
      
      let summary = `[CMD] ${command}\n→ SUBDOMAINS: ${findings.length} found\n`;
      
      const top = findings.slice(0, 20);
      if (top.length > 0) {
        summary += '  SUBDOMAINS:\n';
        top.forEach(f => {
          summary += `  • ${f.title}\n`;
        });
        
        if (findings.length > top.length) {
          summary += `  ... [${findings.length - top.length} more]\n`;
        }
      }
      
      return summary;
    }
    
    // Fallback: truncate
    return `[CMD] ${command}\n→ [Scan: ${output.length} chars]\n${output.substring(0, 500)}...[truncated]`;
    
  } catch (error) {
    console.error('[ContextBuilder] Compression error:', error);
    // Fallback to truncation
    return `[CMD] ${command}\n→ [Scan: ${output.length} chars]\n${output.substring(0, 1000)}...[truncated]`;
  }
}

/**
 * Build command history
 * IMPROVED: Better formatting with timestamps and error highlighting
 * Compress scan tool output using parsers
 */
function buildCommandHistory(commands: any[]): string {
  if (commands.length === 0) return '';
  
  return `═══ COMMAND HISTORY (${commands.length}) ═══\n${commands.map(o => {
    const status = o.live ? '● ACTIVE' : (o.exitCode === 0 ? '✓' : '✗');
    const recordLabel = o.live ? 'LIVE' : o.num;
    const timestamp = new Date(o.timestamp).toLocaleTimeString();
    const safeCommand = redactSensitiveText(o.command);
    
    // Detect scan commands and compress their output
    if (isScanCommand(o.command) && o.output && o.output.length > 1000) {
      const compressed = redactCommandOutput(compressScanOutput(o.command, o.output));
      return `[${recordLabel}] ${status} ${timestamp} ${redactSensitiveText(o.target || o.host || 'unknown-target')}${o.tool ? ` [${redactSensitiveText(o.tool)}]` : ''}\n${safeCommand}\n${compressed}`;
    }
    
    // For manual commands (ssh, msfconsole, manual exploitation), keep fuller output
    // Limit output per command even in ultra mode
    const maxOutputPerCommand = 10000; // 10K chars max for manual commands
    let output = redactCommandOutput(o.output);
    output = `[target: ${redactSensitiveText(o.target || o.host || 'unknown-target')}${o.tool ? `, tool: ${redactSensitiveText(o.tool)}` : ''}]\n${output}`;
    if (o.stderr) {
      output += `\n[stderr]\n${redactCommandOutput(o.stderr).substring(0, 4000)}`;
    }
    
    if (output.length > maxOutputPerCommand) {
      const lines = output.split('\n');
      const truncated = [
        ...lines.slice(0, 200),
        `\n...[${lines.length - 400} lines truncated]...\n`,
        ...lines.slice(-200)
      ].join('\n');
      output = truncated.substring(0, maxOutputPerCommand);
    } else {
      output = output.substring(0, maxOutputPerCommand);
    }
    
    return `[${recordLabel}] ${status} ${timestamp} ${safeCommand}\n→ ${output}${o.output.length > maxOutputPerCommand ? '\n...[truncated]' : ''}`;
  }).join('\n\n')}`;
}

/**
 * Compress command output
 * Handles OSCP/CRTX exam chaos - massive file dumps, network scans, docker ops
 */
function compressCommand(cmd: any): any {
  if (!cmd.output || cmd.output.length < 3000) return cmd;
  
  const lines = cmd.output.split('\n');
  if (lines.length < 20) return cmd;
  
  // Detect output type for smart compression
  const outputType = detectOutputType(cmd.command, cmd.output);
  
  switch (outputType) {
    case 'file_dump':
      return compressFileDump(cmd, lines);
    case 'network_scan':
      return compressNetworkScan(cmd, lines);
    case 'process_list':
      return compressProcessList(cmd, lines);
    case 'docker_output':
      return compressDockerOutput(cmd, lines);
    default:
      return compressGeneric(cmd, lines);
  }
}

/**
 * Detect output type for smart compression
 */
function detectOutputType(command: string, output: string): string {
  const cmd = command.toLowerCase();
  
  // File dumps (find, ls -R, tree)
  if (cmd.includes('find') || cmd.includes('ls -r') || cmd.includes('tree')) {
    const filePathCount = (output.match(/\//g) || []).length;
    if (filePathCount > 50) return 'file_dump';
  }
  
  // Network scans (netstat, ss, nmap)
  if (cmd.includes('netstat') || cmd.includes('ss ') || cmd.includes('nmap')) {
    return 'network_scan';
  }
  
  // Process listing (ps, top)
  if (cmd.includes('ps ') || cmd.includes('top')) {
    return 'process_list';
  }
  
  // Docker operations
  if (cmd.includes('docker')) {
    return 'docker_output';
  }
  
  return 'generic';
}

/**
 * Compress file dump (find, ls -R)
 * Strategy: Keep interesting paths, summarize node_modules
 */
/**
 * Compress file dump (find, ls -R)
 * OPTIMIZED: Early exit for speed
 */
function compressFileDump(cmd: any, lines: string[]): any {
  const interesting: string[] = [];
  let nodeModulesCount = 0;
  const maxInteresting = 150;

  for (const line of lines) {
    if (line.includes('node_modules')) {
      nodeModulesCount++;
      continue;
    }

    const l = line.toLowerCase();

    if (
      l.includes('.conf') || l.includes('.key') || l.includes('.pem') ||
      l.includes('.env') || l.includes('password') || l.includes('secret') ||
      l.includes('/etc/') || l.includes('/root/') || l.includes('/home/') ||
      l.includes('.bak') || l.includes('.sql') || l.includes('.db') ||
      l.includes('admin') || l.includes('config')
    ) {
      interesting.push(line);
      if (interesting.length >= maxInteresting) break;
    }
  }

  return {
    ...cmd,
    output: `[${lines.length} files, ${nodeModulesCount} node_modules]\n\n${interesting.join('\n')}\n\n[${interesting.length} shown]`
  };
}

/**
 * Compress network scan (netstat, ss)
 * Strategy: Keep all connections, group by type
 */
/**
 * Compress network scan (netstat, ss)
 * OPTIMIZED: Dedupe TIME_WAIT spam
 */
function compressNetworkScan(cmd: any, lines: string[]): any {
  const established: string[] = [];
  const listening: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const l = line.toLowerCase();

    if (l.includes('established')) {
      established.push(line);
    } else if (l.includes('listen')) {
      listening.push(line);
    } else if (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(line)) {
      other.push(line);
    }
  }

  return {
    ...cmd,
    output: `[${lines.length} connections]\n\nLISTENING:\n${listening.join('\n')}\n\nESTABLISHED:\n${established.join('\n')}\n\nOTHER:\n${other.slice(0, 30).join('\n')}`
  };
}

/**
 * Compress process list (ps aux)
 * Strategy: Keep interesting processes
 */
/**
 * Compress process list (ps aux)
 * OPTIMIZED: Early exit for speed
 */
function compressProcessList(cmd: any, lines: string[]): any {
  const interesting: string[] = [];
  const maxProcesses = 200;

  for (const line of lines) {
    if (interesting.length >= maxProcesses) break;

    const l = line.toLowerCase();
    if (
      (l.includes('root') || l.includes('ssh') || l.includes('docker') ||
       l.includes('proxy') || l.includes('mysql') || l.includes('postgres') ||
       l.includes('apache') || l.includes('nginx') || l.includes('node') ||
       l.includes('python') || l.includes('java')) &&
      !l.includes('grep')
    ) {
      interesting.push(line);
    }
  }

  return {
    ...cmd,
    output: `[${lines.length} processes, ${interesting.length} interesting]\n\n${interesting.join('\n')}`
  };
}

/**
 * Compress docker output
 * OPTIMIZED: Faster truncation
 */
function compressDockerOutput(cmd: any, lines: string[]): any {
  return { 
    ...cmd, 
    output: [
      ...lines.slice(0, 50),
      `[${lines.length - 100} lines hidden]`,
      ...lines.slice(-50)
    ].join('\n')
  };
}

/**
 * Generic compression with context preservation
 * OPTIMIZED: Sampling for speed
 */
function compressGeneric(cmd: any, lines: string[]): any {
  const important: string[] = [];
  const step = Math.max(1, Math.floor(lines.length / 500)); // Sample every Nth line
  
  for (let i = 0; i < lines.length && important.length < 150; i += step) {
    const line = lines[i];
    const l = line.toLowerCase();
    
    if (
      l.includes('open') || l.includes('error') || l.includes('found') ||
      l.includes('vulnerable') || l.includes('root') || l.includes('password') ||
      l.includes('credential') || l.includes('cve-') || l.includes('exploit') ||
      /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(line)
    ) {
      important.push(line);
    }
  }
  
  return { 
    ...cmd, 
    output: [
      ...lines.slice(0, 15),
      `[${lines.length - 25 - important.length} lines hidden]`,
      ...important,
      ...lines.slice(-10)
    ].join('\n')
  };
}
