// ============================================================================
// @matthesketh/utopia-runtime — Lifecycle helpers
// ============================================================================
//
// thin wrappers around the common browser side-effects (event listeners,
// intervals, timeouts) that register their teardown with the surrounding
// component/list/branch scope via pushDisposer — so they are cleaned up
// automatically on unmount instead of by hand-written onDestroy code.
// ============================================================================

import { pushDisposer } from './component';

/** anything that exposes addEventListener/removeEventListener. */
interface ListenerTarget {
  addEventListener(
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: unknown,
  ): void;
  removeEventListener(
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: unknown,
  ): void;
}

/**
 * add an event listener that is removed automatically when the surrounding
 * scope is torn down. returns a manual stop function for early removal.
 *
 * ```ts
 * useEventListener(window, 'resize', onResize);
 * ```
 */
export function useEventListener(
  target: ListenerTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
): () => void {
  target.addEventListener(type, handler, options);
  let active = true;
  const stop = (): void => {
    if (!active) return;
    active = false;
    target.removeEventListener(type, handler, options);
  };
  pushDisposer(stop);
  return stop;
}

/**
 * start an interval that is cleared automatically when the surrounding scope
 * is torn down. returns a manual stop function.
 *
 * ```ts
 * useInterval(() => tick(), 1000);
 * ```
 */
export function useInterval(callback: () => void, delayMs: number): () => void {
  const id = setInterval(callback, delayMs);
  let active = true;
  const stop = (): void => {
    if (!active) return;
    active = false;
    clearInterval(id);
  };
  pushDisposer(stop);
  return stop;
}

/**
 * start a timeout that is cleared automatically if the surrounding scope is
 * torn down before it fires. returns a manual cancel function.
 *
 * ```ts
 * useTimeout(() => hideToast(), 3000);
 * ```
 */
export function useTimeout(callback: () => void, delayMs: number): () => void {
  let active = true;
  const id = setTimeout(() => {
    active = false;
    callback();
  }, delayMs);
  const cancel = (): void => {
    if (!active) return;
    active = false;
    clearTimeout(id);
  };
  pushDisposer(cancel);
  return cancel;
}
