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
  setAttr,
  addEventListener,
  insertBefore,
  removeNode,
  appendChild,
  createComment,
} from './dom.js';

// ---------------------------------------------------------------------------
// Directives (used by compiled control-flow constructs)
// ---------------------------------------------------------------------------
export { createIf, createFor, createComponent } from './directives.js';

// ---------------------------------------------------------------------------
// Component lifecycle
// ---------------------------------------------------------------------------
export {
  mount,
  createComponentInstance,
  pushDisposer,
  startCapturingDisposers,
  stopCapturingDisposers,
} from './component.js';

export type { ComponentDefinition, ComponentInstance } from './component.js';

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
export { queueJob, nextTick } from './scheduler.js';

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------
export { hydrate } from './hydration.js';

// ---------------------------------------------------------------------------
// Reactivity primitives (re-exported from @matthesketh/utopia-core)
// ---------------------------------------------------------------------------
export { signal, computed, effect, batch, untrack } from '@matthesketh/utopia-core';

// ---------------------------------------------------------------------------
// createEffect — wrapped effect() that captures disposers
// ---------------------------------------------------------------------------
import { effect as _coreEffect } from '@matthesketh/utopia-core';
import { pushDisposer } from './component.js';

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
} from './form.js';

export type {
  ValidationRule,
  FieldConfig,
  FormField,
  Form,
} from './form.js';
