/**
 * Renderer-lifetime AI projection for listener and tunnel PTYs.
 *
 * Foothold/tunnel commands intentionally stay in a foreground shell while
 * waiting for a connection, so TerminalService cannot finalize their command
 * record until the user stops them and the shell prompt returns. This bridge
 * publishes a bounded, replaceable snapshot to the command-output store while
 * the process is active. It is not durable history and is removed when the
 * command or backend PTY finishes.
 */
import { CommandOutputStore } from './attack-state/command-output-store';
import { cleanANSIForDisplay } from './utils/ansi-cleaner';

type ManagedKind = 'foothold' | 'tunneling';

type ManagedRecord = {
  id: string;
  kind: ManagedKind;
  type: string;
  command: string;
  tabId?: string;
  targetHint?: string;
  running: boolean;
};

type ActiveRun = {
  key: string;
  id: string;
  kind: ManagedKind;
  type: string;
  command: string;
  tabId?: string;
  targetHint?: string;
  sessionId?: string;
  target?: string;
  output: string;
  startedAt: number;
  num: number;
  generation: number;
  retryCount: number;
  publishTimer: ReturnType<typeof setTimeout> | null;
};

type StoreModules = {
  foothold: typeof import('./foothold-store');
  tunneling: typeof import('./tunneling-store');
  attack: typeof import('./attack-state-store');
};

type Cleanup = () => void;

const MAX_LIVE_OUTPUT_CHARS = 120_000;
const LIVE_PUBLISH_INTERVAL_MS = 350;
const LIVE_RETRY_INTERVAL_MS = 1_000;
const MAX_LIVE_PUBLISH_RETRIES = 30;

let modulePromise: Promise<StoreModules> | null = null;
let initializationPromise: Promise<Cleanup | undefined> | null = null;
let lifecycleGeneration = 0;
let nextLiveNum = 1_000_000_000;

const records = new Map<string, ManagedRecord>();
const activeRuns = new Map<string, ActiveRun>();
const pendingRuns = new Set<string>();
const outputChains = new Map<string, Promise<void>>();
const adaptedStores = new WeakSet<object>();

/**
 * Older licensed managers can provide a command store compiled before live
 * projections existed. Layer the optional methods onto that instance without
 * replacing its finalized evidence or persistence implementation.
 */
function ensureLiveStoreApi(store: any): boolean {
  if (!store || (typeof store !== 'object' && typeof store !== 'function')) return false;
  if (typeof store.upsertLiveOutput === 'function' && typeof store.removeLiveOutput === 'function') return true;
  if (adaptedStores.has(store)) return typeof store.upsertLiveOutput === 'function';

  try {
    const liveStore = new CommandOutputStore(128, MAX_LIVE_OUTPUT_CHARS, 16 * 1024 * 1024);
    const baseGetAll = typeof store.getAllOutputs === 'function'
      ? store.getAllOutputs.bind(store)
      : () => [];
    const baseGetScoped = typeof store.getScopedOutputs === 'function'
      ? store.getScopedOutputs.bind(store)
      : (scope: any) => baseGetAll().filter((output: any) => {
        if (scope?.terminalId && output?.terminalId !== scope.terminalId) return false;
        if (scope?.tabId && output?.tabId !== scope.tabId) return false;
        if (scope?.sessionId && output?.sessionId !== scope.sessionId) return false;
        return true;
      });
    const basePersisted = typeof store.getPersistedOutputs === 'function'
      ? store.getPersistedOutputs.bind(store)
      : baseGetAll;
    const baseClearForScope = typeof store.clearForScope === 'function'
      ? store.clearForScope.bind(store)
      : undefined;
    const baseClear = typeof store.clear === 'function' ? store.clear.bind(store) : undefined;
    const chronological = (outputs: any[]) => outputs.sort((left, right) =>
      (left.timestamp || 0) - (right.timestamp || 0) || (left.num || 0) - (right.num || 0),
    );

    store.upsertLiveOutput = (key: string, output: any) => liveStore.upsertLiveOutput(key, output);
    store.removeLiveOutput = (key: string) => liveStore.removeLiveOutput(key);
    store.getLiveOutputs = () => liveStore.getLiveOutputs();
    store.getPersistedOutputs = () => basePersisted();
    store.getAllOutputs = () => chronological([...baseGetAll(), ...liveStore.getAllOutputs()]);
    store.getRecentOutputs = (count: number) => store.getAllOutputs().slice(-count);
    store.getScopedOutputs = (scope: any) => chronological([...baseGetScoped(scope), ...liveStore.getScopedOutputs(scope)]);
    store.clearForScope = (scope: any) => {
      baseClearForScope?.(scope);
      liveStore.clearForScope(scope);
    };
    store.clear = () => {
      baseClear?.();
      liveStore.clear();
    };

    adaptedStores.add(store);
    return true;
  } catch {
    return false;
  }
}

function loadModules(): Promise<StoreModules> {
  if (!modulePromise) {
    modulePromise = Promise.all([
      import('./foothold-store'),
      import('./tunneling-store'),
      import('./attack-state-store'),
    ]).then(([foothold, tunneling, attack]) => ({ foothold, tunneling, attack }));
  }
  return modulePromise;
}

