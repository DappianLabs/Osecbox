import { ConnectionNode, ConnectionRole, ConnectionMethod } from './connection-store';

// Regex patterns for passive detection
const PATTERNS = {
  // SSH connections
  ssh: /ssh\s+(?:.*?@)?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/i,
  sshConnected: /Connected to ([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/i,
  
  // Reverse shells
  reverseShell: /(?:nc|netcat|ncat)\s+(?:-[a-z]+\s+)*([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\s+(\d+)/i,
  reverseConnect: /connect(?:ed|ing)?\s+(?:from|to)\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}):?(\d+)?/i,
  
  // Metasploit
  msfSession: /Session\s+(\d+)\s+opened.*?->\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}):(\d+)/i,
  meterpreter: /meterpreter\s*>/i,
  
  // Listeners
  listening: /(?:listening|bound)\s+(?:on|to)\s+(?:.*?:)?(\d+)/i,
  ncListener: /(?:nc|netcat|ncat)\s+(?:-[a-z]+\s+)*-l.*?(\d+)/i,
  
  // Tunneling
  chisel: /chisel\s+(?:server|client)\s+.*?(?:--port\s+(\d+)|:(\d+))/i,
  // Ligolo proxy releases use -selfcert/-laddr; agent releases use
  // -connect/-ignore-cert. Older builds also exposed --bind/--connect.
  ligolo: /ligolo.*?(?:-laddr|--laddr|-bind|--bind|-connect|--connect)\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}):(\d+)/i,
  sshuttle: /sshuttle.*?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(?:\/\d+)?)/i,
  
  // VPN
  vpnConnected: /(?:tun|tap)\d+.*?(?:inet|ip)\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/i,
  openvpn: /Initialization Sequence Completed/i,
  
  // Socat
  socat: /socat.*?TCP(?:4|6)?-LISTEN:(\d+).*?TCP(?:4|6)?:([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}):(\d+)/i,
};

export interface DetectionResult {
  detected: boolean;
  connection?: Omit<ConnectionNode, 'id' | 'terminalId' | 'createdAt'>;
}

/**
 * Passive connection detector - analyzes PTY output for connection indicators
 * NO kernel access, NO iptables, NO manual input - pure regex on terminal output
 */
export class ConnectionDetector {
  /**
   * Analyze a line of terminal output for connection indicators
   */
  static detectConnection(
    output: string,
    terminalId: string,
    context?: { lastCommand?: string }
  ): DetectionResult {
    const line = output.trim();
    
    // SSH detection
    const sshMatch = line.match(PATTERNS.ssh) || line.match(PATTERNS.sshConnected);
    if (sshMatch) {
      return {
        detected: true,
        connection: {
          ip: sshMatch[1],
          role: 'foothold',
          method: 'ssh',
          metadata: {
            hostname: this.extractHostname(line),
          },
        },
      };
    }
    
    // Metasploit session
    const msfMatch = line.match(PATTERNS.msfSession);
    if (msfMatch) {
      return {
        detected: true,
        connection: {
          ip: msfMatch[2],
          port: msfMatch[3],
          role: 'foothold',
          method: 'msf',
          metadata: {
            hostname: `session-${msfMatch[1]}`,
          },
        },
      };
    }
    
    // Meterpreter prompt (indicates active session)
    if (PATTERNS.meterpreter.test(line)) {
      return {
        detected: true,
        connection: {
          role: 'foothold',
          method: 'msf',
        },
      };
    }
    
    // Reverse shell connection
    const reverseMatch = line.match(PATTERNS.reverseShell) || line.match(PATTERNS.reverseConnect);
    if (reverseMatch) {
      return {
        detected: true,
        connection: {
          ip: reverseMatch[1],
          port: reverseMatch[2],
          role: 'foothold',
          method: 'reverse',
        },
      };
    }
    
    // Listener detection - ONLY when actually listening
    if (line.toLowerCase().includes('listening') || line.toLowerCase().includes('bound')) {
      const listenerMatch = line.match(PATTERNS.ncListener) || line.match(PATTERNS.listening);
      if (listenerMatch) {
        return {
          detected: true,
          connection: {
            port: listenerMatch[1],
            role: 'listener',
            method: 'nc',
          },
        };
      }
    }
    
    // Chisel tunneling - ONLY detect when actually listening
    if (line.toLowerCase().includes('listening') || line.toLowerCase().includes('server:')) {
      const chiselMatch = line.match(PATTERNS.chisel);
      if (chiselMatch) {
        const port = chiselMatch[1] || chiselMatch[2];
        return {
          detected: true,
          connection: {
            port,
            role: 'pivot',
            method: 'chisel',
          },
        };
      }
    }
    
    // Ligolo tunneling - ONLY detect when actually connected
    if (line.toLowerCase().includes('session created') || line.toLowerCase().includes('agent connected')) {
      const ligoloMatch = line.match(PATTERNS.ligolo);
      if (ligoloMatch) {
        return {
          detected: true,
          connection: {
            ip: ligoloMatch[1],
            port: ligoloMatch[2],
            role: 'pivot',
            method: 'ligolo',
          },
        };
      }
    }
    
    // SSHuttle - ONLY detect when actually connected
    if (line.toLowerCase().includes('connected') || line.toLowerCase().includes('c : connected')) {
      const sshuttleMatch = line.match(PATTERNS.sshuttle);
      if (sshuttleMatch) {
        return {
          detected: true,
          connection: {
            ip: sshuttleMatch[1],
            role: 'pivot',
            method: 'sshuttle',
            metadata: {
              subnet: sshuttleMatch[1],
            },
          },
        };
      }
    }
    
    // Socat - ONLY detect when actually listening/connected
    if (line.toLowerCase().includes('listening') || line.toLowerCase().includes('accepting')) {
      const socatMatch = line.match(PATTERNS.socat);
      if (socatMatch) {
        return {
          detected: true,
          connection: {
            ip: socatMatch[2],
            port: socatMatch[1],
            role: 'pivot',
            method: 'socat',
          },
        };
      }
    }
    
    // VPN connection
    const vpnMatch = line.match(PATTERNS.vpnConnected);
    if (vpnMatch || PATTERNS.openvpn.test(line)) {
      return {
        detected: true,
        connection: {
          ip: vpnMatch?.[1],
          role: 'vpn',
          metadata: {
            interface: this.extractInterface(line),
          },
        },
      };
    }
    
    return { detected: false };
  }
  
  /**
   * Extract hostname from SSH output
   */
  private static extractHostname(line: string): string | undefined {
    const match = line.match(/(?:@|to\s+)([a-zA-Z0-9.-]+)/);
    return match?.[1];
  }
  
  /**
   * Extract network interface from VPN output
   */
  private static extractInterface(line: string): string | undefined {
    const match = line.match(/(tun|tap)\d+/);
    return match?.[0];
  }
  
  /**
   * Batch analyze multiple lines (for initial output)
   */
  static detectConnectionsInBatch(
    lines: string[],
    terminalId: string
  ): DetectionResult[] {
    const results: DetectionResult[] = [];
    
    for (const line of lines) {
      const result = this.detectConnection(line, terminalId);
      if (result.detected) {
        results.push(result);
      }
    }
    
    return results;
  }
}
