# OsecBox

> **An AI-assisted desktop workstation for authorized security testing that keeps recon, exploitation, terminals, listeners, pivots, and session context in one place.**

[![Version](https://img.shields.io/badge/version-1.0.2-7c3aed?style=flat-square)](https://github.com/DappianLabs/Osecbox/releases)
[![Platforms](https://img.shields.io/badge/releases-Windows%20x64%20%7C%20Linux%20x64-2563eb?style=flat-square)](https://github.com/DappianLabs/Osecbox/releases)
[![License](https://img.shields.io/badge/license-MIT-16a34a?style=flat-square)](LICENSE)

![OsecBox Nmap workspace with scan configuration, live terminal output, and parsed results](client/public/images/readme/scanners-nmap.webp)

Security engagements often fragment across terminals, flags, output files, listeners, and handwritten notes. OsecBox brings the tools and context together in a desktop workspace, so you can move from discovery to analysis without repeatedly rebuilding the same command, losing a terminal, or disconnecting the evidence from the action that produced it.

**OsecBox is for systems and data you are explicitly authorized to test.**

## What is OsecBox?

OsecBox is an Electron desktop application for managing authorized penetration-testing workflows. It combines guided tool launchers with live terminal sessions and keeps scan output, findings, listeners, tunnels, and saved workspaces connected as an engagement progresses.

It is not a replacement for the underlying security tools. It is the workspace that makes their command, output, and session context easier to manage.

## What it does

| From one workspace | What it helps you do |
| --- | --- |
| **Recon & scanning** | Configure and run Nmap, Nikto, Nuclei, and directory-scanning workflows; review live terminal output alongside parsed results. |
| **AI-assisted analysis** | Send captured command and output context to a configured AI provider for explanations and next-step guidance. |
| **Metasploit workflows** | Work with Metasploit console sessions, handlers, modules, jobs, and session state in the desktop app. |
| **Listeners & pivots** | Manage listeners, reverse-shell workflows, SSH tunnels, port forwarding, and pivoting sessions without losing their owning terminal. |
| **Engagement continuity** | Use multiple terminals, save and load workspace sessions, schedule supported scans, and review recorded activity. |
| **Attack-surface context** | Enumerate subdomains and generate a network topology from active scan and infrastructure data. |

## Core workflow

1. **Start with a target.** Use the Console scan workflow or Sub Domain view to begin discovery with the tools available in your configured runtime.
2. **Keep the evidence attached.** Each run has its own tab and terminal context, with parser-supported results kept beside the raw output.
3. **Understand the result.** Use the optional AI Assistant with your configured provider to analyze the captured context and suggest a next command for review.
4. **Continue the engagement.** Move into Metasploit, listener, and tunneling workflows while OsecBox retains the terminals and state that support them.
5. **Preserve the picture.** Save the workspace, use batch and scheduled scan workflows where appropriate, and build a topology from active scan and infrastructure data.

## Key capabilities

### Recon with live output and parsed findings

Nmap configuration, live output, and parsed port/finding views belong to the same scan tab rather than separate tools and files.

![Nmap scan configuration with clickable flags and parsed port results](client/public/images/readme/scanners-nmap.webp)

### AI that starts with the work you just did

The AI Assistant can use the command and terminal/output context OsecBox has captured. It requires a provider and API credentials configured by the user; review every suggested command and conclusion before acting on it.

![OsecBox AI panel explaining Nuclei findings with contextual next-step guidance](client/public/images/readme/ai-nuclei.webp)

### Metasploit, listeners, and session-aware infrastructure

OsecBox surfaces Metasploit console and handler workflows alongside listener and tunnel management, while preserving the associated terminal context.

| Metasploit workspace | Listener and tunnel management |
| --- | --- |
| ![OsecBox Metasploit console and module state](client/public/images/readme/msf-console.webp) | ![OsecBox listener management showing active sessions](client/public/images/readme/listeners-tunnel.webp) |

### Pivoting with visible configuration

Configure SSH tunnels, chisel, proxy chains, and port-forwarding workflows from the workspace, with the generated command visible for operator review before it runs.

## Why OsecBox

- **One engagement workspace.** Keep targets, commands, raw output, parsed results, terminals, listeners, and tunnels together instead of spread across windows.
- **Tool context, not a fake abstraction.** OsecBox works with real tool runtimes and displays their live output. It does not conceal what is being run.
- **A practical handoff between stages.** Scan data and active infrastructure can feed the topology view; sessions can be saved and loaded when work resumes.
- **Optional AI assistance with visible context.** AI features are user-configured and complement—not replace—operator judgment or authorization.

## Product tour

### 1. Prepare a batch scan

Use **Automate** to enter or import a target list, apply a scan preset across the list, and run the batch in Console mode.

![OsecBox automation view with target list and scan presets](client/public/images/readme/timeline-automation.webp)

### 2. Map the engagement

The **Topology** view can generate a network map from active scan results and active listeners, tunnels, and connections. You can also draw a custom diagram and export it as JSON or PNG.

### 3. Resume with the whole workspace

Use **Save** and **Load** to preserve the working session. OsecBox maintains per-user application data through Electron’s normal user-data location; it does not require administrator access to save a workspace.

## Architecture at a glance

OsecBox is an Electron-first desktop application:

- the **React renderer** provides the workspace and user interface;
- the **Electron main process** manages the desktop bridge, terminal/runtime integration, and IPC boundaries;
- the optional **Express server** supports the web renderer and AI API path.

For runtime boundaries and contributor ownership details, see [the architecture guide](docs/architecture.md).

## Installation

Download the current release from [GitHub Releases](https://github.com/DappianLabs/Osecbox/releases):

- **Windows x64:** use the NSIS installer for a normal installation, or the portable EXE for a no-install run.
- **Linux x64:** choose the AppImage, `.deb`, or `.tar.gz` package that suits your system.

Current tagged releases are published for Windows x64 and Linux x64. macOS packaging exists as future work but is not part of the current release lane.

OsecBox can run without every optional security tool installed. On Windows, workflows that use Linux-native tools require a working WSL2 version-2 distribution. Review the [optional setup guide](docs/setup.md) before installing tools or running setup helpers.

## Development

The project targets Node.js **22.12.0**. For a local development environment:

```sh
npm ci
npm run dev:electron
```

Run `npm run check`, `npm run check:electron`, and `npm test` for a focused local verification pass. See [development and verification](docs/development.md) for environment configuration, full checks, packaging notes, and contributor guidance.

## Security

Use OsecBox only with explicit authorization. Review the target, command, credentials, and tool configuration before every security workflow.

For vulnerability reporting and release-verification guidance, see [SECURITY.md](SECURITY.md). Do not submit secrets, target data, or unredacted command transcripts in public issues.

## Releases

Releases are published on [GitHub Releases](https://github.com/DappianLabs/Osecbox/releases). Current releases cover Windows x64 and Linux x64. Maintainer-only signing, packaging, checksum, and release procedures are intentionally kept in [the release guide](docs/release.md), not in this product overview.

## Documentation

- [Architecture](docs/architecture.md) — high-level runtime boundaries
- [Development](docs/development.md) — local setup, verification, and packaging notes
- [Optional setup](docs/setup.md) — WSL2 and security-tool setup
- [Release guide](docs/release.md) — maintainer release process
- [Contributing](CONTRIBUTING.md) — contribution expectations
- [Security policy](SECURITY.md) — reporting and release-safety guidance

## License

[MIT](LICENSE) © OsecBox contributors.
