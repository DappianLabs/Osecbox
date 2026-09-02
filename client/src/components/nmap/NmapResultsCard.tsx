import React, { useState } from 'react';
import {
  Server,
  Wifi,
  Shield,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Info,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AiExplanationState {
  loading: boolean;
  text?: string;
  error?: string;
}

interface NmapHost {
  ip: string;
  hostname?: string;
  state?: string;
  status?: string;
  os?: string;
  mac?: string;
  ports: Array<{
    port: number;
    protocol: string;
    state: string;
    service?: string;
    version?: string;
    product?: string;
  }>;
}

interface NmapResultsCardProps {
  results: NmapHost[];
  target: string;
}

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type NoteLevel = 'danger' | 'warning' | 'success' | 'tip' | 'info';

interface PortNote {
  level: NoteLevel;
  text: string;
}

interface PortIntelligence {
  name: string;
  summary: string;
  description: string;
  vendor?: string;
  risk: RiskLevel;
  notes: PortNote[];
}

// Map each note level to an SVG icon + color (no emojis)
const NOTE_ICONS: Record<NoteLevel, LucideIcon> = {
  danger: ShieldAlert,
  warning: AlertTriangle,
  success: CheckCircle2,
  tip: Lightbulb,
  info: Info,
};

const NOTE_ICON_COLORS: Record<NoteLevel, string> = {
  danger: 'text-red-500',
  warning: 'text-amber-500',
  success: 'text-emerald-500',
  tip: 'text-sky-500',
  info: 'text-muted-foreground',
};

// Risk-based accent styling
const RISK_SUMMARY_STYLES: Record<RiskLevel, string> = {
  critical: 'bg-red-500/5 border-red-500/40 text-red-600 dark:text-red-400',
  high: 'bg-orange-500/5 border-orange-500/40 text-orange-600 dark:text-orange-400',
  medium: 'bg-amber-500/5 border-amber-500/40 text-amber-600 dark:text-amber-400',
  low: 'bg-sky-500/5 border-sky-500/40 text-sky-600 dark:text-sky-400',
};

const RISK_DETAIL_STYLES: Record<RiskLevel, string> = {
  critical: 'bg-red-500/10 border-red-500/30',
  high: 'bg-orange-500/10 border-orange-500/30',
  medium: 'bg-amber-500/10 border-amber-500/30',
  low: 'bg-sky-500/10 border-sky-500/30',
};

const RISK_BADGE_STYLES: Record<RiskLevel, string> = {
  critical: 'border-red-500 text-red-500',
  high: 'border-orange-500 text-orange-500',
  medium: 'border-amber-500 text-amber-500',
  low: 'border-sky-500 text-sky-500',
};

// Port intelligence database with concise summaries and typed security notes
const PORT_DB: Record<number, PortIntelligence> = {
  21: {
    name: 'FTP',
    summary: 'File Transfer Protocol. Transmits credentials in plaintext and is a high-value target for brute-force attacks.',
    description: 'Used for transferring files between systems',
    vendor: 'Standard Protocol',
    risk: 'high',
    notes: [
      { level: 'warning', text: 'Transmits credentials in plaintext' },
      { level: 'tip', text: 'Consider using SFTP (port 22) or FTPS instead' },
      { level: 'warning', text: 'Common target for brute-force attacks' },
      { level: 'info', text: 'Often misconfigured with anonymous access' },
    ],
  },
  22: {
    name: 'SSH',
    summary: 'Secure Shell for encrypted remote access. Secure when key-based authentication is enforced.',
    description: 'Encrypted remote access protocol',
    vendor: 'OpenSSH / Standard',
    risk: 'low',
    notes: [
      { level: 'success', text: 'Encrypted and secure when properly configured' },
      { level: 'tip', text: 'Use key-based authentication instead of passwords' },
      { level: 'warning', text: 'Still vulnerable to brute force with weak passwords' },
      { level: 'info', text: 'Monitor for unusual login attempts' },
    ],
  },
  23: {
    name: 'Telnet',
    summary: 'Critical: unencrypted remote access that sends passwords in plaintext. Replace with SSH immediately.',
    description: 'Unencrypted remote access protocol',
    vendor: 'Legacy Protocol',
    risk: 'critical',
    notes: [
      { level: 'danger', text: 'Sends all data, including passwords, in plaintext' },
      { level: 'danger', text: 'Should never be used in production' },
      { level: 'tip', text: 'Replace with SSH immediately' },
      { level: 'warning', text: 'Extremely vulnerable to man-in-the-middle attacks' },
    ],
  },
  25: {
    name: 'SMTP',
    summary: 'Email sending protocol. Can be abused for spam if misconfigured and should enforce TLS/SSL.',
    description: 'Simple Mail Transfer Protocol - Email sending',
    vendor: 'Standard Protocol',
    risk: 'medium',
    notes: [
      { level: 'info', text: 'Used for sending emails between servers' },
      { level: 'warning', text: 'Can be abused for spam if misconfigured' },
      { level: 'tip', text: 'Should use TLS/SSL (STARTTLS)' },
      { level: 'tip', text: 'Implement SPF, DKIM, and DMARC' },
    ],
  },
  53: {
    name: 'DNS',
    summary: 'Domain Name System. Critical for the internet and can be exploited for amplification attacks.',
    description: 'Resolves domain names to IP addresses',
    vendor: 'Standard Protocol',
    risk: 'medium',
    notes: [
      { level: 'info', text: 'Critical for internet functionality' },
      { level: 'warning', text: 'Can be exploited for DNS amplification attacks' },
      { level: 'info', text: 'Monitor for DNS tunneling attempts' },
      { level: 'tip', text: 'Use DNSSEC when possible' },
    ],
  },
  80: {
    name: 'HTTP',
    summary: 'Standard unencrypted web server. Should redirect to HTTPS (443) for security.',
    description: 'Hypertext Transfer Protocol - Unencrypted web traffic',
    vendor: 'Standard Protocol',
    risk: 'medium',
    notes: [
      { level: 'info', text: 'Standard web server port' },
      { level: 'warning', text: 'Transmits data in plaintext' },
      { level: 'tip', text: 'Should redirect to HTTPS (443)' },
      { level: 'warning', text: 'Common target for web application attacks' },
    ],
  },
  110: {
    name: 'POP3',
    summary: 'Email retrieval protocol. Transmits credentials in plaintext; use POP3S (995) instead.',
    description: 'Post Office Protocol - Email retrieval',
    vendor: 'Standard Protocol',
    risk: 'high',
    notes: [
      { level: 'info', text: 'Downloads emails from the server' },
      { level: 'warning', text: 'Transmits credentials in plaintext' },
      { level: 'tip', text: 'Use POP3S (995) instead' },
      { level: 'info', text: 'Consider using IMAP for better functionality' },
    ],
  },
  135: {
    name: 'MS-RPC',
    summary: 'Microsoft RPC endpoint mapper. Frequently targeted by malware; block at the firewall externally.',
    description: 'Microsoft RPC Endpoint Mapper',
    vendor: 'Microsoft',
    risk: 'high',
    notes: [
      { level: 'info', text: 'Windows-specific service' },
      { level: 'warning', text: 'Frequently targeted by malware' },
      { level: 'warning', text: 'Used in WannaCry and similar attacks' },
      { level: 'tip', text: 'Should be blocked at the firewall for external access' },
    ],
  },
  139: {
    name: 'NetBIOS',
    summary: 'Legacy Windows networking. Exposes system information and is a common enumeration target.',
    description: 'NetBIOS Session Service - Windows file sharing',
    vendor: 'Microsoft',
    risk: 'high',
    notes: [
      { level: 'info', text: 'Legacy Windows networking' },
      { level: 'warning', text: 'Exposes system information' },
      { level: 'warning', text: 'Common target for enumeration attacks' },
      { level: 'danger', text: 'Should be disabled if not needed' },
    ],
  },
  143: {
    name: 'IMAP',
    summary: 'Email access protocol, more capable than POP3. Use IMAPS (993) to encrypt connections.',
    description: 'Internet Message Access Protocol - Email access',
    vendor: 'Standard Protocol',
    risk: 'medium',
    notes: [
      { level: 'info', text: 'More advanced than POP3' },
      { level: 'warning', text: 'Use IMAPS (993) for encryption' },
      { level: 'info', text: 'Supports folder synchronization' },
      { level: 'info', text: 'Monitor for brute-force attempts' },
    ],
  },
  443: {
    name: 'HTTPS',
    summary: 'Encrypted web traffic over TLS/SSL. Standard for secure websites; verify certificate validity.',
    description: 'HTTP Secure - Encrypted web traffic',
    vendor: 'Standard Protocol',
    risk: 'low',
    notes: [
      { level: 'success', text: 'Encrypted web traffic using TLS/SSL' },
      { level: 'tip', text: 'Standard for secure websites' },
      { level: 'info', text: 'Check certificate validity' },
      { level: 'warning', text: 'Still vulnerable to application-level attacks' },
    ],
  },
  445: {
    name: 'SMB',
    summary: 'Critical: Windows file sharing and a major ransomware target (WannaCry, NotPetya). Block at the firewall.',
    description: 'Server Message Block - Windows file sharing',
    vendor: 'Microsoft',
    risk: 'critical',
    notes: [
      { level: 'danger', text: 'Major target for ransomware' },
      { level: 'warning', text: 'Used in WannaCry, NotPetya, and EternalBlue' },
      { level: 'tip', text: 'Must be blocked at the firewall' },
      { level: 'warning', text: 'Ensure the latest patches are applied' },
    ],
  },
  3306: {
    name: 'MySQL',
    summary: 'MySQL database server. Should not be exposed to the internet; use strong passwords and IP restrictions.',
    description: 'MySQL Database Server',
    vendor: 'Oracle / MySQL',
    risk: 'high',
    notes: [
      { level: 'info', text: 'Popular open-source database' },
      { level: 'warning', text: 'Should not be exposed to the internet' },
      { level: 'tip', text: 'Use strong passwords and encryption' },
      { level: 'tip', text: 'Restrict access to specific IPs' },
    ],
  },
  3389: {
    name: 'RDP',
    summary: 'Critical: Windows Remote Desktop. An extremely high-value target with constant brute-force attempts.',
    description: 'Remote Desktop Protocol - Windows remote access',
    vendor: 'Microsoft',
    risk: 'critical',
    notes: [
      { level: 'danger', text: 'Extremely high-value target' },
      { level: 'warning', text: 'Constant brute-force attempts' },
      { level: 'tip', text: 'Use a VPN or jump box instead of direct exposure' },
      { level: 'tip', text: 'Require NLA and strong passwords' },
    ],
  },
  5432: {
    name: 'PostgreSQL',
    summary: 'PostgreSQL database server. Should not be exposed to the internet; configure pg_hba.conf and use SSL.',
    description: 'PostgreSQL Database Server',
    vendor: 'PostgreSQL',
    risk: 'high',
    notes: [
      { level: 'info', text: 'Advanced open-source database' },
      { level: 'warning', text: 'Should not be exposed to the internet' },
      { level: 'tip', text: 'Configure pg_hba.conf properly' },
      { level: 'tip', text: 'Use SSL/TLS connections' },
    ],
  },
  5900: {
    name: 'VNC',
    summary: 'Remote desktop that often has weak or no authentication. Tunnel over SSH; frequently scanned.',
    description: 'Virtual Network Computing - Remote desktop',
    vendor: 'RealVNC / Various',
    risk: 'high',
    notes: [
      { level: 'info', text: 'Cross-platform remote desktop' },
      { level: 'warning', text: 'Often has weak or no authentication' },
      { level: 'tip', text: 'Use SSH tunneling' },
      { level: 'warning', text: 'Frequently scanned by attackers' },
    ],
  },
  6379: {
    name: 'Redis',
    summary: 'Critical: in-memory database often exposed with no authentication, which can lead to remote code execution.',
    description: 'Redis In-Memory Database',
    vendor: 'Redis Labs',
    risk: 'critical',
    notes: [
      { level: 'danger', text: 'Often exposed with no authentication' },
      { level: 'warning', text: 'Can lead to remote code execution' },
      { level: 'tip', text: 'Must have authentication enabled' },
      { level: 'tip', text: 'Should only be accessible internally' },
    ],
  },
  8080: {
    name: 'HTTP-Alt',
    summary: 'Alternative HTTP port, often used for dev servers. May be less secured than 80/443; check what is running.',
    description: 'Alternative HTTP port - Often used for web proxies',
    vendor: 'Various',
    risk: 'medium',
    notes: [
      { level: 'info', text: 'Common for development servers' },
      { level: 'warning', text: 'Often less secured than port 80/443' },
      { level: 'info', text: 'Check what application is running' },
      { level: 'warning', text: 'May expose admin interfaces' },
    ],
  },
  27017: {
    name: 'MongoDB',
    summary: 'Critical: MongoDB database frequently exposed without authentication. Thousands were ransomed in 2017.',
    description: 'MongoDB Database Server',
    vendor: 'MongoDB Inc.',
    risk: 'critical',
    notes: [
      { level: 'danger', text: 'Frequently found exposed without authentication' },
      { level: 'warning', text: 'Thousands of databases were ransomed in 2017' },
      { level: 'tip', text: 'Must enable authentication' },
      { level: 'tip', text: 'Should only be accessible internally' },
    ],
  },
};

const getPortIntelligence = (port: number, service?: string) => {
  const info = PORT_DB[port];
  if (!info) return undefined;

  // Check for suspicious port usage (service name differs from the well-known one)
  const isSuspicious = Boolean(service && service.toLowerCase() !== info.name.toLowerCase());

  return {
    ...info,
    isSuspicious,
    suspiciousNote: isSuspicious
      ? `${service} is running on port ${port} (expected ${info.name})`
      : null,
  };
};

function NoteRow({ note }: { note: PortNote }) {
  const Icon = NOTE_ICONS[note.level];
  return (
    <div className="flex items-start gap-2.5">
      <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', NOTE_ICON_COLORS[note.level])} strokeWidth={2} />
      <span className="text-sm font-medium leading-relaxed text-foreground">{note.text}</span>
    </div>
  );
}

// Renders the live AI explanation for a finding (loading / error / content states)
function AiExplanation({
  state,
  hasStaticIntel,
  onRetry,
}: {
  state?: AiExplanationState;
  hasStaticIntel: boolean;
  onRetry: () => void;
}) {
  return (
    <div className={cn('space-y-2', hasStaticIntel && 'pt-3 border-t border-border/60')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-bold text-foreground">
          <Sparkles className="w-5 h-5 text-primary" strokeWidth={2} />
          AI Analysis
        </div>
        {state && !state.loading && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-sm font-medium text-foreground/70 hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('[NmapResultsCard] Regenerate clicked');
              onRetry();
            }}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Regenerate
          </Button>
        )}
      </div>

      {(!state || state.loading) && (
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <Loader2 className="w-4 h-4 animate-spin" />
          Generating explanation...
        </div>
      )}

      {state && !state.loading && state.error && (
        <div className="flex items-start gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {state && !state.loading && state.text && (
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {state.text}
        </p>
      )}
    </div>
  );
}

