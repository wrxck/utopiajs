// ============================================================================
// @matthesketh/utopia-runtime — Transitions
// ============================================================================
//
// CSS-based transition system. When elements enter/leave the DOM, transition
// classes are applied following this sequence:
//
// Enter: .name-enter-from + .name-enter-active → next frame → .name-enter-to
//        → transitionend → cleanup
//
// Leave: .name-leave-from + .name-leave-active → next frame → .name-leave-to
//        → transitionend → remove element
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransitionOptions {
  name: string;
  duration?: number;
}

export interface TransitionHooks {
  beforeEnter(el: Element): void;
  enter(el: Element, done: () => void): void;
  beforeLeave(el: Element): void;
  leave(el: Element, done: () => void): void;
}

// ---------------------------------------------------------------------------
// createTransition
// ---------------------------------------------------------------------------

/**
 * Apply CSS transition classes to an element.
 *
 * This function is called by the compiler's generated code when a
 * `u-transition` directive is present.
 *
 * @returns TransitionHooks that can be used by createIf/createFor
 *          to coordinate enter/leave animations.
 */
/**
 * The longest `duration + delay` among an element's CSS transitions and
 * animations, in ms — the time a phase can legitimately take.
 */
function cssTimeout(el: Element): number {
  if (typeof getComputedStyle !== 'function') return 0;
  const style = getComputedStyle(el);
  const longest = (durations: string, delays: string): number => {
    const d = toMs(durations);
    const l = toMs(delays);
    let max = 0;
    for (let i = 0; i < d.length; i++) {
      max = Math.max(max, d[i]! + (l[i % Math.max(l.length, 1)] ?? 0));
    }
    return max;
  };
  return Math.max(
    longest(style.transitionDuration || '', style.transitionDelay || ''),
    longest(style.animationDuration || '', style.animationDelay || ''),
  );
}

/** Parse a CSS time list (`0.3s, 150ms`) into milliseconds. */
function toMs(list: string): number[] {
  if (!list) return [];
  return list.split(',').map((t) => {
    const v = t.trim();
    const n = parseFloat(v);
    if (Number.isNaN(n)) return 0;
    return v.endsWith('ms') ? n : n * 1000;
  });
}

/**
 * Run one transition phase (enter or leave): swap the `-from` class for the
 * `-to` class, then remove the phase classes and call `done` exactly once —
 * on `transitionend`, or after a safety timeout when `transitionend` never
 * fires. The timeout is the configured `duration`, or else the element's own
 * CSS transition/animation time, plus 50ms. It used to exist only with a
 * configured duration, so a leave with no CSS transition defined never
 * completed and the element was never removed.
 */
function runPhase(
  el: Element,
  name: string,
  phase: 'enter' | 'leave',
  duration: number | undefined,
  done: () => void,
): void {
  // Force reflow so the browser picks up the initial state.
  void (el as HTMLElement).offsetHeight;

  el.classList.remove(`${name}-${phase}-from`);
  el.classList.add(`${name}-${phase}-to`);

  let called = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const onEnd = () => {
    if (called) return;
    called = true;
    el.classList.remove(`${name}-${phase}-active`, `${name}-${phase}-to`);
    el.removeEventListener('transitionend', onEnd);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    done();
  };

  el.addEventListener('transitionend', onEnd);

  const ms = duration ?? cssTimeout(el);
  timeoutId = setTimeout(onEnd, ms > 0 ? ms + 50 : 0);
}

/** An element carrying the hooks its `u-transition` directive created. */
interface TransitionElement extends Element {
  __transition?: TransitionHooks;
}

export function createTransition(el: Element, opts: TransitionOptions): TransitionHooks {
  const name = opts.name;

  const hooks: TransitionHooks = {
    beforeEnter(el: Element) {
      el.classList.add(`${name}-enter-from`, `${name}-enter-active`);
    },

    enter(el: Element, done: () => void) {
      runPhase(el, name, 'enter', opts.duration, done);
    },

    beforeLeave(el: Element) {
      el.classList.add(`${name}-leave-from`, `${name}-leave-active`);
    },

    leave(el: Element, done: () => void) {
      runPhase(el, name, 'leave', opts.duration, done);
    },
  };
  // the compiled `u-transition` directive discards the return value; the
  // structural directives find the hooks on the element instead.
  (el as TransitionElement).__transition = hooks;
  return hooks;
}

/**
 * Play the enter transition of a node a `u-if` branch or `u-for` row just
 * inserted, when its `u-transition` directive attached one.
 */
export function transitionEnter(node: Node): void {
  const hooks = (node as TransitionElement).__transition;
  if (hooks) performEnter(node as Element, hooks);
}

/**
 * Remove a node, first playing its leave transition when it has one. Returns
 * true when removal was deferred to the end of the transition.
 */
export function transitionLeave(node: Node, remove: () => void): boolean {
  const hooks = (node as TransitionElement).__transition;
  if (!hooks || !(node as Element).isConnected) return false;
  performLeave(node as Element, hooks, remove);
  return true;
}

/**
 * Run enter transition on an element.
 */
export function performEnter(el: Element, hooks: TransitionHooks): void {
  hooks.beforeEnter(el);
  hooks.enter(el, () => {});
}

/**
 * Run leave transition on an element, calling done() when complete.
 */
export function performLeave(el: Element, hooks: TransitionHooks, done: () => void): void {
  hooks.beforeLeave(el);
  hooks.leave(el, done);
}
