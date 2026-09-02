/**
 * SECURITY: Comprehensive input validation utilities
 * Prevents command injection, path traversal, and other attacks
 */

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate IP address (IPv4 or IPv6)
 */
export function validateIP(ip: string): boolean {
  // IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255);
  }
  
  // IPv6 (simplified)
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){7}[0-9a-fA-F]{0,4}$/;
  return ipv6Regex.test(ip);
}

/**
 * Validate CIDR notation
 */
export function validateCIDR(cidr: string): boolean {
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;
  
  const [ip, mask] = parts;
  if (!validateIP(ip)) return false;
  
  const maskNum = parseInt(mask);
  return maskNum >= 0 && maskNum <= 32;
}

/**
 * Validate hostname/domain
 */
export function validateHostname(hostname: string): boolean {
  if (hostname.length > 253) return false;
  
  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return hostnameRegex.test(hostname);
}

/**
 * Validate target (IP, CIDR, range, or hostname)
 */
export function validateTarget(target: string): { valid: boolean; error?: string } {
  if (!target || typeof target !== 'string') {
    return { valid: false, error: 'Target is required' };
  }
  
  // Check for shell metacharacters
  if (/[;&|`$(){}[\]<>\\'"!]/.test(target)) {
    return { valid: false, error: 'Target contains invalid characters' };
  }
  
  // IP address
  if (validateIP(target)) {
    return { valid: true };
  }
  
  // CIDR notation
  if (validateCIDR(target)) {
    return { valid: true };
  }
  
  // IP range (e.g., 192.168.1.1-254)
  const rangeRegex = /^(\d{1,3}\.){3}\d{1,3}-\d{1,3}$/;
  if (rangeRegex.test(target)) {
    const [baseIP, endOctet] = target.split('-');
    if (validateIP(baseIP)) {
      const end = parseInt(endOctet);
      if (end >= 0 && end <= 255) {
        return { valid: true };
      }
    }
  }
  
  // Hostname
  if (validateHostname(target)) {
    return { valid: true };
  }
  
  return { valid: false, error: 'Invalid target format' };
}

/**
 * Validate port number
 */
export function validatePort(port: number | string): { valid: boolean; error?: string } {
  const portNum = typeof port === 'string' ? parseInt(port) : port;
  
  if (isNaN(portNum)) {
    return { valid: false, error: 'Port must be a number' };
  }
  
  if (portNum < 1 || portNum > 65535) {
    return { valid: false, error: 'Port must be between 1 and 65535' };
  }
  
  return { valid: true };
}

/**
 * Validate Metasploit option name
 */
export function validateMsfOptionName(name: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Option name is required' };
  }
  
  // Only allow alphanumeric and underscore
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return { valid: false, error: 'Invalid option name format' };
  }
  
  return { valid: true };
}

/**
 * Validate Metasploit option value
 */
export function validateMsfOptionValue(name: string, value: string): { valid: boolean; sanitized: string; error?: string } {
  if (value === null || value === undefined) {
    return { valid: false, sanitized: '', error: 'Option value is required' };
  }
  
  const valueStr = String(value);
  
  // Check for dangerous characters
  const dangerous = /[;&|`$(){}[\]<>'"\\!]/;
  if (dangerous.test(valueStr)) {
    return { valid: false, sanitized: '', error: 'Option value contains dangerous characters' };
  }
  
  // Validate specific option types
  const nameLower = name.toLowerCase();
  
  // Host validation
  if (nameLower === 'rhosts' || nameLower === 'rhost' || nameLower === 'lhost') {
    const targetValidation = validateTarget(valueStr);
    if (!targetValidation.valid) {
      return { valid: false, sanitized: '', error: `Invalid host: ${targetValidation.error}` };
    }
  }
  
  // Port validation
  if (nameLower === 'rport' || nameLower === 'lport') {
    const portValidation = validatePort(valueStr);
    if (!portValidation.valid) {
      return { valid: false, sanitized: '', error: portValidation.error };
    }
  }
  
  // Payload validation (must be a valid module path)
  if (nameLower === 'payload') {
    if (!/^[a-zA-Z0-9_/]+$/.test(valueStr)) {
      return { valid: false, sanitized: '', error: 'Invalid payload format' };
    }
  }
  
  // URIPATH validation
  if (nameLower === 'uripath') {
    if (!/^\/[a-zA-Z0-9_/-]*$/.test(valueStr)) {
      return { valid: false, sanitized: '', error: 'Invalid URI path format' };
    }
  }
  
  // Escape single quotes and wrap in single quotes for shell safety
  const sanitized = valueStr.replace(/'/g, "'\"'\"'");
  return { valid: true, sanitized: `'${sanitized}'` };
}

/**
 * Validate file path (prevent path traversal)
 */
export function validateFilePath(filePath: string): { valid: boolean; error?: string } {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'File path is required' };
  }
  
  // Check for path traversal attempts
  if (filePath.includes('..') || filePath.includes('~')) {
    return { valid: false, error: 'Path traversal not allowed' };
  }
  
  // Check for dangerous characters
  if (/[;&|`$(){}[\]<>'"!]/.test(filePath)) {
    return { valid: false, error: 'File path contains invalid characters' };
  }
  
  return { valid: true };
}

/**
 * Validate command name (for tool execution)
 */
export function validateCommandName(command: string): { valid: boolean; error?: string } {
  if (!command || typeof command !== 'string') {
    return { valid: false, error: 'Command name is required' };
  }
  
  // Only allow alphanumeric, dash, underscore, dot, and forward slash
  if (!/^[a-zA-Z0-9._/-]+$/.test(command)) {
    return { valid: false, error: 'Invalid command name format' };
  }
  
  return { valid: true };
}

/**
 * Sanitize shell argument (escape for bash/sh)
 */
export function sanitizeShellArg(arg: string): string {
  // If no special chars, return as-is
  if (!/[\s"'<>\\!|&;(){}[\]*?~$]/.test(arg)) {
    return arg;
  }
  
  // Escape single quotes and wrap in single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Validate nmap flags (whitelist approach)
 */
export function validateNmapFlags(flags: string[]): { valid: boolean; error?: string } {
  const allowedFlags = [
    '-sS', '-sT', '-sU', '-sY', '-sn', '-sA', '-sW', '-sM', '-sF', '-sN', '-sX',
    '-p', '-F', '-T0', '-T1', '-T2', '-T3', '-T4', '-T5',
    '-sV', '-O', '-A', '-sC', '--traceroute', '--version-intensity', '--version-light', '--version-all',
    '--script', '--min-rate', '--max-rate', '--host-timeout', '--top-ports', '--exclude-ports', '--exclude',
    '-f', '-D', '-S', '--spoof-mac', '--data-length', '--randomize-hosts', '--badsum', '--mtu',
    '-oN', '-oX', '-oG', '-oA', '--append-output', '-v', '-vv', '-d', '--reason', '--open',
    '--packet-trace', '--iflist', '--log-errors', '--stats-every', '-6', '-n', '-R', '--system-dns',
    '--dns-servers', '-Pn', '-PS', '-PA', '-PU', '-PY', '-PE', '-PP', '-PM', '-PO', '-PR', '--disable-arp-ping'
  ];
  
  for (const flag of flags) {
    // Check for shell metacharacters
    if (/[;&|`$(){}[\]<>\\'"!]/.test(flag)) {
      return { valid: false, error: `Flag contains dangerous characters: ${flag}` };
    }
    
    // Check if flag is in whitelist
    const isAllowed = allowedFlags.some(allowed => {
      if (allowed.includes('=')) {
        return flag.startsWith(allowed.split('=')[0]);
      }
      return flag.startsWith(allowed) || flag === allowed;
    });
    
    if (!isAllowed) {
      return { valid: false, error: `Flag not allowed: ${flag}` };
    }
  }
  
  return { valid: true };
}
