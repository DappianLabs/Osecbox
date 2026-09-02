/**
 * Data policy for text that may cross the AI provider boundary.
 *
 * The local attack-state may retain the original terminal output so the
 * operator can inspect it, but provider-bound context must contain evidence
 * about a secret rather than the secret itself.  This module is deliberately
 * synchronous and dependency-free because it runs on every captured command.
 */

export interface SensitiveEvidence {
  kind: string;
  key?: string;
  line: number;
}

export interface RedactionResult {
  text: string;
  findings: SensitiveEvidence[];
}

const SENSITIVE_KEY_PATTERN =
  /\b(?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|access[_-]?key|api[_-]?key|apikey|auth(?:orization)?|credential|cookie|session[_-]?cookie|client[_-]?secret|private[_-]?key|secret[_-]?access[_-]?key|aws[_-]?(?:secret[_-]?access[_-]?key|access[_-]?key[_-]?id|session[_-]?token)|azure[_-]?client[_-]?secret|database[_-]?url|db[_-]?password|connection[_-]?string|docker[_-]?auth|kubeconfig(?:[_-]?token)?|tf[_-]?var)\b/i;

const PLACEHOLDER_PATTERN = /^(?:\*+|x+|<redacted>|\[redacted[^\]]*\]|redacted|null|undefined|none|n\/a)$/i;

