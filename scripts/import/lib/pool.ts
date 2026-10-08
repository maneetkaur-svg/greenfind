/** Runs `worker` over `items` with at most `limit` in flight at once. One
 *  item throwing never stops the others — the caller's worker is expected to
 *  catch its own errors and return a result describing the failure. */
export async function runWithConcurrency<T, R>(
  items: T[], limit: number, worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function lane(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}
