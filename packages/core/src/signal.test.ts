// ============================================================================
// @matthesketh/utopia-core — Reactivity system test suite
// ============================================================================

import { describe, expect, it, vi } from 'vitest';

import {
  batch,
  computed,
  createRoot,
  effect,
  flushSync,
  onEffectError,
  queueJob,
  type ReadonlySignal,
  signal,
  tick,
  untrack,
} from '@/index';

// ---------------------------------------------------------------------------
// signal — basic read / write
// ---------------------------------------------------------------------------

describe('signal', () => {
  it('reads the initial value via invocation', () => {
    const s = signal(42);
    expect(s()).toBe(42);
  });

  it('reads the initial value via .value', () => {
    const s = signal('hello');
    expect(s.value).toBe('hello');
  });

  it('writes a new value with .set()', () => {
    const s = signal(0);
    s.set(10);
    expect(s()).toBe(10);
  });

  it('updates via callback with .update()', () => {
    const s = signal(5);
    s.update((n) => n * 3);
    expect(s()).toBe(15);
  });

  it('does not notify subscribers when value is the same (Object.is)', () => {
    const s = signal(1);
    const fn = vi.fn(() => {
      s();
    });

    effect(fn);
    fn.mockClear(); // clear the initial synchronous run

    s.set(1); // same value
    expect(fn).not.toHaveBeenCalled();
  });

  it('handles NaN correctly (NaN === NaN via Object.is)', () => {
    const s = signal(NaN);
    const fn = vi.fn(() => {
      s();
    });

    effect(fn);
    fn.mockClear();

    s.set(NaN); // same value (Object.is(NaN, NaN) === true)
    expect(fn).not.toHaveBeenCalled();
  });

  it('works with object references', () => {
    const obj = { a: 1 };
    const s = signal(obj);
    expect(s()).toBe(obj);

    const newObj = { a: 2 };
    s.set(newObj);
    expect(s()).toBe(newObj);
  });

  it('can hold undefined and null', () => {
    const s = signal<number | null | undefined>(10);
    s.set(null);
    expect(s()).toBe(null);
    s.set(undefined);
    expect(s()).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// signal.peek — read without tracking
// ---------------------------------------------------------------------------

describe('signal.peek', () => {
  it('reads the current value without tracking', () => {
    const s = signal(7);
    const fn = vi.fn(() => {
      s.peek();
    });

    effect(fn);
    fn.mockClear();

    s.set(8);
    expect(fn).not.toHaveBeenCalled();
    expect(s.peek()).toBe(8);
  });

  it('returns the same value as a tracked read', () => {
    const s = signal('test');
    expect(s.peek()).toBe(s());
  });
});

// ---------------------------------------------------------------------------
// computed — derived values
// ---------------------------------------------------------------------------

describe('computed', () => {
  it('derives a value from a signal', () => {
    const count = signal(3);
    const doubled = computed(() => count() * 2);
    expect(doubled()).toBe(6);
  });

  it('reads via .value', () => {
    const count = signal(4);
    const doubled = computed(() => count() * 2);
    expect(doubled.value).toBe(8);
  });

  it('updates when the source signal changes', () => {
    const count = signal(1);
    const doubled = computed(() => count() * 2);

    count.set(5);
    expect(doubled()).toBe(10);
  });

  it('is lazily evaluated — does not compute until read', () => {
    const fn = vi.fn(() => 42);
    const c = computed(fn);

    expect(fn).not.toHaveBeenCalled();

    expect(c()).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('caches the value — does not recompute if deps have not changed', () => {
    const count = signal(1);
    const fn = vi.fn(() => count() * 2);
    const doubled = computed(fn);

    doubled(); // first read — computes
    doubled(); // second read — cached
    doubled(); // third read — cached

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('recomputes only when dirty', () => {
    const count = signal(1);
    const fn = vi.fn(() => count() * 2);
    const doubled = computed(fn);

    expect(doubled()).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);

    count.set(2);
    expect(doubled()).toBe(4);
    expect(fn).toHaveBeenCalledTimes(2);

    // reading again without changing the source should not recompute
    expect(doubled()).toBe(4);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('chains computeds correctly', () => {
    const a = signal(2);
    const b = computed(() => a() + 1);
    const c = computed(() => b() * 10);

    expect(c()).toBe(30);

    a.set(5);
    expect(c()).toBe(60);
  });

  it('peek() during its own recomputation returns the previous value without recursing', () => {
    // a computed that peeks itself while computing must not re-enter
    // _recompute — the in-progress guard returns the last settled value.
    let c!: ReadonlySignal<number>;
    const dep = signal(1);
    c = computed(() => dep() + ((c ? c.peek() : 0) ?? 0));
    expect(c()).toBe(1); // first compute: self-peek yields undefined → ?? 0
    dep.set(2);
    expect(c()).toBe(3); // second compute: self-peek yields the previous 1
  });

  it('peek() reads without tracking', () => {
    const s = signal(10);
    const c = computed(() => s() * 2);

    const fn = vi.fn(() => {
      c.peek();
    });

    effect(fn);
    fn.mockClear();

    s.set(20);
    // The effect used peek on the computed, so it should NOT re-run.
    expect(fn).not.toHaveBeenCalled();
    // But the computed itself should still be up to date.
    expect(c.peek()).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// effect — side effects
// ---------------------------------------------------------------------------

describe('effect', () => {
  it('runs synchronously on creation', () => {
    const fn = vi.fn();
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-runs when a tracked signal changes', () => {
    const count = signal(0);
    const fn = vi.fn(() => {
      count();
    });

    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    count.set(1);
    expect(fn).toHaveBeenCalledTimes(2);

    count.set(2);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('tracks computed signals as dependencies', () => {
    const count = signal(1);
    const doubled = computed(() => count() * 2);
    const values: number[] = [];

    effect(() => {
      values.push(doubled());
    });

    count.set(2);
    count.set(3);

    expect(values).toEqual([2, 4, 6]);
  });

  it('stops tracking after dispose', () => {
    const count = signal(0);
    const fn = vi.fn(() => {
      count();
    });

    const dispose = effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    dispose();

    count.set(1);
    count.set(2);
    expect(fn).toHaveBeenCalledTimes(1); // no further calls
  });

  it('runs cleanup function on disposal', () => {
    const cleanup = vi.fn();
    const dispose = effect(() => {
      return cleanup;
    });

    expect(cleanup).not.toHaveBeenCalled();

    dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runs cleanup function before each re-execution', () => {
    const count = signal(0);
    const cleanup = vi.fn();
    const log: string[] = [];

    effect(() => {
      count();
      log.push('run');
      return () => {
        cleanup();
        log.push('cleanup');
      };
    });

    expect(log).toEqual(['run']);

    count.set(1);
    expect(log).toEqual(['run', 'cleanup', 'run']);

    count.set(2);
    expect(log).toEqual(['run', 'cleanup', 'run', 'cleanup', 'run']);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('handles effects that read multiple signals', () => {
    const a = signal(1);
    const b = signal(2);
    const values: number[] = [];

    effect(() => {
      values.push(a() + b());
    });

    expect(values).toEqual([3]);

    a.set(10);
    expect(values).toEqual([3, 12]);

    b.set(20);
    expect(values).toEqual([3, 12, 30]);
  });
});

// ---------------------------------------------------------------------------
// Conditional dependency tracking
// ---------------------------------------------------------------------------

describe('conditional dependency tracking', () => {
  it('removes stale dependencies when a branch is no longer taken', () => {
    const cond = signal(true);
    const a = signal('A');
    const b = signal('B');
    const values: string[] = [];

    effect(() => {
      if (cond()) {
        values.push(a());
      } else {
        values.push(b());
      }
    });

    expect(values).toEqual(['A']);

    // Switch branch — now only `b` should be tracked.
    cond.set(false);
    expect(values).toEqual(['A', 'B']);

    // Changing `a` should NOT trigger the effect.
    a.set('A2');
    expect(values).toEqual(['A', 'B']);

    // Changing `b` SHOULD trigger the effect.
    b.set('B2');
    expect(values).toEqual(['A', 'B', 'B2']);
  });

  it('handles conditional tracking in computed signals', () => {
    const cond = signal(true);
    const a = signal(1);
    const b = signal(2);

    const result = computed(() => (cond() ? a() : b()));

    expect(result()).toBe(1);

    cond.set(false);
    expect(result()).toBe(2);

    a.set(100);
    // `a` is no longer a dependency — computed should still return 2
    expect(result()).toBe(2);

    b.set(200);
    expect(result()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Diamond dependency problem
// ---------------------------------------------------------------------------

describe('diamond dependency', () => {
  it('effect runs only once for a diamond dependency graph', () => {
    //     a
    //    / \
    //   b   c
    //    \ /
    //     d (effect)
    const a = signal(1);
    const b = computed(() => a() + 1);
    const c = computed(() => a() * 10);

    const fn = vi.fn(() => {
      b();
      c();
    });

    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    fn.mockClear();

    a.set(2);
    // The effect should run exactly ONCE, even though both b and c changed.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('computed in diamond executes correctly', () => {
    const a = signal(1);
    const b = computed(() => a() + 1);
    const c = computed(() => a() * 2);
    const d = computed(() => b() + c());

    expect(d()).toBe(4); // (1+1) + (1*2) = 4

    a.set(3);
    expect(d()).toBe(10); // (3+1) + (3*2) = 10
  });
});

// ---------------------------------------------------------------------------
// batch
// ---------------------------------------------------------------------------

describe('batch', () => {
  it('defers effects until the batch completes', () => {
    const a = signal(1);
    const b = signal(2);
    const fn = vi.fn(() => {
      a();
      b();
    });

    effect(fn);
    fn.mockClear();

    batch(() => {
      a.set(10);
      b.set(20);
    });

    // Should have run exactly once after the batch, not twice.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the value from the batch function', () => {
    const result = batch(() => 42);
    expect(result).toBe(42);
  });

  it('handles nested batches', () => {
    const s = signal(0);
    const fn = vi.fn(() => {
      s();
    });

    effect(fn);
    fn.mockClear();

    batch(() => {
      s.set(1);
      batch(() => {
        s.set(2);
        s.set(3);
      });
      // still inside outer batch — effect should not have run yet
      expect(fn).not.toHaveBeenCalled();
      s.set(4);
    });

    // now it should have run once
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s()).toBe(4);
  });

  it('runs effects after batch even if an error occurs inside', () => {
    const s = signal(0);
    const fn = vi.fn(() => {
      s();
    });

    effect(fn);
    fn.mockClear();

    expect(() => {
      batch(() => {
        s.set(1);
        throw new Error('boom');
      });
    }).toThrow('boom');

    // The batch still flushes on the way out (finally block).
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('batches updates across multiple signals feeding one computed', () => {
    const a = signal(1);
    const b = signal(2);
    const sum = computed(() => a() + b());
    const values: number[] = [];

    effect(() => {
      values.push(sum());
    });

    expect(values).toEqual([3]);

    batch(() => {
      a.set(10);
      b.set(20);
    });

    // Should capture the final state, not intermediate.
    expect(values).toEqual([3, 30]);
  });
});

// ---------------------------------------------------------------------------
// untrack
// ---------------------------------------------------------------------------

describe('untrack', () => {
  it('reads a signal without creating a dependency', () => {
    const a = signal(1);
    const b = signal(2);
    const fn = vi.fn(() => {
      a(); // tracked
      untrack(() => b()); // NOT tracked
    });

    effect(fn);
    fn.mockClear();

    b.set(20);
    expect(fn).not.toHaveBeenCalled();

    a.set(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the value from the untracked function', () => {
    const s = signal(42);
    const val = untrack(() => s());
    expect(val).toBe(42);
  });

  it('works inside computed', () => {
    const a = signal(1);
    const b = signal(100);
    const c = computed(() => a() + untrack(() => b()));

    expect(c()).toBe(101);

    // Changing b should NOT invalidate c (it was untracked).
    b.set(200);
    expect(c()).toBe(101); // stale but that's the correct behavior

    // Changing a SHOULD invalidate c — it will re-read b during recompute.
    a.set(2);
    expect(c()).toBe(202); // picks up new b value during recompute
  });
});

// ---------------------------------------------------------------------------
// Nested effects
// ---------------------------------------------------------------------------

describe('nested effects', () => {
  it('inner effect tracks independently of outer effect', () => {
    const outer = signal(1);
    const inner = signal(10);
    const log: string[] = [];

    effect(() => {
      log.push(`outer:${outer()}`);

      effect(() => {
        log.push(`inner:${inner()}`);
      });
    });

    expect(log).toEqual(['outer:1', 'inner:10']);

    inner.set(20);
    expect(log).toEqual(['outer:1', 'inner:10', 'inner:20']);
  });

  it('disposes inner effects when outer effect re-runs', () => {
    const outer = signal(1);
    const inner = signal(10);
    const log: string[] = [];

    effect(() => {
      const val = outer();
      log.push(`outer:${val}`);

      // We manually manage inner disposal by capturing the dispose function
      // in the outer effect's cleanup.
      const d = effect(() => {
        log.push(`inner:${inner()}`);
      });

      // Return cleanup that disposes the inner effect.
      return () => {
        d();
      };
    });

    expect(log).toEqual(['outer:1', 'inner:10']);

    // Changing the outer should dispose the inner effect created on the
    // previous run, then create a new inner effect.
    outer.set(2);
    expect(log).toEqual(['outer:1', 'inner:10', 'outer:2', 'inner:10']);

    // The inner effect from the first run should be disposed, so changing
    // `inner` should only trigger ONE new execution.
    log.length = 0;
    inner.set(20);
    // Only one inner effect is alive now.
    expect(log).toEqual(['inner:20']);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('signal works with boolean values', () => {
    const s = signal(false);
    expect(s()).toBe(false);
    s.set(true);
    expect(s()).toBe(true);
  });

  it('effect does not re-run when set to the same object reference', () => {
    const obj = { count: 0 };
    const s = signal(obj);
    const fn = vi.fn(() => {
      s();
    });

    effect(fn);
    fn.mockClear();

    s.set(obj); // same reference
    expect(fn).not.toHaveBeenCalled();
  });

  it('effect re-runs when set to a different object with same shape', () => {
    const s = signal({ count: 0 });
    const fn = vi.fn(() => {
      s();
    });

    effect(fn);
    fn.mockClear();

    s.set({ count: 0 }); // different reference
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('computed handles throwing functions', () => {
    const s = signal(0);
    const c = computed(() => {
      if (s() === 0) throw new Error('zero!');
      return s() * 2;
    });

    expect(() => c()).toThrow('zero!');

    s.set(5);
    expect(c()).toBe(10);
  });

  it('multiple effects on the same signal', () => {
    const s = signal(0);
    const log1: number[] = [];
    const log2: number[] = [];

    effect(() => {
      log1.push(s());
    });
    effect(() => {
      log2.push(s());
    });

    s.set(1);

    expect(log1).toEqual([0, 1]);
    expect(log2).toEqual([0, 1]);
  });

  it('disposing an effect twice is safe', () => {
    const s = signal(0);
    const dispose = effect(() => {
      s();
    });

    dispose();
    expect(() => dispose()).not.toThrow();
  });

  it('effect does not run after disposal even if queued in batch', () => {
    const s = signal(0);
    const fn = vi.fn(() => {
      s();
    });

    const dispose = effect(fn);
    fn.mockClear();

    batch(() => {
      s.set(1);
      dispose();
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it('computed with no dependents does not leak', () => {
    const s = signal(1);
    const c = computed(() => s() * 2);

    // Just reading once should work fine.
    expect(c()).toBe(2);

    // Changing the signal — the computed is dirty but nobody is watching.
    s.set(2);
    expect(c()).toBe(4);
  });

  it('deeply chained computeds update correctly', () => {
    const s = signal(1);
    const c1 = computed(() => s() + 1);
    const c2 = computed(() => c1() + 1);
    const c3 = computed(() => c2() + 1);
    const c4 = computed(() => c3() + 1);

    expect(c4()).toBe(5);

    s.set(10);
    expect(c4()).toBe(14);
  });

  it('signal update function receives current value', () => {
    const s = signal(10);
    s.update((v) => {
      expect(v).toBe(10);
      return 20;
    });
    expect(s()).toBe(20);
  });

  it('batch within effect works correctly', () => {
    const a = signal(0);
    const b = signal(0);
    const log: string[] = [];

    effect(() => {
      log.push(`effect:${a()},${b()}`);
    });

    expect(log).toEqual(['effect:0,0']);

    // Trigger an effect that internally batches updates
    effect(() => {
      if (a() > 0) {
        batch(() => {
          b.set(a() * 10);
        });
      }
    });

    a.set(1);
    // After a.set(1):
    //   - first effect re-runs: logs effect:1,0 (or effect:1,10 depending on order)
    //   - second effect re-runs: sets b to 10 inside batch
    //   - first effect re-runs again because b changed
    // The exact intermediate values depend on execution order, but the final
    // state should be consistent.
    expect(a()).toBe(1);
    expect(b()).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Integration: realistic usage patterns
// ---------------------------------------------------------------------------

describe('integration', () => {
  it('todo list pattern', () => {
    const todos = signal<string[]>([]);
    const filter = signal('all');

    const filteredTodos = computed(() => {
      const list = todos();
      const f = filter();
      if (f === 'all') return list;
      return list.filter((t) => t.includes(f));
    });

    const count = computed(() => filteredTodos().length);

    const log: number[] = [];
    effect(() => {
      log.push(count());
    });

    todos.set(['buy milk', 'walk dog', 'buy eggs']);
    expect(log).toEqual([0, 3]);

    filter.set('buy');
    expect(log).toEqual([0, 3, 2]);

    todos.set(['buy milk', 'walk dog', 'buy eggs', 'buy bread']);
    expect(log).toEqual([0, 3, 2, 3]);
  });

  it('form validation pattern', () => {
    const username = signal('');
    const password = signal('');

    const usernameError = computed(() =>
      username().length < 3 ? 'Username must be at least 3 characters' : null,
    );

    const passwordError = computed(() =>
      password().length < 8 ? 'Password must be at least 8 characters' : null,
    );

    const isValid = computed(() => !usernameError() && !passwordError());

    expect(isValid()).toBe(false);

    batch(() => {
      username.set('alice');
      password.set('12345678');
    });

    expect(isValid()).toBe(true);
    expect(usernameError()).toBe(null);
    expect(passwordError()).toBe(null);
  });

  it('undo/redo pattern with signals', () => {
    const state = signal(0);
    const history: number[] = [];

    effect(() => {
      history.push(state());
    });

    state.set(1);
    state.set(2);
    state.set(3);

    expect(history).toEqual([0, 1, 2, 3]);

    // "Undo" by setting to previous value
    state.set(history[history.length - 2]);
    expect(state()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('recovers when effect function throws', () => {
    const s = signal(0);
    let callCount = 0;

    effect(() => {
      callCount++;
      const val = s();
      if (val === 1) throw new Error('test error');
    });

    expect(callCount).toBe(1);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    s.set(1);
    expect(callCount).toBe(2);
    expect(consoleSpy).toHaveBeenCalledWith('Error in effect:', expect.any(Error));

    s.set(2);
    expect(callCount).toBe(3);
    consoleSpy.mockRestore();
  });

  it('recovers when cleanup function throws', () => {
    const s = signal(0);
    let effectRan = 0;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    effect(() => {
      effectRan++;
      s();
      return () => {
        throw new Error('cleanup error');
      };
    });

    expect(effectRan).toBe(1);

    s.set(1);
    expect(effectRan).toBe(2);
    expect(consoleSpy).toHaveBeenCalledWith('Error in effect cleanup:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('disposes effect even when cleanup throws', () => {
    const s = signal(0);
    let effectRan = 0;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const dispose = effect(() => {
      effectRan++;
      s();
      return () => {
        throw new Error('cleanup error');
      };
    });

    expect(effectRan).toBe(1);

    dispose();
    expect(consoleSpy).toHaveBeenCalled();

    s.set(1);
    expect(effectRan).toBe(1);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Circular dependencies
// ---------------------------------------------------------------------------

describe('circular dependencies', () => {
  it('detects circular dependency in computed chain', () => {
    const s = signal(0);
    const computeds: ReadonlySignal<number>[] = [];

    computeds.push(computed(() => s() + 1));
    for (let i = 1; i <= 100; i++) {
      computeds.push(computed(() => computeds[i - 1]() + 1));
    }

    expect(() => computeds[100]()).toThrow('Circular dependency detected in computed chain');
  });
});

// ---------------------------------------------------------------------------
// flushPendingEffects — infinite loop guard
// ---------------------------------------------------------------------------

describe('onEffectError', () => {
  it('routes effect errors to the registered handler instead of console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn();
    const restore = onEffectError(handler);

    const s = signal(0);
    const dispose = effect(() => {
      if (s() > 0) throw new Error('effect boom');
    });
    s.set(1);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as Error).message).toBe('effect boom');
    expect(consoleSpy).not.toHaveBeenCalled();

    dispose();
    restore();
    consoleSpy.mockRestore();
  });

  it('routes cleanup errors to the registered handler', () => {
    const handler = vi.fn();
    const restore = onEffectError(handler);

    const s = signal(0);
    const dispose = effect(() => {
      s();
      return () => {
        throw new Error('cleanup boom');
      };
    });
    s.set(1); // re-run → previous cleanup throws

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as Error).message).toBe('cleanup boom');

    dispose(); // final cleanup throws again — also routed
    expect(handler).toHaveBeenCalledTimes(2);
    restore();
  });

  it('restore() reinstates the previous handler', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outer = vi.fn();
    const inner = vi.fn();

    const restoreOuter = onEffectError(outer);
    const restoreInner = onEffectError(inner);
    restoreInner(); // back to outer

    const s = signal(0);
    const dispose = effect(() => {
      if (s() > 0) throw new Error('x');
    });
    s.set(1);

    expect(inner).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(1);

    restoreOuter();
    s.set(2);
    expect(outer).toHaveBeenCalledTimes(1); // handler gone — falls back to console
    expect(consoleSpy).toHaveBeenCalled();

    dispose();
    consoleSpy.mockRestore();
  });
});

describe('effect disposal during a flush', () => {
  it('skips a queued effect that an earlier effect disposed in the same flush', () => {
    const s = signal(0);
    let bRuns = 0;

    // A is created first so it is notified (and flushed) before B.
    const disposeA = effect(() => {
      if (s() > 0) disposeB();
    });
    const disposeB = effect(() => {
      s();
      bRuns++;
    });
    expect(bRuns).toBe(1);

    batch(() => s.set(1)); // both queued; A runs first and disposes B

    expect(bRuns).toBe(1); // B never ran again

    s.set(2);
    expect(bRuns).toBe(1); // stays disposed
    disposeA();
  });
});

describe('flushPendingEffects — infinite loop guard', () => {
  it('throws when a cycle of effects creates an infinite re-queue loop', () => {
    // Create N > MAX_FLUSH_ITERATIONS effects in a cycle so that creating each
    // new effect triggers a cascade that re-queues effects already in the chain,
    // causing flushPendingEffects to recurse beyond the allowed depth.
    const N = 110;
    const sigs = Array.from({ length: N }, () => signal(0));
    const disposers: Array<() => void> = [];
    let threw = false;

    try {
      for (let i = 0; i < N; i++) {
        const idx = i;
        const next = (i + 1) % N;
        disposers.push(
          effect(() => {
            sigs[idx]();
            sigs[next].set(sigs[idx].peek() + 1);
          }),
        );
      }
    } catch (e: unknown) {
      threw = true;
      expect((e as Error).message).toContain('Maximum effect flush iterations exceeded');
    } finally {
      disposers.forEach((d) => d());
    }

    expect(threw).toBe(true);
  });

  it('leaves innocently-queued effects re-runnable after a flush guard abort', () => {
    // an unrelated effect that happens to be queued BEHIND a runaway cascade
    // must not become a permanent zombie: before the fix its _queued flag was
    // never reset when the guard aborted the flush, so every future
    // notification was silently ignored.
    const N = 110;
    const gate = signal(false);
    const sigs = Array.from({ length: N }, () => signal(0));
    const innocentDep = signal(0);
    const disposers: Array<() => void> = [];

    for (let i = 0; i < N; i++) {
      const idx = i;
      const next = (i + 1) % N;
      disposers.push(
        effect(() => {
          if (!gate()) return;
          sigs[idx]();
          sigs[next].set(sigs[idx].peek() + 1);
        }),
      );
    }

    let innocentRuns = 0;
    disposers.push(
      effect(() => {
        innocentDep();
        innocentRuns++;
      }),
    );
    expect(innocentRuns).toBe(1);

    // queue the doomed cascade first, the innocent effect last.
    expect(() =>
      batch(() => {
        gate.set(true);
        innocentDep.set(1);
      }),
    ).toThrow(/Maximum effect flush iterations exceeded/);

    // the innocent effect never got to run during the aborted flush — but a
    // fresh signal change must still be able to re-trigger it.
    const before = innocentRuns;
    innocentDep.set(2);
    expect(innocentRuns).toBe(before + 1);

    disposers.forEach((d) => d());
  });

  it('aborts a deeply-nested write cascade (long effect chain)', () => {
    // a linear chain of effects, each writing the next signal, nests one
    // flush per hop — exceeding the flush depth guard on a chain longer
    // than the allowed depth.
    const N = 150;
    const sigs = Array.from({ length: N + 1 }, () => signal(0));
    const disposers = sigs.slice(0, N).map((_, i) =>
      effect(() => {
        sigs[i]();
        sigs[i + 1].set(sigs[i].peek() + 1);
      }),
    );

    expect(() => sigs[0].set(1)).toThrow(/Maximum effect flush iterations exceeded/);

    disposers.forEach((d) => d());
  });
});

// ---------------------------------------------------------------------------
// computed().dispose()
// ---------------------------------------------------------------------------

describe('computed().dispose()', () => {
  it('unsubscribes from its source so the source no longer retains it', () => {
    const src = signal(1);
    const derived = computed(() => src() * 2);
    expect(derived()).toBe(2);

    let runs = 0;
    const stop = effect(() => {
      derived();
      runs++;
    });
    expect(runs).toBe(1);

    derived.dispose!();
    // after dispose the computed is frozen and no longer tracks src.
    src.set(5);
    expect(derived()).toBe(2); // frozen at last value
    expect(runs).toBe(1); // downstream effect did not re-run via the computed
    stop();
  });

  it('is idempotent', () => {
    const derived = computed(() => 1);
    derived();
    expect(() => {
      derived.dispose!();
      derived.dispose!();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createRoot()
// ---------------------------------------------------------------------------

describe('createRoot()', () => {
  it('disposes every effect created within when its dispose is called', () => {
    const s = signal(0);
    let runs = 0;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      effect(() => {
        s();
        runs++;
      });
    });
    expect(runs).toBe(1);
    s.set(1);
    expect(runs).toBe(2);

    dispose();
    s.set(2);
    expect(runs).toBe(2); // effect torn down
  });

  it('disposes computeds created within (no leak against the source)', () => {
    const src = signal(1);
    let derived!: ReadonlySignal<number>;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      derived = computed(() => src() * 10);
    });
    expect(derived()).toBe(10);

    dispose();
    src.set(2);
    expect(derived()).toBe(10); // frozen — root disposed it
  });

  it('returns the callback result and restores the previous root after nesting', () => {
    const outerSeen: number[] = [];
    const result = createRoot((disposeOuter) => {
      const s = signal(0);
      effect(() => outerSeen.push(s()));
      createRoot((disposeInner) => {
        // inner root captures only its own effect
        effect(() => void s());
        disposeInner();
      });
      // outer effect still live after inner root disposed
      s.set(1);
      disposeOuter();
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(outerSeen).toEqual([0, 1]);
  });

  it('does not register effects created outside any root', () => {
    // a bare effect still works and is independently disposable.
    const s = signal(0);
    let runs = 0;
    const stop = effect(() => {
      s();
      runs++;
    });
    s.set(1);
    expect(runs).toBe(2);
    stop();
  });
});

// ---------------------------------------------------------------------------
// effect — a throwing run must not orphan the effect
// ---------------------------------------------------------------------------

describe('effect — a throwing run must not orphan the effect', () => {
  it('keeps its dependencies when a re-run throws before reading any signal', () => {
    const s = signal(0);
    const seen: number[] = [];
    let boom = false;

    const stop = effect(() => {
      // this throw lands before the first signal read, and _run has already
      // dropped every subscription by then. without the snapshot restore the
      // effect survives subscribed to nothing and can never be notified again.
      if (boom) throw new Error('failed before reading anything');
      seen.push(s());
    });
    expect(seen).toEqual([0]);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    boom = true;
    s.set(1);
    expect(seen).toEqual([0]);
    expect(consoleSpy).toHaveBeenCalledWith('Error in effect:', expect.any(Error));

    boom = false;
    s.set(2);
    expect(seen).toEqual([0, 2]); // still reachable — the effect recovered

    consoleSpy.mockRestore();
    stop();
  });

  it('does not restore dependencies a successful run deliberately dropped', () => {
    const a = signal(0);
    const b = signal(0);
    let readB = true;
    let runs = 0;

    const stop = effect(() => {
      runs++;
      a();
      if (readB) b();
    });
    expect(runs).toBe(1);

    readB = false;
    a.set(1); // re-runs and legitimately stops tracking b
    expect(runs).toBe(2);

    b.set(1);
    expect(runs).toBe(2); // conditional tracking still drops b

    stop();
  });

  it('keeps only what a run captured when it throws after reading a signal', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    let boom = false;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = effect(() => {
      runs++;
      a();
      if (boom) throw new Error('failed between the two reads');
      b();
    });
    expect(runs).toBe(1);

    boom = true;
    a.set(1); // run 2 captures a, then throws before reaching b
    expect(runs).toBe(2);

    b.set(1);
    expect(runs).toBe(2); // b was dropped by a partial run — not resurrected

    a.set(2);
    expect(runs).toBe(3); // what it did capture still notifies it

    consoleSpy.mockRestore();
    stop();
  });

  it('leaves a disposed effect unsubscribed even when its final run threw', () => {
    const s = signal(0);
    let runs = 0;
    let dispose: () => void;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dispose = effect(() => {
      runs++;
      if (runs > 1) {
        dispose();
        throw new Error('disposed mid-run, then threw');
      }
      s();
    });
    expect(runs).toBe(1);

    s.set(1);
    expect(runs).toBe(2);

    s.set(2);
    expect(runs).toBe(2); // stayed disposed

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// effect — synchronous cascade guard
// ---------------------------------------------------------------------------

describe('effect — synchronous cascade guard', () => {
  it('throws when running an effect synchronously runs effects without bound', () => {
    // the unbatched path: every run starts the next one synchronously, so the
    // cascade never reaches flushPendingEffects and its guards never see it.
    let depth = 0;
    const grow = (): void => {
      effect(() => {
        if (depth++ < 500) grow();
      });
    };

    expect(() => grow()).toThrow('Maximum synchronous effect cascade depth exceeded');
    expect(depth).toBeLessThan(500); // stopped early rather than running away
  });

  it('permits a deep but finite synchronous chain', () => {
    let depth = 0;
    const grow = (): void => {
      effect(() => {
        if (depth++ < 50) grow();
      });
    };

    expect(() => grow()).not.toThrow();
    expect(depth).toBe(51);
  });
});

// ---------------------------------------------------------------------------
// effect — scheduler option
// ---------------------------------------------------------------------------

describe('effect — scheduler option', () => {
  it('runs the first pass inline and defers only re-runs', async () => {
    // a binding must paint on mount; it is the UPDATE that waits, so an element
    // never appears blank for a microtask.
    const s = signal('a');
    const seen: string[] = [];
    effect(() => void seen.push(s()), { scheduler: queueJob });

    expect(seen).toEqual(['a']); // mounted synchronously

    s.set('b');
    expect(seen).toEqual(['a']); // not yet
    await tick();
    expect(seen).toEqual(['a', 'b']);
  });

  it('collapses a burst of writes into one run', () => {
    // the reason bindings are scheduled at all: a handler that writes five
    // signals should produce one DOM pass, not five.
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    effect(
      () => {
        a();
        b();
        runs++;
      },
      { scheduler: queueJob },
    );
    expect(runs).toBe(1);

    a.set(1);
    a.set(2);
    b.set(1);
    return tick().then(() => {
      expect(runs).toBe(2); // one re-run for all three writes
    });
  });

  it('lets the write finish before a scheduled reader observes the world', async () => {
    // the bug this exists for. `store` stands in for anything a binding reads
    // that is not itself reactive — a date-fns default locale, a persisted
    // copy, a dom attribute — updated by the same function that wrote the
    // signal. run inline, the reader sees the old value.
    const flag = signal(0);
    let store = 'old';
    const observed: string[] = [];

    effect(
      () => {
        flag();
        observed.push(store);
      },
      { scheduler: queueJob },
    );
    observed.length = 0;

    const update = (): void => {
      flag.set(1); // subscribers are notified INSIDE this call
      store = 'new'; // ...and this had not happened yet
    };
    update();

    await tick();
    expect(observed).toEqual(['new']);
  });

  it('keeps a scheduled effect scheduled when it was queued by a batch', () => {
    // batch() must not smuggle a binding back onto the synchronous path: its
    // updates always land in one place.
    const s = signal(0);
    let runs = 0;
    effect(
      () => {
        s();
        runs++;
      },
      { scheduler: queueJob },
    );
    batch(() => {
      s.set(1);
      s.set(2);
    });
    expect(runs).toBe(1); // still deferred after the batch closed
    return tick().then(() => expect(runs).toBe(2));
  });

  it('does not run a scheduled effect that was disposed before its turn', () => {
    const s = signal(0);
    let runs = 0;
    const stop = effect(
      () => {
        s();
        runs++;
      },
      { scheduler: queueJob },
    );
    s.set(1);
    stop(); // disposed while its job sits in the queue
    return tick().then(() => expect(runs).toBe(1));
  });
});

// ---------------------------------------------------------------------------
// flushSync
// ---------------------------------------------------------------------------

describe('flushSync', () => {
  it('applies scheduled work before returning', () => {
    const s = signal(0);
    let runs = 0;
    effect(
      () => {
        s();
        runs++;
      },
      { scheduler: queueJob },
    );

    flushSync(() => s.set(1));
    expect(runs).toBe(2); // no await needed
  });

  it('still collapses several writes into one run', () => {
    const s = signal(0);
    let runs = 0;
    effect(
      () => {
        s();
        runs++;
      },
      { scheduler: queueJob },
    );

    flushSync(() => {
      s.set(1);
      s.set(2);
      s.set(3);
    });
    expect(runs).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Effect teardown — the dependency-unsubscribe call path
// ---------------------------------------------------------------------------
//
// EffectNode drops its dependency subscriptions in two places: before every
// re-run (so conditional tracking is correct) and once on disposal. Both go
// through the same helper. A refactor that renames or removes that helper on
// one side of a merge, while a call site on the other side still invokes it,
// breaks every teardown route at once — so each route is pinned here by name
// rather than only incidentally by the tests that happen to dispose.
// ---------------------------------------------------------------------------

describe('effect teardown unsubscribes from dependencies', () => {
  it('drops stale dependencies before each re-run', () => {
    const useA = signal(true);
    const a = signal('a');
    const b = signal('b');
    let runs = 0;

    const stop = effect(() => {
      runs++;
      if (useA()) {
        a();
      } else {
        b();
      }
    });
    expect(runs).toBe(1);

    // switch the branch: `a` must be unsubscribed, `b` subscribed.
    useA.set(false);
    expect(runs).toBe(2);

    a.set('a2');
    expect(runs).toBe(2); // the abandoned branch no longer notifies

    b.set('b2');
    expect(runs).toBe(3);

    stop();
  });

  it('unsubscribes when the returned dispose function is called', () => {
    const s = signal(0);
    let runs = 0;
    const stop = effect(() => {
      s();
      runs++;
    });
    expect(runs).toBe(1);

    expect(() => stop()).not.toThrow();
    s.set(1);
    s.set(2);
    expect(runs).toBe(1);

    // disposing twice must stay a no-op, not throw on an already-cleared set.
    expect(() => stop()).not.toThrow();
  });

  it('unsubscribes an effect disposed through its owning root', () => {
    const s = signal(0);
    let runs = 0;
    let dispose!: () => void;

    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      effect(() => {
        s();
        runs++;
      });
    });
    expect(runs).toBe(1);

    expect(() => dispose()).not.toThrow();
    s.set(1);
    expect(runs).toBe(1);
  });

  it('unsubscribes an effect that also registered a cleanup function', () => {
    const s = signal(0);
    let cleanups = 0;
    let runs = 0;

    const stop = effect(() => {
      s();
      runs++;
      return () => {
        cleanups++;
      };
    });
    expect(runs).toBe(1);

    s.set(1);
    expect(runs).toBe(2);
    expect(cleanups).toBe(1);

    // dispose runs the pending cleanup AND unsubscribes, in that order.
    expect(() => stop()).not.toThrow();
    expect(cleanups).toBe(2);
    s.set(2);
    expect(runs).toBe(2);
  });
});
