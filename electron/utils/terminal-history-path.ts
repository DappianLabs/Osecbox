import { createHash } from 'crypto';

/**
 * Convert an arbitrary PTY/session id into a safe, stable filename stem.
 *
 * PTY ids intentionally contain separators such as `::` so they are useful
 * as in-memory keys. They cannot be used verbatim in Windows filenames,
 * where `:` is reserved. The digest keeps distinct ids from collapsing onto
 * the same history files after sanitization.
 */
export function getTerminalHistoryFileStem(ptyId: string): string {
  const original = typeof ptyId === 'string' ? ptyId : '';
  const safeBase = (original.trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+/, '_')
    .replace(/\.+$/, '_')
    .slice(0, 96)) || 'terminal';
  const digest = createHash('sha256').update(original).digest('hex').slice(0, 12);

  // Prefixing the stem also prevents Windows device-name collisions such as
  // CON, PRN, and NUL after sanitization.
  return `pty_${safeBase}_${digest}`;
}
