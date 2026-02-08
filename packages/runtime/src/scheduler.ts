/**
 * @matthesketh/utopia-runtime — Microtask-based update scheduler
 *
 * Batches DOM update jobs so that multiple signal changes within the same
 * synchronous tick only trigger a single DOM update pass.
 */

const queue: Set<() => void> = new Set();
let isFlushing = false;
let isFlushPending = false;
let resolvedPromise: Promise<void> = Promise.resolve();

/**
 * Queue a job for the next microtask flush. Duplicate references to the same
 * function are automatically de-duplicated because we store them in a Set.
 */
export function queueJob(job: () => void): void {
  queue.add(job);

  if (!isFlushPending && !isFlushing) {
    isFlushPending = true;
    resolvedPromise.then(flushJobs);
  }
}

/**
 * Returns a promise that resolves after the current pending flush completes.
 * Useful for tests and any code that needs to wait for DOM updates.
 */
export function nextTick(): Promise<void> {
  return resolvedPromise.then();
}

function flushJobs(): void {
  isFlushPending = false;
  isFlushing = true;

  try {
    // Process the queue. Jobs added during flush are picked up in the same pass.
    for (const job of queue) {
      queue.delete(job);
      job();
    }
  } finally {
    isFlushing = false;
    // If new jobs were queued during flush, schedule another pass.
    if (queue.size > 0) {
      isFlushPending = true;
      resolvedPromise.then(flushJobs);
    }
  }
}
