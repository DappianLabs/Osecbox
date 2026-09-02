/**
 * Subdomain Enumeration Handlers
 * Handles subdomain discovery tools (subfinder, amass, ffuf, assetfinder)
 */

import { toolExecutionService } from '../services/tool-execution-service';
import { rateLimiters } from './rate-limiter';
import { logSecurityEvent } from '../utils/security-logger';
import { OutputStreamBatcher } from '../utils/output-stream-batcher';

// Keep history off the initial handler/module load path. Tool detection and
// the first terminal prompt should not wait for fs/readline to be imported.
let terminalHistoryServicePromise: Promise<typeof import('../terminal-history-service').terminalHistoryService> | null = null;
async function getTerminalHistoryService() {
  if (!terminalHistoryServicePromise) {
    terminalHistoryServicePromise = import('../terminal-history-service')
      .then(module => module.terminalHistoryService)
      .catch(error => {
        terminalHistoryServicePromise = null;
        throw error;
      });
  }
  return terminalHistoryServicePromise;
}

export function registerSubdomainHandlers(
  registerIPCHandler: (channel: string, handler: (...args: any[]) => any) => void
) {
  // SECURITY: Whitelist of allowed flags per tool
  const ALLOWED_FLAGS: Record<string, string[]> = {
    subfinder: ['-all', '-recursive', '-silent', '-t', '-timeout', '-o', '-oJ', '-v', '-nW', '-rL', '-max-time'],
    amass: ['-passive', '-active', '-brute', '-d', '-timeout', '-o', '-json', '-v', '-max-dns-queries', '-rf'],
    ffuf: ['-w', '-u', '-t', '-timeout', '-mc', '-fc', '-fs', '-fw', '-fl', '-fr', '-o', '-of', '-s', '-v', '-H', '-X', '-d', '-recursion', '-recursion-depth'],
    assetfinder: ['--subs-only'],
    sublist3r: ['-d', '-b', '-p', '-v', '-t', '-e', '-o']
  };

  // SECURITY: Validate custom flags against whitelist
  function validateCustomFlags(tool: string, flags: string): { valid: boolean; error?: string } {
    if (!flags || flags.trim() === '') {
      return { valid: true };
    }

    const allowedFlags = ALLOWED_FLAGS[tool];
    if (!allowedFlags) {
      return { valid: false, error: `Tool '${tool}' does not support custom flags` };
    }

    // Split flags and validate each one
    const flagParts = flags.trim().split(/\s+/);
    
    for (let i = 0; i < flagParts.length; i++) {
      const part = flagParts[i];
      
      // Check if it's a flag (starts with -)
      if (part.startsWith('-')) {
        if (!allowedFlags.includes(part)) {
          return { valid: false, error: `Flag '${part}' is not allowed for ${tool}` };
        }
      } else {
        // It's a value - validate it doesn't contain dangerous characters
        if (/[;&|`$(){}[\]<>\\]/.test(part)) {
          return { valid: false, error: `Value '${part}' contains illegal characters` };
        }
      }
    }

    return { valid: true };
  }

  // Execute subdomain enumeration tool with settings integration
  registerIPCHandler('execute-subdomain-tool', async (event, args: { tool: string; domain: string; toolId: string; terminalId?: string; customFlags?: string }) => {
    const { tool, domain, toolId, terminalId, customFlags } = args;
    const historyId = typeof terminalId === 'string' ? terminalId.trim() : '';
    
    console.log(`[SubdomainHandler] Received request:`, {
      tool,
      domain,
      toolId,
      hasCustomFlags: Boolean(customFlags),
      customFlagsLength: typeof customFlags === 'string' ? customFlags.length : 0,
    });
    
    // SECURITY: Validate payload size (10MB limit)
    const payloadSize = JSON.stringify(args).length;
    if (payloadSize > 10 * 1024 * 1024) {
      console.error(`[SubdomainHandler] Payload too large: ${payloadSize} bytes`);
      return { success: false, error: 'Request payload too large', toolId };
    }
    
    // SECURITY: Validate domain format
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(domain)) {
      return { success: false, error: 'Invalid domain format', toolId };
    }
    
    // SECURITY: Validate custom flags with whitelist
    if (customFlags) {
      const validation = validateCustomFlags(tool, customFlags);
      if (!validation.valid) {
        console.error(`[SECURITY] Blocked invalid custom flags for ${tool}`);
        logSecurityEvent.invalidInput('customFlags', customFlags, validation.error || 'Invalid flags');
        return { success: false, error: validation.error, toolId };
      }
    }
    
    // SECURITY: Rate limiting to prevent DoS
    const rateLimitCheck = rateLimiters.subdomainTool.check('subdomain-tool');
    if (!rateLimitCheck.allowed) {
      console.error(`[SECURITY] Rate limit exceeded for subdomain tools`);
      logSecurityEvent.rateLimitExceeded('subdomain-tool', tool);
      return { 
        success: false, 
        error: `Rate limit exceeded. Please wait ${rateLimitCheck.retryAfter} seconds.`, 
        toolId 
      };
    }
    
    let outputBatcher: OutputStreamBatcher | null = null;
    let historyWritePromise: Promise<void> = Promise.resolve();
    let historyService: Awaited<ReturnType<typeof getTerminalHistoryService>> | null = null;
    try {
      let result;

      // Subdomain tools run as child processes rather than inside the shell
      // PTY. Persist their streamed output in the same history identified by
      // the visible terminal, otherwise a long enumeration is only retained
      // by the renderer's bounded recovery buffer.
      if (historyId) {
        try {
          historyService = await getTerminalHistoryService();
          await historyService.initHistory(historyId);
        } catch (error: any) {
          // History is a durability enhancement; it must never prevent the
          // actual enumeration process from starting.
          console.warn(`[SubdomainHandler] History unavailable for ${historyId}:`, error?.message || error);
        }
      }

      outputBatcher = new OutputStreamBatcher((data, type) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('listener-output', {
            listenerId: toolId,
            data,
            type,
          });
        }
      });
      const onOutput = (data: string, type: 'stdout' | 'stderr') => {
        if (historyId && historyService && data) {
          historyWritePromise = historyWritePromise
            .then(() => historyService!.appendOutput(historyId, data))
            .catch(error => {
              console.warn(`[SubdomainHandler] Failed to persist output for ${historyId}:`, error?.message || error);
            });
        }
        outputBatcher?.push(data, type);
      };
      
      console.log(`[SubdomainHandler] Executing tool: ${tool}`);
      
      // Use ToolExecutionService for supported tools
      switch (tool) {
        case 'subfinder':
          result = await toolExecutionService.executeSubfinder(domain, toolId, {
            customFlags,
            onOutput
          });
          break;
          
        case 'amass':
          result = await toolExecutionService.executeAmass(domain, toolId, {
            customFlags,
            onOutput
          });
          break;
          
        case 'ffuf':
          result = await toolExecutionService.executeFFUF(domain, toolId, {
            customFlags,
            onOutput
          });
          break;
          
        case 'assetfinder':
          result = await toolExecutionService.executeAssetfinder(domain, toolId, {
            customFlags,
            onOutput
          });
          break;
          
        case 'sublist3r':
          result = await toolExecutionService.executeSublist3r(domain, toolId, {
            customFlags,
            onOutput
          });
          break;
          
        default:
          outputBatcher?.dispose();
          console.error(`[SubdomainHandler] Unknown tool: ${tool}`);
          return { success: false, error: 'Unknown tool', toolId };
      }

      outputBatcher?.dispose();
      await historyWritePromise;
      
      console.log(`[SubdomainHandler] Tool execution completed:`, { 
        success: result.success, 
        hasOutput: !!result.output,
        outputLength: result.output?.length || 0,
        error: result.error 
      });

      // Tool execution is not backed by the shell PTY, so it does not emit
      // the normal listener-closed event. Publish an exit event explicitly so
      // AI output capture flushes immediately instead of waiting 30 seconds
      // for its idle timer.
      if (!event.sender.isDestroyed()) {
        event.sender.send('listener-exit', {
          listenerId: toolId,
          exitCode: result.code ?? (result.success ? 0 : 1),
          timestamp: Date.now(),
        });
      }
      
      return {
        success: result.success,
        output: result.output,
        stderr: result.stderr,
        error: result.error,
        toolId,
      };
    } catch (error: any) {
      outputBatcher?.dispose();
      console.error(`[SubdomainHandler] Exception:`, error);
      if (!event.sender.isDestroyed()) {
        event.sender.send('listener-exit', {
          listenerId: toolId,
          exitCode: 1,
          timestamp: Date.now(),
        });
      }
      return { success: false, error: error.message, toolId };
    }
  });
}
