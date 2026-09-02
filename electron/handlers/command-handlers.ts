/**
 * Command Execution Handlers
 * Handles generic command execution and system commands
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { BoundedOutput } from '../utils/bounded-output';
import { OutputStreamBatcher } from '../utils/output-stream-batcher';
import { processManager } from '../utils/process-manager';

const MAX_COMMAND_LENGTH = 256 * 1024;
const MAX_ARGUMENTS = 256;
const MAX_ARGUMENT_LENGTH = 64 * 1024;
const COMMAND_TIMEOUT_MS = 2 * 60 * 1000;
const FORCE_KILL_DELAY_MS = 2 * 1000;
const SHELL_OPERATOR_CHARS = new Set([';', '&', '|', '<', '>', '`', '$', '(', ')']);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

// Generic commands are intentionally shell-free. Keep a per-renderer working
// directory so the small GlobalTerminal can still provide normal `cd`/`pwd`
// behavior without giving child processes a shell.
const workingDirectories = new Map<number, string>();
let commandRegistrationSequence = 0;

/**
 * Parse a command into argv without invoking a shell. Quotes and escaped
 * whitespace are preserved as argument boundaries, while shell syntax is
 * rejected instead of being passed on for another layer to interpret.
 */
export function tokenizeShellFreeCommand(input: unknown): { args?: string[]; error?: string } {
  if (typeof input !== 'string') {
    return { error: 'Command must be a string' };
  }
  if (!input.trim()) {
    return { error: 'Empty command' };
  }
  if (input.length > MAX_COMMAND_LENGTH) {
    return { error: 'Command too large' };
  }
  if (CONTROL_CHARACTERS.test(input)) {
    return { error: 'Command contains control characters' };
  }

  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;

  const append = (value: string): boolean => {
    current += value;
    tokenStarted = true;
    return current.length <= MAX_ARGUMENT_LENGTH;
  };

  const pushCurrent = (): string | null => {
    if (!tokenStarted) return null;
    if (args.length >= MAX_ARGUMENTS) return 'Too many command arguments';
    args.push(current);
    current = '';
    tokenStarted = false;
    return null;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quote) {
      if (character === quote) {
        quote = null;
        tokenStarted = true;
        continue;
      }
      if (character === '\\') {
        const next = input[index + 1];
        if (next === undefined) {
          return { error: 'Trailing escape in command' };
        }
        if (next === quote || next === '\\' || /\s/.test(next)) {
          if (!append(next)) return { error: 'Command argument too large' };
          index += 1;
        } else if (!append('\\')) {
          return { error: 'Command argument too large' };
        }
        continue;
      }
      if (!append(character)) {
        return { error: 'Command argument too large' };
      }
      continue;
    }

    if (/\s/.test(character)) {
      const error = pushCurrent();
      if (error) return { error };
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (character === '\\') {
      const next = input[index + 1];
      if (next === undefined) {
        return { error: 'Trailing escape in command' };
      }
      if (SHELL_OPERATOR_CHARS.has(next)) {
        return { error: 'Shell operators are not allowed' };
      }
      if (next === '\\' || next === '"' || next === "'" || /\s/.test(next)) {
        if (!append(next)) return { error: 'Command argument too large' };
        index += 1;
      } else if (!append('\\')) {
        return { error: 'Command argument too large' };
      }
      continue;
    }
    if (SHELL_OPERATOR_CHARS.has(character)) {
      return { error: 'Shell operators are not allowed' };
    }
    if (!append(character)) {
      return { error: 'Command argument too large' };
    }
  }

  if (quote) {
    return { error: 'Unclosed quote in command' };
  }
  const error = pushCurrent();
  if (error) return { error };
  return args.length > 0 ? { args } : { error: 'Invalid command' };
}

function getSenderId(event: any): number {
  const senderId = Number(event?.sender?.id);
  return Number.isSafeInteger(senderId) ? senderId : 0;
}

function getDefaultWorkingDirectory(): string {
  return process.platform === 'win32'
    ? process.env.USERPROFILE || homedir() || process.cwd()
    : process.env.HOME || homedir() || process.cwd();
}

async function handleWorkingDirectoryCommand(
  args: string[],
  senderId: number,
): Promise<Record<string, unknown> | null> {
  const operation = args[0]?.toLowerCase();
  if (operation !== 'cd' && operation !== 'pwd') return null;

  const current = workingDirectories.get(senderId) || getDefaultWorkingDirectory();
  if (operation === 'pwd') {
    if (args.length !== 1) {
      return { success: false, error: 'pwd does not accept arguments', output: '', exitCode: 2 };
    }
    return { success: true, output: `${current}\n`, exitCode: 0 };
  }

  let targetIndex = 1;
  if (process.platform === 'win32' && args[1]?.toLowerCase() === '/d') {
    targetIndex = 2;
  }
  if (args.length > targetIndex + 1) {
    return { success: false, error: 'cd accepts one directory argument', output: '', exitCode: 2 };
  }

  const requested = args[targetIndex] || (process.platform === 'win32' ? process.env.USERPROFILE || homedir() : homedir());
  const expanded = requested === '~'
    ? getDefaultWorkingDirectory()
    : requested.startsWith('~/')
      ? path.join(getDefaultWorkingDirectory(), requested.slice(2))
      : requested;
  const resolved = path.resolve(current, expanded);

  try {
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      return { success: false, error: `Not a directory: ${resolved}`, output: '', exitCode: 1 };
    }
  } catch {
    return { success: false, error: `Directory not found: ${resolved}`, output: '', exitCode: 1 };
  }

  workingDirectories.set(senderId, resolved);
  return { success: true, output: `${resolved}\n`, exitCode: 0 };
}

