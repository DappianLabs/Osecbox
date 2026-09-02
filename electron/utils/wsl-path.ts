/**
 * Shared WSL PATH and resource-path helpers.
 *
 * Keep shell quoting in one place. Terminal startup, tool discovery, and
 * non-PTY tool execution must all use the same Linux PATH semantics or a
 * configured Go binary can appear available in one surface and missing in
 * another.
 */

export const DEFAULT_WSL_PATHS = [
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
  '/usr/games',
  '/usr/local/games',
  '$HOME/go/bin',
  '$HOME/.local/bin',
  '$HOME/.cargo/bin',
  '/usr/local/go/bin',
  '/snap/bin',
];

function normalizeExtraPath(value: unknown): string | null {
  let trimmed = String(value || '').trim();
  if (!trimmed) return null;

  if (trimmed === '~') trimmed = '$HOME';
  else if (trimmed.startsWith('~/')) trimmed = `$HOME/${trimmed.slice(2)}`;

  // Extra PATH entries are Linux paths, not arbitrary shell fragments. Keep
  // spaces (for example /mnt/c/Program Files/tools) but reject characters
  // that could terminate the PATH assignment or inject another command.
  if (!(trimmed.startsWith('/') || trimmed === '$HOME' || trimmed.startsWith('$HOME/'))) {
    return null;
  }
  if (/[`;|&<>()[\]{}"'\r\n\0:]/.test(trimmed)) return null;
  if (trimmed.split('/').some(segment => segment === '..')) return null;
  return trimmed;
}

/** Accept a wordlist basename, never an arbitrary filesystem path. */
export function normalizeWordlistName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(trimmed)) return null;
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('..\\')) return null;
  return trimmed;
}

/** Quote one PATH segment for a bash command without expanding user data. */
export function shellQuotePathSegment(value: string): string {
  const trimmed = String(value || '').trim();
  if (trimmed === '$HOME' || trimmed.startsWith('$HOME/')) {
    return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${trimmed.replace(/'/g, "'\\''")}'`;
}

export function buildWslPath(extraPaths: string[] = []): string {
  return [...DEFAULT_WSL_PATHS, ...extraPaths]
    .map((value) => normalizeExtraPath(value))
    .filter((value): value is string => Boolean(value))
    .map(shellQuotePathSegment)
    .join(':');
}

/** Convert a Windows drive path into the corresponding WSL mount path. */
export function toWslPath(value: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  const drivePath = normalized.match(/^([a-zA-Z]):\/(.*)$/);
  if (drivePath) {
    return `/mnt/${drivePath[1].toLowerCase()}/${drivePath[2]}`;
  }
  return normalized;
}
