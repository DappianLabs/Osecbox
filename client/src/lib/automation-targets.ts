import { validateScanTarget } from './scanner/target-validation';

export interface AutomationTargetStats {
  total: number;
  valid: string[];
  invalid: string[];
}

/**
 * Parse the one-target-per-line format used by Automation. The scanner's
 * shared target validator is deliberately reused here so batch scans do not
 * accept values that a normal Nmap tab would reject (for example, an IPv4
 * address with an octet greater than 255).
 */
export function parseAutomationTargets(value: string | undefined | null): AutomationTargetStats {
  const lines = String(value ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const line of lines) {
    const target = line.split(/\s+/)[0] || '';
    const result = validateScanTarget(target, 'nmap');
    if (result.valid) valid.push(line);
    else invalid.push(target);
  }

  return { total: lines.length, valid, invalid };
}

/** Split a valid automation line into the host and the flags to pass to Nmap. */
export function splitAutomationTarget(line: string): { target: string; flags: string[] } {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return {
    target: tokens[0] || '',
    flags: tokens.slice(1),
  };
}
