/**
 * Terminal Output Compressor
 * Handles massive terminal dumps by extracting key facts and enabling semantic search
 * 
 * Problem: 100KB terminal output = 25K tokens (too expensive)
 * Solution: Compress to key facts = 500 tokens, store embeddings for retrieval
 */

export interface TerminalChunk {
  chunk_id: string;
  command_id: number;
  command: string;
  raw_text: string; // Full output (stored separately, not sent to AI)
  compressed_facts: string[]; // Key facts extracted (sent to AI)
  chunk_type: 'file_listing' | 'network_scan' | 'process_list' | 'config_dump' | 'error_output' | 'generic';
  metadata: {
    line_count: number;
    char_count: number;
    compression_ratio: number; // How much we compressed
    entities_found: string[]; // IPs, files, services, etc.
    timestamp: number;
  };
}

export interface CompressedOutput {
  command_id: number;
  command: string;
  chunks: TerminalChunk[];
  summary: string; // One-line summary of entire output
  total_compression_ratio: number;
}

/**
 * Compress terminal output into semantic chunks
 */
export function compressTerminalOutput(
  command_id: number,
  command: string,
  output: string
): CompressedOutput {
  // Step 1: Detect output type and chunk accordingly
  const chunks = chunkOutput(command_id, command, output);
  
  // Step 2: Compress each chunk
  const compressedChunks = chunks.map(chunk => compressChunk(chunk));
  
  // Step 3: Generate overall summary
  const summary = generateSummary(command, compressedChunks);
  
  // Step 4: Calculate compression ratio
  const originalSize = output.length;
  const compressedSize = compressedChunks.reduce((sum, c) => 
    sum + c.compressed_facts.join(' ').length, 0
  );
  const compressionRatio = originalSize / Math.max(compressedSize, 1);
  
  return {
    command_id,
    command,
    chunks: compressedChunks,
    summary,
    total_compression_ratio: compressionRatio
  };
}

/**
 * Chunk output based on content type
 */
function chunkOutput(
  command_id: number,
  command: string,
  output: string
): TerminalChunk[] {
  const chunks: TerminalChunk[] = [];
  const lines = output.split('\n');
  
  // Detect output type
  const outputType = detectOutputType(command, output);
  
  switch (outputType) {
    case 'file_listing':
      // Chunk by directory or every 100 lines
      return chunkFileListing(command_id, command, lines);
      
    case 'network_scan':
      // Chunk by host or service type
      return chunkNetworkScan(command_id, command, lines);
      
    case 'process_list':
      // Chunk by process type or every 50 lines
      return chunkProcessList(command_id, command, lines);
      
    case 'config_dump':
      // Chunk by section or every 200 lines
      return chunkConfigDump(command_id, command, lines);
      
    case 'error_output':
      // Keep as single chunk (usually small)
      return [{
        chunk_id: `${command_id}-error`,
        command_id,
        command,
        raw_text: output,
        compressed_facts: [],
        chunk_type: 'error_output',
        metadata: {
          line_count: lines.length,
          char_count: output.length,
          compression_ratio: 1,
          entities_found: [],
          timestamp: Date.now()
        }
      }];
      
    default:
      // Generic chunking: every 100 lines
      return chunkGeneric(command_id, command, lines);
  }
}

/**
 * Detect output type from command and content
 */
function detectOutputType(command: string, output: string): TerminalChunk['chunk_type'] {
  const cmd = command.toLowerCase();
  
  // File listing commands
  if (cmd.match(/\b(ls|find|tree|dir)\b/) && output.match(/^[-drwx]/m)) {
    return 'file_listing';
  }
  
  // Network scan commands
  if (cmd.match(/\b(nmap|masscan|netstat|ss|ip|ifconfig|ping|curl|wget)\b/)) {
    return 'network_scan';
  }
  
  // Process listing
  if (cmd.match(/\b(ps|top|htop|pgrep)\b/)) {
    return 'process_list';
  }
  
  // Config dumps
  if (cmd.match(/\b(cat|less|more|head|tail)\b.*\.(conf|config|ini|yml|yaml|json|xml)/)) {
    return 'config_dump';
  }
  
  // Error output
  if (output.match(/error|failed|denied|not found/i) && output.split('\n').length < 20) {
    return 'error_output';
  }
  
  return 'generic';
}

