/**
 * @matthesketh/utopia-test — Component rendering utilities
 *
 * Provides mount() and render() for testing .utopia components in jsdom.
 */

import {
  createComponentInstance,
  type ComponentDefinition,
  type ComponentInstance,
} from '@matthesketh/utopia-runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MountOptions {
  /** Props to pass to the component. */
  props?: Record<string, unknown>;
  /** Target element to mount into. Defaults to a new <div> appended to body. */
  target?: HTMLElement;
}

export interface MountResult {
  /** The container element the component was mounted into. */
  container: HTMLElement;
  /** The component instance. */
  component: ComponentInstance;
  /** Unmount the component and clean up the container. */
  unmount: () => void;
}

export interface RenderResult extends MountResult {
  /** Query a single element by CSS selector. Throws if not found. */
  getBySelector: (selector: string) => Element;
  /** Query all elements by CSS selector. */
  getAllBySelector: (selector: string) => Element[];
  /** Find an element by its text content. Throws if not found. */
  getByText: (text: string | RegExp) => Element;
}

// ---------------------------------------------------------------------------
// mount()
// ---------------------------------------------------------------------------

/**
 * Mount a component into the DOM for testing.
 *
 * Creates a container `<div>`, appends it to `document.body`, and mounts
 * the component into it.
 */
export function mount(definition: ComponentDefinition, options: MountOptions = {}): MountResult {
  const container = options.target ?? document.createElement('div');

  if (!options.target) {
    document.body.appendChild(container);
  }

  const instance = createComponentInstance(definition, options.props);
  instance.mount(container);

  return {
    container,
    component: instance,
    unmount() {
      instance.unmount();
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

/**
 * Render a component with query helpers for testing.
 *
 * Extends `mount()` with `getBySelector`, `getAllBySelector`, and `getByText`.
 */
export function render(definition: ComponentDefinition, options: MountOptions = {}): RenderResult {
  const result = mount(definition, options);

  return {
    ...result,

    getBySelector(selector: string): Element {
      const el = result.container.querySelector(selector);
      if (!el) {
        throw new Error(`[utopia-test] getBySelector: no element found for selector "${selector}"`);
      }
      return el;
    },

    getAllBySelector(selector: string): Element[] {
      return Array.from(result.container.querySelectorAll(selector));
    },

    getByText(text: string | RegExp): Element {
      const walker = document.createTreeWalker(result.container, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const content = node.textContent ?? '';
        const matches = typeof text === 'string' ? content.includes(text) : text.test(content);
        if (matches && node.parentElement) {
          return node.parentElement;
        }
      }
      throw new Error(
        `[utopia-test] getByText: no element found with text ${typeof text === 'string' ? `"${text}"` : text}`,
      );
    },
  };
}
