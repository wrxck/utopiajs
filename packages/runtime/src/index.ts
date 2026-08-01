/**
 * @matthesketh/utopia-runtime — Public API
 *
 * Re-exports everything that compiled .utopia code and end-user application
 * code needs from the runtime.
 */

// ---------------------------------------------------------------------------
// DOM helpers (used by compiled template output)
// ---------------------------------------------------------------------------
export {
  createElement,
  createTextNode,
  setText,
  setHtml,
  setSafeHtml,
  setShow,
  sanitizeHtml,
  setAttr,
  mergeClass,
  normalizeClass,
  normalizeStyle,
  addEventListener,
  insertBefore,
  removeNode,
  appendChild,
  createComment,
} from '@/dom';

// ---------------------------------------------------------------------------
// Two-way binding (u-model)
// ---------------------------------------------------------------------------
export { applyModel } from '@/model';

// ---------------------------------------------------------------------------
// Directives (used by compiled control-flow constructs)
// ---------------------------------------------------------------------------
export { createIf, createFor, createComponent } from '@/directives';
export type { ForItemScope } from '@/directives';

// ---------------------------------------------------------------------------
// Component lifecycle
// ---------------------------------------------------------------------------
export {
  mount,
  createComponentInstance,
  pushDisposer,
  startCapturingDisposers,
  stopCapturingDisposers,
  startCapturingLifecycle,
  stopCapturingLifecycle,
  pushOwner,
  popOwner,
  onMount,
  onDestroy,
  provide,
  inject,
} from '@/component';

export type { ComponentDefinition, ComponentInstance } from '@/component';

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
export { queueJob, nextTick } from '@/scheduler';

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------
export { hydrate } from '@/hydration';

// ---------------------------------------------------------------------------
// Lifecycle helpers (auto-cleanup side-effects)
// ---------------------------------------------------------------------------
export { useEventListener, useInterval, useTimeout } from '@/use';

// ---------------------------------------------------------------------------
// Reactivity primitives (re-exported from @matthesketh/utopia-core)
// ---------------------------------------------------------------------------
export { signal, computed, effect, batch, untrack, createRoot } from '@matthesketh/utopia-core';

// ---------------------------------------------------------------------------
// createEffect — wrapped effect() that captures disposers
// ---------------------------------------------------------------------------
import { effect as _coreEffect } from '@matthesketh/utopia-core';
import { pushDisposer } from '@/component';
import { domScheduler } from '@/scheduler';

/**
 * The compiler wraps every `{{ }}` interpolation and `:binding` in one of
 * these, so this is where compiled output meets reactivity.
 *
 * Updates are scheduled onto the microtask queue rather than run inline. A
 * signal write notifies its subscribers *inside* `set()`, so an inline binding
 * re-renders partway through whatever function did the write — against a world
 * that function has not finished updating. Deferring moves every binding to
 * after the synchronous work, which also collapses a handler that writes five
 * signals into a single DOM pass.
 *
 * The first run is still synchronous (effects always run once inline on
 * creation), so an element paints its initial value on mount.
 *
 * User-authored `effect()` in a component `<script>` is deliberately NOT
 * scheduled: it is application logic rather than rendering, and its ordering is
 * something authors reason about directly.
 */
export function createEffect(fn: () => void | (() => void)): () => void {
  const dispose = _coreEffect(fn, { scheduler: domScheduler });
  pushDisposer(dispose);
  return dispose;
}

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------
export {
  createForm,
  required,
  minLength,
  maxLength,
  min,
  max,
  email,
  pattern,
  validate,
} from '@/form';

export type { ValidationRule, FieldConfig, FormField, Form } from '@/form';

// ---------------------------------------------------------------------------
// Head management
// ---------------------------------------------------------------------------
export { useHead } from '@/head';
export type { HeadConfig } from '@/head';

// ---------------------------------------------------------------------------
// Error boundaries
// ---------------------------------------------------------------------------
export { createErrorBoundary } from '@/error-boundary';

// ---------------------------------------------------------------------------
// Lazy components
// ---------------------------------------------------------------------------
export { defineLazy } from '@/lazy';

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------
export { createTransition, performEnter, performLeave } from '@/transition';
export type { TransitionOptions, TransitionHooks } from '@/transition';