/**
 * Chunk file listing output
 */
function chunkFileListing(
  command_id: number,
  command: string,
  lines: string[]
): TerminalChunk[] {
  const chunks: TerminalChunk[] = [];
  const chunkSize = 100;
  
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunkLines = lines.slice(i, i + chunkSize);
    const raw_text = chunkLines.join('\n');
    
    chunks.push({
      chunk_id: `${command_id}-files-${i}`,
      command_id,
      command,
      raw_text,
      compressed_facts: [],
      chunk_type: 'file_listing',
      metadata: {
        line_count: chunkLines.length,
        char_count: raw_text.length,
        compression_ratio: 1,
        entities_found: [],
        timestamp: Date.now()
      }
    });
  }
  
  return chunks;
}

/**
 * Chunk network scan output
 */
function chunkNetworkScan(
  command_id: number,
  command: string,
  lines: string[]
): TerminalChunk[] {
  const chunks: TerminalChunk[] = [];
  let currentChunk: string[] = [];
  let currentHost: string | null = null;
  
  for (const line of lines) {
    // Detect new host
    const hostMatch = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    
    if (hostMatch && hostMatch[0] !== currentHost) {
      // New host, save previous chunk
      if (currentChunk.length > 0) {
        chunks.push({
          chunk_id: `${command_id}-net-${currentHost}`,
          command_id,
          command,
          raw_text: currentChunk.join('\n'),
          compressed_facts: [],
          chunk_type: 'network_scan',
          metadata: {
            line_count: currentChunk.length,
            char_count: currentChunk.join('\n').length,
            compression_ratio: 1,
            entities_found: [],
            timestamp: Date.now()
          }
        });
      }
      
      currentHost = hostMatch[0];
      currentChunk = [line];
    } else {
      currentChunk.push(line);
    }
  }
  
  // Save last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      chunk_id: `${command_id}-net-${currentHost || 'final'}`,
      command_id,
      command,
      raw_text: currentChunk.join('\n'),
      compressed_facts: [],
      chunk_type: 'network_scan',
      metadata: {
        line_count: currentChunk.length,
        char_count: currentChunk.join('\n').length,
        compression_ratio: 1,
        entities_found: [],
        timestamp: Date.now()
      }
    });
  }
  
  return chunks.length > 0 ? chunks : chunkGeneric(command_id, command, lines);
}

/**
 * Chunk process list output
 */
function chunkProcessList(
  command_id: number,
  command: string,
  lines: string[]
): TerminalChunk[] {
  const chunks: TerminalChunk[] = [];
  const chunkSize = 50;
  
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunkLines = lines.slice(i, i + chunkSize);
    const raw_text = chunkLines.join('\n');
    
    chunks.push({
      chunk_id: `${command_id}-proc-${i}`,
      command_id,
      command,
      raw_text,
      compressed_facts: [],
      chunk_type: 'process_list',
      metadata: {
        line_count: chunkLines.length,
        char_count: raw_text.length,
        compression_ratio: 1,
        entities_found: [],
        timestamp: Date.now()
      }
    });
  }
  
  return chunks;
}

/**
 * Chunk config dump output
 */
function chunkConfigDump(
  command_id: number,
  command: string,
  lines: string[]
): TerminalChunk[] {
  const chunks: TerminalChunk[] = [];
  const chunkSize = 200;
  
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunkLines = lines.slice(i, i + chunkSize);
    const raw_text = chunkLines.join('\n');
    
    chunks.push({
      chunk_id: `${command_id}-config-${i}`,
      command_id,
      command,
      raw_text,
      compressed_facts: [],
      chunk_type: 'config_dump',
      metadata: {
        line_count: chunkLines.length,
        char_count: raw_text.length,
        compression_ratio: 1,
        entities_found: [],
        timestamp: Date.now()
      }
    });
  }
  
  return chunks;
}

/**
 * Generic chunking
 */
