/**
 * Error Handler - Centralized error handling for terminal system
 */

import { logger } from '@/lib/utils/logger';

export enum TerminalErrorType {
  PTY_CREATION_FAILED = 'PTY_CREATION_FAILED',
  TERMINAL_CREATION_FAILED = 'TERMINAL_CREATION_FAILED',
  IPC_COMMUNICATION_FAILED = 'IPC_COMMUNICATION_FAILED',
  BUFFER_OVERFLOW = 'BUFFER_OVERFLOW',
  MEMORY_PRESSURE = 'MEMORY_PRESSURE',
  ATTACH_FAILED = 'ATTACH_FAILED',
  RESIZE_FAILED = 'RESIZE_FAILED',
  SCROLL_FAILED = 'SCROLL_FAILED',
}

export interface TerminalError {
  type: TerminalErrorType;
  message: string;
  context: Record<string, any>;
  timestamp: number;
  recoverable: boolean;
}

export class TerminalErrorHandler {
  private errorHistory: TerminalError[] = [];
  private readonly MAX_ERROR_HISTORY = 100;

  handleError(
    type: TerminalErrorType,
    message: string,
    context: Record<string, any> = {},
    error?: Error
  ): TerminalError {
    const terminalError: TerminalError = {
      type,
      message,
      context,
      timestamp: Date.now(),
      recoverable: this.isRecoverable(type),
    };

    this.errorHistory.push(terminalError);
    
    // Trim history if too long
    if (this.errorHistory.length > this.MAX_ERROR_HISTORY) {
      this.errorHistory = this.errorHistory.slice(-this.MAX_ERROR_HISTORY);
    }

    // Log based on severity
    if (this.isCritical(type)) {
      logger.error('TerminalErrorHandler', `CRITICAL: ${message}`, {
        type,
        context,
        originalError: error?.message,
        stack: error?.stack,
      });
    } else if (terminalError.recoverable) {
      logger.warn('TerminalErrorHandler', `RECOVERABLE: ${message}`, {
        type,
        context,
        originalError: error?.message,
      });
    } else {
      logger.error('TerminalErrorHandler', `ERROR: ${message}`, {
        type,
        context,
        originalError: error?.message,
      });
    }

    return terminalError;
  }

  private isRecoverable(type: TerminalErrorType): boolean {
    switch (type) {
      case TerminalErrorType.RESIZE_FAILED:
      case TerminalErrorType.SCROLL_FAILED:
      case TerminalErrorType.IPC_COMMUNICATION_FAILED:
        return true;
      
      case TerminalErrorType.PTY_CREATION_FAILED:
      case TerminalErrorType.TERMINAL_CREATION_FAILED:
      case TerminalErrorType.BUFFER_OVERFLOW:
      case TerminalErrorType.MEMORY_PRESSURE:
      case TerminalErrorType.ATTACH_FAILED:
        return false;
      
      default:
        return false;
    }
  }

  private isCritical(type: TerminalErrorType): boolean {
    switch (type) {
      case TerminalErrorType.BUFFER_OVERFLOW:
      case TerminalErrorType.MEMORY_PRESSURE:
        return true;
      
      default:
        return false;
    }
  }

  getRecentErrors(count: number = 10): TerminalError[] {
    return this.errorHistory.slice(-count);
  }

  getCriticalErrors(): TerminalError[] {
    return this.errorHistory.filter(error => this.isCritical(error.type));
  }

  getErrorsByType(type: TerminalErrorType): TerminalError[] {
    return this.errorHistory.filter(error => error.type === type);
  }

  clearErrorHistory(): void {
    this.errorHistory = [];
    logger.info('TerminalErrorHandler', 'Error history cleared');
  }

  getErrorStats() {
    const errorCounts = new Map<TerminalErrorType, number>();
    
    this.errorHistory.forEach(error => {
      const count = errorCounts.get(error.type) || 0;
      errorCounts.set(error.type, count + 1);
    });

    return {
      totalErrors: this.errorHistory.length,
      criticalErrors: this.getCriticalErrors().length,
      recoverableErrors: this.errorHistory.filter(e => e.recoverable).length,
      errorsByType: Object.fromEntries(errorCounts),
      recentErrors: this.getRecentErrors(5),
    };
  }

  formatErrorReport(): string {
    const stats = this.getErrorStats();
    
    let report = `Terminal Error Report:\n`;
    report += `- Total Errors: ${stats.totalErrors}\n`;
    report += `- Critical Errors: ${stats.criticalErrors}\n`;
    report += `- Recoverable Errors: ${stats.recoverableErrors}\n`;
    
    if (Object.keys(stats.errorsByType).length > 0) {
      report += `\nError Breakdown:\n`;
      Object.entries(stats.errorsByType).forEach(([type, count]) => {
        report += `- ${type}: ${count}\n`;
      });
    }
    
    if (stats.recentErrors.length > 0) {
      report += `\nRecent Errors:\n`;
      stats.recentErrors.forEach(error => {
        const time = new Date(error.timestamp).toLocaleTimeString();
        report += `- [${time}] ${error.type}: ${error.message}\n`;
      });
    }
    
    return report;
  }
}