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
  sanitizeHtml,
  setAttr,
  mergeClass,
  addEventListener,
  insertBefore,
  removeNode,
  appendChild,
  createComment,
} from './dom';

// ---------------------------------------------------------------------------
// Directives (used by compiled control-flow constructs)
// ---------------------------------------------------------------------------
export { createIf, createFor, createComponent } from './directives';

// ---------------------------------------------------------------------------
// Component lifecycle
// ---------------------------------------------------------------------------
export {
  mount,
  createComponentInstance,
  pushDisposer,
  startCapturingDisposers,
  stopCapturingDisposers,
  onMount,
  onDestroy,
} from './component';

export type { ComponentDefinition, ComponentInstance } from './component';

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
export { queueJob, nextTick } from './scheduler';

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------
export { hydrate } from './hydration';

// ---------------------------------------------------------------------------
// Lifecycle helpers (auto-cleanup side-effects)
// ---------------------------------------------------------------------------
export { useEventListener, useInterval, useTimeout } from './use';

// ---------------------------------------------------------------------------
// Reactivity primitives (re-exported from @matthesketh/utopia-core)
// ---------------------------------------------------------------------------
export { signal, computed, effect, batch, untrack } from '@matthesketh/utopia-core';

// ---------------------------------------------------------------------------
// createEffect — wrapped effect() that captures disposers
// ---------------------------------------------------------------------------
import { effect as _coreEffect } from '@matthesketh/utopia-core';
import { pushDisposer } from './component';

export function createEffect(fn: () => void | (() => void)): () => void {
  const dispose = _coreEffect(fn);
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
} from './form';

export type { ValidationRule, FieldConfig, FormField, Form } from './form';

// ---------------------------------------------------------------------------
// Head management
// ---------------------------------------------------------------------------
export { useHead } from './head';
export type { HeadConfig } from './head';

// ---------------------------------------------------------------------------
// Error boundaries
// ---------------------------------------------------------------------------
export { createErrorBoundary } from './error-boundary';

// ---------------------------------------------------------------------------
// Lazy components
// ---------------------------------------------------------------------------
export { defineLazy } from './lazy';

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------
export { createTransition, performEnter, performLeave } from './transition';
export type { TransitionOptions, TransitionHooks } from './transition';
