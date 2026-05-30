// tests for the auto-cleanup lifecycle helpers: each must tear down its
// side-effect when the surrounding component scope unmounts.

import { describe, it, expect, vi } from 'vitest';

import { createComponentInstance } from './component';
import type { ComponentDefinition } from './component';
import { useEventListener, useInterval, useTimeout } from './use';

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
