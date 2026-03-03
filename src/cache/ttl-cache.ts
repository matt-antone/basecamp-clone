type CacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

export class TtlCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>
  ): Promise<T> {
    const existing = this.entries.get(key);

    if (existing && existing.expiresAt > this.now()) {
      return existing.value as Promise<T>;
    }

    const value = loader().catch((error) => {
      this.entries.delete(key);
      throw error;
    });

    this.entries.set(key, {
      expiresAt: this.now() + ttlMs,
      value
    });

    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
