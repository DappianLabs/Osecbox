# Optional local setup

The application can run without installing every security tool. WSL2 and tool setup is only needed for the workflows that invoke Linux-native tooling.

The scripts in [`scripts/setup/`](../scripts/setup/) are intentionally opt-in:

- `check-wsl2.bat` checks the Windows WSL2 prerequisites.
- `check-dns.bat` runs a read-only DNS and default-route preflight in WSL2; pass an optional hostname to separate resolver failures from target-specific/VPN DNS, for example `check-dns.bat app.example.com`.
- `check-listeners.bat` reports the exact WSL/Linux listener and tunnel runtime state; pass `--loopback` to exercise only local `nc`, `socat`, and `chisel` paths and clean them up automatically.
- `install-tools.sh` and the smaller installer scripts install or check common tools inside WSL2.
- `setup-listeners.sh` prepares listener-related dependencies.
- `check-htb-readiness.sh` reports whether a lab environment has the expected tooling.

Review every command before running it on a workstation. OsecBox is for systems and labs you are authorized to test; setup scripts do not grant authorization.

## DNS troubleshooting

OsecBox performs this same read-only preflight before managed hostname-based scans and exposes it in Settings → Platform & WSL2 → DNS preflight. It checks the resolver from the tool runtime, not only Windows DNS. A successful browser lookup therefore does not prove that a WSL2 tool can resolve the same name.

If it reports `resolver-unavailable`, inspect `/etc/resolv.conf` and `resolvectl status` in the selected distro, reconnect any VPN that supplies split DNS, and rerun the check. If it reports `network-unavailable`, restore the default route first. If it reports `target-unresolved` while `example.com` works, check the target record or private/VPN DNS; that is not a general WSL resolver failure.

The checker never changes networking configuration. If a repair is needed, back up `/etc/wsl.conf`, `/etc/resolv.conf`, and any systemd-resolved drop-in before editing. Public resolvers such as 1.1.1.1 or 8.8.8.8 are not a universal fix: they can break corporate/private split DNS and are outside OsecBox's control.

## Listener and tunnel troubleshooting

Listener and tunnel controls repeat the tool check at Start time in the same runtime as the PTY. A missing binary, unavailable WSL service, occupied local bind port, insufficient local permission, or Ligolo proxy/agent role mismatch leaves the session idle and reports the specific blocker. The install indicator is advisory until Start-time preflight completes.

Run `check-listeners.bat --loopback` for a safe local smoke test. Missing optional tools such as ngrok or Sliver are reported as `BLOCKED`, not treated as DNS failures. A Ligolo agent binary cannot provide proxy/server mode; install the matching proxy binary in the selected WSL distro. If the wrapper reports a WSL service/access error, repair or restart WSL2 first; that is a host/runtime boundary outside the app and not something a DNS change can solve.

The listener preflight also initializes `pwncat-cs --list` without opening a session. If it reports `FileFinder.find_module`, the installed pwncat release is incompatible with the selected Python runtime; update/reinstall pwncat-cs in WSL2 or configure a virtual environment with a Python version supported by that release. OsecBox does not silently patch system Python packages.
