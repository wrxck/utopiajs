// ============================================================================
// @matthesketh/utopia-core — Reactivity system test suite
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { signal, computed, effect, batch, untrack } from './index';

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
    s.update(n => n * 3);
    expect(s()).toBe(15);
  });

  it('does not notify subscribers when value is the same (Object.is)', () => {
    const s = signal(1);
    const fn = vi.fn(() => s());

    effect(fn);
    fn.mockClear(); // clear the initial synchronous run

    s.set(1); // same value
    expect(fn).not.toHaveBeenCalled();
  });

  it('handles NaN correctly (NaN === NaN via Object.is)', () => {
    const s = signal(NaN);
    const fn = vi.fn(() => s());

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
      return b() + c();
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
    let innerDispose: (() => void) | undefined;

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
    const fn = vi.fn(() => s());

    effect(fn);
    fn.mockClear();

    s.set(obj); // same reference
    expect(fn).not.toHaveBeenCalled();
  });

  it('effect re-runs when set to a different object with same shape', () => {
    const s = signal({ count: 0 });
    const fn = vi.fn(() => s());

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

    effect(() => log1.push(s()));
    effect(() => log2.push(s()));

    s.set(1);

    expect(log1).toEqual([0, 1]);
    expect(log2).toEqual([0, 1]);
  });

  it('disposing an effect twice is safe', () => {
    const s = signal(0);
    const dispose = effect(() => { s(); });

    dispose();
    expect(() => dispose()).not.toThrow();
  });

  it('effect does not run after disposal even if queued in batch', () => {
    const s = signal(0);
    const fn = vi.fn(() => { s(); });

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
    s.update(v => {
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
      return list.filter(t => t.includes(f));
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
      username().length < 3 ? 'Username must be at least 3 characters' : null
    );

    const passwordError = computed(() =>
      password().length < 8 ? 'Password must be at least 8 characters' : null
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
