/**
 * Host factory and utilities
 */

import type { Host, HostRole, Coverage, Unexplored } from './types';

export function createHost(id: string, ip: string, role: HostRole = 'target'): Host {
  return {
    id,
    ip,
    role,
    footholds: new Set(),
    foothold_details: new Map(), // Enhanced foothold tracking
    constraints: {},
    coverage: {
      filesystem: 0,
      network: 0,
      auth: 0,
      privilege: 0,
      execution: 0
    },
    unexplored: {
      filesystem: initializeFilesystemTargets(),
      network: initializeNetworkTargets(),
      auth: initializeAuthTargets(),
      privilege: initializePrivilegeTargets()
    },
    writable_paths: [],
    readable_paths: [],
    blockers: [],
    quick_wins: [],
    time_in_scope: {
      filesystem: 0,
      network: 0,
      auth: 0,
      privilege: 0,
      execution: 0
    },
    last_activity: Date.now()
  };
}

function initializeFilesystemTargets() {
  return [
    { path: '/etc/shadow', priority: 10 },
    { path: '/etc/passwd', priority: 9 },
    { path: '/root/.ssh', priority: 10 },
    { path: '/etc/cron.d', priority: 8 },
    { path: '/etc/crontab', priority: 8 },
    { path: '/var/spool/cron', priority: 8 },
    { path: '/var/www', priority: 7 },
    { path: '/opt', priority: 6 },
    { path: '/tmp', priority: 5 },
    { path: '/home', priority: 6 },
    { path: '/etc/sudoers', priority: 9 },
    { path: '/proc/version', priority: 7 },
    { path: '/etc/issue', priority: 6 }
  ];
}

function initializeNetworkTargets() {
  return [
    { service: 'kerberos', priority: 10 },
    { service: 'ldap', priority: 9 },
    { service: 'smb', priority: 8 },
    { service: 'ssh', priority: 7 },
    { service: 'rdp', priority: 7 },
    { service: 'http', priority: 5 },
    { service: 'https', priority: 5 },
    { service: 'ftp', priority: 6 },
    { service: 'mysql', priority: 7 },
    { service: 'postgresql', priority: 7 },
    { service: 'mssql', priority: 7 },
    { service: 'redis', priority: 6 },
    { service: 'mongodb', priority: 6 }
  ];
}

function initializeAuthTargets() {
  return [
    { method: 'local_users', priority: 8 },
    { method: 'domain_users', priority: 9 },
    { method: 'service_accounts', priority: 8 },
    { method: 'ssh_keys', priority: 9 },
    { method: 'kerberos_tickets', priority: 10 },
    { method: 'password_reuse', priority: 7 }
  ];
}

function initializePrivilegeTargets() {
  return [
    { vector: 'sudo', priority: 10 },
    { vector: 'suid', priority: 9 },
    { vector: 'kernel_exploit', priority: 10 },
    { vector: 'cron_job', priority: 8 },
    { vector: 'service_misconfiguration', priority: 7 },
    { vector: 'writable_service', priority: 8 },
    { vector: 'path_hijacking', priority: 7 },
    { vector: 'capabilities', priority: 8 }
  ];
}

export function serializeHost(host: Host): any {
  return {
    ...host,
    footholds: Array.from(host.footholds),
    foothold_details: Array.from(host.foothold_details.entries())
  };
}

export function deserializeHost(data: any): Host {
  return {
    ...data,
    footholds: new Set(data.footholds),
    foothold_details: new Map(data.foothold_details || [])
  };
}
