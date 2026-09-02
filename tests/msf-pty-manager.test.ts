import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DataHandler = (data: string) => void;
type ExitHandler = (event: { exitCode: number }) => void;

class FakePty {
  readonly writes: string[] = [];
  private dataHandlers: DataHandler[] = [];
  private exitHandlers: ExitHandler[] = [];

  onData(handler: DataHandler) {
    this.dataHandlers.push(handler);
    return { dispose: () => undefined };
  }

  onExit(handler: ExitHandler) {
    this.exitHandlers.push(handler);
    return { dispose: () => undefined };
  }

  write(data: string) {
    this.writes.push(data);
  }

  resize() {
    return undefined;
  }

  kill() {
    this.exitHandlers.forEach(handler => handler({ exitCode: 0 }));
  }

  emitOutput(data: string) {
    this.dataHandlers.forEach(handler => handler(data));
  }
}

const fakeProcesses: FakePty[] = [];
const spawn = vi.fn(() => {
  const process = new FakePty();
  fakeProcesses.push(process);
  return process;
});

vi.mock('../electron/services/settings-service', () => ({
  settingsService: {
    waitUntilReady: vi.fn(async () => undefined),
    getToolConfig: vi.fn(() => ({ path: 'msfconsole' })),
    getSettings: vi.fn(() => ({ wsl2ExtraPaths: [] })),
  },
}));

vi.mock('../electron/platform-service', () => ({
  platformService: {
    checkToolAvailability: vi.fn(async () => ({
      available: true,
      path: 'msfconsole',
      usedWSL: false,
    })),
    getExecutionStrategy: vi.fn(async () => ({
      shouldUseWSL: false,
      commandPrefix: [],
      shellCommand: 'bash',
      homeDir: process.cwd(),
    })),
  },
}));

vi.mock('../electron/lazy-pty', () => ({
  loadPTY: vi.fn(async () => ({ spawn })),
}));

vi.mock('../electron/terminal-history-service', () => ({
  terminalHistoryService: {
    initHistory: vi.fn(async () => undefined),
    appendOutput: vi.fn(async () => undefined),
  },
}));

const { MsfPtyManager } = await import('../electron/msf-pty-manager');

