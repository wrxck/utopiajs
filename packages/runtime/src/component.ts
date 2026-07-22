/**
 * @matthesketh/utopia-runtime — Component lifecycle
 *
 * Provides the primitives for instantiating and mounting compiled .utopia
 * component definitions.
 */

// ---------------------------------------------------------------------------
// Effect disposer capture mechanism
// ---------------------------------------------------------------------------

let activeDisposers: (() => void)[] | null = null;

export function pushDisposer(fn: () => void): void {
  if (activeDisposers !== null) {
    activeDisposers.push(fn);
  }
}

export function startCapturingDisposers(): (() => void)[] | null {
  const prev = activeDisposers;
  activeDisposers = [];
  return prev;
}

export function stopCapturingDisposers(prev: (() => void)[] | null): (() => void)[] {
  const captured = activeDisposers ?? [];
  activeDisposers = prev;
  return captured;
}

// ---------------------------------------------------------------------------
// Lifecycle hook capture mechanism
// ---------------------------------------------------------------------------

let currentMountCallbacks: (() => void)[] | null = null;
let currentDestroyCallbacks: (() => void)[] | null = null;

export function startCapturingLifecycle(): void {
  currentMountCallbacks = [];
  currentDestroyCallbacks = [];
}

export function stopCapturingLifecycle(): {
  mount: (() => void)[];
  destroy: (() => void)[];
} {
  const mount = currentMountCallbacks ?? [];
  const destroy = currentDestroyCallbacks ?? [];
  currentMountCallbacks = null;
  currentDestroyCallbacks = null;
  return { mount, destroy };
}

/**
 * Register a callback to run after the component is mounted to the DOM.
 * Must be called during component setup.
 */
export function onMount(fn: () => void): void {
  if (currentMountCallbacks !== null) {
    currentMountCallbacks.push(fn);
  } else {
    console.warn('[utopia] onMount() called outside of component setup');
  }
}

/**
 * Register a callback to run when the component is unmounted.
 * Must be called during component setup.
 */
export function onDestroy(fn: () => void): void {
  if (currentDestroyCallbacks !== null) {
    currentDestroyCallbacks.push(fn);
  } else {
    console.warn('[utopia] onDestroy() called outside of component setup');
  }
}

// ---------------------------------------------------------------------------
// Setup + render pipeline (shared by mount, createComponent, and hydrate)
// ---------------------------------------------------------------------------

/**
 * Internal: run a definition's setup() and render() inside a single
 * disposer-capture scope, capturing lifecycle hooks during setup. Running
 * setup inside the scope means effects created during setup are disposed
 * together with render-created ones instead of leaking.
 */
