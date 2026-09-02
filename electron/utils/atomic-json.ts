import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';

interface Candidate {
  filePath: string;
  data: string;
  modifiedAt: number;
}

function companionPattern(filePath: string): RegExp {
  const escaped = path.basename(filePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?:\\..+)?\\.(?:bak|tmp)$`);
}

async function readCandidate(filePath: string, validate?: (data: string) => boolean): Promise<Candidate | null> {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    if (validate && !validate(data)) return null;
    const stats = await fs.stat(filePath);
    return { filePath, data, modifiedAt: stats.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Read a file while recovering a complete .bak/.tmp companion after a crash.
 * The primary file always wins when it is valid; recovery candidates are only
 * considered when the primary is missing or invalid.
 */
export async function readTextFileWithRecovery(
  filePath: string,
  validate?: (data: string) => boolean,
): Promise<string | null> {
  const primary = await readCandidate(filePath, validate);
  if (primary) return primary.data;

  let entries: string[] = [];
  try {
    entries = await fs.readdir(path.dirname(filePath));
  } catch {
    return null;
  }

  const pattern = companionPattern(filePath);
  const candidates = (await Promise.all(
    entries
      .filter(entry => pattern.test(entry))
      .map(entry => readCandidate(path.join(path.dirname(filePath), entry), validate)),
  )).filter((candidate): candidate is Candidate => !!candidate)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  const recovered = candidates[0];
  if (!recovered) return null;

  // Promote only validated content. If another process has repaired the file
  // first, leaving the recovered companion is harmless and recoverable.
  try {
    await fs.rename(recovered.filePath, filePath);
  } catch {
    // Windows refuses replacement renames. A missing/invalid target is safe to
    // remove here because the validated recovery candidate is still present.
    try {
      await fs.rm(filePath, { force: true });
      await fs.rename(recovered.filePath, filePath);
    } catch {
      // The caller can still consume the validated data below.
    }
  }

  return recovered.data;
}

/**
 * Persist UTF-8 text with a flushed temporary file and a recoverable backup.
 * This is intentionally shared by session JSON and terminal-history manifests
 * so Windows, macOS, and Linux use the same failure semantics.
 */
export async function writeTextFileAtomic(filePath: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const suffix = `${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}`;
  const temporaryPath = `${filePath}.${suffix}.tmp`;
  const backupPath = `${filePath}.bak`;
  let handle: fs.FileHandle | null = null;
  let movedExisting = false;

  try {
    handle = await fs.open(temporaryPath, 'w', 0o600);
    await handle.writeFile(data, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = null;

    try {
      await fs.rm(backupPath, { force: true });
      await fs.rename(filePath, backupPath);
      movedExisting = true;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }

    try {
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      if (movedExisting) {
        await fs.rename(backupPath, filePath).catch(() => undefined);
        movedExisting = false;
      }
      throw error;
    }

    // Removing a stale backup is cleanup, not part of commit. If a security
    // product or antivirus temporarily holds it, the new target is still a
    // complete committed save and the backup remains useful for recovery.
    await fs.rm(backupPath, { force: true }).catch(() => undefined);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function isValidJson(data: string): boolean {
  try {
    JSON.parse(data);
    return true;
  } catch {
    return false;
  }
}
