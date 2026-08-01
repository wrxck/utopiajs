// tests for the auto-cleanup lifecycle helpers: each must tear down its
// side-effect when the surrounding component scope unmounts.

import { describe, expect, it, vi } from 'vitest';

import type { ComponentDefinition } from '@/component';
import { createComponentInstance } from '@/component';
import { useEventListener, useInterval, useTimeout } from '@/use';

function mountWith(render: () => Node): { unmount: () => void } {
  const def: ComponentDefinition = { render };
  const instance = createComponentInstance(def);
  instance.mount(document.body);
  return instance;
}

describe('useEventListener', () => {
  it('fires while mounted and stops after unmount', () => {
    const handler = vi.fn();
    const target = document.createElement('div');
    const instance = mountWith(() => {
      useEventListener(target, 'click', handler);
      return document.createElement('span');
    });

    target.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);

    instance.unmount();
    target.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1); // no further calls — listener removed
  });

  it('returns a manual stop function', () => {
    const handler = vi.fn();
    const target = document.createElement('div');
    mountWith(() => {
      const stop = useEventListener(target, 'click', handler);
      stop();
      return document.createElement('span');
    });
    target.dispatchEvent(new Event('click'));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('useInterval', () => {
  it('clears the interval on unmount', () => {
    vi.useFakeTimers();
    try {
      const tick = vi.fn();
      const instance = mountWith(() => {
        useInterval(tick, 100);
        return document.createElement('span');
      });
      vi.advanceTimersByTime(250);
      expect(tick).toHaveBeenCalledTimes(2);

      instance.unmount();
      vi.advanceTimersByTime(500);
      expect(tick).toHaveBeenCalledTimes(2); // stopped — no more ticks
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useTimeout', () => {
  it('does not fire if the scope unmounts first', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const instance = mountWith(() => {
        useTimeout(fn, 1000);
        return document.createElement('span');
      });
      instance.unmount();
      vi.advanceTimersByTime(2000);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires if still mounted when it elapses', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      mountWith(() => {
        useTimeout(fn, 1000);
        return document.createElement('span');
      });
      vi.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('idempotent stop functions', () => {
  it('useEventListener stop is safe to call twice and after unmount', () => {
    const handler = vi.fn();
    const target = document.createElement('div');
    const removeSpy = vi.spyOn(target, 'removeEventListener');

    let stop!: () => void;
    const instance = mountWith(() => {
      stop = useEventListener(target, 'click', handler);
      return document.createElement('span');
    });

    stop();
    stop(); // second call is a no-op
    instance.unmount(); // scope disposal after manual stop is a no-op too
    expect(removeSpy).toHaveBeenCalledTimes(1);
    removeSpy.mockRestore();
  });

  it('useInterval stop is safe to call twice', () => {
    vi.useFakeTimers();
    try {
      const tick = vi.fn();
      let stop!: () => void;
      const instance = mountWith(() => {
        stop = useInterval(tick, 50);
        return document.createElement('span');
      });
      stop();
      stop();
      vi.advanceTimersByTime(500);
      expect(tick).not.toHaveBeenCalled();
      instance.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('useTimeout cancel after firing is a no-op', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      let cancel!: () => void;
      const instance = mountWith(() => {
        cancel = useTimeout(fn, 100);
        return document.createElement('span');
      });
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
      cancel(); // already fired — must not throw or clear anything
      cancel();
      instance.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