function chunkGeneric(
  command_id: number,
  command: string,
  lines: string[]
): TerminalChunk[] {
  const chunks: TerminalChunk[] = [];
  const chunkSize = 100;
  
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunkLines = lines.slice(i, i + chunkSize);
    const raw_text = chunkLines.join('\n');
    
    chunks.push({
      chunk_id: `${command_id}-gen-${i}`,
      command_id,
      command,
      raw_text,
      compressed_facts: [],
      chunk_type: 'generic',
      metadata: {
        line_count: chunkLines.length,
        char_count: raw_text.length,
        compression_ratio: 1,
        entities_found: [],
        timestamp: Date.now()
      }
    });
  }
  
  return chunks;
}

/**
 * Compress chunk into key facts
 */
function compressChunk(chunk: TerminalChunk): TerminalChunk {
  const facts: string[] = [];
  const entities: string[] = [];
  
  switch (chunk.chunk_type) {
    case 'file_listing':
      return compressFileListing(chunk);
    case 'network_scan':
      return compressNetworkScan(chunk);
    case 'process_list':
      return compressProcessList(chunk);
    case 'config_dump':
      return compressConfigDump(chunk);
    case 'error_output':
      return compressErrorOutput(chunk);
    default:
      return compressGeneric(chunk);
  }
}

/**
 * Compress file listing to key facts
 */
function compressFileListing(chunk: TerminalChunk): TerminalChunk {
  const lines = chunk.raw_text.split('\n');
  const facts: string[] = [];
  const entities: string[] = [];
  
  // Extract interesting files only
  const interestingFiles: string[] = [];
  
  for (const line of lines) {
    // Skip noise (node_modules, .so files, etc.)
    if (line.includes('node_modules')) continue;
    if (line.match(/\.so(\.\d+)*$/)) continue;
    
    // Keep interesting files
    if (line.match(/password|passwd|cred|secret|key|token|config|\.env|\.ssh|backup|admin|root/i)) {
      const path = extractPath(line);
      if (path) {
        interestingFiles.push(path);
        entities.push(`f:${path}`);
      }
    }
  }
  
  // Summarize
  if (interestingFiles.length > 0) {
    facts.push(`Found ${interestingFiles.length} interesting files`);
    facts.push(...interestingFiles.slice(0, 10)); // Top 10
    if (interestingFiles.length > 10) {
      facts.push(`... and ${interestingFiles.length - 10} more`);
    }
  } else {
    facts.push(`Scanned ${lines.length} files, no interesting files found`);
  }
  
  chunk.compressed_facts = facts;
  chunk.metadata.entities_found = entities;
  chunk.metadata.compression_ratio = chunk.raw_text.length / facts.join(' ').length;
  
  return chunk;
}

/**
 * Compress network scan to key facts
 */
function compressNetworkScan(chunk: TerminalChunk): TerminalChunk {
  const lines = chunk.raw_text.split('\n');
  const facts: string[] = [];
  const entities: string[] = [];
  
  // Extract IPs and open ports
  const hosts = new Set<string>();
  const openPorts: Array<{ ip: string; port: number; service?: string }> = [];
  
  for (const line of lines) {
    // Extract IPs
    const ipMatch = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) {
      hosts.add(ipMatch[0]);
      entities.push(`h:${ipMatch[0]}`);
    }
    
    // Extract open ports
    const portMatch = line.match(/(\d+)\/(tcp|udp)\s+(open|OPEN)/i);
    if (portMatch && ipMatch) {
      const port = parseInt(portMatch[1]);
      const serviceMatch = line.match(/\s+([a-zA-Z0-9_-]+)\s*$/);
      openPorts.push({
        ip: ipMatch[0],
        port,
        service: serviceMatch?.[1]
      });
      entities.push(`svc:${ipMatch[0]}:${port}`);
    }
  }
  
  // Summarize
  facts.push(`Scanned ${hosts.size} hosts`);
  if (openPorts.length > 0) {
    facts.push(`Found ${openPorts.length} open ports`);
    for (const { ip, port, service } of openPorts.slice(0, 20)) {
      facts.push(`${ip}:${port}${service ? ` (${service})` : ''}`);
    }
    if (openPorts.length > 20) {
      facts.push(`... and ${openPorts.length - 20} more ports`);
    }
  } else {
    facts.push('No open ports found');
  }
  
  chunk.compressed_facts = facts;
  chunk.metadata.entities_found = entities;
  chunk.metadata.compression_ratio = chunk.raw_text.length / facts.join(' ').length;
  
  return chunk;
}