function normalizeOutput(data: string): string {
  return cleanANSIForDisplay(String(data || ''))
    .replace(/\x1b\]9;osecbox-command-exit;\d+\x07/g, '')
    .replace(/\r/g, '');
}

function appendBoundedOutput(run: ActiveRun, data: string): void {
  const clean = normalizeOutput(data);
  if (!clean) return;

  run.output += clean;
  if (run.output.length <= MAX_LIVE_OUTPUT_CHARS) return;

  const head = Math.floor(MAX_LIVE_OUTPUT_CHARS * 0.42);
  const tail = Math.floor(MAX_LIVE_OUTPUT_CHARS * 0.5);
  run.output = `${run.output.slice(0, head)}\n...[active output truncated; terminal retains the full transcript]...\n${run.output.slice(-tail)}`;
}

function schedulePublish(run: ActiveRun): void {
  if (run.publishTimer) return;
  run.publishTimer = setTimeout(() => {
    run.publishTimer = null;
    void publishRun(run);
  }, LIVE_PUBLISH_INTERVAL_MS);
}

async function publishRun(run: ActiveRun): Promise<void> {
  if (activeRuns.get(run.id) !== run) return;

  const modules = await loadModules();
  if (activeRuns.get(run.id) !== run) return;

  const attackState = modules.attack.useAttackState.getState();
  const manager = attackState.manager;
  const session = attackState.session;
  if (!manager || !session) {
    scheduleRetry(run);
    return;
  }

  if (run.sessionId && run.sessionId !== session.id) {
    removeRun(run.id);
    return;
  }

  // Capture provenance exactly once for the run. A later navigation or target
  // change must not reassign old terminal bytes to a different engagement.
  run.sessionId ||= session.id;
  run.target ||= String(session.target_ip || run.targetHint || 'localhost').trim() || 'localhost';

  const commandOutputStore = manager.commandOutputStore;
  if (!ensureLiveStoreApi(commandOutputStore)) {
    scheduleRetry(run);
    return;
  }

  const statusLine = `[ACTIVE ${run.kind} ${run.type}; process remains running]`;
  const output = `${statusLine}\n${run.output.trim() || '[waiting for process output]'}`;

  commandOutputStore.upsertLiveOutput(run.key, {
    num: run.num,
    command: run.command,
    output,
    stderr: '',
    exitCode: 0,
    timestamp: run.startedAt,
    host: run.target,
    duration: Date.now() - run.startedAt,
    live: true,
    liveKey: run.key,
    sessionId: run.sessionId,
    tabId: run.tabId,
    terminalId: run.id,
    target: run.target,
    tool: run.type,
  });
  run.retryCount = 0;
}

function scheduleRetry(run: ActiveRun): void {
  if (run.publishTimer || activeRuns.get(run.id) !== run) return;
  if (run.retryCount >= MAX_LIVE_PUBLISH_RETRIES) {
    console.warn(`[LiveFootholdContext] Stopping projection retries for ${run.id} after ${MAX_LIVE_PUBLISH_RETRIES} attempts`);
    removeRun(run.id);
    return;
  }

  run.retryCount += 1;
  run.publishTimer = setTimeout(() => {
    run.publishTimer = null;
    void publishRun(run);
  }, LIVE_RETRY_INTERVAL_MS);
}

async function ensureRun(record: ManagedRecord): Promise<void> {
  if (!record.running || activeRuns.has(record.id) || pendingRuns.has(record.id)) return;

  pendingRuns.add(record.id);
  const generation = lifecycleGeneration;
  const run: ActiveRun = {
    key: `${record.kind}:${record.id}`,
    id: record.id,
    kind: record.kind,
    type: record.type,
    command: record.command,
    tabId: record.tabId,
    targetHint: record.targetHint,
    output: '',
    startedAt: Date.now(),
    num: nextLiveNum++,
    generation,
    retryCount: 0,
    publishTimer: null,
  };
  activeRuns.set(record.id, run);
  pendingRuns.delete(record.id);

  // Publish a useful active-state record even when netcat/chisel is quiet.
  void publishRun(run);
}

function removeRun(id: string): void {
  const run = activeRuns.get(id);
  if (!run) return;

  if (run.publishTimer) clearTimeout(run.publishTimer);
  activeRuns.delete(id);
  pendingRuns.delete(id);

  const key = run.key;
  void loadModules().then(({ attack }) => {
    attack.useAttackState.getState().manager?.commandOutputStore?.removeLiveOutput?.(key);
  }).catch(() => undefined);
}

function updateManagedStatus(id: string, status: 'stopped' | 'idle'): void {
  const record = records.get(id);
  if (!record) return;

  void loadModules().then(({ foothold, tunneling }) => {
    if (record.kind === 'foothold') {
      foothold.useFootholdStore.getState().updateListener(id, { status: 'stopped' });
    } else {
      tunneling.useTunnelingStore.getState().updateSession(id, { status });
    }
  }).catch(() => undefined);
}

