#!/usr/bin/env node
'use strict';

/**
 * Guard Electron packaging against cross-OS native-module mistakes.
 *
 * electron-builder can technically be asked to emit another platform's
 * archive from the current OS, but OsecBox embeds node-pty. A package built
 * on the wrong host can therefore contain a valid installer with an invalid
 * PTY. Release targets must be built on their matching CI runner.
 */

const target = process.argv.slice(2).find((arg) => /^--(win|linux|mac)$/.test(arg));

if (!target) {
  console.log(`[BuildTarget] Host build: ${process.platform}/${process.arch}`);
  process.exit(0);
}

const expectedPlatform = {
  '--win': 'win32',
  '--linux': 'linux',
  '--mac': 'darwin',
}[target];

if (process.platform !== expectedPlatform) {
  console.error(
    `[BuildTarget] Refusing ${target} packaging on ${process.platform}/${process.arch}. ` +
    `Build it on a ${expectedPlatform} runner so node-pty is rebuilt for the packaged platform.`,
  );
  process.exit(1);
}

console.log(`[BuildTarget] ${target} packaging is running on the matching ${process.platform}/${process.arch} host`);
