// ============================================================================
// @matthesketh/utopia-core — Fine-grained signals reactivity system
// ============================================================================
//
// A compiler-first reactivity primitive layer inspired by SolidJS and Preact
// Signals. Provides: signal, computed, effect, batch, untrack.
//
// Key design decisions:
//   - Signals are callable objects (read via invocation or .value)
//   - Computed signals are lazy (dirty-flag, recompute only on read)
//   - Effects are eager (re-run on dependency change, respecting batching)
//   - Diamond dependencies are handled (each subscriber notified at most once)
//   - Conditional dependency tracking (subscriptions rebuilt on each execution)
// ============================================================================

// ---------------------------------------------------------------------------
// Internal error types
// ---------------------------------------------------------------------------

import { flushJobsSync } from '@/scheduler';

/** Thrown by flushPendingEffects when an infinite effect re-queue is detected. */
class FlushGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlushGuardError';
  }
}

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

/** Global effect error handler callback. */
let effectErrorHandler: ((error: unknown) => void) | null = null;

/**
 * Register a global error handler for effects. When set, effect errors are
 * forwarded to this handler instead of being logged to console.error.
 *
 * Returns a function that restores the previous handler.
 *
 * ```ts
 * const restore = onEffectError((err) => reportToSentry(err));
 * // later:
 * restore();
 * ```
 */
export function onEffectError(handler: (error: unknown) => void): () => void {
  const prev = effectErrorHandler;
  effectErrorHandler = handler;
  return () => {
    effectErrorHandler = prev;
  };
}

