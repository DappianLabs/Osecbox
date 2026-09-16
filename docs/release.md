# OsecBox release foundation

This document is the maintainer checklist for the first public GitHub
release. It prepares the release path; it does not publish anything.

The current public target is:

- Windows x64: an interactive per-user NSIS setup installer and a portable
  EXE.
- Linux x64: AppImage, deb, and tar.gz packages.

The macOS builder configuration remains available for future work, but it is
not part of the current release workflow and does not block a Windows/Linux
release.

## Published asset names

The version below is an example for `1.0.2`; replace it with the release
version. The GitHub Release will contain these user-facing downloads:

| Platform | Asset | Use |
| --- | --- | --- |
| Windows x64 | `OsecBox-1.0.2-x64-Setup.exe` | Recommended per-user installer. |
| Windows x64 | `OsecBox-1.0.2-x64.exe` | Portable, no-install fallback. |
| Linux x64 | `OsecBox-1.0.2-x64.AppImage` | Portable Linux desktop package. |
| Linux x64 | `OsecBox-1.0.2-x64.deb` | Debian/Ubuntu package. |
| Linux x64 | `OsecBox-1.0.2-x64.tar.gz` | Manual archive installation. |
| All | `SHA256SUMS.txt` | Integrity manifest for the published downloads. |

Windows `latest.yml` and the `.blockmap` file are updater metadata. Keep them
with the installer from the same release, but users normally select the setup
installer or portable EXE instead. In GitHub, users open the tagged Release,
expand **Assets**, download the file for their platform, and verify the
checksum before running it. Windows users should also confirm the EXE has a
valid Authenticode signature.

## Local preflight

Run these from a clean checkout before pushing a release tag:

```sh
npm ci
npm run release:foundation
npm run check
npm run check:electron
npm test -- --run
npm run audit:dependencies
npm run audit:platform
```

The normal preflight reports warnings for local-only conditions such as
missing signing credentials, a missing GitHub remote, and the absence of a
release tag. The final gate turns those conditions into failures:

```sh
npm run release:foundation -- --release --target=win --tag=v1.0.2
```

Replace the example tag with the version in `package.json`. The final gate is
read-only: it does not create commits, tags, releases, or files under
`release/`.

## CI security gates

Pull requests run GitHub's dependency-review action and fail on high-severity
dependency changes. Trusted packaging jobs run defense-in-depth scans over the
generated release directory before uploading or publishing it:

- Linux runners install ClamAV, refresh its signatures with freshclam, and
  scan every generated artifact.
- Windows runners update Microsoft Defender signatures and run its command-line
  custom scan over the generated release directory.

A clean antivirus result is a release gate, not a guarantee that software is
malware-free. Users should still download from the official GitHub Release,
verify checksums, and keep endpoint protection enabled.

## Required GitHub Actions secrets

Create these under the repository's Settings → Secrets and variables →
Actions. Store values as secrets, never in the repository or workflow logs.

| Secret | Purpose |
| --- | --- |
| `BUILD_ENCRYPTION_SECRET` | 64 hexadecimal characters used to generate protected runtime modules. |
| `WINDOWS_CSC_LINK` | Base64-encoded Windows Authenticode PFX, or a supported certificate URL/path supplied to electron-builder. |
| `WINDOWS_CSC_KEY_PASSWORD` | Password for the PFX private key. |

Generate the encryption secret once with a password manager or secret manager:

```sh
openssl rand -hex 32
```

Do not rotate `BUILD_ENCRYPTION_SECRET` casually between builds of the same
release. Keep it in the CI secret store and rotate it through a planned
release process.

### Windows Authenticode setup

1. Obtain a CA-issued code-signing certificate that can be used by the
   unattended build process. Export the certificate with its private key as a
   password-protected PFX.
2. Protect the PFX password separately. Do not commit the PFX, private key,
   certificate chain, or a plaintext copy.
