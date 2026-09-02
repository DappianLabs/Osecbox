# Development and verification

## Install and run

```sh
npm ci
npm run dev:electron
```

For local server-backed development, copy `.env.example` to `.env` and set a
random `JWT_SECRET` with at least 32 characters. The `.env` file is ignored and
must not be committed. The supported Node.js version is `22.12.0`.

The renderer can also be run independently with `npm run dev:client`; the Express development server is available through `npm run dev`.

On Windows, [`start-electron.bat`](../start-electron.bat) is the compatibility launcher for contributors who start the project by double-clicking it. It uses `npm.cmd` explicitly, repairs a missing dependency install with `npm ci`, and launches Vite and Electron from the repository directory.

## Verification commands

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
git commit -am "release: v1.0.2"
git push origin main
git tag v1.0.2
git push origin v1.0.2
```

The tag workflow builds Windows and Linux independently, runs the compatibility, dependency, package, and release-foundation audits, writes per-target checksums, verifies the downloaded build outputs, and publishes one GitHub Release. Set the repository Actions secret `BUILD_ENCRYPTION_SECRET` to a 64-character hexadecimal value before the first release. The workflow uses the automatic `GITHUB_TOKEN`; no personal token should be committed or embedded in the app.

The GitHub provider configuration in `electron-builder.json` and the generated `latest.yml`/platform metadata are part of the updater contract. Keep all metadata, blockmaps, and installers from one tagged build in the same release. The installed NSIS package can use `electron-updater`; the portable Windows artifact is intentionally manual-update only. Windows updater signature verification is enabled in `electron-builder.json`.

The release workflow requires `WINDOWS_CSC_LINK`/`WINDOWS_CSC_KEY_PASSWORD` for the public Windows release. Local builds may remain unsigned, but a tagged release fails before publication if Windows EXEs do not pass Authenticode. Linux packages are not platform-signed by this project; users should verify the published SHA-256 manifest instead. See [`docs/release.md`](release.md) for the exact secret preparation and clean-machine acceptance checklist.

Session and settings persistence is per-user and uses Electron's `app.getPath('userData')`; do not hard-code a home-directory path in new code. The session handler performs a copy-only migration from the legacy `.osecbox/sessions` directory.

## Pull-request hygiene

Keep changes grouped by concern, update the relevant documentation when a runtime boundary changes, and do not add manual experiments to `tests/`. Use a focused automated test when a behavior can be exercised without a live WSL2 distribution or installed security tool.