export function runSetupAndRender(
  definition: ComponentDefinition,
  props: Record<string, unknown>,
  slots: Record<string, () => Node>,
): {
  el: Node;
  mountCallbacks: (() => void)[];
  destroyCallbacks: (() => void)[];
  disposers: (() => void)[];
} {
  let el: Node;
  let lifecycle: { mount: (() => void)[]; destroy: (() => void)[] };
  let disposers: (() => void)[];

  const prev = startCapturingDisposers();
  try {
    startCapturingLifecycle();
    let ctx: Record<string, unknown>;
    try {
      ctx = definition.setup ? definition.setup(props) : {};
    } finally {
      // Always close the lifecycle capture, even when setup throws, so a
      // faulty component cannot poison the next component's capture.
      lifecycle = stopCapturingLifecycle();
    }
    el = definition.render({ ...ctx, $slots: slots });
  } finally {
    disposers = stopCapturingDisposers(prev);
  }

  return {
    el,
    mountCallbacks: lifecycle.mount,
    destroyCallbacks: lifecycle.destroy,
    disposers,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A ComponentDefinition is the object the compiler produces for each .utopia
 * single-file component.
 */
export interface ComponentDefinition {
  /** The `<script>` block compiled into a setup function. */
  setup?(props: Record<string, unknown>): Record<string, unknown>;
  /** The `<template>` block compiled into a render function. */
  render(ctx: Record<string, unknown>): Node;
  /** Scoped CSS extracted from the `<style>` block, if any. */
  styles?: string;
}

/**
 * A live instance of a mounted component.
 */
export interface ComponentInstance {
  /** The root DOM node produced by `render()`. */
  el: Node | null;
  /** The reactive props passed into this component. */
  props: Record<string, unknown>;
  /** Named slots (each value is a factory that returns a DOM subtree). */
  slots: Record<string, () => Node>;
  /** Mount the component's root node into the given target element. */
  mount(target: Element, anchor?: Node): void;
  /** Remove the component's root node from the DOM and clean up styles. */
  unmount(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a `ComponentInstance` from a compiled component definition.
 *
 * The instance is **not** automatically mounted — call `instance.mount()`
 * to attach it to the DOM.
 */
export function createComponentInstance(
  definition: ComponentDefinition,
  props?: Record<string, unknown>,
): ComponentInstance {
  let styleElement: HTMLStyleElement | null = null;
  let disposers: (() => void)[] = [];
  let mountCallbacks: (() => void)[] = [];
  let destroyCallbacks: (() => void)[] = [];

  const instance: ComponentInstance = {
    el: null,
    props: props ?? {},
    slots: {},

    mount(target: Element, anchor?: Node): void {
      if (instance.el) {
        // Already rendered — just move into the DOM.
        target.insertBefore(instance.el, anchor ?? null);
        return;
      }

      // 1. Run setup() to obtain the reactive context (capturing lifecycle
      //    hooks) and 2. render the template to a real DOM subtree — both
      //    inside one disposer-capture scope so setup- and render-created
      //    effects are all disposed on unmount.
      const result = runSetupAndRender(definition, instance.props, instance.slots);
      instance.el = result.el;
      disposers = result.disposers;
      mountCallbacks = result.mountCallbacks;
      destroyCallbacks = result.destroyCallbacks;

      // 3. Insert into the target.
      target.insertBefore(instance.el, anchor ?? null);

      // 4. Inject scoped styles (once).
      if (definition.styles && !styleElement) {
        styleElement = document.createElement('style');
        styleElement.textContent = definition.styles;
        document.head.appendChild(styleElement);
      }

      // 5. Run onMount callbacks after DOM insertion.
      for (const cb of mountCallbacks) {
        cb();
      }
      mountCallbacks = [];
    },

    unmount(): void {
      // Run onDestroy callbacks before teardown.
      for (const cb of destroyCallbacks) {
        cb();
      }
      destroyCallbacks = [];

      // Dispose all reactive effects created during render.
      for (const dispose of disposers) {
        dispose();
      }
      disposers = [];

      if (instance.el && instance.el.parentNode) {
        instance.el.parentNode.removeChild(instance.el);
      }
      instance.el = null;

      // Remove injected style element.
      if (styleElement && styleElement.parentNode) {
        styleElement.parentNode.removeChild(styleElement);
        styleElement = null;
      }
    },
  };

  return instance;
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

/**
 * Mount a root component to the page.
 *
 * ```ts
 * import App from './App.utopia'
 * import { mount } from '@matthesketh/utopia-runtime'
 *
 * mount(App, '#app')
 * ```
 *
 * @param component  The compiled root component definition.
 * @param target     A CSS selector string or a DOM Element to mount into.
 * @returns The `ComponentInstance`, allowing later `unmount()`.
 */
export function mount(component: ComponentDefinition, target: string | Element): ComponentInstance {
  const el = typeof target === 'string' ? document.querySelector(target) : target;

  if (!el) {
    throw new Error(
      `[utopia] Mount target not found: ${typeof target === 'string' ? target : 'Element'}`,
    );
  }

  const instance = createComponentInstance(component);
  instance.mount(el);
  return instance;
}
