
export type NmapSection = 'SCAN_TYPE' | 'SERVICE_DETECTION' | 'SPEED_STEALTH' | 'PORT_OPTIONS' | 'SCRIPTS' | 'OUTPUT' | 'FIREWALL_IDS' | 'ADVANCED';

export interface NmapOption {
  id: string;
  label: string;
  flag: string;
  description: string;
  exclusiveGroup?: string; // If set, only one option from this group can be selected
}

export const NMAP_SECTIONS: { id: NmapSection; label: string }[] = [
  { id: 'SCAN_TYPE', label: 'SCAN TYPE' },
  { id: 'SERVICE_DETECTION', label: 'SERVICE DETECTION' },
  { id: 'PORT_OPTIONS', label: 'PORT OPTIONS' },
  { id: 'SPEED_STEALTH', label: 'TIMING' },
  { id: 'SCRIPTS', label: 'NSE SCRIPTS' },
  { id: 'FIREWALL_IDS', label: 'FIREWALL/IDS EVASION' },
  { id: 'OUTPUT', label: 'OUTPUT' },
  { id: 'ADVANCED', label: 'ADVANCED' },
];

export const NMAP_OPTIONS: Record<NmapSection, NmapOption[]> = {
  SCAN_TYPE: [
    { id: 'syn', label: 'SYN Scan', flag: '-sS', description: 'TCP SYN scan (stealth, requires root)', exclusiveGroup: 'scan_type' },
    { id: 'connect', label: 'TCP Connect', flag: '-sT', description: 'TCP Connect scan (no root required)', exclusiveGroup: 'scan_type' },
    { id: 'udp', label: 'UDP Scan', flag: '-sU', description: 'UDP port scan', exclusiveGroup: 'scan_type' },
    { id: 'sctp_init', label: 'SCTP INIT', flag: '-sY', description: 'SCTP INIT scan', exclusiveGroup: 'scan_type' },
    { id: 'ping_only', label: 'Ping Scan', flag: '-sn', description: 'Host discovery only, no port scan', exclusiveGroup: 'scan_type' },
    { id: 'ack', label: 'ACK Scan', flag: '-sA', description: 'TCP ACK scan (firewall rule detection)', exclusiveGroup: 'scan_type' },
    { id: 'window', label: 'Window Scan', flag: '-sW', description: 'TCP Window scan', exclusiveGroup: 'scan_type' },
    { id: 'maimon', label: 'Maimon Scan', flag: '-sM', description: 'TCP Maimon scan', exclusiveGroup: 'scan_type' },
    { id: 'fin', label: 'FIN Scan', flag: '-sF', description: 'TCP FIN scan (stealth)', exclusiveGroup: 'scan_type' },
    { id: 'null', label: 'NULL Scan', flag: '-sN', description: 'TCP Null scan (stealth)', exclusiveGroup: 'scan_type' },
    { id: 'xmas', label: 'Xmas Scan', flag: '-sX', description: 'TCP Xmas scan (stealth)', exclusiveGroup: 'scan_type' },
    { id: 'idle', label: 'Idle Scan', flag: '-sI', description: 'Zombie host idle scan (ultra stealth)', exclusiveGroup: 'scan_type' },
  ],
  SERVICE_DETECTION: [
    { id: 'version', label: 'Version Detection', flag: '-sV', description: 'Probe open ports to determine service/version' },
    { id: 'version_intensity', label: 'Version Intensity', flag: '--version-intensity 5', description: 'Set version detection intensity (0-9)', exclusiveGroup: 'version_level' },
    { id: 'version_light', label: 'Light Version', flag: '--version-light', description: 'Limit to most likely probes (intensity 2)', exclusiveGroup: 'version_level' },
    { id: 'version_all', label: 'All Probes', flag: '--version-all', description: 'Try every single probe (intensity 9)', exclusiveGroup: 'version_level' },
    { id: 'os', label: 'OS Detection', flag: '-O', description: 'Enable OS detection' },
    { id: 'os_aggressive', label: 'Aggressive OS', flag: '--osscan-guess', description: 'Guess OS more aggressively' },
    { id: 'script_default', label: 'Default Scripts', flag: '-sC', description: 'Run default NSE scripts' },
    { id: 'traceroute', label: 'Traceroute', flag: '--traceroute', description: 'Trace hop path to each host' },
    { id: 'agg', label: 'Aggressive Scan', flag: '-A', description: 'Enable OS detection, version, scripts, and traceroute' },
  ],
  PORT_OPTIONS: [
    { id: 'all_ports', label: 'All 65535 Ports', flag: '-p-', description: 'Scan all 65535 ports', exclusiveGroup: 'ports' },
    { id: 'fast_ports', label: 'Fast (100 ports)', flag: '-F', description: 'Scan 100 most common ports', exclusiveGroup: 'ports' },
    { id: 'top_100', label: 'Top 100', flag: '--top-ports 100', description: 'Scan top 100 most common ports', exclusiveGroup: 'ports' },
    { id: 'top_1000', label: 'Top 1000', flag: '--top-ports 1000', description: 'Scan top 1000 most common ports', exclusiveGroup: 'ports' },
    { id: 'top_10', label: 'Top 10', flag: '--top-ports 10', description: 'Scan top 10 most common ports', exclusiveGroup: 'ports' },
    { id: 'common_ports', label: 'Common Ports', flag: '-p 21,22,23,25,53,80,110,111,135,139,143,443,445,993,995,1723,3306,3389,5900,8080', description: 'Scan commonly used ports' },
    { id: 'web_ports', label: 'Web Ports', flag: '-p 80,443,8000,8080,8443', description: 'Scan web server ports only' },
    { id: 'exclude_ports', label: 'Exclude Ports', flag: '--exclude-ports 25,135,445', description: 'Exclude specific ports from scan' },
  ],
  SPEED_STEALTH: [
    { id: 't0', label: 'Paranoid (T0)', flag: '-T0', description: 'Extremely slow (5 min between probes)', exclusiveGroup: 'timing' },
    { id: 't1', label: 'Sneaky (T1)', flag: '-T1', description: 'Very slow (15 sec between probes)', exclusiveGroup: 'timing' },
    { id: 't2', label: 'Polite (T2)', flag: '-T2', description: 'Slow (0.4 sec between probes)', exclusiveGroup: 'timing' },
    { id: 't3', label: 'Normal (T3)', flag: '-T3', description: 'Default timing template', exclusiveGroup: 'timing' },
    { id: 't4', label: 'Aggressive (T4)', flag: '-T4', description: 'Fast scan (recommended)', exclusiveGroup: 'timing' },
    { id: 't5', label: 'Insane (T5)', flag: '-T5', description: 'Extremely fast (may miss results)', exclusiveGroup: 'timing' },
    { id: 'min_rate', label: 'Min Rate 100', flag: '--min-rate 100', description: 'Send packets no slower than 100/sec' },
    { id: 'max_rate', label: 'Max Rate 1000', flag: '--max-rate 1000', description: 'Send packets no faster than 1000/sec' },
    { id: 'host_timeout', label: 'Host Timeout', flag: '--host-timeout 30m', description: 'Give up on target after this time' },
  ],
  SCRIPTS: [
    { id: 'vuln', label: 'Vulnerability Scan', flag: '--script vuln', description: 'Check for known vulnerabilities' },
    { id: 'exploit', label: 'Exploit Scripts', flag: '--script exploit', description: 'Try to exploit vulnerabilities' },
    { id: 'auth', label: 'Auth Scripts', flag: '--script auth', description: 'Test authentication mechanisms' },
    { id: 'brute', label: 'Brute Force', flag: '--script brute', description: 'Brute force passwords' },
    { id: 'discovery', label: 'Discovery', flag: '--script discovery', description: 'Network discovery scripts' },
    { id: 'malware', label: 'Malware Check', flag: '--script malware', description: 'Check for malware/backdoors' },
    { id: 'http_enum', label: 'HTTP Enum', flag: '--script http-enum', description: 'Enumerate web directories' },
    { id: 'smb_enum', label: 'SMB Enum', flag: '--script smb-enum-shares', description: 'Enumerate SMB shares' },
    { id: 'ssl_cert', label: 'SSL Certificate', flag: '--script ssl-cert', description: 'Retrieve SSL certificates' },
    { id: 'dns_brute', label: 'DNS Brute', flag: '--script dns-brute', description: 'Brute force DNS hostnames' },
  ],
  FIREWALL_IDS: [
    { id: 'fragment', label: 'Fragment Packets', flag: '-f', description: 'Fragment IP packets (evade firewalls)' },
    { id: 'mtu', label: 'Custom MTU', flag: '--mtu 24', description: 'Use specified MTU for fragmentation' },
    { id: 'decoy', label: 'Decoy Scan', flag: '-D RND:10', description: 'Cloak scan with decoys' },
    { id: 'spoof_ip', label: 'Spoof Source IP', flag: '-S 192.168.1.1', description: 'Spoof source address' },
    { id: 'spoof_mac', label: 'Spoof MAC', flag: '--spoof-mac 0', description: 'Spoof MAC address' },
    { id: 'randomize', label: 'Randomize Hosts', flag: '--randomize-hosts', description: 'Randomize target scan order' },
    { id: 'badsum', label: 'Bad Checksum', flag: '--badsum', description: 'Send packets with bad TCP/UDP checksums' },
    { id: 'data_length', label: 'Append Data', flag: '--data-length 25', description: 'Append random data to packets' },
  ],
  OUTPUT: [
    { id: 'normal_output', label: 'Normal Output', flag: '-oN scan.txt', description: 'Save normal output to file' },
    { id: 'xml_output', label: 'XML Output', flag: '-oX scan.xml', description: 'Save XML output to file' },
    { id: 'grepable', label: 'Grepable Output', flag: '-oG scan.gnmap', description: 'Save grepable output' },
    { id: 'all_formats', label: 'All Formats', flag: '-oA scan', description: 'Output in all major formats' },
    { id: 'append', label: 'Append Output', flag: '--append-output', description: 'Append to rather than overwrite files' },
  ],
  ADVANCED: [
    { id: 'ipv6', label: 'IPv6 Scan', flag: '-6', description: 'Enable IPv6 scanning' },
    { id: 'verbose', label: 'Verbose', flag: '-v', description: 'Increase verbosity level (use -vv for more)' },
    { id: 'debug', label: 'Debug', flag: '-d', description: 'Enable debugging output' },
    { id: 'reason', label: 'Show Reason', flag: '--reason', description: 'Display reason for port state' },
    { id: 'packet_trace', label: 'Packet Trace', flag: '--packet-trace', description: 'Show all packets sent/received' },
    { id: 'open_only', label: 'Open Ports Only', flag: '--open', description: 'Show only open ports' },
    { id: 'no_dns', label: 'No DNS Resolution', flag: '-n', description: 'Never do DNS resolution' },
    { id: 'dns_servers', label: 'Custom DNS', flag: '--dns-servers 8.8.8.8,8.8.4.4', description: 'Use custom DNS servers' },
    { id: 'privileged', label: 'Privileged Mode', flag: '--privileged', description: 'Assume user is fully privileged', exclusiveGroup: 'privilege_mode' },
    { id: 'unprivileged', label: 'Unprivileged', flag: '--unprivileged', description: 'Assume user lacks raw socket privileges', exclusiveGroup: 'privilege_mode' },
    { id: 'exclude_hosts', label: 'Exclude Hosts', flag: '--exclude 192.168.1.1', description: 'Exclude hosts/networks from scan' },
  ],
};
