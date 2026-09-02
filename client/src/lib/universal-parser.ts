// Universal parser for ALL pentesting tools and custom commands
// Detects tool type and parses output accordingly

// Import all modular parsers
import {
  parseNmap,
  parseMasscan,
  parseNikto,
  parseNuclei,
  parseWPScan,
  parseSubfinder,
  parseAmass,
  parseAssetfinder,
  parseSublist3r,
  parseDNSEnum,
  parseGobuster,
  parseFfuf,
  parseWfuzz,
  parseSQLMap,
  parseHydra,
  parseJohn,
  parseHashcat,
  parseTheHarvester,
  parseWhois,
  parseTcpdump,
  parseSSLScan,
  parseCustom,
} from './parsers';
import { cleanANSI } from './utils/ansi-cleaner';

export type ToolType = 
  // Network Scanners
  | 'nmap' | 'masscan' | 'zmap' | 'unicornscan'
  // Web Scanners
  | 'nikto' | 'nuclei' | 'wpscan' | 'joomscan' | 'droopescan'
  // Directory Busters
  | 'gobuster' | 'dirbuster' | 'feroxbuster' | 'ffuf' | 'dirb' | 'dirsearch' | 'wfuzz'
  // Subdomain Enumeration
  | 'subfinder' | 'assetfinder' | 'amass' | 'sublist3r'
  // DNS Tools
  | 'dnsenum' | 'dnsrecon' | 'fierce' | 'dig' | 'nslookup' | 'host'
  // Exploitation
  | 'metasploit' | 'sqlmap' | 'xsstrike' | 'commix' | 'beef'
  // Wireless
  | 'aircrack-ng' | 'reaver' | 'wifite' | 'kismet' | 'bettercap'
  // Password Attacks
  | 'hydra' | 'medusa' | 'ncrack' | 'john' | 'hashcat' | 'crunch'
  // SSL/TLS
  | 'sslscan' | 'sslyze' | 'testssl' | 'tlssled'
  // Port Scanners
  | 'nc' | 'netcat' | 'telnet' | 'ncat'
  // Web Proxies
  | 'burpsuite' | 'zaproxy' | 'mitmproxy'
  // Recon
  | 'whois' | 'theHarvester' | 'recon-ng' | 'maltego' | 'shodan'
  // Sniffers
  | 'wireshark' | 'tcpdump' | 'tshark' | 'ettercap'
  // Custom/Unknown
  | 'custom';

export interface UniversalFinding {
  id: string;
  type: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown';
  title: string;
  description?: string;
  data: Record<string, any>;
  timestamp: number;
}

export interface UniversalResult {
  tool: ToolType;
  command: string;
  findings: UniversalFinding[];
  summary: Record<string, any>;
  rawOutput: string;
  metadata: {
    target?: string;
    startTime?: number;
    endTime?: number;
    duration?: string;
    hasError?: boolean; // Track if scan had errors
    rawOutputTruncated?: boolean;
    parserInputLength?: number;
  };
}

export const UNIVERSAL_PARSER_LIMITS = {
  // Session imports can bypass the live terminal buffer. Bound parser work at
  // the parser boundary as well so one pasted tool dump cannot exhaust the
  // renderer before a tool-specific parser runs.
  maxInputChars: 8 * 1024 * 1024,
  maxFindings: 10000,
  slowParseMs: 5000,
} as const;

function boundParserInput(output: string): { value: string; truncated: boolean } {
  if (output.length <= UNIVERSAL_PARSER_LIMITS.maxInputChars) {
    return { value: output, truncated: false };
  }

  const marker = '\n...[parser input truncated; head and tail retained]...\n';
  const available = UNIVERSAL_PARSER_LIMITS.maxInputChars - marker.length;
  const headLength = Math.floor(available * 0.25);
  const tailLength = available - headLength;
  return {
    value: `${output.slice(0, headLength)}${marker}${output.slice(-tailLength)}`,
    truncated: true,
  };
}

