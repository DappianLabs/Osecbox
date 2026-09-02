/**
 * Structured Logger with Sanitization
 * Replaces console.log with proper logging
 */

import path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_FILES = 5;

// Ensure log directory exists
fs.promises.mkdir(LOG_DIR, { recursive: true }).catch(() => {});

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

class Logger {
  private logFile: string;
  private errorFile: string;
  private currentLogSize: number = 0;
  
  constructor() {
    this.logFile = path.join(LOG_DIR, 'combined.log');
    this.errorFile = path.join(LOG_DIR, 'error.log');
    
    // Get current log size (async init)
    this.initLogSize();
  }
  
  private async initLogSize(): Promise<void> {
    try {
      const stats = await fs.promises.stat(this.logFile);
      this.currentLogSize = stats.size;
    } catch {
      this.currentLogSize = 0;
    }
  }
  
  /**
   * Sanitize sensitive data from logs
   */
  private sanitize(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }
    
    const sensitive = ['apikey', 'password', 'token', 'secret', 'key', 'auth'];
    const sanitized: any = Array.isArray(data) ? [] : {};
    
    for (const key in data) {
      const lowerKey = key.toLowerCase();
      
      if (sensitive.some(s => lowerKey.includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof data[key] === 'object' && data[key] !== null) {
        sanitized[key] = this.sanitize(data[key]);
      } else {
        sanitized[key] = data[key];
      }
    }
    
    return sanitized;
  }
  
  /**
   * Rotate log files if needed
   */
  private async rotateIfNeeded(): Promise<void> {
    if (this.currentLogSize < MAX_LOG_SIZE) return;
    
    try {
      // Rotate old logs
      for (let i = MAX_LOG_FILES - 1; i > 0; i--) {
        const oldFile = path.join(LOG_DIR, `combined.${i}.log`);
        const newFile = path.join(LOG_DIR, `combined.${i + 1}.log`);
        
        try {
          await fs.promises.access(oldFile);
          if (i === MAX_LOG_FILES - 1) {
            await fs.promises.unlink(oldFile); // Delete oldest
          } else {
            await fs.promises.rename(oldFile, newFile);
          }
        } catch {}
      }
      
      // Rotate current log
      const backupFile = path.join(LOG_DIR, 'combined.1.log');
      try {
        await fs.promises.access(this.logFile);
        await fs.promises.rename(this.logFile, backupFile);
      } catch {}
      
      this.currentLogSize = 0;
    } catch (error) {
      console.error('[Logger] Rotation failed:', error);
    }
  }
  
  /**
   * Write log entry
   */
  private write(level: LogLevel, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data ? this.sanitize(data) : undefined
    };
    
    const line = JSON.stringify(entry) + '\n';
    
    // Rotate if needed
    this.rotateIfNeeded();
    
    // Write to combined log
    try {
      fs.appendFileSync(this.logFile, line);
      this.currentLogSize += line.length;
      
      // Also write errors to error log
      if (level === 'error') {
        fs.appendFileSync(this.errorFile, line);
      }
    } catch (error) {
      console.error('[Logger] Write failed:', error);
    }
    
    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      const color = {
        debug: '\x1b[36m', // cyan
        info: '\x1b[32m',  // green
        warn: '\x1b[33m',  // yellow
        error: '\x1b[31m'  // red
      }[level];
      
      console.log(`${color}[${level.toUpperCase()}]\x1b[0m ${message}`, data || '');
    }
  }
  
  debug(message: string, data?: any): void {
    this.write('debug', message, data);
  }
  
  info(message: string, data?: any): void {
    this.write('info', message, data);
  }
  
  warn(message: string, data?: any): void {
    this.write('warn', message, data);
  }
  
  error(message: string, data?: any): void {
    this.write('error', message, data);
  }
}

// Singleton instance
export const logger = new Logger();

/**
 * Replace console methods with logger
 */
export function replaceConsole(): void {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  console.log = (...args: any[]) => {
    logger.info(args.map(a => String(a)).join(' '));
    if (process.env.NODE_ENV === 'development') {
      originalLog(...args);
    }
  };
  
  console.error = (...args: any[]) => {
    logger.error(args.map(a => String(a)).join(' '));
    if (process.env.NODE_ENV === 'development') {
      originalError(...args);
    }
  };
  
  console.warn = (...args: any[]) => {
    logger.warn(args.map(a => String(a)).join(' '));
    if (process.env.NODE_ENV === 'development') {
      originalWarn(...args);
    }
  };
}
