/**
 * @matthesketh/utopia-runtime — update scheduler (re-export)
 *
 * The scheduler moved to `@matthesketh/utopia-core`, where the reactivity it
 * schedules lives: `effect(fn, { scheduler })` and `flushSync()` both need it,
 * and core cannot import downstream. Re-exported here unchanged so anything
 * already importing `queueJob` / `nextTick` from the runtime keeps working.
 */

export { tick as nextTick, queueJob, tick } from '@matthesketh/utopia-core';

/**
 * The scheduler the DOM bindings pass to `effect`.
 *
 * A bound effect paints its initial value synchronously (effects always run
 * once inline on creation) and defers every later update to a microtask. That
 * is what turns a handler writing five signals into one DOM pass instead of
 * five — and what stops a binding rendering halfway through the function that
 * wrote the signal, against a world only partly updated.
 */
export { queueJob as domScheduler } from '@matthesketh/utopia-core';
