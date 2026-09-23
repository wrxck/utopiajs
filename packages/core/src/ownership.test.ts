/**
 * Reactive ownership and change propagation.
 *
 * - An effect or computed re-runs under the root it was created in, not under
 *   whatever root happens to be active when it is notified.
 * - A computed that recomputes to an equal value does not re-run the effects
 *   and computeds downstream of it.
 * - An effect that disposes itself mid-run leaves nothing subscribed and still
 *   runs the cleanup that run returned.
 */

import { describe, expect, it, vi } from 'vitest';

import { batch, computed, createRoot, effect, signal } from '@/index';

describe('root ownership on re-run', () => {
  it('registers effects created by a re-run with the effect’s own root', () => {
    const trigger = signal(0);
    const inner = signal(0);
    let innerRuns = 0;

    // an effect with no root, whose re-run creates an inner effect.
    effect(() => {
      if (trigger() > 0) {
        effect(() => {
          inner();
          innerRuns++;
        });
      }
    });

    // re-run it synchronously from inside an unrelated root.
    let disposeOther!: () => void;
    createRoot((dispose) => {
      disposeOther = dispose;
      trigger.set(1);
    });
    expect(innerRuns).toBe(1);

    // disposing the unrelated root must not reach the inner effect: that root
    // never owned it.
    disposeOther();
    inner.set(1);
    expect(innerRuns).toBe(2);
  });

  it('disposes effects created by a re-run when their own root is disposed', () => {
    const trigger = signal(0);
    const inner = signal(0);
    let innerRuns = 0;

    const dispose = createRoot((d) => {
      effect(() => {
        if (trigger() > 0) {
          effect(() => {
            inner();
            innerRuns++;
          });
        }
      });
      return d;
    });

    trigger.set(1); // re-run happens after createRoot returned
    expect(innerRuns).toBe(1);

    dispose();
    inner.set(1);
    expect(innerRuns).toBe(1);
  });

  it('leaves an individually disposed effect out of its root’s teardown', () => {
    const cleanup = vi.fn();
    let stop!: () => void;
    const disposeRoot = createRoot((d) => {
      stop = effect(() => cleanup);
      return d;
    });
    stop();
    expect(cleanup).toHaveBeenCalledTimes(1);
    disposeRoot();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('equal computed values stop propagation', () => {
  it('does not re-run an effect when its computed source recomputes to an equal value', () => {
    const offset = signal(0);
    const page = computed(() => Math.floor(offset() / 10));
    const fetchPage = vi.fn();
    effect(() => fetchPage(page()));
    expect(fetchPage).toHaveBeenCalledTimes(1);

    offset.set(3);
    offset.set(7);
    expect(fetchPage).toHaveBeenCalledTimes(1);

    offset.set(12);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenLastCalledWith(1);
  });

  it('does not recompute a computed whose computed source is unchanged', () => {
    const n = signal(1);
    const positive = computed(() => n() > 0);
    const label = vi.fn(() => (positive() ? 'yes' : 'no'));
    const labelled = computed(label);
    effect(() => void labelled());
    expect(label).toHaveBeenCalledTimes(1);

    n.set(2);
    n.set(3);
    expect(label).toHaveBeenCalledTimes(1);

    n.set(-1);
    expect(label).toHaveBeenCalledTimes(2);
    expect(labelled()).toBe('no');
  });

  it('still runs when a plain signal it reads changes alongside an unchanged computed', () => {
    const a = signal(1);
    const b = signal('x');
    const sign = computed(() => a() > 0);
    const seen: string[] = [];
    effect(() => {
      seen.push(`${sign()}:${b()}`);
    });

    batch(() => {
      a.set(2); // computed unchanged
      b.set('y'); // plain signal changed
    });
    expect(seen).toEqual(['true:x', 'true:y']);
  });

  it('runs when an upstream computed throws, so the error surfaces in the effect', () => {
    const n = signal(1);
    const risky = computed(() => {
      if (n() < 0) throw new Error('negative');
      return n() > 0;
    });
    const errors: unknown[] = [];
    const restore = vi.spyOn(console, 'error').mockImplementation((_label, err) => {
      errors.push(err);
    });
    effect(() => {
      risky();
    });
    n.set(-1);
    expect(errors).toHaveLength(1);
    restore.mockRestore();
  });
});

describe('an effect disposing itself mid-run', () => {
  it('unsubscribes reads made after the stop and runs the returned cleanup', () => {
    const done = signal(false);
    const other = signal(0);
    const cleanup = vi.fn();
    let runs = 0;

    let stop: (() => void) | undefined;
    stop = effect(() => {
      runs++;
      if (done()) stop?.();
      other(); // read AFTER the stop
      return cleanup;
    });

    done.set(true); // this run disposes the effect
    expect(runs).toBe(2);
    // the cleanup from the first run ran at dispose; the one this run
    // returned must run too instead of being dropped.
    expect(cleanup).toHaveBeenCalledTimes(2);

    other.set(1);
    expect(runs).toBe(2);
  });
});
