import { NmapOption } from './nmap-config';

export class NmapCommandBuilder {
  private scanType: string | null = null;
  private ports: string | null = null;
  private timing: string | null = null;
  private serviceDetect: string[] = [];
  private scripts: string[] = [];
  private evasion: string[] = [];
  private output: string[] = [];
  private other: string[] = [];
  private target: string | null = null;

  constructor(target?: string) {
    if (target) this.target = target;
  }

  setTarget(target: string) {
    this.target = target;
  }

  addOption(option: NmapOption) {
    const flag = option.flag;

    // Scan type (only one allowed, mutually exclusive)
    if (this.isScanType(flag)) {
      this.scanType = flag;
    }
    // Port specification (only one allowed)
    else if (this.isPortSpec(flag)) {
      this.ports = flag;
    }
    // Timing (only one allowed)
    else if (this.isTiming(flag)) {
      this.timing = flag;
    }
    // Service detection
    else if (this.isServiceDetection(flag)) {
      if (!this.serviceDetect.includes(flag)) {
        this.serviceDetect.push(flag);
      }
    }
    // Scripts (combine multiple into one --script flag)
    else if (flag.startsWith('--script')) {
      this.addScript(flag);
    }
    // Evasion techniques
    else if (this.isEvasion(flag)) {
      if (!this.evasion.includes(flag)) {
        this.evasion.push(flag);
      }
    }
    // Output (goes after target)
    else if (this.isOutput(flag)) {
      if (!this.output.includes(flag)) {
        this.output.push(flag);
      }
    }
    // Privilege mode (mutually exclusive)
    else if (flag === '--privileged' || flag === '--unprivileged') {
      // Remove conflicting privilege flag
      this.other = this.other.filter(f => f !== '--privileged' && f !== '--unprivileged');
      this.other.push(flag);
    }
    // Everything else
    else {
      if (!this.other.includes(flag)) {
        this.other.push(flag);
      }
    }
  }

  removeOption(option: NmapOption) {
    const flag = option.flag;

    if (this.scanType === flag) this.scanType = null;
    else if (this.ports === flag) this.ports = null;
    else if (this.timing === flag) this.timing = null;
    else {
      this.serviceDetect = this.serviceDetect.filter(f => f !== flag);
      this.scripts = this.scripts.filter(f => !f.includes(flag));
      this.evasion = this.evasion.filter(f => f !== flag);
      this.output = this.output.filter(f => f !== flag);
      this.other = this.other.filter(f => f !== flag);
    }
  }

  private isScanType(flag: string): boolean {
    return ['-sS', '-sT', '-sU', '-sY', '-sn', '-sA', '-sW', '-sM', '-sF', '-sN', '-sX', '-sI'].some(f => flag.includes(f));
  }

  private isPortSpec(flag: string): boolean {
    return flag.startsWith('-p') || flag === '-F' || flag.includes('--top-ports') || flag.includes('--exclude-ports');
  }

  private isTiming(flag: string): boolean {
    return /^-T[0-5]/.test(flag) || flag.includes('--min-rate') || flag.includes('--max-rate') || flag.includes('--host-timeout');
  }

  private isServiceDetection(flag: string): boolean {
    return ['-sV', '-O', '-A', '-sC', '--traceroute', '--version-intensity', '--version-light', '--version-all', '--osscan-guess'].some(f => flag.includes(f));
  }

  private isEvasion(flag: string): boolean {
    return ['-f', '-D', '-S', '--spoof-mac', '--data-length', '--randomize-hosts', '--badsum', '--mtu'].some(f => flag.includes(f));
  }

  private isOutput(flag: string): boolean {
    return ['-oN', '-oX', '-oG', '-oA', '--append-output'].some(f => flag.includes(f));
  }