function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';

  try {
    return String(value);
  } catch {
    return '';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const tokenPattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(command)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? '';
    tokens.push(token.replace(/\\([\\"'\s])/g, '$1'));
  }

  return tokens;
}

function normalizeExecutableToken(token: string): string {
  const withoutAssignment = token.includes('=') && !token.startsWith('-')
    ? token.slice(token.lastIndexOf('=') + 1)
    : token;
  const basename = withoutAssignment.split(/[\\/]/).pop() || withoutAssignment;
  return basename.toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, '');
}

function hasExecutableToken(tokens: string[], names: string[]): boolean {
  const normalizedNames = new Set(names.map(name => name.toLowerCase()));
  const executableToken = tokens.find(token => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  return executableToken
    ? normalizedNames.has(normalizeExecutableToken(executableToken))
    : false;
}

function hasOutputWord(output: string, words: string[]): boolean {
  return words.some(word => new RegExp(
    `(?:^|[^a-z0-9_-])${escapeRegExp(word)}(?:$|[^a-z0-9_-])`,
    'i',
  ).test(output));
}

interface ToolDetector {
  tool: ToolType;
  commandNames: string[];
  outputNames?: string[];
}

const TOOL_DETECTORS: ToolDetector[] = [
  { tool: 'nmap', commandNames: ['nmap'], outputNames: ['nmap'] },
  { tool: 'masscan', commandNames: ['masscan'], outputNames: ['masscan'] },
  { tool: 'zmap', commandNames: ['zmap'], outputNames: ['zmap'] },
  { tool: 'unicornscan', commandNames: ['unicornscan'], outputNames: ['unicornscan'] },
  { tool: 'nikto', commandNames: ['nikto'], outputNames: ['nikto'] },
  { tool: 'nuclei', commandNames: ['nuclei'], outputNames: ['nuclei'] },
  { tool: 'wpscan', commandNames: ['wpscan'], outputNames: ['wpscan'] },
  { tool: 'joomscan', commandNames: ['joomscan'], outputNames: ['joomscan'] },
  { tool: 'droopescan', commandNames: ['droopescan'], outputNames: ['droopescan'] },
  { tool: 'gobuster', commandNames: ['gobuster'], outputNames: ['gobuster'] },
  { tool: 'dirbuster', commandNames: ['dirbuster'], outputNames: ['dirbuster'] },
  { tool: 'feroxbuster', commandNames: ['feroxbuster'], outputNames: ['feroxbuster'] },
  { tool: 'ffuf', commandNames: ['ffuf'], outputNames: ['ffuf'] },
  { tool: 'dirb', commandNames: ['dirb'], outputNames: ['dirb'] },
  { tool: 'dirsearch', commandNames: ['dirsearch'], outputNames: ['dirsearch'] },
  { tool: 'wfuzz', commandNames: ['wfuzz'], outputNames: ['wfuzz'] },
  { tool: 'subfinder', commandNames: ['subfinder'], outputNames: ['subfinder'] },
  { tool: 'assetfinder', commandNames: ['assetfinder'], outputNames: ['assetfinder'] },
  { tool: 'amass', commandNames: ['amass'], outputNames: ['amass'] },
  { tool: 'sublist3r', commandNames: ['sublist3r'], outputNames: ['sublist3r'] },
  { tool: 'dnsenum', commandNames: ['dnsenum'], outputNames: ['dnsenum'] },
  { tool: 'dnsrecon', commandNames: ['dnsrecon'], outputNames: ['dnsrecon'] },
  { tool: 'fierce', commandNames: ['fierce'], outputNames: ['fierce'] },
  { tool: 'dig', commandNames: ['dig'], outputNames: ['dig'] },
  { tool: 'nslookup', commandNames: ['nslookup'], outputNames: ['nslookup'] },
  { tool: 'host', commandNames: ['host'], outputNames: ['host'] },
  { tool: 'metasploit', commandNames: ['msfconsole', 'msfvenom'], outputNames: ['metasploit'] },
  { tool: 'sqlmap', commandNames: ['sqlmap'], outputNames: ['sqlmap'] },
  { tool: 'xsstrike', commandNames: ['xsstrike'], outputNames: ['xsstrike'] },
  { tool: 'commix', commandNames: ['commix'], outputNames: ['commix'] },
  { tool: 'beef', commandNames: ['beef'], outputNames: ['beef'] },
  { tool: 'aircrack-ng', commandNames: ['aircrack-ng', 'airodump-ng', 'aireplay-ng'], outputNames: ['aircrack-ng'] },
  { tool: 'reaver', commandNames: ['reaver'], outputNames: ['reaver'] },
  { tool: 'wifite', commandNames: ['wifite'], outputNames: ['wifite'] },
  { tool: 'kismet', commandNames: ['kismet'], outputNames: ['kismet'] },
  { tool: 'bettercap', commandNames: ['bettercap'], outputNames: ['bettercap'] },
  { tool: 'hydra', commandNames: ['hydra'], outputNames: ['hydra'] },
  { tool: 'medusa', commandNames: ['medusa'], outputNames: ['medusa'] },
  { tool: 'ncrack', commandNames: ['ncrack'], outputNames: ['ncrack'] },
  { tool: 'john', commandNames: ['john'], outputNames: ['john the ripper'] },
  { tool: 'hashcat', commandNames: ['hashcat'], outputNames: ['hashcat'] },
  { tool: 'crunch', commandNames: ['crunch'], outputNames: ['crunch'] },
  { tool: 'sslscan', commandNames: ['sslscan'], outputNames: ['sslscan'] },
  { tool: 'sslyze', commandNames: ['sslyze'], outputNames: ['sslyze'] },
  { tool: 'testssl', commandNames: ['testssl'], outputNames: ['testssl'] },
  { tool: 'tlssled', commandNames: ['tlssled'], outputNames: ['tlssled'] },
  { tool: 'nc', commandNames: ['nc', 'netcat'], outputNames: ['netcat'] },
  { tool: 'telnet', commandNames: ['telnet'], outputNames: ['telnet'] },
  { tool: 'ncat', commandNames: ['ncat'], outputNames: ['ncat'] },
  { tool: 'whois', commandNames: ['whois'], outputNames: ['whois'] },
  { tool: 'theHarvester', commandNames: ['theharvester'], outputNames: ['theharvester'] },
  { tool: 'recon-ng', commandNames: ['recon-ng'], outputNames: ['recon-ng'] },
  { tool: 'shodan', commandNames: ['shodan'], outputNames: ['shodan'] },
  { tool: 'tcpdump', commandNames: ['tcpdump'], outputNames: ['tcpdump'] },
  { tool: 'tshark', commandNames: ['tshark'], outputNames: ['tshark'] },
  { tool: 'ettercap', commandNames: ['ettercap'], outputNames: ['ettercap'] },
];

export function detectTool(command: unknown, output: unknown): ToolType {
  const safeCommand = toSafeString(command);
  const safeOutput = toSafeString(output);
  const commandTokens = tokenizeCommand(safeCommand);

  // Prefer command evidence. Exact executable tokens prevent names such as
  // "nmap-wrapper" or a target argument containing "nmap" from selecting a
  // parser accidentally.
  for (const detector of TOOL_DETECTORS) {
    if (hasExecutableToken(commandTokens, detector.commandNames)) return detector.tool;
  }

  // Output evidence is deliberately word-boundary based as well. A scanner
  // name embedded in an unrelated identifier is not a tool banner.
  for (const detector of TOOL_DETECTORS) {
    if (detector.outputNames && hasOutputWord(safeOutput, detector.outputNames)) {
      return detector.tool;
    }
  }

  return 'custom';
}

// ============================================================================
// MAIN UNIVERSAL PARSER
// ============================================================================

export function parseUniversalOutput(command: unknown, output: unknown, targetOverride?: unknown): UniversalResult {
  const safeCommand = toSafeString(command);
  const safeOutput = toSafeString(output);
  const safeTargetOverride = toSafeString(targetOverride).trim() || undefined;
  const boundedInput = boundParserInput(safeOutput);
  // Parse sanitized text so prompts, OSC exit markers, and colored tool
  // banners cannot hide otherwise valid lines from a modular parser. The
  // terminal buffer still retains the original stream for forensic review.
  const parserInput = cleanANSI(boundedInput.value);
  const tool = detectTool(safeCommand, parserInput);
  let findings: UniversalFinding[] = [];
  
  // PROTECTION: Input is bounded before any parser or JSON decoder runs.
  const startTime = Date.now();
  const PARSE_SLOW_THRESHOLD = UNIVERSAL_PARSER_LIMITS.slowParseMs;
  const truncationFinding: UniversalFinding | null = boundedInput.truncated ? {
    id: 'parse-input-truncated',
    type: 'warning',
    severity: 'medium',
    title: 'Parser input was bounded',
    description: `Parser input exceeded ${UNIVERSAL_PARSER_LIMITS.maxInputChars} characters. The beginning and end were retained.`,
    data: {
      originalLength: safeOutput.length,
      parserInputLength: parserInput.length,
      maxInputChars: UNIVERSAL_PARSER_LIMITS.maxInputChars,
    },
    timestamp: Date.now(),
  } : null;
  
  // COMPREHENSIVE: Detect output format
  const format = detectOutputFormat(parserInput, tool);
  console.log(`[universal-parser] Detected tool: ${tool}, format: ${format}`);
  
  // Errors are annotations, not a parser short-circuit. A tool can emit a
  // warning/failure line after valid findings (or print a recoverable warning
  // before them), and the terminal remains the source of truth for all raw
  // output. Keep the error finding while still parsing the complete bounded
  // input.
  const errorCheck = detectErrors(parserInput, tool);
  if (errorCheck.hasError) {
    findings.push({
      id: 'error-0',
      type: 'error',
      severity: 'critical',
      title: errorCheck.title,
      description: errorCheck.message,
      data: {
        error: errorCheck.message,
        details: errorCheck.details,
        raw: parserInput.substring(0, 500),
      },
      timestamp: Date.now(),
    });
  }

  // Keep structured-format metadata small. The full structured payload stays
  // in rawOutput/terminal history; placing it in finding.data duplicates large
  // objects in React state and can freeze the results panel.
  if (format === 'xml' && tool === 'nmap') {
    findings.push({
      id: 'format-info',
      type: 'info',
      severity: 'info',
      title: 'XML Output Detected',
      description: 'Nmap XML output detected and parsed into host and port findings.',
      data: { format: 'xml' },
      timestamp: Date.now(),
    });
  } else if (format === 'json') {
    try {
      const jsonData = JSON.parse(parserInput);
      const isArray = Array.isArray(jsonData);
      const objectKeys = !isArray && jsonData && typeof jsonData === 'object'
        ? Object.keys(jsonData).slice(0, 50)
        : [];
      findings.push({
        id: 'format-info',
        type: 'info',
        severity: 'info',
        title: 'JSON Output Detected',
        description: 'JSON output detected and parsed.',
        data: {
          format: 'json',
          topLevel: isArray ? 'array' : typeof jsonData,
          itemCount: isArray ? jsonData.length : undefined,
          keys: objectKeys,
        },
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error('[universal-parser] Failed to parse JSON:', e);
    }
  }
  
  // PROTECTION: Wrap parsing in try-catch with timeout check
  try {
    let parsedFindings: UniversalFinding[] = [];
    // Route to appropriate parser (now using modular parsers)
    switch (tool) {
      case 'nmap':
        parsedFindings = parseNmap(parserInput);
        break;
      case 'nikto':
        parsedFindings = parseNikto(parserInput);
        break;
      case 'nuclei':
        parsedFindings = parseNuclei(parserInput);
        break;
      case 'gobuster':
      case 'dirbuster':
      case 'feroxbuster':
      case 'dirb':
      case 'dirsearch':
        parsedFindings = parseGobuster(parserInput);
        break;
      case 'ffuf':
        parsedFindings = parseFfuf(parserInput);
        break;
      case 'masscan':
        parsedFindings = parseMasscan(parserInput);
        break;
      case 'wpscan':
        parsedFindings = parseWPScan(parserInput);
        break;
      case 'subfinder':
        parsedFindings = parseSubfinder(parserInput);
        break;
      case 'amass':
        parsedFindings = parseAmass(parserInput);
        break;
      case 'assetfinder':
        parsedFindings = parseAssetfinder(parserInput);
        break;
      case 'sublist3r':
        parsedFindings = parseSublist3r(parserInput);
        break;
      case 'dnsenum':
      case 'dnsrecon':
      case 'fierce':
        parsedFindings = parseDNSEnum(parserInput);
        break;
      case 'sqlmap':
        parsedFindings = parseSQLMap(parserInput);
        break;
      case 'hydra':
      case 'medusa':
      case 'ncrack':
        parsedFindings = parseHydra(parserInput);
        break;
      case 'sslscan':
      case 'sslyze':
      case 'testssl':
        parsedFindings = parseSSLScan(parserInput);
        break;
      case 'wfuzz':
        parsedFindings = parseWfuzz(parserInput);
        break;
      case 'theHarvester':
        parsedFindings = parseTheHarvester(parserInput);
        break;
      case 'whois':
        parsedFindings = parseWhois(parserInput);
        break;
      case 'tcpdump':
      case 'tshark':
        parsedFindings = parseTcpdump(parserInput);
        break;
      case 'john':
        parsedFindings = parseJohn(parserInput);
        break;
      case 'hashcat':
        parsedFindings = parseHashcat(parserInput);
        break;
      default:
        parsedFindings = parseCustom(parserInput);
        break;
    }

    findings.push(...parsedFindings);
    
    // PROTECTION: Check if parsing took too long
    const parseTime = Date.now() - startTime;
    if (parseTime > PARSE_SLOW_THRESHOLD) {
      console.warn(`[universal-parser] Parsing took ${parseTime}ms (slow threshold: ${PARSE_SLOW_THRESHOLD}ms)`);
      findings.unshift({
        id: 'parse-slow',
        type: 'warning',
        severity: 'low',
        title: 'Slow Parsing Detected',
        description: `Parsing took ${parseTime}ms. The bounded input may still be expensive for this tool format.`,
        data: { parseTime, slowParseMs: PARSE_SLOW_THRESHOLD },
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    console.error('[universal-parser] Parser crashed:', error);
    findings.push({
      id: 'parse-error',
      type: 'error',
      severity: 'critical',
      title: 'Parser Error',
      description: error instanceof Error ? error.message : 'Unknown parser error',
      data: { error: String(error), tool, outputLength: parserInput.length },
      timestamp: Date.now(),
    });
  }

  // Keep the input-truncation marker inside the same cap as parser findings.
  // Otherwise a parser that already returned exactly maxFindings could grow by
  // one more item when the imported output was bounded.
  if (truncationFinding && !findings.includes(truncationFinding)) {
    findings.unshift(truncationFinding);
  }

  if (findings.length > UNIVERSAL_PARSER_LIMITS.maxFindings) {
    const headCount = Math.floor(UNIVERSAL_PARSER_LIMITS.maxFindings * 0.8);
    const tailCount = UNIVERSAL_PARSER_LIMITS.maxFindings - headCount - 1;
    findings = [
      ...findings.slice(0, headCount),
      ...findings.slice(-tailCount),
      {
        id: 'parse-findings-truncated',
        type: 'warning',
        severity: 'medium',
        title: `Findings truncated at ${UNIVERSAL_PARSER_LIMITS.maxFindings}`,
        description: 'The parser retained the first and last findings to protect renderer memory.',
        data: { maxFindings: UNIVERSAL_PARSER_LIMITS.maxFindings },
        timestamp: Date.now(),
      },
    ];
  }

  // COMPREHENSIVE: Handle empty results
  if (findings.length === 0 && parserInput.length > 50) {
    findings.push({
      id: 'no-results',
      type: 'info',
      severity: 'info',
      title: 'No Results Found',
      description: 'Scan completed but no findings were detected.',
      data: {
        outputLength: parserInput.length,
        outputPreview: parserInput.substring(0, 200),
      },
      timestamp: Date.now(),
    });
  }
  
  // GUI ENHANCEMENT: Build comprehensive summary with stats
  const summary: Record<string, any> = {
    total: findings.length,
    byType: {},
    bySeverity: {},
    format,
    truncated: boundedInput.truncated || findings.some((finding) => finding.id === 'parse-findings-truncated'),
    // GUI enhancement: Add quick stats
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    infoCount: 0,
    unknownCount: 0,
  };
  
  findings.forEach(f => {
    summary.byType[f.type] = (summary.byType[f.type] || 0) + 1;
    if (f.severity) {
      summary.bySeverity[f.severity] = (summary.bySeverity[f.severity] || 0) + 1;
      
      // Quick access counters for GUI
      if (f.severity === 'critical') summary.criticalCount++;
      else if (f.severity === 'high') summary.highCount++;
      else if (f.severity === 'medium') summary.mediumCount++;
      else if (f.severity === 'low') summary.lowCount++;
      else if (f.severity === 'info') summary.infoCount++;
      else if (f.severity === 'unknown') summary.unknownCount++;
    }
  });
  
  // GUI ENHANCEMENT: Add risk score (0-100)
  summary.riskScore = calculateRiskScore(summary);
  
  return {
    tool,
    command: safeCommand,
    findings,
    summary,
    rawOutput: parserInput,
    metadata: {
      target: safeTargetOverride || extractTarget(safeCommand),
      startTime,
      endTime: Date.now(),
      duration: `${Date.now() - startTime}ms`,
      rawOutputTruncated: boundedInput.truncated,
      parserInputLength: parserInput.length,
      hasError: errorCheck.hasError,
    },
  };
}

/**
 * Calculate risk score for GUI display (0-100)
 */
function calculateRiskScore(summary: any): number {
  const weights = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
    info: 0,
  };
  
  const score = 
    (summary.criticalCount || 0) * weights.critical +
    (summary.highCount || 0) * weights.high +
    (summary.mediumCount || 0) * weights.medium +
    (summary.lowCount || 0) * weights.low;
  
  // Cap at 100
  return Math.min(100, score);
}

// Detect output format
function isCompleteXmlDocument(output: string, root: string): boolean {
  const escapedRoot = escapeRegExp(root);
  return new RegExp(
    `<${escapedRoot}\\b[^>]*>[\\s\\S]*<\\/${escapedRoot}>`,
    'i',
  ).test(output);
}

function parseCsvRow(line: string): string[] | null {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      fields.push(field.trim());
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) return null;
  fields.push(field.trim());
  return fields;
}

function detectOutputFormat(output: string, tool: ToolType): string {
  const trimmed = output.trim();
  if (!trimmed) return 'text';

  // Require a recognizable, complete tool-specific XML document. An arbitrary
  // log line containing "<host>" or only an XML declaration is still text.
  if (isCompleteXmlDocument(trimmed, 'nmaprun') || isCompleteXmlDocument(trimmed, 'niktoscan')) {
    return 'xml';
  }

  // JSON detection
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not valid JSON
    }
  }

  // JSONL detection (nuclei -jsonl). A single JSON object is handled above;
  // requiring two records avoids labeling ordinary JSON-like text as JSONL.
  const jsonLines = output.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
  if (jsonLines.length >= 2 && jsonLines.every(line => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  })) {
    return 'jsonl';
  }

  // Grepable format (nmap -oG)
  if (tool === 'nmap' && /(^|\\n)#\\s*nmap\\b/i.test(output) && /(^|\\n)host:/i.test(output)) {
    return 'grepable';
  }

  // CSV detection requires several complete rows with a stable column count;
  // a comma in a diagnostic or URL must not switch the parser format.
  const csvLines = output.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
  if (csvLines.length >= 3) {
    const rows = csvLines.slice(0, 100).map(parseCsvRow);
    const width = rows[0]?.length || 0;
    if (width >= 2 && rows.every(row => row !== null && row.length === width)) {
      return 'csv';
    }
  }

  return 'text';
}

// Comprehensive error detection
function detectErrors(output: string, tool: ToolType): {
  hasError: boolean;
  title: string;
  message: string;
  details: string;
} {
  const lowerOutput = output.toLowerCase();
  
  // Tool not installed
  if (lowerOutput.includes('command not found') ||
      lowerOutput.includes('not found, but can be installed') ||
      lowerOutput.includes('not recognized as an internal or external command')) {
    return {
      hasError: true,
      title: 'Tool Not Installed',
      message: `${tool} is not installed on your system`,
      details: `Install ${tool} using your package manager (apt, brew, etc.)`,
    };
  }
  
  // Connection errors
  if (lowerOutput.includes('connection refused') ||
      lowerOutput.includes('failed to connect') ||
      lowerOutput.includes('could not connect')) {
    return {
      hasError: true,
      title: 'Connection Refused',
      message: 'Target refused the connection',
      details: 'Target may be down, firewalled, or service not running',
    };
  }
  
  // Timeout errors
  if (lowerOutput.includes('connection timed out') ||
      lowerOutput.includes('timeout') && lowerOutput.includes('connect')) {
    return {
      hasError: true,
      title: 'Connection Timeout',
      message: 'Connection to target timed out',
      details: 'Target may be slow, down, or network issues present',
    };
  }
  
  // Permission errors
  if (lowerOutput.includes('permission denied') ||
      lowerOutput.includes('requires root privileges') ||
      lowerOutput.includes('must be run as root')) {
    return {
      hasError: true,
      title: 'Permission Denied',
      message: 'Insufficient privileges to run scan',
      details: 'Run with sudo or as administrator',
    };
  }
  
  // Hostname resolution errors
  if (lowerOutput.includes('failed to resolve') ||
      lowerOutput.includes('could not resolve') ||
      lowerOutput.includes('name or service not known')) {
    return {
      hasError: true,
      title: 'Hostname Resolution Failed',
      message: 'Cannot resolve target hostname',
      details: 'Check hostname spelling or use IP address',
    };
  }
  
  // Template not found (nuclei) must be classified before the generic file
  // branch, otherwise the UI gives an actionable template failure the wrong
  // remediation.
  if (tool === 'nuclei' && /\btemplate(?:s)?\b[\s\S]*\bnot found\b/i.test(output)) {
    return {
      hasError: true,
      title: 'Templates Not Found',
      message: 'Nuclei templates not found',
      details: 'Run: nuclei -update-templates',
    };
  }

  // File not found
  if (lowerOutput.includes('file not found') ||
      lowerOutput.includes('no such file') ||
      (lowerOutput.includes('wordlist') && lowerOutput.includes('not found'))) {
    return {
      hasError: true,
      title: 'File Not Found',
      message: 'Required file or wordlist not found',
      details: 'Check file path and permissions',
    };
  }
  
  // Invalid target
  if (lowerOutput.includes('invalid target') ||
      lowerOutput.includes('invalid hostname')) {
    return {
      hasError: true,
      title: 'Invalid Target',
      message: 'Target specification is invalid',
      details: 'Use valid IP address, hostname, or CIDR notation',
    };
  }
  
  // Process killed
  if (lowerOutput.includes('killed') ||
      lowerOutput.includes('terminated') ||
      lowerOutput.includes('interrupted')) {
    return {
      hasError: true,
      title: 'Scan Interrupted',
      message: 'Scan was stopped before completion',
      details: 'Partial results may be available',
    };
  }
  
  return {
    hasError: false,
    title: '',
    message: '',
    details: '',
  };
}

function extractTarget(command: string): string | undefined {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return undefined;

  // Try to extract target from command
  const parts = trimmedCommand.split(/\s+/);
  
  // Look for IP addresses
  const ipMatch = trimmedCommand.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  if (ipMatch) return ipMatch[1];
  
  // Look for domains
  const domainMatch = trimmedCommand.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/i);
  if (domainMatch) return domainMatch[0];
  
  // Look for URLs
  const urlMatch = trimmedCommand.match(/https?:\/\/([^\s/]+)/i);
  if (urlMatch) return urlMatch[1];
  
  // Return last argument as fallback, but never expose an empty target.
  return parts[parts.length - 1] || undefined;
}
