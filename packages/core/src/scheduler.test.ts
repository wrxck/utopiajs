/**
 * The microtask job queue behind the DOM bindings.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { flushSync, queueJob, tick } from '@/index';

// core has no node typings; the slice of `process` these tests use.
const proc = (
  globalThis as unknown as {
    process: {
      on(event: string, fn: (err: unknown) => void): void;
      removeAllListeners(event: string): void;
    };
  }
).process;

describe('a throwing job', () => {
  afterEach(() => {
    proc.removeAllListeners('unhandledRejection');
  });

  it('does not drop the jobs queued after it', async () => {
    // the pass rethrows the first error once every job has run; in a
    // microtask flush that surfaces as an unhandled rejection.
    const surfaced: unknown[] = [];
    proc.on('unhandledRejection', (err) => surfaced.push(err));

    let ran = false;
    queueJob(() => {
      throw new Error('boom');
    });
    queueJob(() => {
      ran = true;
    });
    await tick();
    await new Promise((r) => setTimeout(r, 0));

    expect(ran).toBe(true);
    expect(surfaced).toHaveLength(1);
    expect((surfaced[0] as Error).message).toBe('boom');
  });

  it('surfaces the first error to a flushSync caller after running the rest', () => {
    let ran = false;
    expect(() =>
      flushSync(() => {
        queueJob(() => {
          throw new Error('first');
        });
        queueJob(() => {
          ran = true;
        });
      }),
    ).toThrow('first');
    expect(ran).toBe(true);
  });
});
