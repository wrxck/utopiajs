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
  addEventListener,
  appendChild,
  createComment,
  createElement,
  createTextNode,
  insertBefore,
  mergeClass,
  normalizeClass,
  normalizeStyle,
  removeNode,
  sanitizeHtml,
  setAttr,
  setHtml,
  setSafeHtml,
  setShow,
  setText,
} from '@/dom';

// ---------------------------------------------------------------------------
// Two-way binding (u-model)
// ---------------------------------------------------------------------------
export { applyModel } from '@/model';

// ---------------------------------------------------------------------------
// Directives (used by compiled control-flow constructs)
// ---------------------------------------------------------------------------
export type { ForItemScope } from '@/directives';
export { createComponent, createFor, createIf } from '@/directives';

// ---------------------------------------------------------------------------
// Component lifecycle
// ---------------------------------------------------------------------------
export type { ComponentDefinition, ComponentInstance } from '@/component';
export {
  createComponentInstance,
  inject,
  mount,
  onDestroy,
  onMount,
  popOwner,
  provide,
  pushDisposer,
  pushOwner,
  startCapturingDisposers,
  startCapturingLifecycle,
  stopCapturingDisposers,
  stopCapturingLifecycle,
} from '@/component';

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
export { nextTick, queueJob } from '@/scheduler';

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
export { batch, computed, createRoot, effect, signal, untrack } from '@matthesketh/utopia-core';

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
export type { FieldConfig, Form, FormField, ValidationRule } from '@/form';
export {
  createForm,
  email,
  max,
  maxLength,
  min,
  minLength,
  pattern,
  required,
  validate,
} from '@/form';

// ---------------------------------------------------------------------------
// Head management
// ---------------------------------------------------------------------------
export type { HeadConfig } from '@/head';
export { useHead } from '@/head';

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
export type { TransitionHooks, TransitionOptions } from '@/transition';
export { createTransition, performEnter, performLeave } from '@/transition';
