// Per-key async mutex. Serialises order placement for the same venue+symbol so a
// signal SELL and a stop-loss SELL (or two BUYs) can never run concurrently.
const _tails = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = _tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => gate);
  _tails.set(key, tail);
  try {
    await prev.catch(() => undefined);
    return await fn();
  } finally {
    release();
    if (_tails.get(key) === tail) _tails.delete(key);
  }
}
