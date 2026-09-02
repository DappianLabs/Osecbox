import type { TunnelingSession } from './tunneling-store';

export function isStrictPort(value: string): boolean {
  return /^\d{1,5}$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 65535;
}

export function isSafeRemoteHost(value: string): boolean {
  const host = value.trim();
  return /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/.test(host);
}

function parsePort(value: string | undefined): number | null {
  return value && isStrictPort(value) ? Number(value) : null;
}

function normalizeLocalHost(value: string | undefined, fallback: string): string {
  const host = value?.trim() || '';
  if (!host || host === '*') return fallback;
  if (/^localhost$/i.test(host)) return '127.0.0.1';
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function commandExecutable(command: string): string {
  const withoutSudo = command.trim().replace(/^sudo\s+-n\s+/i, '');
  return withoutSudo.match(/^(?:\S*\/)?([A-Za-z0-9._-]+)\b/i)?.[1]?.toLowerCase() || '';
}

/** Replace only the executable token, preserving an optional noninteractive sudo prefix. */
export function replaceCommandExecutable(command: string, replacement: string): string {
  return command.replace(/^(\s*(?:sudo\s+-n\s+)?)(?:\S+)(?=\s|$)/i, `$1${replacement}`);
}

/** Return a local bind that can be checked before a tunnel command starts. */
export function getLocalTunnelBind(session: TunnelingSession): { port: number; host: string } | null {
  const command = session.command.trim().replace(/^sudo\s+-n\s+/i, '');
  const executable = commandExecutable(session.command);

  if (session.tool === 'chisel' && session.mode === 'server' && executable === 'chisel' && /^\S+\s+server\b/i.test(command)) {
    const portMatch = command.match(/--port(?:=|\s+)([^\s]+)|(?:^|\s)-p(?:=|\s+|(?=\d))([^\s]+)/i);
    const port = parsePort(portMatch?.[1] || portMatch?.[2]) ?? parsePort(session.port);
    const host = normalizeLocalHost(command.match(/--host(?:=|\s+)([^\s]+)/i)?.[1], '0.0.0.0');
    return port ? { port, host } : null;
  }
  if (
    session.tool === 'ligolo-ng'
    && session.mode === 'server'
    && ['ligolo-ng', 'proxy', 'ligolo-proxy'].includes(executable)
    && /(?:-selfcert\b|(?:-laddr|--laddr)(?:=|\s+))/i.test(command)
  ) {
    const address = command.match(/(?:-laddr|--laddr)(?:=|\s+)([^\s]+)/i)?.[1];
    const addressMatch = address?.match(/^(?:\[([^\]]+)\]|([^:]*)):(\d{1,5})$/);
    const port = parsePort(addressMatch?.[3]) ?? parsePort(session.port);
    const host = normalizeLocalHost(addressMatch?.[1] || addressMatch?.[2], '0.0.0.0');
    return port ? { port, host } : null;
  }
  if (session.tool === 'socat' && executable === 'socat' && /^\S+\s+TCP(?:4|6)?-LISTEN:/i.test(command)) {
    const port = parsePort(command.match(/^\S+\s+TCP(?:4|6)?-LISTEN:(\d{1,5})/i)?.[1]) ?? parsePort(session.port);
    const host = normalizeLocalHost(command.match(/(?:^|[,\s])bind=([^,\s]+)/i)?.[1], '0.0.0.0');
    return port ? { port, host } : null;
  }
  if (session.tool === 'ssh' && session.mode === 'client' && executable === 'ssh') {
    const localForward = command.match(/(?:^|\s)-L(?:=|\s+|(?=\[|[0-9*]))([^\s]+)/i)?.[1];
    if (!localForward) return null;
    const forwardMatch = localForward.match(/^(?:(\[[^\]]+\]|[^:]+):)?(\d{1,5}):/);
    const port = parsePort(forwardMatch?.[2]) ?? parsePort(session.localPort);
    const host = normalizeLocalHost(forwardMatch?.[1], '127.0.0.1');
    return port ? { port, host } : null;
  }
  return null;
}
