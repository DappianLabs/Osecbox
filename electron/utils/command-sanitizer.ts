/**
 * Command Sanitization Utilities
 * Prevents command injection attacks
 */

/**
 * Sanitize a single command argument
 * Removes or escapes dangerous characters
 */
export function sanitizeArg(arg: string): string {
  if (typeof arg !== 'string') {
    throw new Error('Argument must be a string');
  }
  
  // Remove null bytes
  arg = arg.replace(/\0/g, '');
  
  // For Windows, escape special characters
  if (process.platform === 'win32') {
    // Escape: & | < > ^ " %
    arg = arg.replace(/[&|<>^"%]/g, '^$&');
  } else {
    // For Unix, we'll use array args with spawn (no shell)
    // Just remove dangerous characters
    arg = arg.replace(/[;&|`$()]/g, '');
  }
  
  return arg;
}

/**
 * Sanitize an array of command arguments
 */
export function sanitizeArgs(args: string[]): string[] {
  return args.map(arg => sanitizeArg(arg));
}

/**
 * Validate that a path doesn't contain directory traversal
 */
export function validatePath(path: string): boolean {
  // Check for directory traversal attempts
  if (path.includes('..')) {
    return false;
  }
  
  // Check for absolute paths (should be relative)
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  
  return true;
}

/**
 * Sanitize a tool name (only allow alphanumeric, dash, underscore)
 */
export function sanitizeToolName(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Validate IP address format
 */
export function validateIP(ip: string): boolean {
  // IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }
  
  // IPv6 (basic check)
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){7}[0-9a-fA-F]{0,4}$/;
  return ipv6Regex.test(ip);
}

/**
 * Validate domain name format
 */
export function validateDomain(domain: string): boolean {
  // Basic domain validation
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain) && domain.length <= 253;
}

/**
 * Validate port number
 */
export function validatePort(port: number | string): boolean {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * Sanitize environment variables
 * Remove dangerous env vars that could be used for injection
 */
export function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const dangerous = ['LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES'];
  const sanitized = { ...env };
  
  dangerous.forEach(key => {
    delete sanitized[key];
  });
  
  return sanitized;
}
