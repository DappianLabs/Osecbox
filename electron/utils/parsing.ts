/**
 * Robust parsing with error handling
 * Prevents crashes from malformed tool output
 */

/**
 * Safely parse Metasploit search output
 */
export function parseMsfSearchOutput(output: string): any[] {
  try {
    const modules: any[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      try {
        // Match module lines (format: #  Name  Disclosure Date  Rank  Check  Description)
        const match = line.match(/^\s*\d+\s+(\S+)\s+(\d{4}-\d{2}-\d{2})?\s*(\w+)?\s+(\w+)?\s+(.+)$/);
        if (match) {
          const [, fullPath, disclosureDate, rank, , description] = match;
          
          // Determine module type from path
          let type: 'exploit' | 'auxiliary' | 'post' | 'payload' = 'auxiliary';
          if (fullPath.startsWith('exploit/')) type = 'exploit';
          else if (fullPath.startsWith('auxiliary/')) type = 'auxiliary';
          else if (fullPath.startsWith('post/')) type = 'post';
          else if (fullPath.startsWith('payload/')) type = 'payload';
          
          // Extract name from path
          const pathParts = fullPath.split('/');
          const name = pathParts[pathParts.length - 1].replace(/_/g, ' ');
          
          modules.push({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            fullPath,
            type,
            rank: rank || 'Normal',
            description: description?.trim() || '',
            disclosureDate: disclosureDate || undefined,
          });
        }
      } catch (lineError) {
        // Skip malformed line
        continue;
      }
    }
    
    return modules;
  } catch (error) {
    console.error('[Parsing] Failed to parse MSF search output:', error);
    return [];
  }
}

/**
 * Safely parse Metasploit module options
 */
export function parseMsfOptions(output: string): any[] {
  try {
    const options: any[] = [];
    const lines = output.split('\n');
    let inOptionsSection = false;
    
    for (const line of lines) {
      try {
        // Detect options section
        if (line.includes('Module options') || line.includes('Basic options')) {
          inOptionsSection = true;
          continue;
        }
        
        // End of options section
        if (inOptionsSection && line.trim() === '') {
          break;
        }
        
        // Parse option line (format: Name  Current Setting  Required  Description)
        if (inOptionsSection) {
          const match = line.match(/^\s*(\S+)\s+(\S*)\s+(yes|no)\s+(.+)$/i);
          if (match) {
            const [, name, defaultValue, required, description] = match;
            options.push({
              name,
              required: required.toLowerCase() === 'yes',
              default: defaultValue || '',
              description: description.trim(),
            });
          }
        }
      } catch (lineError) {
        continue;
      }
    }
    
    return options;
  } catch (error) {
    console.error('[Parsing] Failed to parse MSF options:', error);
    return [];
  }
}

/**
 * Safely parse Metasploit payloads
 */
export function parseMsfPayloads(output: string, moduleType?: string, modulePlatform?: string): any[] {
  try {
    const payloads: any[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      try {
        const trimmed = line.trim();
        
        // Skip headers and empty lines
        if (!trimmed || trimmed.startsWith('=') || trimmed.startsWith('Compatible') || 
            (trimmed.includes('Name') && trimmed.includes('Size'))) {
          continue;
        }
        
        // Parse payload line
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          const fullPath = parts[0];
          const pathParts = fullPath.split('/');
          
          if (pathParts.length >= 2) {
            const platform = pathParts[0];
            const arch = pathParts[1] || 'x86';
            const name = pathParts[pathParts.length - 1];
            
            payloads.push({
              name: name,
              fullPath: fullPath,
              platform: platform,
              arch: arch,
              type: name.includes('reverse') ? 'staged' : 'stageless',
              size: 0,
              description: parts.slice(3).join(' '),
              options: [
                { name: 'LHOST', required: true, description: 'The listen address', default: '' },
                { name: 'LPORT', required: true, description: 'The listen port', default: '4444' }
              ]
            });
          }
        }
      } catch (lineError) {
        continue;
      }
    }
    
    return payloads;
  } catch (error) {
    console.error('[Parsing] Failed to parse MSF payloads:', error);
    return [];
  }
}

/**
 * Safely parse Metasploit sessions
 */
export function parseMsfSessions(output: string): any[] {
  try {
    const sessions: any[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      try {
        const trimmed = line.trim();
        
        // Skip headers and empty lines
        if (!trimmed || trimmed.startsWith('=') || trimmed.startsWith('Active') || 
            (trimmed.includes('Id') && trimmed.includes('Type'))) {
          continue;
        }
        
        // Parse session line
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 4) {
          const id = parseInt(parts[0]);
          const type = parts[1].toLowerCase();
          const connection = parts[parts.length - 1];
          
          if (connection.includes('->')) {
            const [local, remote] = connection.split(' -> ');
            const [localIp, localPort] = local.split(':');
            const [remoteIp, remotePort] = remote.split(':');
            
            sessions.push({
              id: id,
              type: type.includes('meterpreter') ? 'meterpreter' : 'shell',
              localIp: localIp,
              localPort: parseInt(localPort),
              remoteIp: remoteIp,
              remotePort: parseInt(remotePort),
              status: 'active',
              platform: parts[2] || 'unknown',
              user: parts[3] || 'unknown',
              timestamp: Date.now(),
              lastActivity: Date.now()
            });
          }
        }
      } catch (lineError) {
        continue;
      }
    }
    
    return sessions;
  } catch (error) {
    console.error('[Parsing] Failed to parse MSF sessions:', error);
    return [];
  }
}

/**
 * Safely parse Metasploit handlers/jobs
 */
export function parseMsfHandlers(output: string): any[] {
  try {
    const handlers: any[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      try {
        const trimmed = line.trim();
        
        // Skip headers and empty lines
        if (!trimmed || trimmed.startsWith('=') || trimmed.startsWith('Jobs') || 
            (trimmed.includes('Id') && trimmed.includes('Name'))) {
          continue;
        }
        
        // Parse job line
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          const id = parseInt(parts[0]);
          const name = parts.slice(1).join(' ');
          
          if (name.includes('handler')) {
            handlers.push({
              id: id,
              port: 4444,
              payload: 'windows/meterpreter/reverse_tcp',
              status: 'listening',
              connections: 0,
              startTime: Date.now()
            });
          }
        }
      } catch (lineError) {
        continue;
      }
    }
    
    return handlers;
  } catch (error) {
    console.error('[Parsing] Failed to parse MSF handlers:', error);
    return [];
  }
}
