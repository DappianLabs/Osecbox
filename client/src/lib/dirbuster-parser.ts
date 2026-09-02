// DirBuster/Gobuster/Feroxbuster output parser

export type DirBusterTool = 'dirb' | 'gobuster' | 'feroxbuster' | 'ffuf' | 'dirsearch';

export interface DirBusterFinding {
  url: string;
  statusCode: number;
  size?: number;
  redirect?: string;
  type: 'directory' | 'file';
  interesting: boolean;
  wordCount?: number;
  lineCount?: number;
}

export interface DirBusterResult {
  findings: DirBusterFinding[];
  summary: {
    total: number;
    directories: number;
    files: number;
    interesting: number;
    statusCodes: Record<number, number>;
  };
  tool: DirBusterTool;
  target: string;
}

function isInteresting(statusCode: number): boolean {
  // 200 OK, 201 Created, 204 No Content
  if (statusCode >= 200 && statusCode < 300) return true;
  // 301 Moved, 302 Found, 307 Temp Redirect
  if (statusCode >= 301 && statusCode <= 308) return true;
  // 403 Forbidden (often means directory exists but no access)
  if (statusCode === 403) return true;
  // 401 Unauthorized (auth required)
  if (statusCode === 401) return true;
  
  return false;
}

function detectTool(output: string): DirBusterTool {
  if (output.includes('Gobuster')) return 'gobuster';
  if (output.includes('feroxbuster')) return 'feroxbuster';
  if (output.includes('ffuf')) return 'ffuf';
  if (output.includes('dirsearch')) return 'dirsearch';
  return 'dirb';
}

export function parseDirBusterOutput(output: string): DirBusterResult {
  const lines = output.split('\n');
  const findings: DirBusterFinding[] = [];
  const MAX_FINDINGS = 10000;
  const statusCodes: Record<number, number> = {};
  let target = '';
  const tool = detectTool(output);
  
  for (const line of lines) {
    if (findings.length >= MAX_FINDINGS) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Extract target
    if (trimmed.includes('Target:') || trimmed.includes('URL:') || trimmed.includes('Testing:')) {
      const targetMatch = trimmed.match(/(?:Target|URL|Testing):\s*(.+?)(?:\s|$)/);
      if (targetMatch) target = targetMatch[1];
    }
    
    // Parse Gobuster format: /admin (Status: 200) [Size: 1234]
    const gobusterMatch = trimmed.match(/^(.+?)\s+\(Status:\s+(\d+)\)(?:\s+\[Size:\s+(\d+)\])?/);
    if (gobusterMatch) {
      const path = gobusterMatch[1];
      const statusCode = parseInt(gobusterMatch[2]);
      const size = gobusterMatch[3] ? parseInt(gobusterMatch[3]) : undefined;
      
      statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
      
      findings.push({
        url: path,
        statusCode,
        size,
        type: path.endsWith('/') ? 'directory' : 'file',
        interesting: isInteresting(statusCode),
      });
      continue;
    }
    
    // Parse Feroxbuster format: 200 GET 1234 http://target.com/admin/
    const feroxMatch = trimmed.match(/^(\d+)\s+\w+\s+(\d+)\w?\s+(.+?)(?:\s|$)/);
    if (feroxMatch) {
      const statusCode = parseInt(feroxMatch[1]);
      const size = parseInt(feroxMatch[2]);
      const url = feroxMatch[3];
      
      statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
      
      findings.push({
        url,
        statusCode,
        size,
        type: url.endsWith('/') ? 'directory' : 'file',
        interesting: isInteresting(statusCode),
      });
      continue;
    }
    
    // Parse ffuf format: admin [Status: 200, Size: 1234, Words: 56, Lines: 12]
    const ffufMatch = trimmed.match(/^(.+?)\s+\[Status:\s+(\d+),\s+Size:\s+(\d+)(?:,\s+Words:\s+(\d+))?(?:,\s+Lines:\s+(\d+))?\]/);
    if (ffufMatch) {
      const path = ffufMatch[1];
      const statusCode = parseInt(ffufMatch[2]);
      const size = parseInt(ffufMatch[3]);
      const wordCount = ffufMatch[4] ? parseInt(ffufMatch[4]) : undefined;
      const lineCount = ffufMatch[5] ? parseInt(ffufMatch[5]) : undefined;
      
      statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
      
      findings.push({
        url: path,
        statusCode,
        size,
        wordCount,
        lineCount,
        type: path.endsWith('/') ? 'directory' : 'file',
        interesting: isInteresting(statusCode),
      });
      continue;
    }
    
    // Parse DIRB format: + http://target.com/admin/ (CODE:200|SIZE:1234)
    const dirbMatch = trimmed.match(/^\+\s+(.+?)\s+\(CODE:(\d+)\|SIZE:(\d+)\)/);
    if (dirbMatch) {
      const url = dirbMatch[1];
      const statusCode = parseInt(dirbMatch[2]);
      const size = parseInt(dirbMatch[3]);
      
      statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
      
      findings.push({
        url,
        statusCode,
        size,
        type: url.endsWith('/') ? 'directory' : 'file',
        interesting: isInteresting(statusCode),
      });
      continue;
    }
    
    // Parse dirsearch format: 200 - 1234B - http://target.com/admin/
    const dirsearchMatch = trimmed.match(/^(\d+)\s+-\s+(\d+)B\s+-\s+(.+?)(?:\s|$)/);
    if (dirsearchMatch) {
      const statusCode = parseInt(dirsearchMatch[1]);
      const size = parseInt(dirsearchMatch[2]);
      const url = dirsearchMatch[3];
      
      statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
      
      findings.push({
        url,
        statusCode,
        size,
        type: url.endsWith('/') ? 'directory' : 'file',
        interesting: isInteresting(statusCode),
      });
      continue;
    }
    
    // Generic format: [STATUS] URL
    const genericMatch = trimmed.match(/^\[(\d+)\]\s+(.+?)(?:\s|$)/);
    if (genericMatch) {
      const statusCode = parseInt(genericMatch[1]);
      const url = genericMatch[2];
      
      statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
      
      findings.push({
        url,
        statusCode,
        type: url.endsWith('/') ? 'directory' : 'file',
        interesting: isInteresting(statusCode),
      });
    }
  }
  
  // Calculate summary
  const summary = {
    total: findings.length,
    directories: findings.filter(f => f.type === 'directory').length,
    files: findings.filter(f => f.type === 'file').length,
    interesting: findings.filter(f => f.interesting).length,
    statusCodes,
  };
  
  return {
    findings,
    summary,
    tool,
    target,
  };
}
