/** Minimal storage interface (localStorage-compatible). */
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
/** Offline queue for attempt submissions (NFR reliability). Items are de-duplicated by id. */
export class OfflineQueue<T extends { client_attempt_id: string }> {
  constructor(storage: KeyValueStorage, key?: string) { throw new Error("not implemented"); }
  enqueue(item: T): void { throw new Error("not implemented"); }
  items(): T[] { throw new Error("not implemented"); }
  size(): number { throw new Error("not implemented"); }
  /** Try to send each item in order; stops at the first failure. Successful items are removed. */
  flush(send: (item: T) => Promise<void>): Promise<{ sent: number; remaining: number }> { throw new Error("not implemented"); }
}
