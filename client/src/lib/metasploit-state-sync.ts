import type {
  MetasploitHandler,
  MetasploitSession,
} from './metasploit-store';
import { useMetasploitStore } from './metasploit-store';

function parseEndpoint(value: unknown): { host: string; port: number } {
  const text = String(value || '').trim();
  if (!text) return { host: 'unknown', port: 0 };

  // MSF normally prints host:port. Keep IPv6 literals intact by splitting at
  // the final colon only when the suffix is numeric.
  const match = text.match(/^(.*?)(?::(\d+))$/);
  if (!match) return { host: text, port: 0 };
  return { host: match[1] || 'unknown', port: Number(match[2]) || 0 };
}

export function mapMsfSession(stateSession: any, timestamp = Date.now()): MetasploitSession {
  const tunnel = String(stateSession?.tunnel || '');
  const [localText, remoteText] = tunnel.split(/\s*->\s*/);
  const local = parseEndpoint(localText);
  const remote = parseEndpoint(remoteText || localText);

  return {
    id: Number(stateSession?.id),
    type: stateSession?.type === 'meterpreter' || stateSession?.type === 'shell'
      ? stateSession.type
      : 'unknown',
    localIp: local.host,
    localPort: local.port,
    remoteIp: remote.host,
    remotePort: remote.port,
    status: 'active',
    platform: String(stateSession?.platform || 'unknown'),
    arch: String(stateSession?.arch || 'unknown'),
    user: String(stateSession?.user || 'unknown'),
    computer: String(stateSession?.computer || 'unknown'),
    os: String(stateSession?.info || ''),
    timestamp,
    lastActivity: timestamp,
  };
}

export function mapMsfJob(stateJob: any, timestamp = Date.now()): MetasploitHandler {
  const jobName = String(stateJob?.name || `Metasploit job ${stateJob?.id ?? ''}`).trim();
  const portMatch = jobName.match(/\b(?:lport|port)\s*[:=]?\s*(\d{1,5})\b/i);

  return {
    id: Number(stateJob?.id),
    payload: jobName || 'Unknown payload',
    jobName,
    port: portMatch ? Number(portMatch[1]) : Number(stateJob?.lport) || 0,
    status: 'listening',
    options: {
      ...(stateJob?.lhost ? { LHOST: String(stateJob.lhost) } : {}),
      ...(stateJob?.lport ? { LPORT: String(stateJob.lport) } : {}),
      ...(stateJob?.uripath ? { URIPATH: String(stateJob.uripath) } : {}),
    },
    createdAt: Date.parse(String(stateJob?.started || '')) || timestamp,
    sessionsCount: 0,
  };
}

export function syncMetasploitState(state: any): void {
  if (!state || typeof state !== 'object') return;

  // Keep the store synchronized with the live MSF process. The console state
  // is authoritative for active sessions/jobs; saved records are historical
  // until the process reports them again.
  const store = useMetasploitStore.getState();
  const timestamp = Date.now();

  if (Array.isArray(state.sessions)) {
    store.setSessions(
      state.sessions
        .map((session: any) => mapMsfSession(session, timestamp))
        .filter((session: MetasploitSession) => Number.isFinite(session.id)),
    );
  }

  if (Array.isArray(state.jobs)) {
    store.setHandlers(
      state.jobs
        .map((job: any) => mapMsfJob(job, timestamp))
        .filter((handler: MetasploitHandler) => Number.isFinite(handler.id)),
    );
  }
}
