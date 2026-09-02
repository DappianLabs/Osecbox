import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { isValidJson, readTextFileWithRecovery, writeTextFileAtomic } from '../electron/utils/atomic-json';

describe('atomic JSON persistence', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
  });

  it('commits a complete replacement and leaves valid JSON readable', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osecbox-atomic-'));
    directories.push(directory);
    const filePath = path.join(directory, 'session.json');

    await writeTextFileAtomic(filePath, JSON.stringify({ version: 1, output: 'old' }));
    await writeTextFileAtomic(filePath, JSON.stringify({ version: 2, output: 'new' }));

    const raw = await readTextFileWithRecovery(filePath, isValidJson);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ version: 2, output: 'new' });
  });

  it('recovers a validated backup when the primary is missing', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osecbox-atomic-'));
    directories.push(directory);
    const filePath = path.join(directory, 'history.manifest.json');

    await fs.writeFile(`${filePath}.bak`, JSON.stringify({ totalLines: 42 }), 'utf8');
    const recovered = await readTextFileWithRecovery(filePath, isValidJson);

    expect(JSON.parse(recovered!)).toEqual({ totalLines: 42 });
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual({ totalLines: 42 });
  });

  it('ignores invalid recovery candidates instead of replacing good state with garbage', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'osecbox-atomic-'));
    directories.push(directory);
    const filePath = path.join(directory, 'session.json');

    await fs.writeFile(filePath, '{broken', 'utf8');
    await fs.writeFile(`${filePath}.bak`, JSON.stringify({ safe: true }), 'utf8');

    const recovered = await readTextFileWithRecovery(filePath, isValidJson);
    expect(JSON.parse(recovered!)).toEqual({ safe: true });
  });
});
