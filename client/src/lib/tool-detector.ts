/**
 * Tool Detection System
 * 
 * Detects which pentesting tool is running in a terminal to apply
 * correct chunking and summarization strategies.
 * 
 * Supported tools: LinPEAS, nmap, nuclei, sqlmap, metasploit
 */

// Buffer type for terminal output classification
export type BufferType = 'tool_output' | 'interactive' | 'command' | 'general';

export interface ToolPattern {
  name: string;
  startPattern: RegExp;
  endPattern: RegExp | null;
  chunkSize: number;
  bufferType: BufferType;
  description: string;
}

// Tool detection patterns
const TOOL_PATTERNS: ToolPattern[] = [
  {
    name: 'linpeas',
    startPattern: /linpeas|PEASS|Linux Privilege Escalation Awesome Script/i,
    endPattern: /Finished|completed|linpeas.*done/i,
    chunkSize: 10000,
    bufferType: 'tool_output',
    description: 'LinPEAS privilege escalation enumeration'
  },
  {
    name: 'nmap',
    startPattern: /Starting Nmap|Nmap scan report/i,
    endPattern: /Nmap done|# Nmap done/i,
    chunkSize: 5000,
    bufferType: 'tool_output',
    description: 'Nmap network scanner'
  },
  {
    name: 'nuclei',
    startPattern: /nuclei|Nuclei Engine/i,
    endPattern: /\[INF\] Finished|\[INF\] Templates loaded/i,
    chunkSize: 3000,
    bufferType: 'tool_output',
    description: 'Nuclei vulnerability scanner'
  },
  {
    name: 'sqlmap',
    startPattern: /sqlmap|automatic SQL injection/i,
    endPattern: /shutting down|sqlmap.*finished/i,
    chunkSize: 5000,
    bufferType: 'tool_output',
    description: 'SQLMap SQL injection tool'
  },
  {
    name: 'metasploit',
    startPattern: /meterpreter|msf6|metasploit/i,
    endPattern: null, // Continuous session
    chunkSize: 2000,
    bufferType: 'interactive',
    description: 'Metasploit Framework'
  },
  {
    name: 'gobuster',
    startPattern: /Gobuster|gobuster/i,
    endPattern: /Finished|gobuster.*done/i,
    chunkSize: 4000,
    bufferType: 'tool_output',
    description: 'Gobuster directory brute-forcer'
  },
  {
    name: 'ffuf',
    startPattern: /ffuf|FFUF/i,
    endPattern: /FUZZ.*done|Progress.*100%/i,
    chunkSize: 4000,
    bufferType: 'tool_output',
    description: 'FFUF web fuzzer'
  },
  {
    name: 'nikto',
    startPattern: /Nikto|nikto/i,
    endPattern: /Nikto.*End Time|nikto.*completed/i,
    chunkSize: 5000,
    bufferType: 'tool_output',
    description: 'Nikto web scanner'
  },
  {
    name: 'enum4linux',
    startPattern: /enum4linux|Enum4linux/i,
    endPattern: /enum4linux.*complete|Finished/i,
    chunkSize: 5000,
    bufferType: 'tool_output',
    description: 'Enum4linux SMB enumeration'
  },
  {
    name: 'hydra',
    startPattern: /Hydra|hydra/i,
    endPattern: /Hydra.*done|password cracking finished/i,
    chunkSize: 3000,
    bufferType: 'tool_output',
    description: 'Hydra password cracker'
  }
];

export interface ToolDetectionResult {
  detected: boolean;
  tool: ToolPattern | null;
  isStart: boolean;
  isEnd: boolean;
}

class ToolDetector {
  private activeTools = new Map<string, ToolPattern>();
  
  /**
   * Detect tool in a line of terminal output
   */
  detectTool(terminalId: string, line: string): ToolDetectionResult {
    // Check if tool already active
    const active = this.activeTools.get(terminalId);
    
    if (active) {
      // Check for end pattern
      if (active.endPattern && active.endPattern.test(line)) {
        this.activeTools.delete(terminalId);
        return {
          detected: true,
          tool: active,
          isStart: false,
          isEnd: true
        };
      }
      
      // Tool still running
      return {
        detected: true,
        tool: active,
        isStart: false,
        isEnd: false
      };
    }
    
    // Check for tool start
    for (const pattern of TOOL_PATTERNS) {
      if (pattern.startPattern.test(line)) {
        this.activeTools.set(terminalId, pattern);
        return {
          detected: true,
          tool: pattern,
          isStart: true,
          isEnd: false
        };
      }
    }
    
    // No tool detected
    return {
      detected: false,
      tool: null,
      isStart: false,
      isEnd: false
    };
  }
  
  /**
   * Get currently active tool for a terminal
   */
  getActiveTool(terminalId: string): ToolPattern | null {
    return this.activeTools.get(terminalId) || null;
  }
  
  /**
   * Check if a tool is currently active
   */
  isToolActive(terminalId: string): boolean {
    return this.activeTools.has(terminalId);
  }
  
  /**
   * Manually mark tool as finished (for tools without end pattern)
   */
  markToolFinished(terminalId: string): ToolPattern | null {
    const tool = this.activeTools.get(terminalId);
    if (tool) {
      this.activeTools.delete(terminalId);
      return tool;
    }
    return null;
  }
  
  /**
   * Get all active tools
   */
  getActiveTools(): Map<string, ToolPattern> {
    return new Map(this.activeTools);
  }
  
  /**
   * Clear all active tools
   */
  clearAll() {
    const count = this.activeTools.size;
    this.activeTools.clear();
  }
  
  /**
   * Get tool pattern by name
   */
  getToolPattern(toolName: string): ToolPattern | null {
    return TOOL_PATTERNS.find(p => p.name === toolName) || null;
  }
  
  /**
   * Get all supported tools
   */
  getSupportedTools(): ToolPattern[] {
    return [...TOOL_PATTERNS];
  }
}

// Singleton instance
export const toolDetector = new ToolDetector();