  private addScript(flag: string) {
    // Extract script name from flag like "--script vuln"
    const scriptMatch = flag.match(/--script\s+(\S+)/);
    if (scriptMatch) {
      const scriptName = scriptMatch[1];
      
      // Check if we already have scripts
      if (this.scripts.length === 0) {
        this.scripts.push(flag);
      } else {
        // Combine multiple scripts: --script vuln,auth,brute
        const existingScripts = this.scripts[0].match(/--script\s+(.+)/)?.[1] || '';
        const allScripts = existingScripts.split(',').filter(s => s);
        
        if (!allScripts.includes(scriptName)) {
          allScripts.push(scriptName);
          this.scripts[0] = `--script ${allScripts.join(',')}`;
        }
      }
    } else {
      // Flag doesn't have a value, just add it
      if (!this.scripts.includes(flag)) {
        this.scripts.push(flag);
      }
    }
  }

  buildCommand(): string {
    if (!this.target) {
      throw new Error('No target specified');
    }

    const parts: string[] = ['nmap'];

    // 1. Scan type
    if (this.scanType) parts.push(this.scanType);

    // 2. Port specification
    if (this.ports) parts.push(this.ports);

    // 3. Timing
    if (this.timing) parts.push(this.timing);

    // 4. Service detection
    if (this.serviceDetect.length > 0) {
      parts.push(...this.serviceDetect);
    }

    // 5. Scripts
    if (this.scripts.length > 0) {
      parts.push(...this.scripts);
    }

    // 6. Evasion techniques
    if (this.evasion.length > 0) {
      parts.push(...this.evasion);
    }

    // 7. Other flags
    if (this.other.length > 0) {
      parts.push(...this.other);
    }

    // 8. TARGET (must come before output flags)
    parts.push(this.target);

    // 9. Output flags (after target)
    if (this.output.length > 0) {
      parts.push(...this.output);
    }

    return parts.join(' ');
  }

  // Validation warnings for UI
  getValidationWarnings(): string[] {
    const warnings: string[] = [];

    // Check for scans requiring root
    if (this.scanType === '-sS' || this.scanType === '-sU' || this.serviceDetect.includes('-O')) {
      warnings.push('⚠️ This scan requires root/sudo privileges');
    }

    // Check for slow UDP scan
    if (this.scanType === '-sU' && this.ports === '-p-') {
      warnings.push('⚠️ UDP scan of all ports will take VERY long (hours)');
    }

    // Info about aggressive scan
    if (this.serviceDetect.includes('-A')) {
      warnings.push('ℹ️ -A includes version detection, OS detection, and default scripts');
    }

    // Validate decoy IPs
    const decoyFlag = this.evasion.find(f => f.startsWith('-D '));
    if (decoyFlag && !decoyFlag.includes('RND:')) {
      const ips = decoyFlag.replace('-D ', '').split(',');
      const invalidIps = ips.filter(ip => !this.isValidIP(ip.trim()));
      if (invalidIps.length > 0) {
        warnings.push(`❌ Invalid decoy IPs: ${invalidIps.join(', ')}`);
      }
    }

    // Validate spoof source IP
    const spoofFlag = this.evasion.find(f => f.startsWith('-S '));
    if (spoofFlag) {
      const ip = spoofFlag.replace('-S ', '').trim();
      if (!this.isValidIP(ip)) {
        warnings.push(`❌ Invalid source IP: ${ip}`);
      }
    }

    return warnings;
  }

  private isValidIP(ip: string): boolean {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) return false;
    
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  getFlags(): string[] {
    const flags: string[] = [];
    
    if (this.scanType) flags.push(this.scanType);
    if (this.ports) flags.push(this.ports);
    if (this.timing) flags.push(this.timing);
    flags.push(...this.serviceDetect);
    flags.push(...this.scripts);
    flags.push(...this.evasion);
    flags.push(...this.other);
    flags.push(...this.output);
    
    return flags;
  }

  clear() {
    this.scanType = null;
    this.ports = null;
    this.timing = null;
    this.serviceDetect = [];
    this.scripts = [];
    this.evasion = [];
    this.output = [];
    this.other = [];
  }
}