export function registerCommandHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void,
  getMainWindow: () => any
) {
  // Execute a terminal command without a shell. Built-in cd/pwd commands are
  // handled in-process so the renderer retains a useful persistent cwd.
  registerIPCHandler('execute-command', async (event, command: string) => {
    const parsed = tokenizeShellFreeCommand(command);
    if (!parsed.args) {
      return { success: false, error: parsed.error || 'Invalid command' };
    }

    const senderId = getSenderId(event);
    const builtinResult = await handleWorkingDirectoryCommand(parsed.args, senderId);
    if (builtinResult) return builtinResult;

    const args = parsed.args;
    const cwd = workingDirectories.get(senderId) || getDefaultWorkingDirectory();
    const registrationId = `ipc-command-${senderId}-${++commandRegistrationSequence}`;

    return new Promise((resolve) => {
      const output = new BoundedOutput();
      const errorOutput = new BoundedOutput(2 * 1024 * 1024);
      const outputBatcher = new OutputStreamBatcher((data, type) => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.webContents.send('command-output', { data, type });
          } catch (error) {
            console.error('[Command] Output send error:', error);
          }
        }
      });

      let cmdProcess: ReturnType<typeof spawn> | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;
      let forceKillHandle: NodeJS.Timeout | null = null;
      let settled = false;
      let timedOut = false;
      let processRegistered = false;

      const unregisterProcess = () => {
        if (!processRegistered) return;
        processRegistered = false;
        processManagerUnregister(registrationId, cmdProcess);
      };

      const finish = (result: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (forceKillHandle) clearTimeout(forceKillHandle);
        outputBatcher.dispose();
        resolve(result);
      };

      const terminateOnTimeout = () => {
        if (settled) return;
        timedOut = true;
        try {
          cmdProcess?.kill('SIGTERM');
        } catch {
          // The process may have exited between the timeout and kill call.
        }
        forceKillHandle = setTimeout(() => {
          if (settled) return;
          try {
            cmdProcess?.kill('SIGKILL');
          } catch {
            // The process may already be gone.
          }
          unregisterProcess();
          finish({
            success: false,
            output: output.toString(),
            error: 'Command timed out',
            exitCode: null,
          });
        }, FORCE_KILL_DELAY_MS);
      };

      try {
        cmdProcess = spawn(args[0], args.slice(1), {
          shell: false,
          windowsHide: true,
          cwd,
        });
        processManagerRegister(registrationId, cmdProcess);
        processRegistered = true;
      } catch (error: any) {
        finish({ success: false, error: error?.message || 'Failed to start command' });
        return;
      }

      timeoutHandle = setTimeout(terminateOnTimeout, COMMAND_TIMEOUT_MS);

      cmdProcess.stdout?.on('data', (data) => {
        if (settled) return;
        const text = data.toString();
        output.append(text);
        outputBatcher.push(text, 'stdout');
      });

      cmdProcess.stderr?.on('data', (data) => {
        if (settled) return;
        const text = data.toString();
        errorOutput.append(text);
        outputBatcher.push(text, 'stderr');
      });

      cmdProcess.on('close', (code, signal) => {
        unregisterProcess();
        const stderr = errorOutput.toString();
        finish({
          success: !timedOut && code === 0,
          output: output.toString(),
          error: timedOut
            ? 'Command timed out'
            : (code === 0 ? undefined : stderr || (signal ? `Command terminated by ${signal}` : 'Command failed')),
          exitCode: code,
        });
      });

      cmdProcess.on('error', (error: any) => {
        unregisterProcess();
        finish({
          success: false,
          error: timedOut ? 'Command timed out' : error.message,
        });
      });
    });
  });

  // IPC health ping for monitoring
  registerIPCHandler('ipc-health-ping', () => {
    return { success: true, timestamp: Date.now() };
  });
}

// Keep process-manager coupling local to this module so command registration
// remains testable and app shutdown can terminate generic commands too.
function processManagerRegister(id: string, child: ReturnType<typeof spawn>): void {
  processManager.register(id, child, 'regular');
}
function processManagerUnregister(id: string, child?: ReturnType<typeof spawn> | null): void {
  processManager.unregister(id, child || undefined);
}