3. Encode the PFX for the `WINDOWS_CSC_LINK` secret. In PowerShell:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('.\osecbox-signing.pfx'))
   ```

   Paste the resulting single-line value into `WINDOWS_CSC_LINK` and the PFX
   password into `WINDOWS_CSC_KEY_PASSWORD`.
4. The release workflow maps those secrets to electron-builder's
   `CSC_LINK` and `CSC_KEY_PASSWORD` variables.
5. The Windows runner checks every generated EXE with
   `Get-AuthenticodeSignature` before the publish job can run. A missing,
   invalid, or untrusted certificate stops the release before publication.

The certificate subject should identify the legal publisher you want users to
see. A valid signature improves publisher identity and tamper detection; it
does not prove that the application is malware-free.

## Repository setup

The package and builder metadata are intentionally aligned to:

```text
https://github.com/DappianLabs/Osecbox
```

After creating or selecting that repository, connect the local checkout and
make the first source commit:

```sh
git remote add origin https://github.com/DappianLabs/Osecbox.git
git branch -M main
git add .
git commit -m "chore: prepare OsecBox release foundation"
git push -u origin main
```

If `origin` already exists, inspect it before changing it:

```sh
git remote -v
```

If Git reports that the author identity is missing, configure your own
identity before the first commit. Use a verified address associated with your
GitHub account:

```sh
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Recommended GitHub repository settings:

- Protect `main`, require the CI status checks, and restrict direct pushes.
- Restrict creation or force-updating of `v*` tags to maintainers.
- Keep Actions default workflow permissions read-only. The release workflow
  grants `contents: write` only to its publish job.
- Keep Dependabot updates enabled for npm and GitHub Actions.
- Prefer a protected `release` environment with reviewer approval if more
  than one maintainer can create tags.

## Release sequence

1. Make the application changes and update the version in both manifests. For
   a normal patch release, this updates `package.json` and
   `package-lock.json` together:

   ```sh
   npm version patch --no-git-tag-version
   ```

   The tag must equal the resulting package version, including any prerelease
   suffix.
2. Run the local checks and final foundation gate with the exact tag.
3. Commit and push the source to `main`.
4. Push the matching tag:

   ```sh
   git tag v1.0.2
   git push origin v1.0.2
   ```

5. The tag workflow builds on matching native runners:
   Windows builds Windows `node-pty`; Linux builds Linux `node-pty`.
6. Each target is audited, receives a SHA-256 manifest, and is uploaded as a
   short-lived workflow artifact. The publish job verifies those manifests
   again before creating the GitHub Release.
7. The published Windows set must stay together: the NSIS installer, portable
   EXE, `latest.yml`, and blockmap files must come from the same tagged build.
   `electron-updater` consumes that metadata for installed NSIS builds.
8. Portable Windows builds are manual-update artifacts. Users download the
   newer portable EXE; they do not use the installed NSIS updater path.

For every later update, repeat this same version → check → commit → `main`
push → tag push sequence. The tag workflow rejects a tag whose version does
not match both package manifests, so an update cannot silently publish stale
metadata.

The release job publishes the Linux packages and an aggregate
`SHA256SUMS.txt`. Linux packages are not platform-signed by this project, so
the checksum manifest must be downloaded from the official tagged release and
checked before use.

## Clean-machine acceptance

The CI build proves that the package has the expected files and native PTY
payload. It does not replace a clean-machine rehearsal. Before announcing a
release, test the actual downloaded assets:

- Windows 10/11 x64 VM: install the NSIS setup as a standard user, launch,
  close during initialization, save and load a session, open a terminal,
  verify the configured AI provider with a user-supplied key, and uninstall.
- Windows portable EXE: run it from a fresh writable directory with no prior
  app data, then repeat close/reopen and session save/load.
- Linux test machine or VM: install/run the AppImage and deb package, verify
  desktop launch and terminal startup, and test a tar.gz extraction.
- WSL2 test machine: confirm a version-2 distro, tool discovery, DNS
  preflight, terminal startup directory, and missing-tool guidance. WSL2 is
  an optional runtime boundary, not a dependency of the installer itself.
- Verify the downloaded `SHA256SUMS.txt`; for Windows, also verify the
  Authenticode signature before opening the application. Keep endpoint
  protection enabled.

Record OS build, architecture, installer type, app version, and any blocked
runtime capability. Do not call a Windows-only rehearsal cross-platform
certification.

