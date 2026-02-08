// ============================================================================
// @utopia/core — Fine-grained signals reactivity system
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

/** Batch depth counter. When > 0, effect execution is deferred. */
let batchDepth = 0;

/** Queue of effects waiting to run after the current batch completes. */
let pendingEffects: Set<EffectNode> = new Set();

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
    if (this._dirty && !this._computing) {
      this._recompute();
    }
    // Track via the internal signal node so downstream subscribers are
    // registered.
    return this._signalNode._read();
  }

  /** Read without tracking. */
  _peek(): T {
    if (this._dirty && !this._computing) {
      this._recompute();
    }
    return this._signalNode._peek();
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
   * Flag to prevent re-entrant notification. When an effect is already
   * queued (or currently executing), additional notifications are ignored.
   */
  _queued: boolean = false;

  constructor(fn: () => void | (() => void)) {
    this._fn = fn;
  }

  /** Subscriber interface — called when an upstream dependency changes. */
  notify(): void {
    if (this._disposed || this._queued) {
      return;
    }
    this._queued = true;

    if (batchDepth > 0) {
      pendingEffects.add(this);
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

    // Run previous cleanup function (like React useEffect cleanup).
    if (this._cleanupFn) {
      this._cleanupFn();
      this._cleanupFn = undefined;
    }

    // Unsubscribe from all previous dependencies so conditional tracking
    // is correct on re-execution.
    this._unsubscribe();

    pushSubscriber(this);
    try {
      const result = this._fn();
      this._cleanupFn = typeof result === 'function' ? result : undefined;
    } finally {
      popSubscriber();
      this._queued = false;
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
      this._cleanupFn();
      this._cleanupFn = undefined;
    }
    this._unsubscribe();
    pendingEffects.delete(this);
  }
}

// ---------------------------------------------------------------------------
// effect()
// ---------------------------------------------------------------------------

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
export function effect(fn: () => void | (() => void)): () => void {
  const node = new EffectNode(fn);

  // Run synchronously on creation to establish initial subscriptions.
  node._run();

  return () => node._dispose();
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
  while (pendingEffects.size > 0) {
    const effects = Array.from(pendingEffects);
    pendingEffects.clear();
    for (let i = 0; i < effects.length; i++) {
      effects[i]._run();
    }
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
