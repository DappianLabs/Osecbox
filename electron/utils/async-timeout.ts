/**
 * Run a lifecycle task with a bounded wait.
 *
 * The underlying task is intentionally not cancelled when the deadline is
 * reached: many Electron/OS operations do not support cancellation. The
 * caller is released so shutdown can continue, while the task's promise still
 * has a rejection handler attached through Promise.race.
 */
export async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[Lifecycle] ${label} exceeded ${timeoutMs}ms; continuing`);
      resolve(undefined);
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
