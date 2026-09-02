#!/usr/bin/env bash
# Read-only/runtime-local listener and tunnel preflight.
#
# Default mode reports the selected Linux runtime, privilege boundary, and
# tool availability. --loopback additionally exercises only 127.0.0.1 with
# short-lived local listeners/relays. It never installs packages, changes
# networking, contacts a target, or performs privilege escalation.

set -u

# Match the clean PATH used by OsecBox's WSL PTY/tool probes. Do not inherit
# Windows PATH entries here; they can make a Windows executable look like a
# Linux tool and hide the real runtime failure.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:$HOME/go/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/go/bin:/snap/bin"

LOOPBACK=0
if [ "${1:-}" = "--loopback" ]; then
  LOOPBACK=1
elif [ -n "${1:-}" ]; then
  printf '[ERROR] Usage: %s [--loopback]\n' "$0"
  exit 2
fi

FAILURES=0
PIDS=()

cleanup() {
  local pid
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

section() {
  printf '\n== %s ==\n' "$1"
}

check_tool() {
  local tool="$1"
  if command -v "$tool" >/dev/null 2>&1; then
    printf '[OK] %-14s %s\n' "$tool" "$(command -v "$tool")"
  else
    printf '[BLOCKED] %-14s missing in this runtime\n' "$tool"
  fi
}

pick_port() {
  python3 - <<'PY'
import socket
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
}

section 'Runtime and privilege boundary'
printf 'user: '
id -un 2>/dev/null || printf 'unknown\n'
printf 'uid: '
id -u 2>/dev/null || printf 'unknown\n'
printf 'kernel: '
uname -r 2>/dev/null || printf 'unknown\n'
if command -v sudo >/dev/null 2>&1; then
  if sudo -n true >/dev/null 2>&1; then
    printf '[INFO] sudo exists and accepted a noninteractive no-op check.\n'
  else
    printf '[INFO] sudo exists but passwordless/noninteractive use is unavailable; no elevation was attempted.\n'
  fi
else
  printf '[INFO] sudo is not installed; no elevation path is available here.\n'
fi

section 'Listener and tunnel binaries'
for tool in nc ncat socat chisel ligolo-ng sshuttle ngrok ssh python3 pwncat-cs sliver-server msfconsole; do
  check_tool "$tool"
done

if command -v ligolo-ng >/dev/null 2>&1; then
  ligolo_help="$(ligolo-ng -h 2>&1 || true)"
  if printf '%s\n' "$ligolo_help" | grep -Eqi -- '-selfcert|-laddr'; then
    printf '[OK] ligolo-ng role: proxy/server flags detected\n'
  elif printf '%s\n' "$ligolo_help" | grep -Eqi -- '-connect|-ignore-cert'; then
    printf '[INFO] ligolo-ng role: agent/client flags detected; server mode needs the proxy binary\n'
  else
    printf '[BLOCKED] ligolo-ng role could not be identified from local help output\n'
  fi
fi

section 'Non-networking command checks'
if command -v ssh >/dev/null 2>&1; then
  if ssh -G -o BatchMode=yes -o ConnectTimeout=1 127.0.0.1 >/dev/null 2>&1; then
    printf '[OK] ssh configuration parsed without opening a connection\n'
  else
    printf '[ERROR] ssh configuration parsing failed\n'
    FAILURES=$((FAILURES + 1))
  fi
fi
for tool in sshuttle pwncat-cs; do
  if command -v "$tool" >/dev/null 2>&1; then
    if "$tool" --version >/dev/null 2>&1; then
      printf '[OK] %s version command completed\n' "$tool"
    else
      printf '[ERROR] %s exists but its version command failed\n' "$tool"
      FAILURES=$((FAILURES + 1))
    fi
  fi
done

if command -v pwncat-cs >/dev/null 2>&1; then
  pwncat_log=/tmp/osecbox-check-pwncat-init.log
  if command -v timeout >/dev/null 2>&1; then
    timeout 10s pwncat-cs --list >"$pwncat_log" 2>&1
  else
    pwncat-cs --list >"$pwncat_log" 2>&1
  fi
  if [ "$?" -eq 0 ]; then
    printf '[OK] pwncat-cs local initialization completed without opening a session\n'
  elif grep -Eqi 'FileFinder.*find_module|find_module.*FileFinder' "$pwncat_log"; then
    printf '[BLOCKED] pwncat-cs is incompatible with the current Python runtime (FileFinder.find_module was removed); update/reinstall pwncat-cs or use its supported Python runtime\n'
    FAILURES=$((FAILURES + 1))
  else
    printf '[ERROR] pwncat-cs is installed but failed local initialization; see %s\n' "$pwncat_log"
    FAILURES=$((FAILURES + 1))
  fi
fi

if [ "$LOOPBACK" -eq 1 ]; then
  section 'Loopback-only listener and relay simulation'
  if ! command -v python3 >/dev/null 2>&1; then
    printf '[BLOCKED] python3 is required for the local request harness\n'
  else
    python3 - <<'PY'
import socket, threading
result = {}
ready = threading.Event()
def serve():
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    result["port"] = server.getsockname()[1]
    server.listen(1)
    ready.set()
    client, _ = server.accept()
    result["data"] = client.recv(64).decode()
    client.sendall(b"loopback-ok")
    client.close()
    server.close()
thread = threading.Thread(target=serve)
thread.start()
if not ready.wait(2):
    raise SystemExit("local listener did not become ready")
client = socket.create_connection(("127.0.0.1", result["port"]), 2)
client.sendall(b"pretest")
result["reply"] = client.recv(64).decode()
client.close()
thread.join(2)
if result.get("data") != "pretest" or result.get("reply") != "loopback-ok":
    raise SystemExit("local listener data path failed")
print("[OK] generic loopback bind/accept/data/close")
PY
    if [ "$?" -ne 0 ]; then
      FAILURES=$((FAILURES + 1))
    fi
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import errno, socket
first = socket.socket()
second = socket.socket()
try:
    first.bind(("127.0.0.1", 0))
    first.listen(1)
    port = first.getsockname()[1]
    try:
        second.bind(("127.0.0.1", port))
    except OSError as exc:
        if exc.errno not in (errno.EADDRINUSE, 98, 48, 10048):
            raise
        print("[OK] occupied-port detection returned EADDRINUSE")
    else:
        raise SystemExit("occupied-port detection unexpectedly allowed a second bind")
finally:
    second.close()
    first.close()
PY
    if [ "$?" -ne 0 ]; then
      printf '[ERROR] occupied-port detection failed\n'
      FAILURES=$((FAILURES + 1))
    fi
  fi

  if command -v nc >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    nc_port="$(pick_port)"
    nc -l 127.0.0.1 "$nc_port" >/tmp/osecbox-check-nc.log 2>&1 &
    nc_pid=$!
    PIDS+=("$nc_pid")
    sleep 0.25
    if python3 - "$nc_port" <<'PY'
import socket, sys
port = int(sys.argv[1])
sock = socket.create_connection(("127.0.0.1", port), 2)
sock.sendall(b"nc-pretest")
sock.close()
PY
    then
      printf '[OK] nc loopback listener\n'
    else
      printf '[ERROR] nc loopback listener did not accept a local client\n'
      FAILURES=$((FAILURES + 1))
    fi
  fi

  if command -v socat >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    relay_port="$(pick_port)"
    upstream_port="$(pick_port)"
    python3 -m http.server "$upstream_port" --bind 127.0.0.1 >/tmp/osecbox-check-http.log 2>&1 &
    http_pid=$!
    PIDS+=("$http_pid")
    socat TCP-LISTEN:"$relay_port",bind=127.0.0.1,reuseaddr,fork TCP:127.0.0.1:"$upstream_port" >/tmp/osecbox-check-socat.log 2>&1 &
    socat_pid=$!
    PIDS+=("$socat_pid")
    sleep 0.25
    if python3 - "$relay_port" <<'PY'
from urllib.request import urlopen
import sys
response = urlopen("http://127.0.0.1:%s/" % sys.argv[1], timeout=2)
if response.status != 200:
    raise SystemExit("unexpected HTTP status")
PY
    then
      printf '[OK] socat loopback relay\n'
    else
      printf '[ERROR] socat loopback relay failed\n'
      FAILURES=$((FAILURES + 1))
    fi
  fi

  if command -v chisel >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    chisel_server_port="$(pick_port)"
    chisel_forward_port="$(pick_port)"
    chisel_upstream_port="$(pick_port)"
    python3 -m http.server "$chisel_upstream_port" --bind 127.0.0.1 >/tmp/osecbox-check-chisel-http.log 2>&1 &
    chisel_http_pid=$!
    PIDS+=("$chisel_http_pid")
    chisel server --host 127.0.0.1 --port "$chisel_server_port" >/tmp/osecbox-check-chisel-server.log 2>&1 &
    chisel_server_pid=$!
    PIDS+=("$chisel_server_pid")
    sleep 0.25
    chisel client 127.0.0.1:"$chisel_server_port" "$chisel_forward_port":127.0.0.1:"$chisel_upstream_port" >/tmp/osecbox-check-chisel-client.log 2>&1 &
    chisel_client_pid=$!
    PIDS+=("$chisel_client_pid")
    sleep 0.5
    if python3 - "$chisel_forward_port" <<'PY'
from urllib.request import urlopen
import sys
response = urlopen("http://127.0.0.1:%s/" % sys.argv[1], timeout=3)
if response.status != 200:
    raise SystemExit("unexpected HTTP status")
PY
    then
      printf '[OK] chisel loopback client/server forward\n'
    else
      printf '[ERROR] chisel loopback forward failed; see /tmp/osecbox-check-chisel-*.log\n'
      FAILURES=$((FAILURES + 1))
    fi
  fi
fi

section 'Classification'
if [ "$FAILURES" -eq 0 ]; then
  printf '[OK] No exercised local listener/tunnel path failed. Missing optional tools remain BLOCKED above.\n'
  exit 0
fi

printf '[ERROR] %s local preflight check(s) failed. No target was contacted.\n' "$FAILURES"
exit 1