export function NmapResultsCard({ results, target }: NmapResultsCardProps) {
  // FIX: Handle undefined results safely
  const safeResults = results || [];
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set(safeResults.map(h => h.ip)));
  const [expandedPorts, setExpandedPorts] = useState<Set<string>>(new Set());
  // Per-port AI explanation cache, keyed by portKey
  const [aiExplanations, setAiExplanations] = useState<Record<string, AiExplanationState>>({});

  // Request a real AI explanation for a port via the configured provider (lazy + cached)
  const requestExplanation = React.useCallback(async (portKey: string, host: NmapHost, port: NmapHost['ports'][number], force = false) => {
    setAiExplanations(prev => {
      // Skip if already loading or already loaded (unless forced)
      const existing = prev[portKey];
      if (!force && existing && (existing.loading || existing.text)) return prev;
      return { ...prev, [portKey]: { loading: true } };
    });

    const electron = (typeof window !== 'undefined' ? window.electron : undefined) as any;
    if (!electron?.explainFinding) {
      setAiExplanations(prev => ({
        ...prev,
        [portKey]: { loading: false, error: 'AI is not available. Configure an API key in Settings.' },
      }));
      return;
    }

    const serviceLabel = [port.service, port.product, port.version].filter(Boolean).join(' ');
    const title = `Port ${port.port}/${port.protocol} ${port.state}${serviceLabel ? ` - ${serviceLabel}` : ''}`;
    const context = [
      `Host: ${host.ip}${host.hostname ? ` (${host.hostname})` : ''}`,
      host.os ? `OS: ${host.os}` : '',
      target ? `Scan target: ${target}` : '',
    ].filter(Boolean).join('\n');

    try {
      const res = await electron.explainFinding({ tool: 'nmap', title, context });
      if (res?.success && res.explanation) {
        setAiExplanations(prev => ({ ...prev, [portKey]: { loading: false, text: res.explanation } }));
      } else {
        setAiExplanations(prev => ({
          ...prev,
          [portKey]: { loading: false, error: res?.error || 'AI returned no explanation.' },
        }));
      }
    } catch (err: any) {
      setAiExplanations(prev => ({
        ...prev,
        [portKey]: { loading: false, error: err?.message || 'Failed to reach AI provider.' },
      }));
    }
  }, [target]);

  // FIX: Show empty state if no results
  if (safeResults.length === 0) {
    return (
      <div className="bg-card border-2 border-border rounded-lg shadow-lg p-8 text-center">
        <Server className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No Results Yet</h3>
        <p className="text-sm text-muted-foreground">
          Scan results will appear here once the scan completes
        </p>
      </div>
    );
  }

  const toggleHost = (ip: string) => {
    setExpandedHosts(prev => {
      const next = new Set(prev);
      if (next.has(ip)) {
        next.delete(ip);
      } else {
        next.add(ip);
      }
      return next;
    });
  };

  const togglePortInfo = (portKey: string) => {
    setExpandedPorts(prev => {
      const next = new Set(prev);
      if (next.has(portKey)) {
        next.delete(portKey);
      } else {
        next.add(portKey);
      }
      return next;
    });
  };

  const totalHosts = safeResults.length;
  const hostsUp = safeResults.filter(h => (h.state || h.status) === 'up').length;
  const totalOpenPorts = safeResults.reduce((sum, h) => sum + h.ports.filter(p => p.state === 'open').length, 0);

  return (
    <div className="bg-card border-2 border-border rounded-lg shadow-lg">
      {/* Header */}
      <div className="p-4 border-b border-border bg-muted/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Server className="w-6 h-6 text-primary" />
            <div>
              <h3 className="text-lg font-bold text-foreground">Nmap Scan Results</h3>
              <p className="text-sm text-foreground/70 font-mono">{target}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="text-sm font-semibold">
              {hostsUp}/{totalHosts} hosts up
            </Badge>
            <Badge variant="outline" className="text-sm font-semibold">
              {totalOpenPorts} open ports
            </Badge>
          </div>
        </div>
      </div>

      {/* Hosts */}
      <div className="divide-y divide-border">
        {safeResults.map((host) => {
          const isExpanded = expandedHosts.has(host.ip);
          const hostState = (host.state || host.status || 'unknown').toLowerCase();
          const openPorts = host.ports.filter(p => p.state === 'open');
          const filteredPorts = host.ports.filter(p => p.state === 'filtered');

          return (
            <div key={host.ip} className="bg-card">
              {/* Host Header */}
            <button
              type="button"
              onClick={() => toggleHost(host.ip)}
                className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <Wifi className={cn(
                    "w-5 h-5",
                    hostState === 'up' ? "text-green-500" : hostState === 'down' ? "text-red-500" : "text-muted-foreground"
                  )} />
                  <div className="text-left">
                    <div className="font-mono text-lg font-bold text-foreground tracking-tight">
                      {host.ip}
                      {host.hostname && (
                        <span className="text-foreground/70 ml-2 text-base">({host.hostname})</span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-foreground/70">
                      {hostState.toUpperCase()}
                      {host.mac && ` • MAC: ${host.mac}`}
                      {host.os && ` • ${host.os}`}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {openPorts.length > 0 && (
                    <Badge variant="default" className="text-sm font-semibold bg-green-500/20 text-green-600 dark:text-green-400">
                      {openPorts.length} open
                    </Badge>
                  )}
                  {filteredPorts.length > 0 && (
                    <Badge variant="secondary" className="text-sm font-semibold">
                      {filteredPorts.length} filtered
                    </Badge>
                  )}
                </div>
              </button>

              {/* Ports List */}
              {isExpanded && host.ports.length > 0 && (
                <div className="px-4 pb-4">
                  <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                    {host.ports.map((port) => {
                      const portKey = `${host.ip}-${port.port}-${port.protocol}`;
                      const isPortExpanded = expandedPorts.has(portKey);
                      const intelligence = getPortIntelligence(port.port, port.service);
                      const ai = aiExplanations[portKey];

                      const handleToggle = () => {
                        const willExpand = !expandedPorts.has(portKey);
                        togglePortInfo(portKey);
                        // Lazily fetch a real AI explanation the first time this port is opened
                        if (willExpand) {
                          requestExplanation(portKey, host, port);
                        }
                      };

                      return (
                        <div key={portKey} className="space-y-1.5">
                          <div
                            role="button"
                            tabIndex={0}
                            aria-expanded={expandedPorts.has(portKey)}
                            aria-label={`${expandedPorts.has(portKey) ? 'Collapse' : 'Expand'} details for port ${port.port}/${port.protocol}`}
                            onClick={handleToggle}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              handleToggle();
                            }}
                            className={cn(
                              "p-3 rounded-lg transition-all bg-muted/30 border border-border cursor-pointer hover:bg-muted/50 hover:shadow-md",
                              intelligence?.isSuspicious && "border-2 border-amber-500/50"
                            )}
                          >
                            <div className="flex items-start gap-3 justify-between">
                              {/* Left side - Port info */}
                              <div className="flex items-start gap-3 flex-1 min-w-0">
                                <Shield className={cn(
                                  "w-5 h-5 mt-0.5 flex-shrink-0",
                                  port.state === 'open' ? "text-green-500" : "text-muted-foreground"
                                )} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <span className="font-mono text-base font-bold text-foreground">
                                      {port.port}/{port.protocol}
                                    </span>
                                    {intelligence && (
                                      <Badge variant="outline" className="text-sm font-semibold">
                                        {intelligence.name}
                                      </Badge>
                                    )}
                                    {intelligence?.isSuspicious && (
                                      <Badge variant="destructive" className="text-sm gap-1">
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        Suspicious
                                      </Badge>
                                    )}
                                    <Badge
                                      variant={port.state === 'open' ? 'default' : 'secondary'}
                                      className={cn(
                                        "text-sm font-semibold",
                                        port.state === 'open' && "bg-green-500/20 text-green-600 dark:text-green-400"
                                      )}
                                    >
                                      {port.state}
                                    </Badge>
                                  </div>

                                  {port.service && (
                                    <div className="text-sm font-medium text-foreground/70">
                                      {port.service}
                                      {port.product && ` • ${port.product}`}
                                      {port.version && ` ${port.version}`}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Right side - Insight summary */}
                              {intelligence && (
                                <div className={cn(
                                  "p-3 rounded-lg border-l-2 max-w-sm flex-shrink-0",
                                  RISK_SUMMARY_STYLES[intelligence.risk]
                                )}>
                                  <div className="flex items-start gap-2">
                                    <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
                                    <div className="space-y-1.5">
                                      <p className="text-sm font-medium leading-relaxed">{intelligence.summary}</p>
                                      <div className="flex items-center gap-1 text-sm font-semibold">
                                        <ChevronDown className={cn(
                                          "w-4 h-4 transition-transform",
                                          isPortExpanded && "rotate-180"
                                        )} />
                                        {isPortExpanded ? 'Hide details' : 'Show details'}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Right side - prompt to open AI analysis when no static intel */}
                              {!intelligence && (
                                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground/70 flex-shrink-0 self-center">
                                  <Sparkles className="w-4 h-4" />
                                  <span>{isPortExpanded ? 'Hide AI analysis' : 'AI analysis'}</span>
                                  <ChevronDown className={cn(
                                    "w-4 h-4 transition-transform",
                                    isPortExpanded && "rotate-180"
                                  )} />
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Expanded Details */}
                          {isPortExpanded && (
                            <div className={cn(
                              "ml-7 p-4 rounded-lg border space-y-3 animate-slide-in",
                              intelligence ? RISK_DETAIL_STYLES[intelligence.risk] : "bg-muted/20 border-border"
                            )}>
                              {intelligence && (
                                <div className="flex items-start gap-2.5">
                                  <Info className="w-5 h-5 mt-0.5 flex-shrink-0 text-foreground/80" />
                                  <div className="space-y-3 flex-1">
                                    <div>
                                      <div className="font-bold text-lg text-foreground">{intelligence.description}</div>
                                      {intelligence.vendor && (
                                        <div className="text-sm font-medium text-foreground/70 mt-0.5">
                                          Vendor: {intelligence.vendor}
                                        </div>
                                      )}
                                    </div>

                                    {intelligence.suspiciousNote && (
                                      <div className="flex items-start gap-2 bg-amber-500/15 border border-amber-500/40 rounded-md p-2.5 text-sm font-medium text-amber-700 dark:text-amber-300">
                                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                        <span>{intelligence.suspiciousNote}</span>
                                      </div>
                                    )}

                                    <div className="space-y-2">
                                      <div className="text-base font-bold text-foreground">Security Notes</div>
                                      <div className="space-y-2">
                                        {intelligence.notes.map((note, i) => (
                                          <NoteRow key={i} note={note} />
                                        ))}
                                      </div>
                                    </div>

                                    <Badge
                                      variant="outline"
                                      className={cn("text-sm font-bold", RISK_BADGE_STYLES[intelligence.risk])}
                                    >
                                      Risk Level: {intelligence.risk.toUpperCase()}
                                    </Badge>
                                  </div>
                                </div>
                              )}

                              {/* AI Analysis - real provider call */}
                              <AiExplanation
                                state={ai}
                                hasStaticIntel={Boolean(intelligence)}
                                onRetry={() => requestExplanation(portKey, host, port, true)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
