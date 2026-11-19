# Development and verification

## Install and run

```sh
npm ci
npm run dev:electron
```

For local server-backed development, copy `.env.example` to `.env` and set a
random `JWT_SECRET` with at least 32 characters. The `.env` file is ignored and
must not be committed. The supported Node.js version is `22.13.0`.

The renderer can also be run independently with `npm run dev:client`; the Express development server is available through `npm run dev`.

### WSL2 development

From the repository checkout in WSL2, install the Node.js version pinned by
`.nvmrc`, then install Linux dependencies and run Electron:

```sh
bash scripts/setup/install-wsl-node.sh
source ~/.bashrc
npm ci
npm run dev:electron
```

For first-run AI setup, add `CLOUDFLARE_API_KEY` and
`CLOUDFLARE_ACCOUNT_ID` to the ignored `.env` file. Development Electron loads
these values in the main process and uses them to prefill the Cloudflare
Workers AI default; credentials are encrypted when settings are saved and are
not returned to the renderer. Verify the connection in **Settings → AI → Test
& Save**. WSL2 GUI launches also require WSLg and Electron's Ubuntu shared
libraries (including `libnspr4`, `libnss3`, and `libasound2t64`).

On Windows, [`start-electron.bat`](../start-electron.bat) is the compatibility launcher for contributors who start the project by double-clicking it. It uses `npm.cmd` explicitly, repairs a missing dependency install with `npm ci`, and launches Vite and Electron from the repository directory.

## Verification commands

Public Windows releases are intentionally released without a commercial Authenticode certificate. Tagged builds publish SHA-256 checksums and generate GitHub Artifact Attestations for final release distributables; attestations provide build provenance but do not make Windows SmartScreen trust an unsigned EXE.

Run these before opening a pull request:

```sh
npm run check
npm run release:foundation
npm run check:electron
npm test -- --run
npm run audit:dependencies
npm run audit:platform
npm run build
npm run compile:electron
npm run audit:package
npm run release:checksums
```

`audit:platform` reports environment-specific warnings when a local capability cannot be enumerated. A warning is not a substitute for validating that capability on the target operating system.

## Build notes

- `scripts/build/application.mjs` builds the renderer and bundles the Express server.
- `scripts/build/ensure-electron-compiled.cjs` prepares Electron output for local development when it is missing.
- `scripts/diagnostics/platform-compatibility-audit.cjs` checks local OS/runtime capabilities.
- `scripts/build/rename-to-cjs.cjs` and `scripts/build/fix-all-requires.cjs` make compiled Electron files compatible with the root package's ESM setting.
- `scripts/build/verify-build-target.cjs` blocks cross-OS packaging because the app embeds a native `node-pty` runtime.
- `scripts/diagnostics/packaged-artifact-audit.cjs` verifies the actual `app.asar`, external encrypted-module resources, and target-native PTY files after packaging.
- `scripts/build/after-pack.cjs` removes unused `node-pty` prebuilds from the generated artifact while leaving the working tree untouched; the native payload must still be built on the target OS.
- `scripts/diagnostics/write-release-checksums.cjs` writes SHA-256 checksums for installable/archive artifacts and updater metadata in `release/`.
- `scripts/diagnostics/verify-release-checksums.cjs` verifies a `SHA256SUMS.txt` manifest against the files in a release directory.
- `scripts/diagnostics/release-foundation-check.cjs` validates versions, target outputs, CI permissions, updater metadata, signing readiness, and GitHub state without publishing.
- Production/Electron packaging requires a user- or CI-provided `BUILD_ENCRYPTION_SECRET`. Generated encrypted modules and release output are ignored; source files remain intact in the working tree and are not copied into the package.
- The package manifest keeps Drizzle Kit's deprecated esbuild loader on the patched root esbuild version through a targeted npm override until the upstream dependency removes that loader.

Build each desktop target on its matching runner:

```sh
npm run build:production:win
npm run build:production:linux
npm run build:production:mac
```

The Windows host can only certify the Windows artifact. Linux and macOS builds must run on their native CI runners.

## GitHub release and update flow

Push a version tag only after `package.json` and `package-lock.json` agree:

```sh
git commit -am "release: v1.0.3"
git push origin main
git tag v1.0.3
git push origin v1.0.3
```

The tag workflow builds Windows and Linux independently, runs the compatibility, dependency, package, and release-foundation audits, writes per-target checksums, verifies the downloaded build outputs, and publishes one GitHub Release. Set the repository Actions secret `BUILD_ENCRYPTION_SECRET` to a 64-character hexadecimal value before the first release. The workflow uses the automatic `GITHUB_TOKEN`; no personal token should be committed or embedded in the app.

The GitHub provider configuration in `electron-builder.json` and the generated `latest.yml`/platform metadata are part of the updater contract. Keep all metadata, blockmaps, and installers from one tagged build in the same release. The installed NSIS package and Linux AppImage can use `electron-updater`; the portable Windows, `.deb`, and `.tar.gz` artifacts are intentionally manual-update only. The app keeps updater state in the main process and exposes a state query so a renderer that starts after an update event can still show the correct status. Windows updater signature verification is disabled in `electron-builder.json` because this release is intentionally unsigned; electron-updater still verifies the published metadata/file hash, while SmartScreen may continue to show Unknown Publisher.

The release workflow requires only BUILD_ENCRYPTION_SECRET for packaging. Windows EXEs are intentionally unsigned; the workflow keeps Microsoft Defender scanning, final SHA-256 manifests, and GitHub Artifact Attestations for the final Windows and Linux distributables. Attestations do not replace Authenticode and do not prevent Windows SmartScreen or Unknown Publisher warnings. See docs/release.md for the checksum, attestation, and clean-machine acceptance checklist.

Session and settings persistence is per-user and uses Electron's `app.getPath('userData')`; do not hard-code a home-directory path in new code. The session handler performs a copy-only migration from the legacy `.osecbox/sessions` directory.

## Pull-request hygiene

Keep changes grouped by concern, update the relevant documentation when a runtime boundary changes, and do not add manual experiments to `tests/`. Use a focused automated test when a behavior can be exercised without a live WSL2 distribution or installed security tool.
