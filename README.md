# OsecBox

OsecBox is a cross-platform Electron workspace for authorized security testing. It combines terminal sessions, scanners, listeners, tunneling, Metasploit workflows, result parsing, and optional AI-assisted analysis in one desktop application.

The project is an Electron application first. The Express server supports the web renderer and AI API path.

## Technology

- Electron, React, TypeScript, Vite, and xterm.js
- Express, PostgreSQL/Drizzle schema tooling, and WebSocket services
- WSL2-aware command execution on Windows with native POSIX support
- Vitest for automated tests and GitHub Actions for CI

## Repository map

| Path | Responsibility |
| --- | --- |
| [`client/`](client/) | React renderer, views, stores, terminal UI, scanner UI, and parsers |
| [`electron/`](electron/) | Electron main process, preload bridge, IPC handlers, PTY and desktop services |
| [`server/`](server/) | Express entry point, API routes, AI endpoint, and production static serving |
| [`shared/`](shared/) | Drizzle schema and contracts shared across runtimes |
| [`scripts/build/`](scripts/build/) | Reproducible renderer/server builds and Electron packaging helpers |
| [`scripts/setup/`](scripts/setup/) | Optional WSL2 and security-tool installation helpers |
| [`tests/`](tests/) | Automated Vitest coverage only |
| [`docs/`](docs/) | Maintainer-facing architecture, development, and setup notes |

Generated output, local secrets, manual experiments, release artifacts, and encrypted module bundles are intentionally excluded by [`.gitignore`](.gitignore).

## Requirements

- Node.js 22.12.0 or newer (required by Electron Rebuild 4 and the Electron 43 toolchain)
- npm
- Windows 10 or newer for the Windows desktop build (Electron 43 does not support Windows 7, 8, or 8.1)
- WSL2 with a version-2 distribution for Windows security-tool workflows
- PostgreSQL only when database-backed features or Drizzle migrations are used

## Development

```sh
npm ci
npm run check
npm run check:electron
npm test
```

For a local server-backed development run, copy `.env.example` to `.env` and
set `JWT_SECRET` to a random value of at least 32 characters. Keep `.env` local;
it is intentionally ignored and must never be committed. Configure an AI
provider only if you want to use the AI features. The repository targets Node.js
`22.12.0` (see `.nvmrc`).

Start the Electron development environment with:

```sh
npm run dev:electron
```

On Windows, double-click [`start-electron.bat`](start-electron.bat) for a development launch. It checks for Node.js, installs a missing `node_modules` tree with `npm.cmd ci`, starts Vite in one terminal, and starts Electron in a second terminal. Windows PowerShell users can use `npm.cmd` when execution policy blocks the `npm` shim.

The full local verification set is documented in [`docs/development.md`](docs/development.md).

## Installed app behavior

Use the NSIS installer for normal Windows installation. It installs per user by default and keeps app data in Electron's OS-specific `userData` directory, so settings, terminal history, startup cache, and saved sessions remain writable without administrator access. Sessions created by older builds under `~/.osecbox/sessions` are copied forward on first launch.

The portable Windows build is useful for a no-install run, but it does not provide the same installed-app update path; download a newer portable build manually. The NSIS build checks GitHub Releases for updates when a release is published. Local unsigned builds can trigger Windows SmartScreen or Linux desktop trust warnings. Published Windows builds must pass Authenticode validation. Linux packages use the checksum manifest and official release channel; they are not platform-signed by this project. macOS packaging remains available as a separate future target.

When a security tool is missing, OsecBox generates guidance for the runtime it will use. `Open in Terminal` opens an in-app terminal tab with the command ready for review; it does not silently execute package installation. Windows Linux-native tools still require a working WSL2 distribution.

## Build and package

```sh
npm run build
npm run build:electron:win
npm run build:electron:linux
npm run audit:package
npm run release:checksums
npm run release:verify-checksums -- release
npm run release:foundation
```

