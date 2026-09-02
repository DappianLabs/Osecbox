// Metasploit output parser - extracts sessions, handlers, and execution results

export interface MetasploitSession {
  id: number;
  type: 'meterpreter' | 'shell' | 'unknown';
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  status: 'active' | 'closed' | 'dead';
  platform?: string;
  arch?: string;
  user?: string;
  computer?: string;
  os?: string;
  timestamp: number;
}

export interface MetasploitHandler {
  port: number;
  payload: string;
  status: 'listening' | 'stopped';
  connections: number;
}

export interface MetasploitExecution {
  success: boolean;
  sessions: MetasploitSession[];
  handlers: MetasploitHandler[];
  errors: string[];
  warnings: string[];
  info: string[];
}

export function parseMetasploitOutput(output: string): MetasploitExecution {
  const lines = output.split('\n');
  const sessions: MetasploitSession[] = [];
  const handlers: MetasploitHandler[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Parse session creation
    // [*] Meterpreter session 1 opened (192.168.1.50:4444 -> 192.168.1.100:49157) at 2024-01-13 12:34:56
    const sessionMatch = trimmed.match(/(\w+)\s+session\s+(\d+)\s+opened\s+\((.+?):(\d+)\s+->\s+(.+?):(\d+)\)/i);
    if (sessionMatch) {
      const type = sessionMatch[1].toLowerCase() as 'meterpreter' | 'shell';
      const id = parseInt(sessionMatch[2]);
      const localIp = sessionMatch[3];
      const localPort = parseInt(sessionMatch[4]);
      const remoteIp = sessionMatch[5];
      const remotePort = parseInt(sessionMatch[6]);
      
      sessions.push({
        id,
        type,
        localIp,
        localPort,
        remoteIp,
        remotePort,
        status: 'active',
        timestamp: Date.now(),
      });
      
      info.push(`Session ${id} opened: ${remoteIp}:${remotePort}`);
      continue;
    }
    
    // Parse handler start
    // [*] Started reverse TCP handler on 0.0.0.0:4444
    const handlerMatch = trimmed.match(/Started\s+(?:reverse\s+)?(?:TCP|HTTPS?)\s+handler\s+on\s+.+?:(\d+)/i);
    if (handlerMatch) {
      const port = parseInt(handlerMatch[1]);
      
      handlers.push({
        port,
        payload: 'reverse_tcp',
        status: 'listening',
        connections: 0,
      });
      
      info.push(`Handler listening on port ${port}`);
      continue;
    }
    
    // Parse session closed
    // [*] Session 1 closed.
    const closedMatch = trimmed.match(/Session\s+(\d+)\s+closed/i);
    if (closedMatch) {
      const id = parseInt(closedMatch[1]);
      // Immutable update to prevent React state corruption
      const sessionIndex = sessions.findIndex(s => s.id === id);
      if (sessionIndex >= 0) {
        // Create new object instead of mutating
        const updatedSession = { ...sessions[sessionIndex], status: 'closed' as const };
        sessions[sessionIndex] = updatedSession;
      }
      warnings.push(`Session ${id} closed`);
      continue;
    }
    
    // Parse errors
    if (trimmed.startsWith('[-]') || trimmed.includes('error') || trimmed.includes('failed')) {
      errors.push(trimmed.replace(/^\[-\]\s*/, ''));
      continue;
    }
    
    // Parse warnings
    if (trimmed.startsWith('[!]') || trimmed.includes('warning')) {
      warnings.push(trimmed.replace(/^\[!\]\s*/, ''));
      continue;
    }
    
    // Parse info
    if (trimmed.startsWith('[*]')) {
      const infoText = trimmed.replace(/^\[\*\]\s*/, '');
      if (infoText && !infoText.includes('Sending stage')) {
        info.push(infoText);
      }
    }
  }
  
  return {
    success: sessions.length > 0 || handlers.length > 0,
    sessions,
    handlers,
    errors,
    warnings,
    info,
  };
}

export function parseMeterpreterSysinfo(output: string): Partial<MetasploitSession> {
  const lines = output.split('\n');
  const sysinfo: Partial<MetasploitSession> = {};
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('Computer')) {
      const match = trimmed.match(/Computer\s*:\s*(.+)/);
      if (match) sysinfo.computer = match[1].trim();
    }
    
    if (trimmed.startsWith('OS')) {
      const match = trimmed.match(/OS\s*:\s*(.+)/);
      if (match) sysinfo.os = match[1].trim();
    }
    
    if (trimmed.startsWith('Architecture')) {
      const match = trimmed.match(/Architecture\s*:\s*(.+)/);
      if (match) sysinfo.arch = match[1].trim();
    }
    
    if (trimmed.startsWith('System Language')) {
      const match = trimmed.match(/System Language\s*:\s*(.+)/);
      if (match) sysinfo.platform = match[1].trim();
    }
  }
  
  return sysinfo;
}
