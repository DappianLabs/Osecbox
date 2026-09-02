/**
 * IPC Origin Validator
 * Provides CSRF protection for IPC handlers
 */

import { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { logSecurityEvent } from './security-logger';

/**
 * Validate that IPC call comes from the legitimate main renderer frame.
 * Prevents embedded or malicious websites from triggering IPC calls.
 */
export function validateIPCOrigin(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  try {
    const senderFrame = event?.senderFrame;
    const mainFrame = senderFrame?.top;

    // IPC from a subframe, or from an event without a frame, is not trusted.
    if (!senderFrame || !mainFrame || senderFrame !== mainFrame) {
      logSecurityEvent.suspiciousActivity('IPC call from an invalid renderer frame', {
        senderId: event?.sender?.id,
      });
      return false;
    }

    const url = mainFrame.url;
    const parsedUrl = new URL(url);
    const isAppFile = parsedUrl.protocol === 'file:' &&
      (parsedUrl.hostname === '' || parsedUrl.hostname === 'localhost');
    const isDevOrigin = parsedUrl.origin === 'http://localhost:5002' ||
      parsedUrl.origin === 'http://127.0.0.1:5002';
    const isValid = isAppFile || isDevOrigin;

    if (!isValid) {
      logSecurityEvent.suspiciousActivity('IPC call from unauthorized origin', {
        url,
        senderId: event.sender.id,
      });
    }

    return isValid;
  } catch (error) {
    console.error('[IPC Validator] Error validating origin:', error);
    return false;
  }
}

/**
 * Validate payload size to prevent memory exhaustion
 */
export function validatePayloadSize(data: any, maxSize: number = 10 * 1024 * 1024): boolean {
  try {
    const serialized = JSON.stringify(data);
    if (serialized === undefined) {
      return false;
    }

    const size = Buffer.byteLength(serialized, 'utf8');
    if (size > maxSize) {
      logSecurityEvent.invalidInput('payload', data, `Size ${size} exceeds limit ${maxSize}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[IPC Validator] Error validating payload size:', error);
    return false;
  }
}

/**
 * Sanitize session ID to prevent path traversal
 */
export function sanitizeSessionId(sessionId: string): string | null {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (sanitized !== sessionId || sanitized.length === 0) {
    logSecurityEvent.invalidInput('sessionId', sessionId, 'Contains invalid characters');
    return null;
  }
  return sanitized;
}

/**
 * Validate domain format
 */
export function validateDomain(domain: string): boolean {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!domainRegex.test(domain)) {
    logSecurityEvent.invalidInput('domain', domain, 'Invalid domain format');
    return false;
  }
  return true;
}

/**
 * Validate file path to prevent directory traversal
 */
export function validateFilePath(filePath: string, allowedDir: string): boolean {
  const path = require('path');
  const resolvedPath = path.resolve(filePath);
  const resolvedAllowedDir = path.resolve(allowedDir);
  const relativePath = path.relative(resolvedAllowedDir, resolvedPath);
  const escapesAllowedDir = relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);

  if (escapesAllowedDir) {
    logSecurityEvent.pathTraversal(filePath, 'file access');
    return false;
  }

  return true;
}
