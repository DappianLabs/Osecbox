/**
 * Global Context Store - BLEEDING-EDGE pentesting activity tracker
 * Tracks all scans, findings, and activities across all sections
 * Provides AI with complete, prioritized context of the pentesting session
 * 
 * FEATURES:
 * - Smart severity tracking (critical/high/medium/low)
 * - CVE detection and highlighting
 * - Exploit success tracking
 * - Vulnerability correlation
 * - Priority-based summarization
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface VulnerabilityDetail {
  id: string; // CVE-2021-1234, XSS, SQLi, etc.
  severity: Severity;
  description?: string;
  exploitable?: boolean;
}

export interface NmapActivity {
  type: 'nmap';
  timestamp: number;
  target: string;
  command: string;
  liveHosts: number;
  openPorts: number;
  services: string[];
  vulnerabilities?: VulnerabilityDetail[];
  osDetection?: string;
}

export interface SubdomainActivity {
  type: 'subdomain';
  timestamp: number;
  domain: string;
  tool: string;
  subdomainsFound: number;
  subdomains: Array<{
    subdomain: string;
    ip: string;
    status: 'active' | 'inactive' | 'unknown';
  }>;
  highValueTargets?: string[]; // Subdomains with interesting names (admin, api, etc)
}

export interface ScannerActivity {
  type: 'nuclei' | 'nikto' | 'dirbuster';
  timestamp: number;
  target: string;
  tool: string;
  findings: number;
  criticalFindings: number;
  highFindings: number;
  mediumFindings: number;
  results: string[];
  vulnerabilities?: VulnerabilityDetail[]; // Detailed CVE/vuln info
  cves?: string[]; // Quick CVE list for highlighting
}

export interface MetasploitActivity {
  type: 'metasploit';
  timestamp: number;
  module: string;
  target: string;
  success: boolean;
  sessions?: number;
  shellType?: 'meterpreter' | 'shell' | 'none';
  exploitedVuln?: string; // CVE or vulnerability exploited
}

export type Activity = NmapActivity | SubdomainActivity | ScannerActivity | MetasploitActivity;

export interface CriticalEvent {
  timestamp: number;
  type: 'exploit_success' | 'critical_vuln' | 'shell_obtained' | 'cve_found';
  target: string;
  details: string;
  severity: Severity;
  actionable: boolean;
}

// Flagged findings from scanners
export interface FlaggedFinding {
  id: string;
  type: 'vulnerability' | 'misconfiguration' | 'exposure' | 'weakness';
  severity: Severity;
  title: string;
  description: string;
  target: string;
  tool: string; // Which scanner found it
  timestamp: number;
  exploited: boolean;
  exploitAttempts: number;
  cve?: string;
  cvss?: number;
  recommendation?: string;
}

// User progress tracking (flexible, non-linear)
export interface UserProgress {
  lastActivity: number;
  targetsScanned: number;
  vulnerabilitiesFound: number;
  exploitsAttempted: number;
  exploitsSuccessful: number;
  shellsObtained: number;
}

// Stuck indicators
export interface StuckIndicator {
  timestamp: number;
  type: 'repeated_scans' | 'failed_exploits' | 'no_progress' | 'same_target';
  details: string;
  suggestion: string; // What AI should suggest
  severity: 'warning' | 'critical';
}

// Exploit attempt tracking
export interface ExploitAttempt {
  timestamp: number;
  target: string;
  module: string;
  cve?: string;
  success: boolean;
  error?: string;
  duration?: number;
}

// Terminal interaction tracking (FULL SESSION - BYOK model)
export interface TerminalInteraction {
  timestamp: number;
  sessionId: string;
  sessionType: 'foothold' | 'tunneling' | 'metasploit' | 'scan' | 'general';
  command?: string; // Only when command starts
  exitCode?: number; // Only when command ends
  target?: string;
  duration?: number; // Calculated on end
  recentOutput?: string[]; // ALL output - BYOK model (user controls costs)
}

// User command tracking
export interface UserCommand {
  timestamp: number;
  section: string; // Which section (scan, exploit, foothold, etc.)
  action: string; // What they did (run_scan, start_listener, etc.)
  details: string;
  target?: string;
}

export interface GlobalContext {
  activities: Activity[];
  targets: Set<string>;
  findings: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  timeline: Array<{
    timestamp: number;
    action: string;
    section: string;
    severity?: Severity;
  }>;
  criticalEvents: CriticalEvent[];
  exploitedTargets: Set<string>;
  cveDatabase: Map<string, { target: string; severity: Severity; exploited: boolean; attempts: number }>;
  vulnerableServices: Map<string, string[]>;
  // Advanced tracking for AI intelligence
  flaggedFindings: Map<string, FlaggedFinding[]>; // Target -> flagged findings
  userProgress: UserProgress; // Track where user is in the workflow
  stuckIndicators: StuckIndicator[]; // Detect when user is stuck
  exploitAttempts: Map<string, ExploitAttempt[]>; // Track all exploit attempts
  terminalInteractions: TerminalInteraction[]; // All terminal commands and output
  userCommands: UserCommand[]; // All user actions (button clicks, etc.)
}

class GlobalContextStore {
  // BYOK MODEL: No artificial limits - user controls their own API costs
  // Memory management is user's responsibility (they can clear session if needed)
  private readonly MAX_CRITICAL_EVENTS = 100; // Keep reasonable limit for UI performance
  
  // PERFORMANCE: Cache AI summary with dirty flag (more efficient than time-based)
  private cachedSummary: string | null = null;
  private isDirty: boolean = true; // Start dirty to force initial generation
  
  private context: GlobalContext = {
    activities: [],
    targets: new Set(),
    findings: {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    },
    timeline: [],
    criticalEvents: [],
    exploitedTargets: new Set(),
    cveDatabase: new Map(),
    vulnerableServices: new Map(),
    flaggedFindings: new Map(),
    userProgress: {
      lastActivity: Date.now(),
      targetsScanned: 0,
      vulnerabilitiesFound: 0,
      exploitsAttempted: 0,
      exploitsSuccessful: 0,
      shellsObtained: 0,
    },
    stuckIndicators: [],
    exploitAttempts: new Map(),
    terminalInteractions: [],
    userCommands: [],
  };

  // Add activity with SMART tracking
  addActivity(activity: Activity) {
    this.context.activities.push(activity);
    
    // Mark as dirty when data changes
    this.isDirty = true;
    
    // BYOK: No artificial limits - keep full session history
    
    // Extract target
    if ('target' in activity) {
      this.context.targets.add(activity.target);
    } else if ('domain' in activity) {
      this.context.targets.add(activity.domain);
    }

    // Determine severity for timeline
    const severity = this.getActivitySeverity(activity);

    // Update timeline
    this.context.timeline.push({
      timestamp: activity.timestamp,
      action: this.getActionDescription(activity),
      section: activity.type,
      severity: severity,
    });
    
    // BYOK: No artificial limits - keep full timeline

    // Update findings count with detailed breakdown
    if ('findings' in activity) {
      this.context.findings.total += activity.findings;
      if ('criticalFindings' in activity) {
        this.context.findings.critical += activity.criticalFindings;
      }
      if ('highFindings' in activity) {
        this.context.findings.high += activity.highFindings;
      }
      if ('mediumFindings' in activity) {
        this.context.findings.medium += activity.mediumFindings;
      }
    }

    // Track CVEs and vulnerabilities with flagged findings
    if ('vulnerabilities' in activity && activity.vulnerabilities) {
      activity.vulnerabilities.forEach(vuln => {
        // Add to flagged findings
        this.addFlaggedFinding({
          id: vuln.id,
          type: 'vulnerability',
          severity: vuln.severity,
          title: vuln.id,
          description: vuln.description || 'No description',
          target: activity.target,
          tool: activity.type,
          timestamp: activity.timestamp,
          exploited: false,
          exploitAttempts: 0,
          cve: vuln.id.startsWith('CVE-') ? vuln.id : undefined,
          recommendation: vuln.exploitable ? 'Exploit available - high priority target' : 'Research exploit availability',
        });

        if (vuln.id.startsWith('CVE-')) {
          this.context.cveDatabase.set(vuln.id, {
            target: activity.target,
            severity: vuln.severity,
            exploited: false,
            attempts: 0,
          });
          
          // Create critical event for CVEs
          if (vuln.severity === 'critical' || vuln.severity === 'high') {
            this.addCriticalEvent({
              timestamp: activity.timestamp,
              type: 'cve_found',
              target: activity.target,
              details: `${vuln.id} (${vuln.severity}) - ${vuln.description || 'No description'}`,
              severity: vuln.severity,
              actionable: vuln.exploitable || false,
            });
          }
        }

        // Update progress
        this.context.userProgress.vulnerabilitiesFound++;
      });
    }

    // Track CVEs from scanner results
    if ('cves' in activity && activity.cves) {
      activity.cves.forEach(cve => {
        if (!this.context.cveDatabase.has(cve)) {
          this.context.cveDatabase.set(cve, {
            target: activity.target,
            severity: 'high', // Default to high if not specified
            exploited: false,
            attempts: 0,
          });
        }
      });
    }

    // Track exploits (success and failure)
    if (activity.type === 'metasploit') {
      // Track the attempt
      this.trackExploitAttempt({
        timestamp: activity.timestamp,
        target: activity.target,
        module: activity.module,
        cve: activity.exploitedVuln,
        success: activity.success,
      });

      // Update progress
      this.context.userProgress.exploitsAttempted++;

      if (activity.success) {
        this.context.exploitedTargets.add(activity.target);
        this.context.userProgress.exploitsSuccessful++;
        
        if (activity.sessions && activity.sessions > 0) {
          this.context.userProgress.shellsObtained += activity.sessions;
        }
        
        // Mark CVE as exploited if specified
        if (activity.exploitedVuln) {
          const cveEntry = this.context.cveDatabase.get(activity.exploitedVuln);
          if (cveEntry) {
            cveEntry.exploited = true;
          }

          // Mark flagged finding as exploited
          const findings = this.context.flaggedFindings.get(activity.target);
          if (findings) {
            const finding = findings.find(f => f.cve === activity.exploitedVuln);
            if (finding) {
              finding.exploited = true;
            }
          }
        }
        
        // Create critical event for successful exploit
        this.addCriticalEvent({
          timestamp: activity.timestamp,
          type: activity.sessions && activity.sessions > 0 ? 'shell_obtained' : 'exploit_success',
          target: activity.target,
          details: `${activity.module} - ${activity.shellType || 'exploit'} ${activity.sessions ? `(${activity.sessions} sessions)` : ''}`,
          severity: 'critical',
          actionable: true,
        });
      }
    }

    // Track vulnerable services
    if (activity.type === 'nmap' && activity.services) {
      activity.services.forEach(service => {
        if (!this.context.vulnerableServices.has(service)) {
          this.context.vulnerableServices.set(service, []);
        }
        const targets = this.context.vulnerableServices.get(service)!;
        if (!targets.includes(activity.target)) {
          targets.push(activity.target);
        }
      });
    }

    // Track critical vulnerabilities from scanners
    if ('criticalFindings' in activity && activity.criticalFindings > 0) {
      this.addCriticalEvent({
        timestamp: activity.timestamp,
        type: 'critical_vuln',
        target: activity.target,
        details: `${activity.tool} found ${activity.criticalFindings} critical vulnerabilities`,
        severity: 'critical',
        actionable: true,
      });
    }

    // Update progress tracking (simple stats)
    if (activity.type === 'nmap') {
      this.context.userProgress.targetsScanned++;
    }

    this.context.userProgress.lastActivity = Date.now();
  }

  // Add critical event
  private addCriticalEvent(event: CriticalEvent) {
    this.context.criticalEvents.push(event);
    // Keep reasonable limit for UI performance (100 events)
    if (this.context.criticalEvents.length > this.MAX_CRITICAL_EVENTS) {
      this.context.criticalEvents = this.context.criticalEvents.slice(-this.MAX_CRITICAL_EVENTS);
    }
  }

  // Get activity severity
  private getActivitySeverity(activity: Activity): Severity {
    if (activity.type === 'metasploit' && activity.success) {
      return 'critical';
    }
    if ('criticalFindings' in activity && activity.criticalFindings > 0) {
      return 'critical';
    }
    if ('highFindings' in activity && activity.highFindings > 0) {
      return 'high';
    }
    if ('findings' in activity && activity.findings > 0) {
      return 'medium';
    }
    return 'info';
  }

  // Get action description
  private getActionDescription(activity: Activity): string {
    switch (activity.type) {
      case 'nmap':
        return `Nmap scan on ${activity.target} - ${activity.liveHosts} hosts, ${activity.openPorts} ports`;
      case 'subdomain':
        return `Subdomain enum on ${activity.domain} - ${activity.subdomainsFound} found`;
      case 'nuclei':
      case 'nikto':
      case 'dirbuster':
        return `${activity.tool} scan on ${activity.target} - ${activity.findings} findings`;
      case 'metasploit':
        return `Metasploit ${activity.module} on ${activity.target} - ${activity.success ? 'Success' : 'Failed'}`;
      default:
        return 'Unknown activity';
    }
  }

  // Get AI-friendly summary with SMART prioritization
  getAISummary(): string {
    // PERFORMANCE: Return cached summary if not dirty
    if (this.cachedSummary && !this.isDirty) {
      return this.cachedSummary;
    }
    
    const exploitedTargets = Array.from(this.context.exploitedTargets);
    const criticalCVEs = Array.from(this.context.cveDatabase.entries())
      .filter(([_, data]) => data.severity === 'critical' || data.severity === 'high')
      .map(([cve, data]) => ({
        cve,
        target: data.target,
        severity: data.severity,
        exploited: data.exploited,
      }));

    const summary = {
      // PRIORITY SECTION - What AI should focus on first
      priority: {
        criticalEvents: this.context.criticalEvents.slice(-5).map(e => ({
          type: e.type,
          target: e.target,
          details: e.details,
          severity: e.severity,
          actionable: e.actionable,
          timestamp: new Date(e.timestamp).toLocaleTimeString(),
        })),
        exploitedTargets: exploitedTargets,
        criticalCVEs: criticalCVEs,
        shellsObtained: this.context.activities
          .filter((a): a is MetasploitActivity => a.type === 'metasploit' && a.success && !!a.sessions && a.sessions > 0)
          .map(a => ({
            target: a.target,
            module: a.module,
            sessions: a.sessions!,
          })),
      },

      // SESSION OVERVIEW
      session: {
        totalActivities: this.context.activities.length,
        targets: Array.from(this.context.targets),
        findings: this.context.findings,
        exploitSuccessRate: this.calculateExploitSuccessRate(),
      },

      // RECENT ACTIVITIES (last 10)
      recentActivities: this.context.timeline.slice(-10).map(t => ({
        action: t.action,
        section: t.section,
        severity: t.severity,
        time: new Date(t.timestamp).toLocaleTimeString(),
      })),

      // BREAKDOWN BY TOOL
      breakdown: {
        nmapScans: this.context.activities.filter(a => a.type === 'nmap').length,
        subdomainScans: this.context.activities.filter(a => a.type === 'subdomain').length,
        vulnerabilityScans: this.context.activities.filter(a => 
          a.type === 'nuclei' || a.type === 'nikto' || a.type === 'dirbuster'
        ).length,
        exploitAttempts: this.context.activities.filter(a => a.type === 'metasploit').length,
        successfulExploits: exploitedTargets.length,
      },

      // VULNERABLE SERVICES (for correlation)
      vulnerableServices: Array.from(this.context.vulnerableServices.entries())
        .map(([service, targets]) => ({
          service,
          targets,
          count: targets.length,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10), // Top 10 most common services

      // CVE DATABASE
      cveDatabase: {
        total: this.context.cveDatabase.size,
        exploited: Array.from(this.context.cveDatabase.values()).filter(v => v.exploited).length,
        critical: criticalCVEs.length,
        list: criticalCVEs.slice(0, 10), // Top 10 critical CVEs
      },

      // FLAGGED FINDINGS (Scanner flags)
      flaggedFindings: {
        total: Array.from(this.context.flaggedFindings.values()).flat().length,
        byTarget: Array.from(this.context.flaggedFindings.entries())
          .map(([target, findings]) => ({
            target,
            count: findings.length,
            critical: findings.filter(f => f.severity === 'critical').length,
            high: findings.filter(f => f.severity === 'high').length,
            exploited: findings.filter(f => f.exploited).length,
            unexploited: findings.filter(f => !f.exploited && (f.severity === 'critical' || f.severity === 'high')).length,
            topFindings: findings
              .filter(f => f.severity === 'critical' || f.severity === 'high')
              .slice(0, 5)
              .map(f => ({
                title: f.title,
                severity: f.severity,
                exploited: f.exploited,
                attempts: f.exploitAttempts,
                recommendation: f.recommendation,
              })),
          }))
          .sort((a, b) => b.unexploited - a.unexploited), // Prioritize targets with unexploited critical/high
      },

      // USER PROGRESS (Basic stats for context)
      userProgress: {
        targetsScanned: this.context.userProgress.targetsScanned,
        vulnerabilitiesFound: this.context.userProgress.vulnerabilitiesFound,
        exploitsAttempted: this.context.userProgress.exploitsAttempted,
        exploitsSuccessful: this.context.userProgress.exploitsSuccessful,
        shellsObtained: this.context.userProgress.shellsObtained,
        lastActivity: new Date(this.context.userProgress.lastActivity).toLocaleTimeString(),
      },

      // STUCK INDICATORS (Is user stuck?)
      stuckIndicators: this.context.stuckIndicators.map(i => ({
        type: i.type,
        details: i.details,
        suggestion: i.suggestion,
        severity: i.severity,
        time: new Date(i.timestamp).toLocaleTimeString(),
      })),

      // EXPLOIT ATTEMPTS (All attempts with success/failure)
      exploitAttempts: {
        total: Array.from(this.context.exploitAttempts.values()).flat().length,
        successful: Array.from(this.context.exploitAttempts.values()).flat().filter(a => a.success).length,
        failed: Array.from(this.context.exploitAttempts.values()).flat().filter(a => !a.success).length,
        byTarget: Array.from(this.context.exploitAttempts.entries())
          .map(([target, attempts]) => ({
            target,
            total: attempts.length,
            successful: attempts.filter(a => a.success).length,
            failed: attempts.filter(a => !a.success).length,
            recentAttempts: attempts.slice(-3).map(a => ({
              module: a.module,
              success: a.success,
              cve: a.cve,
              time: new Date(a.timestamp).toLocaleTimeString(),
            })),
          })),
      },

      // TERMINAL INTERACTIONS (Lifecycle events only - no raw output)
      terminalInteractions: {
        total: this.context.terminalInteractions.length,
        recent: this.context.terminalInteractions.slice(-20).map(i => ({
          sessionType: i.sessionType,
          command: i.command,
          exitCode: i.exitCode,
          duration: i.duration,
          target: i.target,
          time: new Date(i.timestamp).toLocaleTimeString(),
        })),
        bySession: Array.from(
          this.context.terminalInteractions.reduce((acc, i) => {
            if (!acc.has(i.sessionId)) {
              acc.set(i.sessionId, []);
            }
            acc.get(i.sessionId)!.push(i);
            return acc;
          }, new Map<string, typeof this.context.terminalInteractions>())
        ).map(([sessionId, interactions]) => ({
          sessionId,
          sessionType: interactions[0]?.sessionType,
          commandCount: interactions.filter(i => i.command).length,
          lastCommand: interactions.filter(i => i.command).slice(-1)[0]?.command,
          avgDuration: interactions.filter(i => i.duration).reduce((sum, i) => sum + (i.duration || 0), 0) / interactions.filter(i => i.duration).length || 0,
        })),
      },

      // USER COMMANDS (Button clicks, UI actions)
      userCommands: {
        total: this.context.userCommands.length,
        recent: this.context.userCommands.slice(-20).map(c => ({
          section: c.section,
          action: c.action,
          details: c.details,
          target: c.target,
          time: new Date(c.timestamp).toLocaleTimeString(),
        })),
        bySection: Array.from(
          this.context.userCommands.reduce((acc, c) => {
            if (!acc.has(c.section)) {
              acc.set(c.section, []);
            }
            acc.get(c.section)!.push(c);
            return acc;
          }, new Map<string, typeof this.context.userCommands>())
        ).map(([section, commands]) => ({
          section,
          count: commands.length,
          lastAction: commands.slice(-1)[0]?.action,
        })),
      },

      // RECOMMENDATIONS (AI hints)
      hints: this.generateSmartHints(),
    };

    // PERFORMANCE: Cache the result and mark as clean
    this.cachedSummary = JSON.stringify(summary, null, 2);
    this.isDirty = false;
    return this.cachedSummary;
  }

  // Calculate exploit success rate
  private calculateExploitSuccessRate(): string {
    const exploitAttempts = this.context.activities.filter(a => a.type === 'metasploit');
    if (exploitAttempts.length === 0) return '0%';
    
    const successful = exploitAttempts.filter(a => a.success).length;
    const rate = (successful / exploitAttempts.length * 100).toFixed(0);
    return `${rate}% (${successful}/${exploitAttempts.length})`;
  }

  // Generate smart hints for AI
  private generateSmartHints(): string[] {
    const hints: string[] = [];

    // Hint: Unexploited critical CVEs
    const unexploitedCriticalCVEs = Array.from(this.context.cveDatabase.entries())
      .filter(([_, data]) => !data.exploited && (data.severity === 'critical' || data.severity === 'high'));
    
    if (unexploitedCriticalCVEs.length > 0) {
      hints.push(`🎯 ${unexploitedCriticalCVEs.length} critical/high CVEs found but not yet exploited`);
    }

    // Hint: Shells obtained
    const shellsObtained = this.context.activities
      .filter(a => a.type === 'metasploit' && a.success && a.sessions && a.sessions > 0).length;
    
    if (shellsObtained > 0) {
      hints.push(`🚀 ${shellsObtained} shell(s) obtained - can be used for pivoting`);
    }

    // Hint: Targets with multiple vulnerabilities
    const targetVulnCount = new Map<string, number>();
    this.context.activities.forEach(a => {
      if ('findings' in a && a.findings > 0) {
        const current = targetVulnCount.get(a.target) || 0;
        targetVulnCount.set(a.target, current + a.findings);
      }
    });

    const highValueTargets = Array.from(targetVulnCount.entries())
      .filter(([_, count]) => count >= 10)
      .sort((a, b) => b[1] - a[1]);

    if (highValueTargets.length > 0) {
      hints.push(`🔥 ${highValueTargets[0][0]} has ${highValueTargets[0][1]} vulnerabilities - high-value target`);
    }

    // Hint: Common vulnerable services
    const commonServices = Array.from(this.context.vulnerableServices.entries())
      .filter(([_, targets]) => targets.length >= 3)
      .sort((a, b) => b[1].length - a[1].length);

    if (commonServices.length > 0) {
      hints.push(`⚠️ ${commonServices[0][0]} found on ${commonServices[0][1].length} targets - potential attack vector`);
    }

    // Hint: User stuck indicators
    const recentStuck = this.context.stuckIndicators.filter(
      i => Date.now() - i.timestamp < 600000 // Last 10 minutes
    );

    if (recentStuck.length > 0) {
      hints.push(`🚨 Detected ${recentStuck.length} stuck indicator(s) - ${recentStuck[0].suggestion}`);
    }

    // Hint: Flagged findings not exploited
    const unexploitedFlags = Array.from(this.context.flaggedFindings.values())
      .flat()
      .filter(f => !f.exploited && (f.severity === 'critical' || f.severity === 'high'));

    if (unexploitedFlags.length > 0) {
      hints.push(`🎯 ${unexploitedFlags.length} critical/high flagged findings not yet exploited`);
    }

    // Hint: Failed exploit attempts
    const recentFailures = Array.from(this.context.exploitAttempts.values())
      .flat()
      .filter(a => !a.success && Date.now() - a.timestamp < 600000);

    if (recentFailures.length >= 3) {
      hints.push(`⚠️ ${recentFailures.length} failed exploit attempts recently - consider alternative approaches`);
    }

    return hints;
  }

  // Get detailed context for specific target
  getTargetContext(target: string): string {
    const targetActivities = this.context.activities.filter(activity => {
      if ('target' in activity) return activity.target === target;
      if ('domain' in activity) return activity.domain === target;
      return false;
    });

    return JSON.stringify({
      target,
      activities: targetActivities,
      totalScans: targetActivities.length,
    }, null, 2);
  }

  // Get recent context (last N activities)
  getRecentContext(count: number = 5): string {
    const recent = this.context.activities.slice(-count);
    return JSON.stringify(recent, null, 2);
  }

  // Get full context
  getFullContext(): GlobalContext {
    return this.context;
  }

  // Clear context
  clear() {
    this.context = {
      activities: [],
      targets: new Set(),
      findings: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      timeline: [],
      criticalEvents: [],
      exploitedTargets: new Set(),
      cveDatabase: new Map(),
      vulnerableServices: new Map(),
      flaggedFindings: new Map(),
      userProgress: {
        lastActivity: Date.now(),
        targetsScanned: 0,
        vulnerabilitiesFound: 0,
        exploitsAttempted: 0,
        exploitsSuccessful: 0,
        shellsObtained: 0,
      },
      stuckIndicators: [],
      exploitAttempts: new Map(),
      terminalInteractions: [],
      userCommands: [],
    };
    this.isDirty = true; // Mark as dirty after clear
  }

  // Export session
  exportSession(): string {
    return JSON.stringify({
      ...this.context,
      targets: Array.from(this.context.targets),
      exploitedTargets: Array.from(this.context.exploitedTargets),
      cveDatabase: Array.from(this.context.cveDatabase.entries()),
      vulnerableServices: Array.from(this.context.vulnerableServices.entries()),
      flaggedFindings: Array.from(this.context.flaggedFindings.entries()),
      userProgress: this.context.userProgress,
      stuckIndicators: this.context.stuckIndicators,
      exploitAttempts: Array.from(this.context.exploitAttempts.entries()),
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }

  // Get critical events only (for urgent AI alerts)
  getCriticalEvents(): CriticalEvent[] {
    return this.context.criticalEvents;
  }

  // Get exploited targets
  getExploitedTargets(): string[] {
    return Array.from(this.context.exploitedTargets);
  }

  // Get CVE database
  getCVEDatabase(): Map<string, { target: string; severity: Severity; exploited: boolean; attempts: number }> {
    return this.context.cveDatabase;
  }

  // Add flagged finding
  addFlaggedFinding(finding: FlaggedFinding) {
    if (!this.context.flaggedFindings.has(finding.target)) {
      this.context.flaggedFindings.set(finding.target, []);
    }
    this.context.flaggedFindings.get(finding.target)!.push(finding);
    this.isDirty = true; // Mark as dirty
  }

  // Track exploit attempt
  trackExploitAttempt(attempt: ExploitAttempt) {
    if (!this.context.exploitAttempts.has(attempt.target)) {
      this.context.exploitAttempts.set(attempt.target, []);
    }
    this.context.exploitAttempts.get(attempt.target)!.push(attempt);
    this.enforceLimitMap(this.context.exploitAttempts, this.MAX_EXPLOIT_ATTEMPTS);
    this.isDirty = true; // Mark as dirty

    // Update CVE attempts if applicable
    if (attempt.cve && this.context.cveDatabase.has(attempt.cve)) {
      const cveEntry = this.context.cveDatabase.get(attempt.cve)!;
      cveEntry.attempts = (cveEntry.attempts || 0) + 1;
    }

    // Detect stuck indicators
    this.detectStuckIndicators(attempt);
  }

  // Detect if user is stuck
  private detectStuckIndicators(attempt: ExploitAttempt) {
    const targetAttempts = this.context.exploitAttempts.get(attempt.target) || [];
    
    // Check for repeated failed exploits on same target
    const recentFailures = targetAttempts
      .filter(a => !a.success && Date.now() - a.timestamp < 600000) // Last 10 minutes
      .length;

    if (recentFailures >= 3) {
      this.addStuckIndicator({
        timestamp: Date.now(),
        type: 'failed_exploits',
        details: `${recentFailures} failed exploit attempts on ${attempt.target}`,
        suggestion: 'Try different exploit modules, verify target configuration, or move to another target',
        severity: 'warning',
      });
    }

    // Check for same module repeated
    const sameModuleAttempts = targetAttempts
      .filter(a => a.module === attempt.module && !a.success)
      .length;

    if (sameModuleAttempts >= 2) {
      this.addStuckIndicator({
        timestamp: Date.now(),
        type: 'repeated_scans',
        details: `Repeated attempts with ${attempt.module} on ${attempt.target}`,
        suggestion: 'This module may not work. Try alternative exploits or verify vulnerability exists',
        severity: 'critical',
      });
    }
  }

  // Add stuck indicator
  private addStuckIndicator(indicator: StuckIndicator) {
    // Avoid duplicates
    const exists = this.context.stuckIndicators.some(
      i => i.type === indicator.type && 
      i.details === indicator.details &&
      Date.now() - i.timestamp < 300000 // Within 5 minutes
    );

    if (!exists) {
      this.context.stuckIndicators.push(indicator);
      // Keep only last 10
      if (this.context.stuckIndicators.length > 10) {
        this.context.stuckIndicators = this.context.stuckIndicators.slice(-10);
      }
    }
  }

  // Track terminal interaction (FULL SESSION - BYOK model)
  trackCommandStart(data: { timestamp: number; sessionId: string; sessionType: string; command: string; target?: string }) {
    const interaction: TerminalInteraction = {
      timestamp: data.timestamp,
      sessionId: data.sessionId,
      sessionType: data.sessionType as any,
      command: data.command,
      target: data.target,
    };
    
    this.context.terminalInteractions.push(interaction);
    this.context.terminalInteractions = this.enforceLimit(this.context.terminalInteractions, this.MAX_TERMINAL_INTERACTIONS);
    this.isDirty = true; // Mark as dirty
    
    // BYOK: No artificial limits - keep full session history

    // Update timeline
    this.context.timeline.push({
      timestamp: data.timestamp,
      action: `Command started: ${data.command}`,
      section: data.sessionType,
    });
  }

  // Track command end (LIGHTWEIGHT - lifecycle + recent output)
  trackCommandEnd(data: { timestamp: number; sessionId: string; sessionType: string; exitCode: number; target?: string; recentOutput?: string[] }) {
    // Find the matching start event
    const startEvent = this.context.terminalInteractions
      .slice()
      .reverse()
      .find(i => i.sessionId === data.sessionId && i.command && !i.exitCode);
    
    if (startEvent) {
      // Update the start event with end data
      startEvent.exitCode = data.exitCode;
      startEvent.duration = data.timestamp - startEvent.timestamp;
      startEvent.recentOutput = data.recentOutput; // Store recent output
    } else {
      // No start event found, create end-only event
      const interaction: TerminalInteraction = {
        timestamp: data.timestamp,
        sessionId: data.sessionId,
        sessionType: data.sessionType as any,
        exitCode: data.exitCode,
        target: data.target,
        recentOutput: data.recentOutput, // Store recent output
      };
      
      this.context.terminalInteractions.push(interaction);
      this.context.terminalInteractions = this.enforceLimit(this.context.terminalInteractions, this.MAX_TERMINAL_INTERACTIONS);
    }

    this.isDirty = true; // Mark as dirty

    // Update timeline
    this.context.timeline.push({
      timestamp: data.timestamp,
      action: `Command ended (exit code: ${data.exitCode})`,
      section: data.sessionType,
    });
  }

  // Track user command (button clicks, UI actions)
  trackUserCommand(command: UserCommand) {
    this.context.userCommands.push(command);
    this.context.userCommands = this.enforceLimit(this.context.userCommands, this.MAX_USER_COMMANDS);
    this.isDirty = true; // Mark as dirty
    
    // BYOK: No artificial limits - keep full session history

    // Update timeline
    this.context.timeline.push({
      timestamp: command.timestamp,
      action: `${command.section}: ${command.action}`,
      section: command.section,
    });
  }

  // Get recent terminal interactions
  getRecentTerminalInteractions(count: number = 10): TerminalInteraction[] {
    return this.context.terminalInteractions.slice(-count);
  }

  // Get terminal interactions for specific session
  getSessionTerminalHistory(sessionId: string): TerminalInteraction[] {
    return this.context.terminalInteractions.filter(i => i.sessionId === sessionId);
  }

  // Get recent user commands
  getRecentUserCommands(count: number = 10): UserCommand[] {
    return this.context.userCommands.slice(-count);
  }

  // Get terminal output for AI context (BYOK - returns ALL output)
  getTerminalOutputForAI(sessionId?: string, maxLines?: number): string {
    let interactions = this.context.terminalInteractions;
    
    // Filter by session if specified
    if (sessionId) {
      interactions = interactions.filter(i => i.sessionId === sessionId);
    }
    
    // Get ALL interactions with output (BYOK - no artificial limits)
    const withOutput = interactions.filter(i => i.recentOutput && i.recentOutput.length > 0);
    
    if (withOutput.length === 0) {
      return 'No terminal output available.';
    }
    
    // Build formatted output
    let output = '# Terminal Session Output\n\n';
    
    withOutput.forEach(interaction => {
      output += `## Command: ${interaction.command || 'unknown'}\n`;
      output += `Exit Code: ${interaction.exitCode}\n`;
      if (interaction.duration) {
        output += `Duration: ${interaction.duration}ms\n`;
      }
      output += '\nOutput:\n```\n';
      
      // Get output lines (all or limited by maxLines if specified)
      const lines = interaction.recentOutput || [];
      const relevantLines = maxLines 
        ? lines.slice(-Math.floor(maxLines / withOutput.length))
        : lines;
      output += relevantLines.join('');
      
      output += '\n```\n\n';
    });
    
    return output;
  }

    private readonly MAX_TARGETS = 1000;
    private readonly MAX_EXPLOIT_ATTEMPTS = 5000;
    private readonly MAX_CVE_DATABASE = 10000;
    private readonly MAX_VULNERABLE_SERVICES = 5000;
    private readonly MAX_FLAGGED_FINDINGS = 5000;
    private readonly MAX_TERMINAL_INTERACTIONS = 10000;
    private readonly MAX_USER_COMMANDS = 5000;

    private enforceLimit<T>(collection: T[], maxSize: number): T[] {
      if (collection.length > maxSize) {
        return collection.slice(-maxSize);
      }
      return collection;
    }

    private enforceLimitMap<K, V>(map: Map<K, V>, maxSize: number): void {
      if (map.size > maxSize) {
        const toRemove = Math.floor(maxSize * 0.1);
        const keys = Array.from(map.keys()).slice(0, toRemove);
        keys.forEach(key => map.delete(key));
      }
    }

    private enforceLimitSet<T>(set: Set<T>, maxSize: number): void {
      if (set.size > maxSize) {
        const toRemove = Math.floor(maxSize * 0.1);
        const items = Array.from(set).slice(0, toRemove);
        items.forEach(item => set.delete(item));
      }
    }

}

// Singleton instance
export const globalContextStore = new GlobalContextStore();
