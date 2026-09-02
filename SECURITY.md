# Security policy

OsecBox is a security-testing tool. Use it only against systems and data for which you have explicit authorization.

## Reporting a vulnerability

Do not publish sensitive details in a public issue. Use [GitHub Security Advisories](https://github.com/DappianLabs/OsecBox/security/advisories/new) for this repository and include:

- the affected version or commit;
- a minimal reproduction;
- impact and required privileges;
- any suggested mitigation.

Never attach API keys, database credentials, private keys, target data, or full command transcripts. Rotate any credential that may have been exposed during testing.

## Release artifacts

Download releases only from the repository’s tagged GitHub Releases. The current release workflow publishes Windows and Linux artifacts. Published Windows artifacts are checked with Authenticode, and the Windows updater requires valid update signatures. Linux packages are not platform-signed by this project; the accompanying SHA-256 manifest provides an integrity check when obtained from the official release. macOS packaging is not part of the current release workflow.

A valid signature or checksum does not prove that software is malware-free, and this repository does not make that claim. Users should keep endpoint protection enabled and scan downloaded artifacts according to their organization’s policy. Report a suspected malicious release through GitHub Security Advisories rather than opening a public issue.
