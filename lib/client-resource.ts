"use client";

export function createClientResource<TKey, TValue>(
  load: (key: TKey) => Promise<TValue>,
  getKey: (key: TKey) => string
) {
  const cache = new Map<string, Promise<TValue>>();

  function read(key: TKey) {
    const cacheKey = getKey(key);
    const existing = cache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const pending = load(key).catch((error) => {
      cache.delete(cacheKey);
      throw error;
    });
    cache.set(cacheKey, pending);
    return pending;
  }

  function clear(key?: TKey) {
    if (key === undefined) {
      cache.clear();
      return;
    }

    cache.delete(getKey(key));
  }

  return {
    read,
    clear
  };
}
