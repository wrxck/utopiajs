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
export function createTransition(el: Element, opts: TransitionOptions): TransitionHooks {
  const name = opts.name;

  return {
    beforeEnter(el: Element) {
      el.classList.add(`${name}-enter-from`, `${name}-enter-active`);
    },

    enter(el: Element, done: () => void) {
      // Force reflow so the browser picks up the initial state.
      void (el as HTMLElement).offsetHeight;

      el.classList.remove(`${name}-enter-from`);
      el.classList.add(`${name}-enter-to`);

      let called = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const onEnd = () => {
        if (called) return;
        called = true;
        el.classList.remove(`${name}-enter-active`, `${name}-enter-to`);
        el.removeEventListener('transitionend', onEnd);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        done();
      };

      el.addEventListener('transitionend', onEnd);

      // Safety timeout: if transitionend doesn't fire (e.g. no CSS transition
      // defined), clean up after the specified duration or a default.
      if (opts.duration) {
        timeoutId = setTimeout(onEnd, opts.duration + 50);
      }
    },

    beforeLeave(el: Element) {
      el.classList.add(`${name}-leave-from`, `${name}-leave-active`);
    },

    leave(el: Element, done: () => void) {
      void (el as HTMLElement).offsetHeight;

      el.classList.remove(`${name}-leave-from`);
      el.classList.add(`${name}-leave-to`);

      let called = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const onEnd = () => {
        if (called) return;
        called = true;
        el.classList.remove(`${name}-leave-active`, `${name}-leave-to`);
        el.removeEventListener('transitionend', onEnd);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        done();
      };

      el.addEventListener('transitionend', onEnd);

      if (opts.duration) {
        timeoutId = setTimeout(onEnd, opts.duration + 50);
      }
    },
  };
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
