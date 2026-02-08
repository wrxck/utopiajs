/**
 * @utopia/runtime — Public API
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
export {
  createIf,
  createFor,
  createComponent,
} from './directives.js';

// ---------------------------------------------------------------------------
// Component lifecycle
// ---------------------------------------------------------------------------
export {
  mount,
  createComponentInstance,
} from './component.js';

export type {
  ComponentDefinition,
  ComponentInstance,
} from './component.js';

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
export { queueJob, nextTick } from './scheduler.js';

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------
export { hydrate } from './hydration.js';

// ---------------------------------------------------------------------------
// Reactivity primitives (re-exported from @utopia/core)
// ---------------------------------------------------------------------------
export { signal, computed, effect, batch, untrack } from '@utopia/core';

// Alias: the compiler emits `createEffect` but @utopia/core exports `effect`.
export { effect as createEffect } from '@utopia/core';
