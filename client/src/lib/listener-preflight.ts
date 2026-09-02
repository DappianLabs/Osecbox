import type { Listener } from './foothold-store';

function parsePort(value: string | undefined): number | null {
  if (!value || !/^\d{1,5}$/.test(value.trim())) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

function normalizeLocalHost(value: string | undefined): string {
  const host = value?.trim() || '';
  if (!host || host === '*') return '0.0.0.0';
  if (/^localhost$/i.test(host)) return '127.0.0.1';
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function commandExecutable(command: string): string {
  const withoutSudo = command.trim().replace(/^sudo\s+-n\s+/i, '');
  return withoutSudo.match(/^(?:\S*\/)?([A-Za-z0-9._-]+)\b/i)?.[1]?.toLowerCase() || '';
}

function resolvePort(candidate: string | undefined, fallback: number): number | null {
  return candidate === undefined ? parsePort(String(fallback)) : parsePort(candidate);
}

function shortOrLongPort(command: string): string | undefined {
  return command.match(/(?:^|\s)--port(?:=|\s+)([^\s]+)/i)?.[1]
    || command.match(/(?:^|\s)-[A-Za-z]*p[A-Za-z]*(?:=|\s+|(?=\d))([^\s]+)/i)?.[1];
}

function hasListenFlag(command: string): boolean {
  return /(?:^|\s)(?:--listen|-[A-Za-z]*l[A-Za-z]*)(?:\s|$)/i.test(command);
}

function localHostOption(command: string): string {
  return normalizeLocalHost(command.match(/(?:^|\s)(?:--bind|--host|-s)(?:=|\s+)([^\s,]+)/i)?.[1]);
}

/** Detect a local bind from the actual listener command, not only the form field. */
export function getLocalListenerBind(listener: Listener): { port: number; host: string } | null {
  if (!listener.command?.trim()) return null;

  const command = listener.command.trim().replace(/^sudo\s+-n\s+/i, '');
  const executable = commandExecutable(listener.command);

  if (['nc', 'ncat', 'netcat'].includes(executable) && hasListenFlag(command)) {
    const port = resolvePort(shortOrLongPort(command), listener.port);
    return port ? { port, host: localHostOption(command) } : null;
  }

  if (executable === 'pwncat-cs' && hasListenFlag(command)) {
    const port = resolvePort(shortOrLongPort(command), listener.port);
    return port ? { port, host: localHostOption(command) } : null;
  }

  if (executable === 'socat' && /^\S+\s+TCP(?:4|6)?-LISTEN:/i.test(command)) {
    const port = resolvePort(command.match(/^\S+\s+TCP(?:4|6)?-LISTEN:(\d{1,5})/i)?.[1], listener.port);
    const host = normalizeLocalHost(command.match(/(?:^|[,\s])bind=([^,\s]+)/i)?.[1]);
    return port ? { port, host } : null;
  }

  if (['python', 'python3'].includes(executable) && /(?:^|\s)-m\s+http\.server\b/i.test(command)) {
    const port = resolvePort(command.match(/-m\s+http\.server(?:=|\s+)(\d{1,5})/i)?.[1], listener.port);
    return port ? { port, host: localHostOption(command) } : null;
  }

  if (executable === 'msfconsole' && /\bset\s+LPORT\b/i.test(command)) {
    const port = resolvePort(command.match(/\bset\s+LPORT\s+(\d{1,5})/i)?.[1], listener.port);
    const host = normalizeLocalHost(command.match(/\bset\s+LHOST\s+([^;\s"]+)/i)?.[1]);
    return port ? { port, host } : null;
  }

  if (['sliver', 'sliver-server'].includes(executable)) {
    const port = resolvePort(command.match(/(?:^|\s)-l(?:=|\s+)(\d{1,5})/i)?.[1], listener.port);
    return port ? { port, host: '0.0.0.0' } : null;
  }

  // Unknown custom commands are intentionally not guessed. The UI can still
  // run them, but OsecBox must not claim that an arbitrary command's port was
  // checked when it could not identify a local bind safely.
  return null;
}
