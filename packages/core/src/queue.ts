/** Minimal storage interface (localStorage-compatible). */
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Offline queue for attempt submissions (NFR reliability). Items are de-duplicated by id. */
export class OfflineQueue<T extends { client_attempt_id: string }> {
  private flushing: Promise<{ sent: number; remaining: number }> | null = null;

  constructor(private storage: KeyValueStorage, private key = 'medsim.offline-queue') {}

  private load(): T[] {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return [];
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as T[]) : [];
    } catch {
      return [];
    }
  }

  private save(items: T[]): void {
    if (items.length === 0) this.storage.removeItem(this.key);
    else this.storage.setItem(this.key, JSON.stringify(items));
  }

  /** Adds an item; an item with the same client_attempt_id is replaced in place (latest data wins). */
  enqueue(item: T): void {
    const items = this.load();
    const i = items.findIndex((x) => x.client_attempt_id === item.client_attempt_id);
    if (i >= 0) items[i] = item;
    else items.push(item);
    this.save(items);
  }

  items(): T[] {
    return this.load();
  }

  size(): number {
    return this.load().length;
  }

  /** Try to send each item in order; stops at the first failure. Successful items are removed. */
  flush(send: (item: T) => Promise<void>): Promise<{ sent: number; remaining: number }> {
    if (this.flushing) return this.flushing;
    const run = async () => {
      let sent = 0;
      for (const item of this.load()) {
        try {
          await send(item);
        } catch {
          break;
        }
        sent++;
        this.save(this.load().filter((x) => x.client_attempt_id !== item.client_attempt_id));
      }
      return { sent, remaining: this.size() };
    };
    this.flushing = run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }
}
