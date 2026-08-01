/**
 * @matthesketh/utopia-core — Microtask update scheduler
 *
 * Batches jobs so that many signal writes within one synchronous block produce
 * a single pass of work. The DOM bindings in `@matthesketh/utopia-runtime`
 * schedule their updates here, which is what makes a handler that writes five
 * signals render once rather than five times — and, just as importantly, what
 * stops a binding observing the world half-updated.
 *
 * A signal write notifies its subscribers *inside* `set()`. Without a
 * scheduler, a DOM binding therefore re-renders in the middle of whatever
 * function did the write, before the rest of that function has run. Deferring
 * to a microtask moves every binding to the point where the synchronous work is
 * finished and the world is consistent.
 *
 * `flushJobsSync` is the escape hatch behind `flushSync()`, for the rare code
 * that must read the DOM immediately after a write.
 */

const queue: Set<() => void> = new Set();
let isFlushing = false;
let isFlushPending = false;
const resolvedPromise: Promise<void> = Promise.resolve();

/**
 * Queue a job for the next microtask flush. Jobs are held in a Set, so the
 * SAME function reference queued repeatedly within a tick runs once — which is
 * why each binding schedules one stable job rather than a fresh closure.
 */
export function queueJob(job: () => void): void {
  queue.add(job);

  if (!isFlushPending && !isFlushing) {
    isFlushPending = true;
    void resolvedPromise.then(flushJobs);
  }
}

/**
 * Resolves after the pending flush completes. Await it in tests and in any code
 * that needs the DOM to reflect a signal write.
 */
export function tick(): Promise<void> {
  return resolvedPromise.then();
}

function flushJobs(): void {
  isFlushPending = false;
  isFlushing = true;

  try {
    // Snapshot and clear before iterating. Jobs added during this flush are
    // picked up by the follow-up pass below, never re-run within this one.
    const jobs = Array.from(queue);
    queue.clear();
    for (let i = 0; i < jobs.length; i++) {
      jobs[i]();
    }
  } finally {
    isFlushing = false;
    if (queue.size > 0) {
      isFlushPending = true;
      void resolvedPromise.then(flushJobs);
    }
  }
}

/**
 * Drain the queue now, including anything queued while draining.
 *
 * The iteration cap is a runaway detector, not a design constraint: a job that
 * re-queues itself every pass would otherwise spin the main thread forever.
 */
const MAX_SYNC_FLUSH_PASSES = 100;

export function flushJobsSync(): void {
  if (isFlushing) return; // already inside a flush; the loop below will pick it up
  let passes = 0;
  while (queue.size > 0) {
    if (++passes > MAX_SYNC_FLUSH_PASSES) {
      queue.clear();
      throw new Error(
        'Maximum synchronous job flush passes exceeded (a scheduled job keeps re-queueing itself)',
      );
    }
    flushJobs();
  }
}