/**
 * Compress process list to key facts
 */
function compressProcessList(chunk: TerminalChunk): TerminalChunk {
  const lines = chunk.raw_text.split('\n');
  const facts: string[] = [];
  const entities: string[] = [];
  
  // Extract interesting processes
  const interestingProcs: string[] = [];
  
  for (const line of lines) {
    // Look for interesting processes
    if (line.match(/ssh|tunnel|proxy|docker|chisel|socat|nc|netcat|python|perl|ruby|bash.*-i/i)) {
      interestingProcs.push(line.trim());
    }
  }
  
  // Summarize
  facts.push(`Found ${lines.length} processes`);
  if (interestingProcs.length > 0) {
    facts.push(`${interestingProcs.length} interesting processes:`);
    facts.push(...interestingProcs.slice(0, 10));
    if (interestingProcs.length > 10) {
      facts.push(`... and ${interestingProcs.length - 10} more`);
    }
  }
  
  chunk.compressed_facts = facts;
  chunk.metadata.entities_found = entities;
  chunk.metadata.compression_ratio = chunk.raw_text.length / facts.join(' ').length;
  
  return chunk;
}

/**
 * Compress config dump to key facts
 */
function compressConfigDump(chunk: TerminalChunk): TerminalChunk {
  const lines = chunk.raw_text.split('\n');
  const facts: string[] = [];
  const entities: string[] = [];
  
  // Extract key config values
  const keyValues: string[] = [];
  
  for (const line of lines) {
    // Look for interesting config
    if (line.match(/password|secret|key|token|api|credential|user|admin|database|connection/i)) {
      keyValues.push(line.trim());
    }
  }
  
  // Summarize
  if (keyValues.length > 0) {
    facts.push(`Found ${keyValues.length} interesting config lines:`);
    facts.push(...keyValues.slice(0, 15));
    if (keyValues.length > 15) {
      facts.push(`... and ${keyValues.length - 15} more`);
    }
  } else {
    facts.push(`Config file with ${lines.length} lines, no sensitive data found`);
  }
  
  chunk.compressed_facts = facts;
  chunk.metadata.entities_found = entities;
  chunk.metadata.compression_ratio = chunk.raw_text.length / facts.join(' ').length;
  
  return chunk;
}

/**
 * Compress error output
 */
function compressErrorOutput(chunk: TerminalChunk): TerminalChunk {
  // Keep errors as-is (usually small)
  chunk.compressed_facts = [chunk.raw_text];
  chunk.metadata.compression_ratio = 1;
  
  return chunk;
}

/**
 * Compress generic output
 */
function compressGeneric(chunk: TerminalChunk): TerminalChunk {
  const lines = chunk.raw_text.split('\n');
  
  // Just summarize line count
  chunk.compressed_facts = [`Output: ${lines.length} lines`];
  chunk.metadata.compression_ratio = chunk.raw_text.length / chunk.compressed_facts[0].length;
  
  return chunk;
}

/**
 * Generate overall summary
 */
function generateSummary(command: string, chunks: TerminalChunk[]): string {
  const totalLines = chunks.reduce((sum, c) => sum + c.metadata.line_count, 0);
  const totalFacts = chunks.reduce((sum, c) => sum + c.compressed_facts.length, 0);
  
  return `${command}: ${totalLines} lines → ${totalFacts} key facts (${chunks.length} chunks)`;
}

/**
 * Extract path from ls -la line
 */
function extractPath(line: string): string | null {
  // Try to extract path from ls -la output
  const lsMatch = line.match(/\s+(\S+\/\S+)$/);
  if (lsMatch) return lsMatch[1];
  
  // Try to extract path from find output
  const findMatch = line.match(/^(\/\S+)/);
  if (findMatch) return findMatch[1];
  
  // Try to extract any path-like string
  const pathMatch = line.match(/([\/~]\S+)/);
  if (pathMatch) return pathMatch[1];
  
  return null;
}
