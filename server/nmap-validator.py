#!/usr/bin/env python3
"""
Nmap Command Validator
Safety net for validating nmap commands before execution
"""

import sys
import re
import os

def parse_command(command):
    """Parse nmap command into flags and target"""
    parts = command.split()
    if not parts or parts[0] != 'nmap':
        return [], None
    
    flags = []
    target = None
    
    # Simple approach: last non-flag argument is the target
    for part in parts[1:]:
        if part.startswith('-'):
            flags.append(part)
        else:
            # Could be a flag argument or the target
            # Assume last non-flag is target
            target = part
    
    return flags, target

def validate_nmap_command(command):
    """Validate nmap command for conflicts and requirements"""
    flags, target = parse_command(command)
    
    if not target:
        return False, "No target IP specified"
    
    # No flags is valid (default scan)
    if not flags:
        return True, "Command valid"
    
    # Check 1: Conflicting scan types
    scan_types = ['-sS', '-sT', '-sU', '-sY', '-sn', '-sA', '-sW', '-sM', '-sF', '-sN', '-sX', '-sI']
    scan_count = sum(1 for flag in flags if any(flag.startswith(st) for st in scan_types))
    if scan_count > 1:
        return False, "Multiple scan types selected (only one allowed)"
    
    # Check 2: Conflicting port options
    port_opts = ['-p', '-F', '--top-ports']
    port_count = sum(1 for flag in flags if any(flag.startswith(opt) for opt in port_opts))
    if port_count > 1:
        return False, "Multiple port options selected (only one allowed)"
    
    # Check 3: Conflicting timing
    timing_opts = ['-T0', '-T1', '-T2', '-T3', '-T4', '-T5']
    timing_count = sum(1 for flag in flags if any(flag.startswith(t) for t in timing_opts))
    if timing_count > 1:
        return False, "Multiple timing options selected (only one allowed)"
    
    # Check 4: Conflicting privilege modes
    priv_count = sum(1 for flag in flags if flag in ['--privileged', '--unprivileged'])
    if priv_count > 1:
        return False, "Both --privileged and --unprivileged specified (mutually exclusive)"
    
    # Check 5: Ping scan with port specification (edge case)
    has_ping_scan = any(flag == '-sn' for flag in flags)
    has_port_spec = any(flag.startswith('-p') for flag in flags)
    if has_ping_scan and has_port_spec:
        return False, "Ping scan (-sn) cannot use port specifications (-p)"
    
    # Check 6: Conflicting version detection options (edge case)
    has_version_intensity = any('--version-intensity' in flag for flag in flags)
    has_version_light = any('--version-light' in flag for flag in flags)
    has_version_all = any('--version-all' in flag for flag in flags)
    version_conflicts = sum([has_version_intensity, has_version_light, has_version_all])
    if version_conflicts > 1:
        return False, "Conflicting version detection options (use only one: --version-intensity, --version-light, or --version-all)"
    
    # Check 7: Requires root (skip on Windows)
    requires_root = any(flag.startswith(f) for flag in flags for f in ['-sS', '-sU', '-O'])
    if requires_root and hasattr(os, 'geteuid') and os.geteuid() != 0:
        return False, "This scan requires root/sudo privileges (use sudo)"
    
    # Check 8: Validate target format
    if not is_valid_target(target):
        return False, f"Invalid target format: {target}"
    
    # Check 9: Shell injection check
    dangerous_chars = [';', '&', '|', '`', '$', '(', ')', '{', '}', '[', ']', '<', '>', '\\']
    if any(char in command for char in dangerous_chars):
        return False, "Dangerous shell characters detected"
    
    return True, "Command valid"

def is_valid_target(target):
    """Validate target IP/hostname format"""
    # IP address
    ip_regex = r'^(\d{1,3}\.){3}\d{1,3}$'
    if re.match(ip_regex, target):
        parts = target.split('.')
        return all(0 <= int(part) <= 255 for part in parts)
    
    # CIDR notation
    cidr_regex = r'^(\d{1,3}\.){3}\d{1,3}/\d{1,2}$'
    if re.match(cidr_regex, target):
        ip, mask = target.split('/')
        parts = ip.split('.')
        return all(0 <= int(part) <= 255 for part in parts) and 0 <= int(mask) <= 32
    
    # IP range
    range_regex = r'^(\d{1,3}\.){3}\d{1,3}-\d{1,3}$'
    if re.match(range_regex, target):
        return True
    
    # Hostname
    hostname_regex = r'^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'
    if re.match(hostname_regex, target):
        return True
    
    return False

def main():
    if len(sys.argv) < 2:
        print("Usage: nmap-validator.py <nmap_command>")
        sys.exit(1)
    
    command = ' '.join(sys.argv[1:])
    
    # Debug: print parsed command
    # flags, target = parse_command(command)
    # print(f"DEBUG: Command: {command}", file=sys.stderr)
    # print(f"DEBUG: Flags: {flags}", file=sys.stderr)
    # print(f"DEBUG: Target: {target}", file=sys.stderr)
    
    valid, message = validate_nmap_command(command)
    
    if valid:
        print(f"✓ {message}")
        sys.exit(0)
    else:
        print(f"✗ {message}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