Electron packaging requires `BUILD_ENCRYPTION_SECRET` in the environment or CI. It must be 64 hexadecimal characters; generate one locally with `openssl rand -hex 32` and store it in a secret manager or GitHub repository secret. Never commit `.env` files, API keys, database credentials, license secrets, plaintext backups, or generated release artifacts.

`release:checksums` writes SHA-256 checksums for the generated installers, archives, and updater metadata. `release:verify-checksums -- release` verifies a generated checksum manifest before an artifact directory is shared. Checksums provide integrity comparison only; they do not prove publisher identity, source provenance, or that software is malware-free. The encryption preparation step is non-destructive: source files remain in the workspace and only generated encrypted modules are copied into the package.

Build targets must run on matching operating systems because the desktop app embeds native `node-pty`: Windows packaging on Windows, Linux packaging on Linux, and macOS packaging on macOS. The CI matrix performs the cross-platform artifact checks; this Windows workstation cannot certify Linux or macOS installers.

## Publishing a release

The repository workflow in [`.github/workflows/release.yml`](.github/workflows/release.yml) publishes the Windows and Linux desktop targets when a version tag is pushed. Before tagging:

```sh
# update package.json and package-lock.json to the same version
git add .
git commit -m "release: v1.0.2"
git push origin main
git tag v1.0.2
git push origin v1.0.2
```

The GitHub repository must contain a `BUILD_ENCRYPTION_SECRET` Actions secret with 64 hexadecimal characters, plus the Windows signing secrets documented in [`docs/release.md`](docs/release.md). The tag must match `package.json.version` exactly. The workflow builds on native Windows and Linux runners, audits each package, generates checksums, and creates the GitHub Release that `electron-updater` consumes. Do not upload a manually built EXE as a replacement for the tagged release metadata; keep the installer, blockmap, and `latest.yml` files from the same build together.

The generated `release/` directory and Windows binaries are intentionally ignored by source control. Users should download the installer and portable EXE from the tagged GitHub Release; the workflow publishes those release assets together with their updater metadata and checksums. This keeps large generated binaries out of the source repository while still shipping the packaged app alongside the code.

Published downloads use names such as `OsecBox-1.0.2-x64-Setup.exe` (Windows installer), `OsecBox-1.0.2-x64.exe` (Windows portable), `OsecBox-1.0.2-x64.AppImage`, `OsecBox-1.0.2-x64.deb`, and `OsecBox-1.0.2-x64.tar.gz` (Linux). Users select the matching file under the GitHub Release **Assets** section and verify `SHA256SUMS.txt` before running it.

For a published release, the workflow requires `WINDOWS_CSC_LINK`/`WINDOWS_CSC_KEY_PASSWORD`. Windows EXEs must pass Authenticode validation before publication. Linux packages are not platform-signed by this project; their release checksums protect against accidental or in-transit changes when the manifest is obtained from the official release. Local development builds may remain unsigned. The macOS secrets are not required by the current release lane.

No release process can honestly prove that an artifact is malware-free. Users should download only from the tagged GitHub Release, verify the checksum manifest, confirm the platform signature where applicable, and scan the downloaded files with their normal endpoint-security tools. See [`SECURITY.md`](SECURITY.md) for vulnerability reporting.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — runtime boundaries and important ownership rules
- [`docs/development.md`](docs/development.md) — development and verification commands
- [`docs/release.md`](docs/release.md) — maintainer preflight, signing, GitHub setup, and clean-machine acceptance
- [`docs/setup.md`](docs/setup.md) — optional WSL2 and tool setup
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution expectations
- [`SECURITY.md`](SECURITY.md) — authorization and vulnerability-reporting guidance

## Authorization

Use OsecBox only against systems and data for which you have explicit authorization. Review command, target, credential, and tool configuration before running security workflows.

## License

MIT. See [`LICENSE`](LICENSE).
