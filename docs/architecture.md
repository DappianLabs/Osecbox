# Architecture

OsecBox has four runtime boundaries. Keeping ownership explicit prevents terminal state, IPC behavior, and renderer state from drifting apart.

## Runtime boundaries

| Boundary | Owns | Does not own |
| --- | --- | --- |
| `client/` | Views, Zustand stores, terminal rendering, scanner state, result parsing | OS processes, secrets, direct filesystem access |
| `electron/` | Window lifecycle, preload bridge, IPC validation, PTYs, tool execution, local persistence | React state or renderer-only presentation |
| `server/` | Express routes, web development server, AI API endpoint, production static serving | Desktop PTY sessions |
| `shared/` | Database schema and cross-runtime contracts | Runtime side effects |

## Important ownership rules

- A long-running command has one owner for its process, terminal session, run token, and cleanup path.
- Stop is terminal for the current run. A later Start creates a fresh run/session and cannot receive output from the cancelled run.
- The scanner, subdomain, and tunneling/listener surfaces use the same visible terminal lifecycle: stop the process, restore the prompt, and allow a new start without reusing stale output.
- Renderer code requests privileged work through the preload API. Main-process handlers validate inputs and own child processes.
- AI context is evidence-scoped. Terminal output and findings should retain the originating target, tab, terminal, and command metadata.
- Generated output belongs in `dist/` or `release/`; encrypted runtime bundles belong in `encrypted-modules/` and are generated during packaging.

## Build flow

```text
client/src + server/  ->  Vite + esbuild  ->  dist/
electron/             ->  TypeScript      ->  dist/electron/
dist/ + encrypted-modules/ -> electron-builder -> release/
```

The ordinary `npm run build` command produces the web/server distribution. Electron packaging adds the compiled main process, places encrypted modules in the resources directory outside `app.asar`, and requires `BUILD_ENCRYPTION_SECRET` before generating protected modules. Because PTY support is native, each desktop target is built on a matching OS runner.
