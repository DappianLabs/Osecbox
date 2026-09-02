/**
 * Security Event Logger
 * Logs security-sensitive operations for audit trail
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const SECURITY_LOG = path.join(LOG_DIR, 'security.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

// Ensure log directory exists
async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (error) {
    console.error('[SecurityLogger] Failed to create log directory:', error);
  }
}

// Initialize log directory before any queued write can flush. Individual writes
// still await this promise so startup races cannot create a partial log.
const logDirReady = ensureLogDir();

export enum SecurityEventType {
  COMMAND_EXECUTION = 'COMMAND_EXECUTION',
  COMMAND_BLOCKED = 'COMMAND_BLOCKED',
  PATH_TRAVERSAL_ATTEMPT = 'PATH_TRAVERSAL_ATTEMPT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INVALID_INPUT = 'INVALID_INPUT',
  SESSION_OPERATION = 'SESSION_OPERATION',
  SETTINGS_CHANGE = 'SETTINGS_CHANGE',
  FILE_OPERATION = 'FILE_OPERATION',
  AUTH_FAILURE = 'AUTH_FAILURE',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
}

export interface SecurityEvent {
  timestamp: string;
  type: SecurityEventType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  details?: Record<string, any>;
  userId?: string;
  ipAddress?: string;
}

class SecurityLogger {
  private logQueue: string[] = [];
  private flushPromise: Promise<boolean> | null = null;

  /**
   * Log a security event
   */
  async log(event: Omit<SecurityEvent, 'timestamp'>): Promise<void> {
    const fullEvent: SecurityEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    const logLine = JSON.stringify(fullEvent) + '\n';
    
    // Console output for immediate visibility
    const severityColor = {
      LOW: '\x1b[32m',      // Green
      MEDIUM: '\x1b[33m',   // Yellow
      HIGH: '\x1b[31m',     // Red
      CRITICAL: '\x1b[35m', // Magenta
    }[event.severity];
    
    console.log(
      `${severityColor}[SECURITY:${event.severity}]\x1b[0m ${event.type}: ${event.message}`,
      event.details ? event.details : ''
    );

    // Add to queue
    this.logQueue.push(logLine);

    // Flush if queue is large
    if (this.logQueue.length >= 10) {
      await this.flush();
    }
  }

  /**
   * Flush log queue to disk. Only one write is active at a time; callers that
   * arrive while a write is active await that same promise.
   */
  private async flush(): Promise<boolean> {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    const pendingFlush = this.writeQueue();
    this.flushPromise = pendingFlush;

    try {
      return await pendingFlush;
    } finally {
      if (this.flushPromise === pendingFlush) {
        this.flushPromise = null;
      }
    }
  }

  private async writeQueue(): Promise<boolean> {
    await logDirReady;

    while (this.logQueue.length > 0) {
      const toWrite = this.logQueue.splice(0, this.logQueue.length);

      try {
        // Check log size and rotate if needed
        await this.rotateIfNeeded();

        // Append to log file
        await fs.appendFile(SECURITY_LOG, toWrite.join(''), 'utf-8');
      } catch (error) {
        console.error('[SecurityLogger] Failed to write logs:', error);
        // Put logs back in queue ahead of records added during this write.
        this.logQueue.unshift(...toWrite);
        return false;
      }
    }

    return true;
  }

  /**
   * Rotate log file if it exceeds max size
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await fs.stat(SECURITY_LOG);
      if (stats.size >= MAX_LOG_SIZE) {
        const rotatedLog = path.join(
          LOG_DIR,
          `security-${Date.now()}.log`
        );
        await fs.rename(SECURITY_LOG, rotatedLog);
        console.log(`[SecurityLogger] Rotated log to ${rotatedLog}`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('[SecurityLogger] Failed to rotate log:', error);
      }
    }
  }

  /**
   * Force flush on app exit
   */
  async shutdown(): Promise<void> {
    await logDirReady;
    while (this.flushPromise || this.logQueue.length > 0) {
      const drained = await this.flush();
      if (!drained) {
        // Keep failed records queued for a later attempt rather than dropping
        // them or spinning forever during application shutdown.
        return;
      }
    }
  }
}

// Singleton instance
export const securityLogger = new SecurityLogger();

// Helper functions for common security events
export const logSecurityEvent = {
  commandExecution: (command: string, success: boolean) => {
    securityLogger.log({
      type: SecurityEventType.COMMAND_EXECUTION,
      severity: 'MEDIUM',
      message: `Command executed: ${command}`,
      details: { command, success },
    });
  },

  commandBlocked: (command: string, reason: string) => {
    securityLogger.log({
      type: SecurityEventType.COMMAND_BLOCKED,
      severity: 'HIGH',
      message: `Command blocked: ${command}`,
      details: { command, reason },
    });
  },

  pathTraversal: (path: string, operation: string) => {
    securityLogger.log({
      type: SecurityEventType.PATH_TRAVERSAL_ATTEMPT,
      severity: 'CRITICAL',
      message: `Path traversal attempt detected`,
      details: { path, operation },
    });
  },

  rateLimitExceeded: (endpoint: string, identifier: string) => {
    securityLogger.log({
      type: SecurityEventType.RATE_LIMIT_EXCEEDED,
      severity: 'MEDIUM',
      message: `Rate limit exceeded for ${endpoint}`,
      details: { endpoint, identifier },
    });
  },

  invalidInput: (field: string, value: any, reason: string) => {
    securityLogger.log({
      type: SecurityEventType.INVALID_INPUT,
      severity: 'MEDIUM',
      message: `Invalid input detected: ${field}`,
      details: { field, value: String(value).substring(0, 100), reason },
    });
  },

  sessionOperation: (operation: string, sessionId: string, success: boolean) => {
    securityLogger.log({
      type: SecurityEventType.SESSION_OPERATION,
      severity: 'LOW',
      message: `Session ${operation}: ${sessionId}`,
      details: { operation, sessionId, success },
    });
  },

  settingsChange: (key: string, success: boolean) => {
    securityLogger.log({
      type: SecurityEventType.SETTINGS_CHANGE,
      severity: 'LOW',
      message: `Settings changed: ${key}`,
      details: { key, success },
    });
  },

  suspiciousActivity: (description: string, details?: Record<string, any>) => {
    securityLogger.log({
      type: SecurityEventType.SUSPICIOUS_ACTIVITY,
      severity: 'HIGH',
      message: description,
      details,
    });
  },
};
