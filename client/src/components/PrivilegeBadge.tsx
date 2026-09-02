import { useEffect, useState } from 'react';
import { usePrivilegeStore } from '@/lib/privilege-store';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';

export function PrivilegeBadge() {
  const { level, username, sudoNoPassword, loading, checkPrivileges } = usePrivilegeStore();

  // CRITICAL OPTIMIZATION: Defer privilege check
  useEffect(() => {
    // Defer to 1 second - not critical for startup
    const timer = setTimeout(() => {
      checkPrivileges();
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [checkPrivileges]);

  if (loading) return null;

  const badges = {
    root: {
      icon: ShieldCheck,
      label: 'Root',
      color: 'text-red-500',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      tooltip: 'Running as root - full privileges',
    },
    admin: {
      icon: ShieldCheck,
      label: 'Admin',
      color: 'text-red-500',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      tooltip: 'Running as administrator',
    },
    sudo: {
      icon: Shield,
      label: 'Sudo',
      color: 'text-yellow-500',
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500/20',
      tooltip: sudoNoPassword
        ? 'Sudo is available without an interactive password at the time of the check'
        : 'Sudo is installed, but a password or policy approval is required; OsecBox did not attempt elevation',
    },
    user: {
      icon: ShieldAlert,
      label: 'User',
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
      tooltip: 'Limited privileges - some scans may not work',
    },
    unknown: {
      icon: Shield,
      label: 'Unknown',
      color: 'text-gray-500',
      bg: 'bg-gray-500/10',
      border: 'border-gray-500/20',
      tooltip: 'Privilege level unknown',
    },
  };

  const badge = badges[level];
  const Icon = badge.icon;

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 rounded-md border ${badge.bg} ${badge.color} ${badge.border} overflow-hidden`}
      title={badge.tooltip}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="text-xs font-medium truncate">{badge.label}</span>
      <span className="text-xs opacity-70 truncate">({username})</span>
    </div>
  );
}