describe('MsfPtyManager', () => {
  let manager: InstanceType<typeof MsfPtyManager>;

  beforeEach(() => {
    fakeProcesses.length = 0;
    spawn.mockClear();
    manager = new MsfPtyManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  it('waits for a real prompt even when the banner and prompt share one PTY chunk', async () => {
    const initialization = manager.initialize();

    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('=[ metasploit ]=\r\nMetasploit tip: use help\r\nmsf6 > ');

    await initialization;

    expect(manager.isReady()).toBe(true);
    expect(manager.getState().prompt).toBe('msf6 >');
  });

  it('queues concurrent early keystrokes and flushes them in order after readiness', async () => {
    const firstInput = manager.writeInput('h');
    const secondInput = manager.writeInput('elp\r');

    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('msf6 > ');
    await Promise.all([firstInput, secondInput]);

    expect(fakeProcesses[0].writes).toEqual(['h', 'elp\r']);
    expect(manager.getState().lastCommand).toBe('elp');
  });

  it('holds normal input until the active command returns to a prompt', async () => {
    const initialization = manager.initialize();

    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('msf6 > ');
    await initialization;

    await manager.writeInput('search type:exploit\r');
    const queuedInput = manager.writeInput('time\r');

    await queuedInput;
    expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r']);

    fakeProcesses[0].emitOutput('search results still streaming\r\nmsf6 > ');

    await vi.waitFor(() => {
      expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r', 'time\r']);
    });
  });

  it('holds a prompt split across PTY chunks until the final output is complete', async () => {
    const initialization = manager.initialize();

    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('msf6 > ');
    await initialization;
    await new Promise(resolve => setTimeout(resolve, 100));

    const displayed: string[] = [];
    manager.on('output', chunk => displayed.push(chunk));

    await manager.writeInput('search type:exploit\r');
    const queuedInput = manager.writeInput('time\r');

    await queuedInput;
    expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r']);

    // The first chunk ends with a prompt-like fragment, but the next chunk is
    // still part of the same search response. It must not release `time`.
    fakeProcesses[0].emitOutput('first result row\r\nmsf6 > ');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r']);

    fakeProcesses[0].emitOutput('continued result row\r\nmsf6 > ');
    await vi.waitFor(() => {
      expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r', 'time\r']);
    });

    await vi.waitFor(() => {
      expect(displayed.join('')).toContain('first result row\r\ncontinued result row\r\nmsf6 > ');
    });
  });

  it('moves a prompt embedded in a PTY burst behind the rows that follow it', async () => {
    const initialization = manager.initialize();

    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('msf6 > ');
    await initialization;

    const displayed: string[] = [];
    manager.on('output', chunk => displayed.push(chunk));

    await manager.writeInput('search type:exploit\r');
    const queuedInput = manager.writeInput('time\r');
    await queuedInput;

    // This is the failure shape from the UI report: a prompt arrives inside a
    // single output burst, followed by more rows from the same response.
    fakeProcesses[0].emitOutput('first result row\r\nmsf6 > \r\ncontinued result row\r\n');

    await vi.waitFor(() => {
      expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r', 'time\r']);
    });

    await vi.waitFor(() => {
      const transcript = displayed.join('');
      expect(transcript.indexOf('first result row')).toBeGreaterThanOrEqual(0);
      expect(transcript.indexOf('continued result row')).toBeGreaterThan(transcript.indexOf('first result row'));
      expect(transcript.lastIndexOf('msf6 >')).toBeGreaterThan(transcript.indexOf('continued result row'));
    });
  });

  it('does not leave input locked after a clear-style screen redraw', async () => {
    const initialization = manager.initialize();

    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('msf6 > ');
    await initialization;

    await manager.writeInput('clear\r');
    const nextCommand = manager.writeInput('search type:exploit\r');
    await nextCommand;
    expect(fakeProcesses[0].writes).toEqual(['clear\r']);

    // This is the styled prompt shape emitted by a real msfconsole readline
    // session: ANSI sequences can occur between "msf" and ">".
    fakeProcesses[0].emitOutput('\x1b[2J\x1b[H\x1b[4mmsf\x1b[0m \x1b[0m> ');

    await vi.waitFor(() => {
      expect(fakeProcesses[0].writes).toEqual(['clear\r', 'search type:exploit\r']);
    });
  });

  it('drops a delayed prompt when the visible transcript is explicitly cleared', async () => {
    const initialization = manager.initialize();

    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('msf6 > ');
    await initialization;

    const displayed: string[] = [];
    manager.on('output', chunk => displayed.push(chunk));
    fakeProcesses[0].emitOutput('old output\r\nmsf6 > ');
    const outputCountBeforeClear = displayed.length;

    await manager.clearDisplayOutput();
    await new Promise(resolve => setTimeout(resolve, 120));

    expect(manager.getBufferedOutput()).toBe('');
    expect(displayed.length).toBe(outputCountBeforeClear);
    expect(manager.isReady()).toBe(true);
  });

  it('does not treat an msf-like help line as a prompt while output is streaming', async () => {
    const initialization = manager.initialize();

    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('msf6 > ');
    await initialization;

    await manager.writeInput('search type:exploit\r');
    const queuedInput = manager.writeInput('time\r');

    await queuedInput;
    fakeProcesses[0].emitOutput(
      'search help is still streaming\r\nmsf > time       : Modules with a matching modification date\r\n',
    );

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r']);

    fakeProcesses[0].emitOutput('msf6 > ');
    await vi.waitFor(() => {
      expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r', 'time\r']);
    });
  });

  it('passes Ctrl+C immediately and discards text queued behind the running command', async () => {
    const initialization = manager.initialize();

    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('msf6 > ');
    await initialization;

    await manager.writeInput('search type:exploit\r');
    await manager.writeInput('time');
    await manager.writeInput('\x03');

    expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r', '\x03']);

    fakeProcesses[0].emitOutput('^C\r\nmsf6 > ');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fakeProcesses[0].writes).toEqual(['search type:exploit\r', '\x03']);
  });

  it('does not let a killed old generation close the restarted console', async () => {
    const firstInitialization = manager.initialize();
    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(1));
    fakeProcesses[0].emitOutput('msf6 > ');
    await firstInitialization;

    const restart = manager.restart();
    await vi.waitFor(() => expect(fakeProcesses).toHaveLength(2));
    fakeProcesses[1].emitOutput('msf6 > ');
    await restart;

    expect(manager.isReady()).toBe(true);
    expect(manager.getState().isReady).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
