/**
 * Move Classifier
 * Converts terminal output into Move objects
 */

import type { Move, MoveScope, MoveResult } from './types';

export function classifyMove(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  duration: number,
  currentHost: string
): Move {
  const scope = classifyScope(command, stdout, stderr);
  const result = classifyResult(exitCode, stderr, stdout);
  const target = extractTarget(command, scope);
  const stderrKeywords = extractStderrKeywords(stderr);

  return {
    host: currentHost,
    scope,
    target,
    result,
    timestamp: Date.now(),
    exit_code: exitCode,
    stderr_keywords: stderrKeywords,
    stdout_size: stdout.length,
    duration
  };
}

function classifyScope(command: string, stdout: string, stderr: string): MoveScope {
  const combined = `${command} ${stdout} ${stderr}`.toLowerCase();

  // Filesystem operations
  if (
    /\b(ls|cat|find|grep|read|write|chmod|chown|cp|mv|rm|mkdir|touch|file|stat)\b/.test(combined) ||
    /\/[a-z0-9_\-\/\.]+/.test(command) ||
    combined.includes('permission denied') ||
    combined.includes('no such file')
  ) {
    return 'filesystem';
  }

  // Network operations
  if (
    /\b(curl|wget|nc|nmap|ping|telnet|ssh|ftp|smbclient|rpcclient|ldapsearch|dig|nslookup|host)\b/.test(combined) ||
    /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(command) ||
    /:\d{1,5}/.test(command) ||
    combined.includes('connection') ||
    combined.includes('socket') ||
    combined.includes('port')
  ) {
    return 'network';
  }

  // Auth operations
  if (
    /\b(su|login|auth|password|credential|ticket|token|kinit|kerberos)\b/.test(combined) ||
    combined.includes('authentication') ||
    combined.includes('login failed') ||
    combined.includes('incorrect password')
  ) {
    return 'auth';
  }

  // Privilege operations
  if (
    /\b(sudo|su|pkexec|doas)\b/.test(combined) ||
    combined.includes('root') ||
    combined.includes('privilege') ||
    combined.includes('elevation') ||
    combined.includes('suid')
  ) {
    return 'privilege';
  }

  // Default to execution
  return 'execution';
}

function classifyResult(exitCode: number, stderr: string, stdout: string): MoveResult {
  const stderrLower = stderr.toLowerCase();
  const stdoutLower = stdout.toLowerCase();

  // Clear failures
  if (
    exitCode !== 0 ||
    stderrLower.includes('connection refused') ||
    stderrLower.includes('permission denied') ||
    stderrLower.includes('access denied') ||
    stderrLower.includes('timeout') ||
    stderrLower.includes('not found') ||
    stderrLower.includes('no such file') ||
    stderrLower.includes('failed') ||
    stderrLower.includes('error')
  ) {
    return 'fail';
  }

  // Partial success (warnings but completed)
  if (
    exitCode === 0 &&
    (stderrLower.includes('warning') ||
      stderrLower.includes('filtered') ||
      stdoutLower.includes('partial'))
  ) {
    return 'partial';
  }

  // Success
  return 'success';
}

function extractTarget(command: string, scope: MoveScope): string | undefined {
  switch (scope) {
    case 'filesystem':
      // Extract file paths
      const pathMatch = command.match(/\/[a-z0-9_\-\/\.]+/i);
      return pathMatch ? pathMatch[0] : undefined;

    case 'network':
      // Extract IP or hostname
      const ipMatch = command.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
      if (ipMatch) return ipMatch[0];
      
      // Extract hostname
      const hostMatch = command.match(/(?:@|\/\/)([a-z0-9\-\.]+)/i);
      return hostMatch ? hostMatch[1] : undefined;

    case 'auth':
      // Extract username
      const userMatch = command.match(/(?:user|username|login)[=:\s]+([a-z0-9_\-]+)/i);
      return userMatch ? userMatch[1] : undefined;

    case 'privilege':
      // Extract privilege target
      if (command.includes('sudo')) return 'sudo';
      if (command.includes('su ')) return 'su';
      return 'privilege_escalation';

    default:
      return undefined;
  }
}

function extractStderrKeywords(stderr: string): string[] {
  const keywords: string[] = [];
  const stderrLower = stderr.toLowerCase();

  const patterns = [
    'connection refused',
    'permission denied',
    'access denied',
    'timeout',
    'not found',
    'no such file',
    'failed',
    'error',
    'warning',
    'filtered',
    'blocked',
    'forbidden'
  ];

  for (const pattern of patterns) {
    if (stderrLower.includes(pattern)) {
      keywords.push(pattern);
    }
  }

  return keywords;
}
