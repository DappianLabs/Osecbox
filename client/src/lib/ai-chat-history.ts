export interface PersistedAiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'ai-conversation-history';
const DATABASE_NAME = 'osecbox-local-state';
const STORE_NAME = 'ai-chat';
const RECORD_KEY = 'conversation';

let writeChain: Promise<void> = Promise.resolve();

function validateMessages(value: unknown): PersistedAiChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message): message is { role: unknown; content: unknown } => (
      !!message && typeof message === 'object' && 'role' in message && 'content' in message
    ))
    .map(message => ({
      role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(message.content ?? ''),
    }))
    .filter(message => message.content.length > 0);
}

export function getAiChatHistorySync(): PersistedAiChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateMessages(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  return new Promise(resolve => {
    try {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readIndexedDb(): Promise<PersistedAiChatMessage[] | null> {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise(resolve => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY);
      request.onsuccess = () => {
        database.close();
        resolve(validateMessages(request.result?.messages));
      };
      request.onerror = () => {
        database.close();
        resolve(null);
      };
    } catch {
      database.close();
      resolve(null);
    }
  });
}

async function writeIndexedDb(messages: PersistedAiChatMessage[]): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>(resolve => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        key: RECORD_KEY,
        messages,
        updatedAt: Date.now(),
      }, RECORD_KEY);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        resolve();
      };
    } catch {
      database.close();
      resolve();
    }
  });
}

/** Load the full local chat, using IndexedDB when localStorage is too small. */
export async function loadAiChatHistory(): Promise<PersistedAiChatMessage[]> {
  await writeChain.catch(() => undefined);
  const indexed = await readIndexedDb();
  return indexed && indexed.length > 0 ? indexed : getAiChatHistorySync();
}

/**
 * Persist without blocking a chat response. The write chain is flushed by
 * SessionManager before a named session save, so a Save click cannot outrun
 * the last message's disk write.
 */
export function persistAiChatHistory(messages: PersistedAiChatMessage[]): Promise<void> {
  const normalized = validateMessages(messages);
  const serialized = JSON.stringify(normalized);

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // IndexedDB below remains the authoritative fallback when the browser
    // quota is full. Keep a small mirror for legacy builds only.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized.slice(-50)));
    } catch {
      // Private mode can reject both writes; the in-memory chat remains usable.
    }
  }

  writeChain = writeChain
    .catch(() => undefined)
    .then(() => writeIndexedDb(normalized));
  return writeChain;
}

export async function flushAiChatHistory(): Promise<void> {
  await writeChain.catch(() => undefined);
}

export function serializeAiChatHistory(messages: PersistedAiChatMessage[]): string {
  return JSON.stringify(validateMessages(messages));
}
