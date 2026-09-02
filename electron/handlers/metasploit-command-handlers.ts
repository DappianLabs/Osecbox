/**
 * Metasploit command handlers
 * Handles one-off msfconsole commands (non-persistent)
 * 
 * These handlers spawn new msfconsole processes for each command.
 * For interactive sessions, use msf-console-* handlers instead.
 */

import { toolExecutionService } from '../services/tool-execution-service';
import {
  parseMsfSearchOutput,
  parseMsfOptions,
  parseMsfPayloads,
  parseMsfSessions,
  parseMsfHandlers,
} from '../utils/parsing';

// Validation helper to prevent command injection
function validateMetasploitOption(key: string, value: string): { 
  isValid: boolean; 
  sanitized: string; 
  error?: string 
} {
  // Validate key (option name)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return { isValid: false, sanitized: '', error: `Invalid option name: ${key}` };
  }
  
  // Sanitize value - remove dangerous characters
  const dangerous = /[;&|`$(){}[\]<>'"\\]/;
  if (dangerous.test(value)) {
    return { isValid: false, sanitized: '', error: `Option value contains dangerous characters: ${value}` };
  }
  
  // Additional validation for common options
  if (key.toLowerCase() === 'rhosts' || key.toLowerCase() === 'rhost') {
    // Validate IP addresses/hostnames
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[a-zA-Z0-9.-]+$/;
    if (!ipPattern.test(value)) {
      return { isValid: false, sanitized: '', error: `Invalid host format: ${value}` };
    }
  }
  
  if (key.toLowerCase() === 'rport' || key.toLowerCase() === 'lport') {
    // Validate port numbers
    const port = parseInt(value);
    if (isNaN(port) || port < 1 || port > 65535) {
      return { isValid: false, sanitized: '', error: `Invalid port number: ${value}` };
    }
  }
  
  return { isValid: true, sanitized: value };
}

let commandSequence = 0;

// Single helper to execute msfconsole commands. Use the shared execution
// service so one-off commands follow the same configured WSL distro/user,
// PATH, cancellation, timeout, and executable resolution as every other tool.
// The old implementation flattened a wrapped WSL command with `split(' ')`,
// which broke quoted arguments and made this path fail on otherwise healthy
// WSL installations.
async function executeMsfCommand(
  command: string,
  timeout: number = 60000
): Promise<{ success: boolean; output?: string; error?: string }> {
  try {
    console.log('[executeMsfCommand] Command:', command);

    const processId = `msf-command-${Date.now()}-${commandSequence++}`;
    const result = await toolExecutionService.executeMsfconsole(
      [command, 'exit'],
      processId,
      { timeout },
    );

    if (result.success) {
      return { success: true, output: result.output || '' };
    }

    return {
      success: false,
      output: result.output,
      error: result.error || `Command failed. Is Metasploit installed?`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || `Command timeout (${timeout / 1000}s). Metasploit may not be installed or is taking too long.`,
    };
  }
}

export function registerMetasploitCommandHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void
) {
  // Search modules
  registerIPCHandler('msf-search', async (_event, query: string) => {
    if (!query || typeof query !== 'string') {
      return { success: false, error: 'Invalid search query' };
    }

    const result = await executeMsfCommand(`search ${query}`);
    
    if (result.success && result.output) {
      const modules = parseMsfSearchOutput(result.output);
      console.log('[msf-search] Found', modules.length, 'modules');
      return { success: true, modules };
    }
    
    return { success: false, error: result.error };
  });

  // Get module info and options
  registerIPCHandler('msf-module-info', async (_event, modulePath: string) => {
    if (!modulePath || typeof modulePath !== 'string') {
      return { success: false, error: 'Invalid module path' };
    }

    const result = await executeMsfCommand(`use ${modulePath}; show options`);
    
    if (result.success && result.output) {
      const options = parseMsfOptions(result.output);
      return { success: true, options };
    }
    
    return { success: false, error: result.error };
  });

  // Get compatible payloads
  registerIPCHandler('msf-get-payloads', async (_event, moduleType: string, modulePlatform?: string) => {
    const result = await executeMsfCommand('use exploit/multi/handler; show payloads');
    
    if (result.success && result.output) {
      const payloads = parseMsfPayloads(result.output, moduleType, modulePlatform);
      return { success: true, payloads };
    }
    
    return { success: false, error: result.error };
  });

  // Get active sessions
  registerIPCHandler('msf-get-sessions', async () => {
    const result = await executeMsfCommand('sessions -l');
    
    if (result.success && result.output) {
      const sessions = parseMsfSessions(result.output);
      return { success: true, sessions };
    }
    
    return { success: false, error: result.error };
  });

  // Execute session command
  registerIPCHandler('msf-session-command', async (_event, sessionId: number, command: string) => {
    if (typeof sessionId !== 'number' || !command) {
      return { success: false, error: 'Invalid session ID or command' };
    }

    const result = await executeMsfCommand(`sessions -i ${sessionId}; ${command}`);
    
    return { 
      success: result.success, 
      output: result.output || result.error,
      error: result.success ? undefined : result.error
    };
  });

  // Create handler
  registerIPCHandler('msf-create-handler', async (_event, args: { 
    payload: string; 
    port: number; 
    options: Record<string, string> 
  }) => {
    const { payload, port, options } = args;
    
    if (!payload || typeof port !== 'number') {
      return { success: false, error: 'Invalid payload or port' };
    }

    // Validate port
    if (port < 1 || port > 65535) {
      return { success: false, error: 'Invalid port number (must be 1-65535)' };
    }

    // Build command with validation
    let commandParts = [
      'use exploit/multi/handler',
      `set payload ${payload}`,
      `set LPORT ${port}`
    ];
    
    // Validate and add options
    for (const [key, value] of Object.entries(options)) {
      if (value && value.trim()) {
        const validation = validateMetasploitOption(key, value);
        if (!validation.isValid) {
          return { success: false, error: validation.error };
        }
        commandParts.push(`set ${key} ${validation.sanitized}`);
      }
    }
    
    commandParts.push('exploit -j');
    
    const result = await executeMsfCommand(commandParts.join('; '));
    
    return { 
      success: result.success && !result.output?.includes('error'), 
      output: result.output,
      error: result.success ? undefined : result.error
    };
  });

  // Get handlers/jobs
  registerIPCHandler('msf-get-handlers', async () => {
    const result = await executeMsfCommand('jobs -l');
    
    if (result.success && result.output) {
      const handlers = parseMsfHandlers(result.output);
      return { success: true, handlers };
    }
    
    return { success: false, error: result.error };
  });

  // Execute module
  registerIPCHandler('msf-execute', async (_event, args: { 
    modulePath: string; 
    options: Record<string, string>; 
    sessionId: string 
  }) => {
    const { modulePath, options, sessionId } = args;

    if (!modulePath || typeof modulePath !== 'string') {
      return { success: false, error: 'Invalid module path', sessionId };
    }

    // Build command with validation
    let commandParts = [`use ${modulePath}`];
    
    // Validate and add options
    for (const [key, value] of Object.entries(options)) {
      if (value && value.trim()) {
        const validation = validateMetasploitOption(key, value);
        if (!validation.isValid) {
          return { success: false, error: validation.error, sessionId };
        }
        commandParts.push(`set ${key} ${validation.sanitized}`);
      }
    }
    
    // Add exploit/run command
    if (modulePath.includes('exploit/')) {
      commandParts.push('exploit');
    } else {
      commandParts.push('run');
    }
    
    const result = await executeMsfCommand(commandParts.join('; '), 120000); // 2 min timeout
    
    return { 
      success: result.success, 
      output: result.output,
      error: result.error,
      sessionId 
    };
  });
}