/** Internal: report an effect error via the global handler or console. */
function reportEffectError(label: string, err: unknown): void {
  if (effectErrorHandler) {
    effectErrorHandler(err);
  } else {
    console.error(label, err);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A read-only reactive signal. */
export interface ReadonlySignal<T> {
  /** Read the current value (tracks dependency). */
  (): T;
  /** Read the current value (tracks dependency). */
  readonly value: T;
  /** Read the current value WITHOUT tracking dependency. */
  peek(): T;
  /**
   * Dispose a derived signal (`computed`), unsubscribing it from its sources so
   * a long-lived source no longer retains it. Present on `computed` results;
   * a no-op concept for plain `signal`s. After disposal the value is frozen at
   * its last computed result.
   */
  dispose?(): void;
}

/** A writable reactive signal. */
export interface Signal<T> extends ReadonlySignal<T> {
  /** Set a new value. */
  set(newValue: T): void;
  /** Update via callback: fn(currentValue) => newValue. */
  update(fn: (current: T) => T): void;
}

// ---------------------------------------------------------------------------
// Internal subscriber interface
// ---------------------------------------------------------------------------

/** Internal interface for anything that can subscribe to signals. */
interface Subscriber {
  /** Called when a dependency has potentially changed. */
  notify(): void;
  /**
   * The set of SignalNodes this subscriber is currently subscribed to.
   * Used to clean up stale subscriptions before re-execution.
   */
  dependencies: Set<SignalNode<any>>;
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

/** Stack of currently executing subscribers (effects / computeds reading deps). */
let subscriberStack: (Subscriber | null)[] = [];

/** The currently active subscriber (top of stack), or null. */
let currentSubscriber: Subscriber | null = null;

/**
 * The currently active reactive root (set by `createRoot`), or null. effects
 * and computeds created while a root is active register their disposer here so
 * the whole group can be torn down at once.
 */
let currentRoot: { disposers: (() => void)[] } | null = null;

/** Register a disposer with the active reactive root, if any. */
function registerWithRoot(dispose: () => void): void {
  if (currentRoot !== null) {
    currentRoot.disposers.push(dispose);
  }
}

/** Batch depth counter. When > 0, effect execution is deferred. */
let batchDepth = 0;

/** Depth counter for computed recomputation — detects mutual circular dependencies. */
let computeDepth = 0;

/** Maximum allowed nesting depth for computed recomputation. */
const MAX_COMPUTE_DEPTH = 100;

/** Maximum allowed iterations for flushing pending effects. */
const MAX_FLUSH_ITERATIONS = 100;

/**
 * Maximum synchronous nesting of effect executions.
 *
 * `flushPendingEffects` guards the batched path, but effects also run
 * synchronously outside a flush: on creation, and from `notify()` whenever
 * `batchDepth === 0`. Nothing bounded that, so a cascade in which running one
 * effect synchronously causes another to run — the real case was an effect
 * dispatching a DOM event whose listeners wrote a signal it had just been made
 * to depend on — recursed with no error and no warning until the main thread
 * melted.
 *
 * The ceiling is the same 100 as MAX_FLUSH_ITERATIONS and MAX_COMPUTE_DEPTH,
 * deliberately: it is a runaway detector, not a design constraint, and one
 * number is easier to reason about than three. Legitimate synchronous nesting
 * is bounded by how deeply a UI nests reactive scopes — a component tree inside
 * nested `u-for` lists reaches tens at the very worst, and each level costs a
 * real render — whereas a runaway cascade blows past 100 in microseconds. Note
 * the counter measures DEPTH, not total runs: a flush that runs a thousand
 * sibling effects in sequence never exceeds 1.
 */
const MAX_SYNC_RUN_DEPTH = 100;

/** Queue of effects waiting to run after the current batch completes. */
let pendingEffects: Set<EffectNode> = new Set();

/** Re-entrancy depth counter for flushPendingEffects — detects effect-triggered infinite flush loops. */
let flushDepth = 0;

/** Synchronous nesting depth of EffectNode._run — detects unbatched runaway cascades. */
let syncRunDepth = 0;

// ---------------------------------------------------------------------------
// pushSubscriber / popSubscriber
// ---------------------------------------------------------------------------

function pushSubscriber(sub: Subscriber | null): void {
  subscriberStack.push(currentSubscriber);
  currentSubscriber = sub;
}

function popSubscriber(): void {
  currentSubscriber = subscriberStack.pop() ?? null;
}

// ---------------------------------------------------------------------------
// SignalNode — the internal mutable state cell
// ---------------------------------------------------------------------------

class SignalNode<T> {
  /** Current stored value. */
  _value: T;
  /** Set of subscribers currently tracking this signal. */
  _subscribers: Set<Subscriber> = new Set();

  constructor(value: T) {
    this._value = value;
  }

  /** Read value, registering the current subscriber if any. */
  _read(): T {
    if (currentSubscriber !== null) {
      this._subscribers.add(currentSubscriber);
      currentSubscriber.dependencies.add(this);
    }
    return this._value;
  }

  /** Read value WITHOUT tracking. */
  _peek(): T {
    return this._value;
  }

  /** Write a new value. If changed, notify all subscribers. */
  _write(newValue: T): void {
    if (Object.is(this._value, newValue)) {
      return;
    }
    this._value = newValue;
    // Automatically batch notifications from a single write. This ensures
    // that diamond dependencies (multiple computeds feeding one effect)
    // only trigger the effect once.
    batchDepth++;
    try {
      // Snapshot subscribers before notifying — a subscriber's notify() may
      // alter the set (cleanup + re-subscribe).
      const subs = Array.from(this._subscribers);
      for (let i = 0; i < subs.length; i++) {
        subs[i].notify();
      }
    } finally {
      batchDepth--;
      if (batchDepth === 0) {
        flushPendingEffects();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// signal()
// ---------------------------------------------------------------------------

/**
 * Creates a writable reactive signal.
 *
 * ```ts
 * const count = signal(0);
 * count()        // read (tracked)
 * count.value    // read (tracked)
 * count.peek()   // read (untracked)
 * count.set(1)   // write
 * count.update(n => n + 1) // write via callback
 * ```
 */
export function signal<T>(initialValue: T): Signal<T> {
  const node = new SignalNode<T>(initialValue);

  // The callable function itself acts as the read accessor.
  const read = (() => node._read()) as Signal<T>;

  // Attach methods and the .value getter.
  Object.defineProperty(read, 'value', {
    get(): T {
      return node._read();
    },
    enumerable: true,
    configurable: false,
  });

  (read as any).peek = (): T => node._peek();

  (read as any).set = (newValue: T): void => {
    node._write(newValue);
  };

  (read as any).update = (fn: (current: T) => T): void => {
    node._write(fn(node._value));
  };

  return read;
}

// ---------------------------------------------------------------------------
// ComputedNode — lazy derived value
// ---------------------------------------------------------------------------

class ComputedNode<T> implements Subscriber {
  _fn: () => T;
  _value: T | undefined;
  _dirty: boolean = true;
  _initialized: boolean = false;
  _signalNode: SignalNode<T>;
  dependencies: Set<SignalNode<any>> = new Set();

  /**
   * Whether we are currently recomputing. Used to prevent infinite loops
   * and to correctly propagate to downstream subscribers only after our
   * own value has settled.
   */
  _computing: boolean = false;

  /** Whether this computed has been disposed (frozen, unsubscribed). */
  _disposed: boolean = false;

  constructor(fn: () => T) {
    this._fn = fn;
    // The computed owns a SignalNode so that downstream effects/computeds
    // can subscribe to it using the same mechanism.
    this._signalNode = new SignalNode<T>(undefined as T);
  }

  /** Subscriber interface — called when an upstream dependency changes. */
  notify(): void {
    if (!this._dirty) {
      this._dirty = true;
      // Propagate notification to our own subscribers. This lets effects
      // that depend on this computed know they might need to re-run.
      // We snapshot to avoid mutation during iteration.
      const subs = Array.from(this._signalNode._subscribers);
      for (let i = 0; i < subs.length; i++) {
        subs[i].notify();
      }
    }
  }

  /** Recompute (if dirty) and return the value. */
  _read(): T {
    // a disposed computed is frozen at its last value — skip recompute (its
    // dependency subscriptions are gone) but still let downstream track the
    // internal node.
    if (this._dirty && !this._computing && !this._disposed) {
      this._recompute();
    }
    // Track via the internal signal node so downstream subscribers are
    // registered.
    return this._signalNode._read();
  }

  /** Read without tracking. */
  _peek(): T {
    if (this._dirty && !this._computing && !this._disposed) {
      this._recompute();
    }
    return this._signalNode._peek();
  }

  /** Dispose permanently — unsubscribe from sources and freeze the value. */
  _dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._cleanup();
  }

  /** Unsubscribe from all current dependencies. */
  _cleanup(): void {
    for (const dep of this.dependencies) {
      dep._subscribers.delete(this);
    }
    this.dependencies.clear();
  }

  /** Recompute the derived value. */
  _recompute(): void {
    if (computeDepth >= MAX_COMPUTE_DEPTH) {
      throw new Error('Circular dependency detected in computed chain');
    }
    computeDepth++;
    this._computing = true;
    // Clean up old subscriptions so conditional branches are correct.
    this._cleanup();

    pushSubscriber(this);
    try {
      const newValue = this._fn();
      this._dirty = false;
      this._computing = false;
      if (!this._initialized || !Object.is(newValue, this._signalNode._value)) {
        this._initialized = true;
        // Directly set _value (don't use _write) because we already
        // propagated notifications in notify(). This avoids double-notify.
        this._signalNode._value = newValue;
      }
    } finally {
      computeDepth--;
      popSubscriber();
      this._computing = false;
    }
  }
}

// ---------------------------------------------------------------------------
// computed()
// ---------------------------------------------------------------------------

/**
 * Creates a lazy computed (derived) signal.
 *
 * ```ts
 * const double = computed(() => count() * 2);
 * double()     // read (tracked)
 * double.value // read (tracked)
 * ```
 */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const node = new ComputedNode<T>(fn);

  const read = (() => node._read()) as ReadonlySignal<T>;

  Object.defineProperty(read, 'value', {
    get(): T {
      return node._read();
    },
    enumerable: true,
    configurable: false,
  });

  (read as any).peek = (): T => node._peek();
  (read as any).dispose = (): void => node._dispose();

  // if created inside a createRoot, tie this computed's teardown to the root so
  // a long-lived source signal no longer retains it after the root is disposed.
  registerWithRoot(() => node._dispose());

  return read;
}

// ---------------------------------------------------------------------------
// EffectNode — eager side-effect
// ---------------------------------------------------------------------------

class EffectNode implements Subscriber {
  _fn: () => void | (() => void);
  _cleanupFn: (() => void) | void = undefined;
  _disposed: boolean = false;
  dependencies: Set<SignalNode<any>> = new Set();

  /**
   * Optional scheduler. When set, a NOTIFIED effect is handed to it instead of
   * running inline — the DOM bindings use this to defer their re-render to a
   * microtask, so a binding never renders halfway through the function that
   * wrote the signal. The first run (on creation) is always synchronous, so
   * mounting is unaffected.
   */
  _scheduler: ((run: () => void) => void) | undefined;

  /**
   * Stable bound `_run`, so a scheduler that de-duplicates by function identity
   * (queueJob's Set) collapses repeated notifications within a tick into one.
   */
  _runBound: () => void = () => this._run();

  /**
   * Flag to prevent re-entrant notification. When an effect is already
   * queued (or currently executing), additional notifications are ignored.
   */
  _queued: boolean = false;

  constructor(fn: () => void | (() => void), scheduler?: (run: () => void) => void) {
    this._fn = fn;
    this._scheduler = scheduler;
  }

  /** Subscriber interface — called when an upstream dependency changes. */
  notify(): void {
    if (this._disposed || this._queued) {
      return;
    }
    this._queued = true;

    if (batchDepth > 0) {
      pendingEffects.add(this);
    } else if (this._scheduler) {
      this._scheduler(this._runBound);
    } else {
      this._run();
    }
  }

  /** Execute the effect, cleaning up previous subscriptions first. */
  _run(): void {
    if (this._disposed) {
      this._queued = false;
      return;
    }

    // runaway-cascade guard. _run is reached synchronously outside the batched
    // flush path in two places — on creation, and from notify() when
    // batchDepth is 0 — and neither is covered by the flushPendingEffects
    // guards, so an effect whose execution synchronously causes further effect
    // executions could recurse unbounded with nothing reported. throw before
    // touching any state so there is nothing to unwind.
    if (syncRunDepth > MAX_SYNC_RUN_DEPTH) {
      this._queued = false;
      pendingEffects.clear();
      throw new FlushGuardError(
        'Maximum synchronous effect cascade depth exceeded (possible infinite loop: running an effect synchronously runs more effects)',
      );
    }

    syncRunDepth++;
    try {
      // Run previous cleanup function (like React useEffect cleanup).
      if (this._cleanupFn) {
        try {
          this._cleanupFn();
        } catch (err) {
          reportEffectError('Error in effect cleanup:', err);
        }
        this._cleanupFn = undefined;
      }

      // Snapshot the current dependencies before dropping them. Unsubscribing
      // first is what makes conditional tracking correct, but it also means a
      // body that throws BEFORE its first signal read leaves this effect
      // subscribed to nothing — and because the error is reported rather than
      // rethrown, the effect object survives with an empty dependency set and
      // can never be notified again. It is dead for the lifetime of the page,
      // silently. Restoring the snapshot in that one case gives a later change
      // the chance to retry it.
      const prevDeps = this.dependencies.size > 0 ? Array.from(this.dependencies) : null;

      // Unsubscribe from all previous dependencies so conditional tracking
      // is correct on re-execution.
      this._unsubscribe();

      pushSubscriber(this);
      let threw = false;
      try {
        const result = this._fn();
        this._cleanupFn = typeof result === 'function' ? result : undefined;
      } catch (err) {
        threw = true;
        if (err instanceof FlushGuardError) {
          throw err;
        }
        reportEffectError('Error in effect:', err);
      } finally {
        popSubscriber();
        this._queued = false;
        // Only the captured-NOTHING case restores. A run that threw after
        // reading some signals has legitimately-partial dependencies: it is
        // indistinguishable from a conditional branch that stopped reading the
        // rest, it is still reachable from what it did read, and re-adding the
        // dependencies it no longer touches would resurrect subscriptions the
        // reactive graph is meant to drop. A successful run that captured
        // nothing is also left alone — that is an effect deliberately opting
        // out of tracking, not an orphan.
        if (threw && prevDeps !== null && !this._disposed && this.dependencies.size === 0) {
          for (const dep of prevDeps) {
            dep._subscribers.add(this);
            this.dependencies.add(dep);
          }
        }
      }
    } finally {
      syncRunDepth--;
    }
  }

  /** Unsubscribe from all tracked dependencies. */
  _unsubscribe(): void {
    for (const dep of this.dependencies) {
      dep._subscribers.delete(this);
    }
    this.dependencies.clear();
  }

  /** Dispose the effect permanently — runs cleanup and unsubscribes. */
  _dispose(): void {
    this._disposed = true;
    if (this._cleanupFn) {
      try {
        this._cleanupFn();
      } catch (err) {
        reportEffectError('Error in effect cleanup:', err);
      }
      this._cleanupFn = undefined;
    }
    this._unsubscribe();
    pendingEffects.delete(this);
  }
}

// ---------------------------------------------------------------------------
// effect()
// ---------------------------------------------------------------------------

export interface EffectOptions {
  /**
   * Where a re-run goes instead of executing inline. Receives the effect's
   * runner; call it whenever the work should happen. `queueJob` defers to the
   * next microtask, which is what the DOM bindings use.
   *
   * The runner has a stable identity per effect, so a scheduler that
   * de-duplicates by function reference collapses a burst of notifications
   * into a single run.
   */
  scheduler?: (run: () => void) => void;
}

/**
 * Creates a reactive side-effect that re-runs when its dependencies change.
 *
 * The callback may optionally return a cleanup function that is invoked
 * before each re-execution and on disposal (like React useEffect).
 *
 * Returns a dispose function to stop the effect.
 *
 * ```ts
 * const dispose = effect(() => {
 *   console.log('count is', count());
 *   return () => console.log('cleaning up');
 * });
 *
 * dispose(); // stop watching
 * ```
 */
export function effect(
  fn: () => void | (() => void),
  options?: EffectOptions,
): () => void {
  const node = new EffectNode(fn, options?.scheduler);

  // Run synchronously on creation to establish initial subscriptions. This is
  // deliberately NOT scheduled even when a scheduler is given: a binding must
  // paint its initial value on mount, not a microtask later.
  node._run();

  const dispose = (): void => node._dispose();
  // if created inside a createRoot, tie this effect's teardown to the root.
  registerWithRoot(dispose);
  return dispose;
}

// ---------------------------------------------------------------------------
// createRoot()
// ---------------------------------------------------------------------------

/**
 * Run `fn` inside a reactive root that owns every `effect` and `computed`
 * created during its synchronous execution. `fn` receives a `dispose` function
 * that tears them all down at once — use it to scope a subtree of reactivity
 * (e.g. a route page) so it can be cleaned up on navigation/unmount.
 *
 * ```ts
 * const stop = createRoot((dispose) => {
 *   effect(() => render(state()));
 *   return dispose;
 * });
 * stop(); // disposes the effect above
 * ```
 *
 * Roots nest: an inner root captures only what it creates, and disposing an
 * outer root does not implicitly dispose a sibling.
 */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const root = { disposers: [] as (() => void)[] };
  const prev = currentRoot;
  currentRoot = root;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    const ds = root.disposers.splice(0);
    for (let i = ds.length - 1; i >= 0; i--) {
      try {
        ds[i]();
      } catch {
        /* a faulty disposer must not abort the rest of teardown */
      }
    }
  };
  try {
    return fn(dispose);
  } finally {
    currentRoot = prev;
  }
}

// ---------------------------------------------------------------------------
// batch()
// ---------------------------------------------------------------------------

/**
 * Batches multiple signal writes so that effects only run once after the
 * batch completes.
 *
 * ```ts
 * batch(() => {
 *   a.set(1);
 *   b.set(2);
 * });
 * // effects that depend on a AND b only run once
 * ```
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      flushPendingEffects();
    }
  }
}

/**
 * Flush all pending effects that were queued during a batch. We iterate
 * until the queue is empty because an effect may write to signals and
 * queue additional effects.
 */
function flushPendingEffects(): void {
  flushDepth++;
  try {
    if (flushDepth > MAX_FLUSH_ITERATIONS) {
      pendingEffects.clear();
      throw new FlushGuardError(
        'Maximum effect flush iterations exceeded (possible infinite loop: an effect is re-triggering itself)',
      );
    }
    let iterations = 0;
    while (pendingEffects.size > 0) {
      if (++iterations > MAX_FLUSH_ITERATIONS) {
        pendingEffects.clear();
        throw new FlushGuardError(
          'Maximum effect flush iterations exceeded (possible infinite loop: an effect is re-triggering itself)',
        );
      }
      const effects = Array.from(pendingEffects);
      pendingEffects.clear();
      for (let i = 0; i < effects.length; i++) {
        const node = effects[i];
        // a scheduled effect keeps its scheduler even when it was queued by a
        // batch: the point of a DOM binding's scheduler is that its updates
        // ALWAYS land in one place, so batch() must not smuggle one back onto
        // the synchronous path.
        if (node._scheduler) node._scheduler(node._runBound);
        else node._run();
      }
    }
  } finally {
    flushDepth--;
  }
}

// ---------------------------------------------------------------------------
// untrack()
// ---------------------------------------------------------------------------

/**
 * Runs a function without tracking any signal reads as dependencies.
 *
 * ```ts
 * effect(() => {
 *   const x = a();                     // tracked
 *   const y = untrack(() => b());      // NOT tracked
 * });
 * ```
 */
export function untrack<T>(fn: () => T): T {
  pushSubscriber(null);
  try {
    return fn();
  } finally {
    popSubscriber();
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Run `fn` and apply every DOM update it causes before returning.
 *
 * Bindings normally defer to a microtask, so reading the DOM straight after a
 * signal write sees the previous frame. Wrap the write when you genuinely need
 * it applied now — measuring layout, moving focus, setting scroll:
 *
 * ```ts
 * flushSync(() => open.set(true));
 * panel.scrollTop = 0;               // the panel exists
 * ```
 *
 * Prefer `await tick()` where you can; this forces work the scheduler was
 * deliberately coalescing.
 */
export function flushSync<T>(fn: () => T): T {
  const result = batch(fn);
  flushJobsSync();
  return result;
}

export { queueJob, tick } from '@/scheduler';

// ---------------------------------------------------------------------------
// Shared signals (cross-tab sync via BroadcastChannel)
// ---------------------------------------------------------------------------

export { sharedSignal } from '@/shared';
export type { SharedSignal, SharedSignalOptions } from '@/shared';

// ---------------------------------------------------------------------------
// Persisted signals (synced to localStorage / sessionStorage)
// ---------------------------------------------------------------------------

export { persistedSignal } from '@/persisted';
export type { PersistedSignal, PersistedSignalOptions } from '@/persisted';