function lineNumber(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function addFinding(findings: SensitiveEvidence[], seen: Set<string>, text: string, index: number, kind: string, key?: string): void {
  const normalizedKey = key?.trim().replace(/^['"`]|['"`]$/g, '');
  const entry = `${kind}|${normalizedKey || ''}|${lineNumber(text, index)}`;
  if (seen.has(entry)) return;
  seen.add(entry);
  findings.push({
    kind,
    ...(normalizedKey ? { key: normalizedKey } : {}),
    line: lineNumber(text, index),
  });
}

function keyFromPrefix(prefix: string): string | undefined {
  const match = prefix.match(/\b([a-z][a-z0-9_-]*)\b["'`]?\s*[:=]/i);
  return match?.[1];
}

function isSensitiveKeyName(key: string | undefined): boolean {
  const value = String(key || '').trim();
  if (!value) return false;

  // Match both ordinary keys (password) and namespaced environment keys
  // (AWS_SECRET_ACCESS_KEY, TF_VAR_DB_PASSWORD, GITHUB_TOKEN). The compact
  // form avoids relying on word-boundaries around underscores.
  const segments = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const compact = segments.join('');
  const sensitiveSegments = new Set([
    'password', 'passwd', 'pwd', 'pass', 'secret', 'token', 'credential',
    'apikey', 'authorization', 'auth', 'cookie', 'privatekey', 'accesskey',
    'clientsecret', 'connectionstring', 'databaseurl', 'dockerauth',
    'kubeconfig', 'kubeconfigtoken', 'sessioncookie', 'refreshtoken',
  ]);

  return SENSITIVE_KEY_PATTERN.test(value)
    || segments.some(segment => sensitiveSegments.has(segment))
    || compact.includes('accesskey')
    || compact.includes('clientsecret')
    || compact.includes('connectionstring')
    || compact.includes('databaseurl')
    || compact.includes('dockerauth')
    || compact.includes('kubeconfig');
}

function classifyKey(key: string | undefined): string {
  const normalized = String(key || '').toLowerCase().replace(/[-_]/g, '');
  if (normalized.includes('aws') && normalized.includes('access')) return 'aws_credential';
  if (normalized.includes('docker') || normalized === 'auth') return 'container_credential';
  if (normalized.includes('kube')) return 'kubernetes_credential';
  if (normalized.includes('database') || normalized.includes('connection') || normalized.includes('db')) return 'connection_credential';
  if (normalized.includes('private') || normalized.includes('key')) return 'private_key';
  if (normalized.includes('cookie') || normalized.includes('session')) return 'session_credential';
  if (normalized.includes('token')) return 'token';
  if (normalized.includes('api')) return 'api_key';
  if (normalized.includes('auth')) return 'authorization';
  return 'credential';
}

function isPlaceholder(value: string): boolean {
  return !value.trim() || PLACEHOLDER_PATTERN.test(value.trim());
}

function replaceKeyValueSecrets(text: string, findings: SensitiveEvidence[], seen: Set<string>): string {
  // Supports JSON, YAML, dotenv, Terraform environment variables, shell
  // exports, and common CLI output while preserving the key/quote style for
  // useful evidence and line context. Match a generic key first, then make
  // the sensitivity decision in the callback; this catches namespaced keys
  // such as AWS_SECRET_ACCESS_KEY without masking ordinary fields like port.
  const keyValuePattern = /(["'`]?\b[a-z][a-z0-9_.-]{0,127}\b["'`]?\s*[:=]\s*)(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s,;}\]]+))/gi;

  return text.replace(keyValuePattern, (match, prefix: string, doubleQuoted: string | undefined, singleQuoted: string | undefined, backtickQuoted: string | undefined, bare: string | undefined, offset: number) => {
    const key = keyFromPrefix(prefix);
    if (!isSensitiveKeyName(key)) return match;

    const value = doubleQuoted ?? singleQuoted ?? backtickQuoted ?? bare ?? '';
    if (isPlaceholder(value)) return match;

    const kind = classifyKey(key);
    addFinding(findings, seen, text, offset, kind, key);

    const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : backtickQuoted !== undefined ? '`' : '';
    return `${prefix}${quote}[REDACTED:${kind}]${quote}`;
  });
}

/**
 * Redact secrets while retaining non-sensitive evidence such as the key name
 * and line number. Never put the original value in the returned findings.
 */
export function redactSensitiveTextWithFindings(value: unknown): RedactionResult {
  let text = String(value ?? '');
  const findings: SensitiveEvidence[] = [];
  const seen = new Set<string>();

  // PEM/private-key material must be removed as a block before line-oriented
  // rules inspect it.
  text = text.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, (match: string, offset: number) => {
    const type = /PRIVATE KEY/i.test(match) ? 'private_key' : 'certificate_material';
    addFinding(findings, seen, text, offset, type);
    return `[REDACTED:${type}]`;
  });

  // Connection strings and URLs can carry credentials without a named key.
  text = text.replace(/((?:https?|ssh|ftp|ftps|postgres(?:ql)?|mysql):\/\/[^\s/@:]+:)([^\s@]+)(@)/gi, (match: string, prefix: string, _secret: string, suffix: string, offset: number) => {
    addFinding(findings, seen, text, offset, 'connection_credential');
    return `${prefix}[REDACTED:connection_credential]${suffix}`;
  });

  // Authorization headers and bearer values are frequently separated by a
  // space, so they cannot rely on the key/value rule.
  text = text.replace(/\b(Bearer)\s+([A-Za-z0-9._~+/=-]{8,})/gi, (match: string, scheme: string, _secret: string, offset: number) => {
    addFinding(findings, seen, text, offset, 'bearer_token');
    return `${scheme} [REDACTED:bearer_token]`;
  });

  // Basic authentication is often emitted without a `Basic:` key. The
  // base64 payload still contains a credential and must not cross the provider
  // boundary.
  text = text.replace(/\b(Basic)\s+([A-Za-z0-9+/=]{12,})/gi, (match: string, scheme: string, _secret: string, offset: number) => {
    addFinding(findings, seen, text, offset, 'basic_auth');
    return `${scheme} [REDACTED:basic_auth]`;
  });

  text = replaceKeyValueSecrets(text, findings, seen);

  // Common provider token formats. These rules intentionally require the
  // recognizable prefix and a meaningful length to avoid masking ordinary
  // words or short IDs.
  const recognizableTokenPattern = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bglpat-[A-Za-z0-9_-]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b|\bAIza[A-Za-z0-9_-]{25,}\b|\bsk-ant-[A-Za-z0-9_-]{16,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bnpm_[A-Za-z0-9]{20,}\b|\bpypi-[A-Za-z0-9_-]{16,}\b/g;
  text = text.replace(recognizableTokenPattern, (match: string, offset: number) => {
    const kind = /^(?:AKIA|ASIA)/.test(match) ? 'aws_access_key' :
      /^ghp_|^github_pat_/.test(match) ? 'github_token' :
        /^glpat-/.test(match) ? 'gitlab_token' :
          /^xox/.test(match) ? 'slack_token' :
            /^AIza/.test(match) ? 'google_api_key' :
              /^sk-ant-/.test(match) ? 'anthropic_key' :
                /^sk-/.test(match) ? 'api_key' :
                  /^npm_/.test(match) ? 'npm_token' : 'package_registry_token';
    addFinding(findings, seen, text, offset, kind);
    return `[REDACTED:${kind}]`;
  });

  text = text.replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, (match: string, offset: number) => {
    addFinding(findings, seen, text, offset, 'jwt');
    return '[REDACTED:jwt]';
  });

  // Do not treat command flags such as `-p 8080` as a password. Long-form
  // secret flags are unambiguous and cover the common shell/tool forms.
  text = text.replace(/((?:--password|--token|--api-key|--secret)(?:=|\s+))("[^"]*"|'[^']*'|`[^`]*`|[^\s]+)/gi, (match: string, prefix: string, rawValue: string, offset: number) => {
    const value = rawValue.replace(/^["'`]|["'`]$/g, '');
    if (isPlaceholder(value)) return match;
    const kind = prefix.toLowerCase().includes('password') ? 'credential' : prefix.toLowerCase().includes('api') ? 'api_key' : 'token';
    addFinding(findings, seen, text, offset, kind);
    const quote = /^["'`]/.test(rawValue) ? rawValue[0] : '';
    return `${prefix}${quote}[REDACTED:${kind}]${quote}`;
  });

  // Short password flags are common in database clients and sshpass. Keep
  // nmap's -p <port> and generic tool flags untouched by scoping this rule to
  // commands where -p is unambiguously a password argument.
  text = text.replace(/(\bsshpass\b[^\n]*?\s-p(?:\s+|=))("[^"]*"|'[^']*'|`[^`]*`|[^\s]+)/gi, (match: string, prefix: string, rawValue: string, offset: number) => {
    const value = rawValue.replace(/^["'`]|["'`]$/g, '');
    if (isPlaceholder(value)) return match;
    addFinding(findings, seen, text, offset, 'credential');
    const quote = /^["'`]/.test(rawValue) ? rawValue[0] : '';
    return `${prefix}${quote}[REDACTED:credential]${quote}`;
  });
  text = text.replace(/(\b(?:mysql|mariadb|psql|sqlcmd|redis-cli|mongo(?:sh)?)\b[^\n]*?\s-p(?:\s+|=))("[^"]*"|'[^']*'|`[^`]*`|[^\s]+)/gi, (match: string, prefix: string, rawValue: string, offset: number) => {
    const value = rawValue.replace(/^["'`]|["'`]$/g, '');
    if (isPlaceholder(value)) return match;
    addFinding(findings, seen, text, offset, 'credential');
    const quote = /^["'`]/.test(rawValue) ? rawValue[0] : '';
    return `${prefix}${quote}[REDACTED:credential]${quote}`;
  });

  return { text, findings };
}

export function redactSensitiveText(value: unknown): string {
  return redactSensitiveTextWithFindings(value).text;
}

export function collectSensitiveEvidence(value: unknown): SensitiveEvidence[] {
  return redactSensitiveTextWithFindings(value).findings;
}

export function summarizeSensitiveEvidence(value: unknown): string[] {
  const findings = collectSensitiveEvidence(value);
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.kind, (counts.get(finding.kind) || 0) + 1);
  return Array.from(counts.entries()).map(([kind, count]) => `${kind} detected (${count})`);
}
