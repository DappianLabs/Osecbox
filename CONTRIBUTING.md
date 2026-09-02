# Contributing

## Before opening a pull request

Run the checks that match the change, at minimum:

```sh
npm run check
npm run check:electron
npm test -- --run
```

For build, packaging, dependency, or platform changes also run the corresponding audit and build commands in [`docs/development.md`](docs/development.md).

## Change boundaries

- Keep renderer, Electron, server, and shared changes in their owning directories.
- Preserve run ownership and cancellation behavior for scanners, terminals, listeners, and subdomain enumeration.
- Do not commit `.env` files, generated output, release artifacts, encrypted bundles, manual scripts, or local recordings.
- Explain user-visible behavior changes and new environment requirements in the pull request.

## Security-sensitive changes

Never include live credentials, target data, or unredacted command output in issues, pull requests, fixtures, or logs. See [`SECURITY.md`](SECURITY.md) for reporting guidance.
