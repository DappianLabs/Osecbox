#!/usr/bin/env bash
# Read-only DNS/runtime preflight for the same Linux environment used by OsecBox.
# It never edits /etc/resolv.conf, WSL settings, routes, or VPN configuration.

set -u

TARGET="${1:-}"
PROBE_OUTPUT=""
PROBE_STATUS=1
PROBE_AVAILABLE=0
PROBE_OK=0
ROUTE_OUTPUT=""
ROUTE_AVAILABLE=0
PUBLIC_OK=0
TARGET_OK=0

print_section() {
  printf '\n== %s ==\n' "$1"
}

lookup() {
  local host="$1"
  PROBE_OUTPUT=""
  PROBE_STATUS=1
  PROBE_AVAILABLE=0
  PROBE_OK=0

  if command -v getent >/dev/null 2>&1; then
    PROBE_AVAILABLE=1
    if command -v timeout >/dev/null 2>&1; then
      PROBE_OUTPUT="$(timeout 6s getent ahosts "$host" 2>&1)"
      PROBE_STATUS=$?
    else
      PROBE_OUTPUT="$(getent ahosts "$host" 2>&1)"
      PROBE_STATUS=$?
    fi
    [ "$PROBE_STATUS" -eq 0 ] && [ -n "$PROBE_OUTPUT" ] && PROBE_OK=1
    return 0
  fi

  if command -v dig >/dev/null 2>&1; then
    PROBE_AVAILABLE=1
    PROBE_OUTPUT="$(dig +time=4 +tries=1 +short "$host" 2>&1)"
    PROBE_STATUS=$?
    [ "$PROBE_STATUS" -eq 0 ] && [ -n "$PROBE_OUTPUT" ] && PROBE_OK=1
    return 0
  fi

  if command -v nslookup >/dev/null 2>&1; then
    PROBE_AVAILABLE=1
    if command -v timeout >/dev/null 2>&1; then
      PROBE_OUTPUT="$(timeout 6s nslookup -timeout=4 -retry=1 "$host" 2>&1)"
      PROBE_STATUS=$?
    else
      PROBE_OUTPUT="$(nslookup -timeout=4 -retry=1 "$host" 2>&1)"
      PROBE_STATUS=$?
    fi
    if [ "$PROBE_STATUS" -eq 0 ] && ! printf '%s\n' "$PROBE_OUTPUT" | grep -Eqi 'NXDOMAIN|SERVFAIL|timed out|can.t find|no answer|server failure|no servers could be reached'; then
      if printf '%s\n' "$PROBE_OUTPUT" | awk '/^Name:/{seen=1; next} seen && /^Address([[:space:]]|:)/{found=1} END{exit found ? 0 : 1}'; then
        PROBE_OK=1
      fi
    fi
    return 0
  fi

  return 0
}

if [ -n "$TARGET" ]; then
  if [[ ! "$TARGET" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    printf '[ERROR] Target must be a hostname such as app.example.com (no URL, path, or shell characters).\n'
    exit 2
  fi
fi

print_section 'Resolver configuration'
if [ -r /etc/resolv.conf ]; then
  sed -n '1,80p' /etc/resolv.conf
else
  printf '[ERROR] Cannot read /etc/resolv.conf\n'
fi

if command -v resolvectl >/dev/null 2>&1; then
  resolvectl status --no-pager 2>&1 | sed -n '1,120p'
else
  printf '[INFO] resolvectl is not installed; resolver status is limited to /etc/resolv.conf.\n'
fi

print_section 'Default route'
if command -v ip >/dev/null 2>&1; then
  ROUTE_AVAILABLE=1
  ROUTE_OUTPUT="$(ip route show default 2>&1)"
  if [ -n "$ROUTE_OUTPUT" ]; then
    printf '%s\n' "$ROUTE_OUTPUT"
  else
    printf '[ERROR] No default route was reported.\n'
  fi
else
  printf '[ERROR] ip command is not installed; route state could not be inspected.\n'
fi

if [ "$ROUTE_AVAILABLE" -eq 1 ] && ! printf '%s\n' "$ROUTE_OUTPUT" | grep -Eq '(^|[[:space:]])default([[:space:]]|$)|^0\.0\.0\.0[[:space:]]'; then
  printf '[ERROR] The runtime has no usable default route.\n'
fi

print_section 'Neutral DNS probe: example.com'
lookup example.com
if [ "$PROBE_AVAILABLE" -eq 0 ]; then
  printf '[ERROR] No supported resolver command is installed (getent, dig, or nslookup).\n'
  printf 'How to solve: install dnsutils on Debian/Ubuntu, or restore getent in the selected runtime.\n'
  exit 2
elif [ "$PROBE_OK" -eq 1 ]; then
  printf '[OK] example.com resolved in this runtime.\n%s\n' "$PROBE_OUTPUT"
  PUBLIC_OK=1
else
  printf '[ERROR] example.com did not resolve in this runtime.\n%s\n' "$PROBE_OUTPUT"
fi

if [ -n "$TARGET" ]; then
  print_section "Target DNS probe: $TARGET"
  lookup "$TARGET"
  if [ "$PROBE_OK" -eq 1 ]; then
    printf '[OK] %s resolved in this runtime.\n%s\n' "$TARGET" "$PROBE_OUTPUT"
    TARGET_OK=1
  else
    printf '[ERROR] %s did not resolve in this runtime.\n%s\n' "$TARGET" "$PROBE_OUTPUT"
  fi
fi

print_section 'Classification and next action'

# A target that resolves is usable even when a public neutral name is blocked;
# that is common on private/VPN/split-DNS networks.
if [ -n "$TARGET" ]; then
  if [ "$TARGET_OK" -eq 1 ]; then
    printf '[OK] Target DNS is usable in this runtime.\n'
    if [ "$PUBLIC_OK" -eq 0 ]; then
      printf '[INFO] The neutral public probe failed, but the target resolved; this may be expected split-DNS/VPN behavior.\n'
    fi
    exit 0
  fi
fi

if [ "$PUBLIC_OK" -eq 1 ]; then
  printf '[ERROR] The runtime resolver works for example.com, but the requested target does not.\n'
  printf 'How to solve: check the hostname spelling and its A/AAAA records; connect the required VPN or split-DNS network; do not replace private DNS with a public resolver.\n'
  exit 2
fi

if [ "$ROUTE_AVAILABLE" -eq 1 ] && ! printf '%s\n' "$ROUTE_OUTPUT" | grep -Eq '(^|[[:space:]])default([[:space:]]|$)|^0\.0\.0\.0[[:space:]]'; then
  printf '[ERROR] DNS failed and the runtime has no default route.\n'
  printf 'How to solve: restore the host network/VPN, then restart or reopen the runtime and rerun this check.\n'
  exit 2
fi

printf '[ERROR] DNS failed for the neutral public probe in the tool runtime.\n'
printf 'How to solve: reconnect the network/VPN, inspect /etc/resolv.conf and resolvectl status, and only then repair the runtime resolver. Back up files before editing; OsecBox does not blindly overwrite them.\n'
printf 'On WSL2, if the host network is healthy but the WSL DNS tunnel remains stale, close active WSL work only if safe, run: wsl --shutdown, reopen WSL, and rerun.\n'
exit 2
