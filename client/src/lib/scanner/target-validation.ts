/**
 * Scanner Context - Target Validation
 *
 * Client-side validation for scan targets. The live scan path
 * (createRunScan) writes commands straight to the terminal and never reaches
 * the Electron backend validators, so these checks are the only thing standing
 * between a stray click and a scan against the wrong (or no) host.
 *
 * @module target-validation
 */

import type { ScannerType } from './scanner-types';

export interface TargetValidationResult {
  valid: boolean;
  error?: string;
}

// IPv4, optionally with /CIDR
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
// IPv4 range e.g. 192.168.1.1-254
const IP_RANGE = /^(\d{1,3}\.){3}\d{1,3}-\d{1,3}$/;
// Hostname / domain (labels separated by dots)
const HOSTNAME = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

function octetsValid(parts: string[]): boolean {
  return parts.every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function isValidIPv4(value: string): boolean {
  const m = value.match(IPV4);
  if (!m) return false;
  return octetsValid(m.slice(1, 5));
}

function isValidCIDR(value: string): boolean {
  const m = value.match(CIDR);
  if (!m) return false;
  if (!octetsValid(m.slice(1, 5))) return false;
  const prefix = Number(m[5]);
  return prefix >= 0 && prefix <= 32;
}

function isValidIPRange(value: string): boolean {
  if (!IP_RANGE.test(value)) return false;
  const [base, endOctet] = value.split('-');
  if (!isValidIPv4(base)) return false;
  const end = Number(endOctet);
  return end >= 0 && end <= 255;
}

/**
 * Extract the host portion from a URL or host[:port][/path] string.
 * Returns null if nothing host-like can be found.
 */
function extractHost(value: string): string | null {
  let v = value.trim();
  if (!v) return null;

  // Strip scheme
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v)) {
    try {
      const url = new URL(v);
      return url.hostname || null;
    } catch {
      v = v.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
    }
  }

  // Strip credentials, path, query, and port
  v = v.split('/')[0].split('?')[0];
  if (v.includes('@')) v = v.split('@').pop() as string;
  // Remove :port (but keep IPv6-less simple form)
  v = v.replace(/:\d+$/, '');
  return v || null;
}

/** True for IP / CIDR / range / hostname (localhost included). */
function isHostLike(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.toLowerCase() === 'localhost') return true;

  // A malformed numeric address must not fall through to the hostname
  // grammar. Numeric labels are legal hostnames, so without this guard values
  // such as 999.999.999.999 would be accepted as domains.
  if (/^\d+(?:\.\d+){3}(?:\/\d+)?$/.test(v)) {
    return isValidIPv4(v) || isValidCIDR(v);
  }
  if (/^\d+(?:\.\d+){3}-\d+$/.test(v)) {
    return isValidIPRange(v);
  }

  return (
    isValidIPv4(v) ||
    isValidCIDR(v) ||
    isValidIPRange(v) ||
    HOSTNAME.test(v)
  );
}

/**
 * Return true when the target is a literal IP, CIDR, or IPv4 range and does
 * not need a DNS lookup before a scan starts.
 */
export function isDnsFreeScanTarget(rawTarget: string | undefined | null): boolean {
  let target = (rawTarget ?? '').trim();
  if (!target) return false;

  // Full nmap command input is allowed. Use the last non-flag token, which is
  // the target in the supported command form.
  if (/^nmap\b/i.test(target)) {
    const tokens = target.slice(4).trim().split(/\s+/).filter(token => !token.startsWith('-'));
    target = tokens[tokens.length - 1] || '';
  }

  const host = extractHost(target) ?? target;
  return isValidIPv4(host) || isValidCIDR(host) || isValidIPRange(host);
}

/**
 * Validate a scan target for the given scanner type.
 *
 * - nikto / nuclei / dirbuster: expect a URL or host/IP (host is extracted and
 *   format-checked).
 * - nmap: accept either a raw `nmap ...` command or a single host/IP/CIDR/range
 *   token.
 * - universal: accept any non-empty command (it is a free-form command line).
 */
export function validateScanTarget(
  rawTarget: string | undefined | null,
  scannerType: ScannerType | undefined,
): TargetValidationResult {
  const target = (rawTarget ?? '').trim();

  if (!target) {
    return { valid: false, error: 'Enter a target before starting a scan.' };
  }

  // Universal / custom command: just needs to be a non-empty command.
  if (scannerType === 'universal') {
    return { valid: true };
  }

  if (scannerType === 'nmap') {
    // A full nmap command line is allowed (input hint is "nmap [options] <target>").
    if (target.toLowerCase().startsWith('nmap')) {
      const rest = target.slice(4).trim();
      if (!rest) {
        return { valid: false, error: 'Add a target after "nmap".' };
      }
      // Require at least one non-flag token that looks like a host.
      const tokens = rest.split(/\s+/).filter((t) => !t.startsWith('-'));
      if (tokens.length === 0) {
        return { valid: false, error: 'The nmap command needs a target host.' };
      }
      const hasHost = tokens.some((t) => isHostLike(t));
      if (!hasHost) {
        return { valid: false, error: `"${tokens[tokens.length - 1]}" is not a valid host, IP, CIDR, or range.` };
      }
      return { valid: true };
    }

    // Do not treat a malformed numeric CIDR/range as a URL path. The generic
    // host extractor intentionally removes paths, which would turn
    // `10.0.0.0/33` into the valid-looking host `10.0.0.0`.
    if (/^\d+(?:\.\d+){3}(?:\/\d+)?$/.test(target) || /^\d+(?:\.\d+){3}-\d+$/.test(target)) {
      return isHostLike(target)
        ? { valid: true }
        : { valid: false, error: `"${target}" is not a valid host, IP, CIDR, or range.` };
    }

    // Single token: strip a protocol if present, then host-check.
    const host = extractHost(target) ?? target;
    if (!isHostLike(host)) {
      return { valid: false, error: `"${target}" is not a valid host, IP, CIDR, or range.` };
    }
    return { valid: true };
  }

  // Web scanners: nikto / nuclei / dirbuster
  const host = extractHost(target);
  if (!host) {
    return { valid: false, error: `"${target}" is not a valid URL or host.` };
  }
  if (!isHostLike(host)) {
    return { valid: false, error: `"${host}" is not a valid host, IP, or domain.` };
  }
  return { valid: true };
}