function syncManagedRecords(modules: StoreModules): void {
  const next = new Map<string, ManagedRecord>();

  for (const tab of modules.foothold.useFootholdStore.getState().tabs) {
    for (const listener of tab.listeners) {
      next.set(listener.id, {
        id: listener.id,
        kind: 'foothold',
        type: listener.type,
        command: listener.command,
        tabId: tab.id,
        running: listener.status === 'running',
      });
    }
  }

  for (const tab of modules.tunneling.useTunnelingStore.getState().tabs) {
    for (const session of tab.sessions) {
      next.set(session.id, {
        id: session.id,
        kind: 'tunneling',
        type: session.tool,
        command: session.command,
        tabId: tab.id,
        targetHint: session.remoteHost,
        running: session.status === 'running',
      });
    }
  }

  records.clear();
  next.forEach((record, id) => records.set(id, record));

  for (const [id] of activeRuns) {
    if (!next.get(id)?.running) removeRun(id);
  }
  next.forEach(record => {
    if (record.running) void ensureRun(record);
  });
}

async function handleOutput(data: { listenerId?: string; data?: string }): Promise<void> {
  const id = String(data?.listenerId || '');
  const record = records.get(id);
  if (!record?.running || !data?.data) return;

  await ensureRun(record);
  const run = activeRuns.get(id);
  if (!run || run.generation !== lifecycleGeneration) return;

  appendBoundedOutput(run, data.data);
  schedulePublish(run);
}

function enqueueOutput(data: { listenerId?: string; data?: string }): void {
  const id = String(data?.listenerId || '');
  if (!id || id.includes('::')) return;

  const previous = outputChains.get(id) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => handleOutput(data));
  outputChains.set(id, next);
  void next.finally(() => {
    if (outputChains.get(id) === next) outputChains.delete(id);
  }).catch(() => undefined);
}

function handleFinalized(id: string): void {
  const record = records.get(id);
  if (!record) return;
  removeRun(id);
  updateManagedStatus(id, record.kind === 'foothold' ? 'stopped' : 'idle');
}

function handleClosed(id: string): void {
  if (!records.has(id)) return;
  removeRun(id);
  const record = records.get(id);
  updateManagedStatus(id, record?.kind === 'foothold' ? 'stopped' : 'idle');
}

/** Clear active projections when the attack-state session is replaced/reset. */
export function invalidateLiveFootholdContext(): void {
  lifecycleGeneration += 1;
  for (const run of activeRuns.values()) {
    if (run.publishTimer) clearTimeout(run.publishTimer);
  }
  Array.from(activeRuns.keys()).forEach(removeRun);
  pendingRuns.clear();
  outputChains.clear();
}

/** Install once for the renderer lifetime; cleanup is only for app shutdown. */
export function initializeLiveFootholdContext(): Promise<Cleanup | undefined> {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    if (typeof window === 'undefined' || !window.electron?.onListenerOutput) return undefined;

    const modules = await loadModules();
    const api = window.electron;
    let disposed = false;
    // Increment the run epoch when the bridge is installed, but do not capture
    // it in event handlers. Session resets invalidate active runs and then
    // reuse this same renderer-lifetime bridge; a captured epoch would leave
    // all later PTY output permanently ignored.
    ++lifecycleGeneration;

    const sync = () => {
      if (!disposed) syncManagedRecords(modules);
    };

    const cleanupFns: Cleanup[] = [
      modules.foothold.useFootholdStore.subscribe(sync),
      modules.tunneling.useTunnelingStore.subscribe(sync),
      api.onListenerOutput((data) => {
        if (!disposed) enqueueOutput(data);
      }),
      api.onListenerClosed((data) => {
        if (!disposed) handleClosed(String(data.listenerId || ''));
      }),
      api.onListenerExit((data) => {
        if (!disposed) handleClosed(String(data.listenerId || ''));
      }),
      api.onListenerError((data) => {
        if (!disposed) handleClosed(String(data.listenerId || ''));
      }),
      (() => {
        const listener = (event: Event) => {
          if (disposed) return;
          const detail = (event as CustomEvent<{ listenerId?: string }>).detail;
          const id = String(detail?.listenerId || '');
          if (id) handleFinalized(id);
        };
        window.addEventListener('terminal-command-finalized', listener);
        return () => window.removeEventListener('terminal-command-finalized', listener);
      })(),
      (() => {
        const listener = (event: Event) => {
          if (disposed) return;
          const detail = (event as CustomEvent<{ listenerId?: string }>).detail;
          const id = String(detail?.listenerId || '');
          if (id) handleFinalized(id);
        };
        window.addEventListener('listener-stopped', listener);
        return () => window.removeEventListener('listener-stopped', listener);
      })(),
    ];

    sync();

    return () => {
      disposed = true;
      lifecycleGeneration += 1;
      cleanupFns.forEach(cleanup => cleanup?.());
      invalidateLiveFootholdContext();
      records.clear();
      initializationPromise = null;
    };
  })();

  return initializationPromise;
}
