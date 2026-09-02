#!/usr/bin/env node
/**
 * Minimal Electron-runtime smoke test.
 *
 * This intentionally exercises the embedded Electron Node runtime and the
 * native node-pty module without opening a GUI window. It catches ABI and
 * platform packaging failures early on Windows, Linux, and macOS runners.
 */

const { spawn } = require('child_process');

const electronBinary = require('electron');
const marker = 'osecbox-electron-pty-ok';
const probe = `
  const pty = require('node-pty');
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : 'sh';
  const args = isWindows ? ['/d', '/c', 'echo ${marker}'] : ['-lc', 'printf "${marker}\\n"'];
  const term = pty.spawn(shell, args, {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });
  let output = '';
  const timer = setTimeout(() => {
    console.error('[ElectronSmoke] PTY timed out');
    try { term.kill(); } catch {}
    process.exit(1);
  }, 10000);
  term.onData((data) => {
    output += data;
    if (output.includes('${marker}')) {
      clearTimeout(timer);
      console.log('[ElectronSmoke] node-pty output received');
    }
  });
  term.onExit(({ exitCode }) => {
    clearTimeout(timer);
    if (!output.includes('${marker}')) {
      console.error('[ElectronSmoke] Expected marker was not received');
      process.exit(1);
    }
    console.log('[ElectronSmoke] PTY exited with code ' + exitCode);
    process.exit(0);
  });
`;

const child = spawn(electronBinary, ['--eval', probe], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

child.stdout.on('data', (data) => process.stdout.write(data));
child.stderr.on('data', (data) => process.stderr.write(data));
child.on('error', (error) => {
  console.error('[ElectronSmoke] Failed to launch Electron:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[ElectronSmoke] Electron exited via ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code || 0;
  }
});
