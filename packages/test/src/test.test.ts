/**
 * Tests for @matthesketh/utopia-test
 */

import { signal } from '@matthesketh/utopia-core';
import type { ComponentDefinition } from '@matthesketh/utopia-runtime';
import {
  addEventListener,
  appendChild,
  createComponent,
  createEffect,
  createElement,
  createIf,
  createTextNode,
  inject,
  provide,
  setAttr,
  setText,
} from '@matthesketh/utopia-runtime';
import { afterEach, describe, expect, it } from 'vitest';

import { fireEvent, mount, nextTick, render } from '@/index';

// ---------------------------------------------------------------------------
// Test fixtures — manually-defined ComponentDefinitions
// ---------------------------------------------------------------------------

/** A simple static component. */
const StaticComponent: ComponentDefinition = {
  render() {
    const div = createElement('div');
    const text = createTextNode('Hello World');
    appendChild(div, text);
    return div;
  },
};

/** A component with reactive text. */
function createCounterComponent(): ComponentDefinition {
  return {
    render() {
      const count = signal(0);

      const div = createElement('div');

      const p = createElement('p');
      const text = createTextNode('');
      createEffect(() => {
        setText(text, String(count()));
      });
      appendChild(p, text);
      appendChild(div, p);

      const btn = createElement('button');
      const btnText = createTextNode('increment');
      appendChild(btn, btnText);
      addEventListener(btn, 'click', () => {
        count.set(count() + 1);
      });
      appendChild(div, btn);

      return div;
    },
  };
}

/** A component with props. */
const PropsComponent: ComponentDefinition = {
  setup(props) {
    return props;
  },
  render(ctx) {
    const div = createElement('div');
    const text = createTextNode('');
    createEffect(() => {
      const msg =
        typeof ctx.message === 'function'
          ? (ctx.message as () => string)()
          : String(ctx.message ?? '');
      setText(text, msg);
    });
    appendChild(div, text);
    return div;
  },
};

/** A component with multiple elements. */
const MultiElementComponent: ComponentDefinition = {
  render() {
    const div = createElement('div');

    const h1 = createElement('h1');
    appendChild(h1, createTextNode('Title'));
    appendChild(div, h1);

    const p = createElement('p');
    appendChild(p, createTextNode('Description'));
    appendChild(div, p);

    const span = createElement('span');
    setAttr(span, 'class', 'badge');
    appendChild(span, createTextNode('Tag'));
    appendChild(div, span);

    return div;
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mount()', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('mounts a component into a container', () => {
    const result = mount(StaticComponent);
    cleanup = result.unmount;

    expect(result.container).toBeInstanceOf(HTMLElement);
    expect(result.container.parentNode).toBe(document.body);
    expect(result.container.textContent).toBe('Hello World');
  });

  it('returns the component instance', () => {
    const result = mount(StaticComponent);
    cleanup = result.unmount;

    expect(result.component).toBeDefined();
    expect(result.component.el).toBeInstanceOf(Node);
  });

  it('unmount() removes the container from the DOM', () => {
    const result = mount(StaticComponent);
    expect(result.container.parentNode).toBe(document.body);

    result.unmount();
    expect(result.container.parentNode).toBeNull();
  });

  it('accepts a custom target element', () => {
    const target = document.createElement('section');
    document.body.appendChild(target);

    const result = mount(StaticComponent, { target });
    cleanup = () => {
      result.unmount();
      target.remove();
    };

    expect(result.container).toBe(target);
    expect(target.textContent).toBe('Hello World');
  });

  it('passes props to the component', () => {
    const result = mount(PropsComponent, { props: { message: 'hi' } });
    cleanup = result.unmount;

    expect(result.container.textContent).toBe('hi');
  });

  it('unmount() tolerates a target that was never attached to the DOM', () => {
    const target = document.createElement('div');
    const result = mount(StaticComponent, { target });

    expect(target.parentNode).toBeNull();
    expect(() => result.unmount()).not.toThrow();
  });
});

describe('render()', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('provides getBySelector', () => {
    const result = render(MultiElementComponent);
    cleanup = result.unmount;

    const h1 = result.getBySelector('h1');
    expect(h1.textContent).toBe('Title');
  });

  it('getBySelector throws when not found', () => {
    const result = render(MultiElementComponent);
    cleanup = result.unmount;

    expect(() => result.getBySelector('.nonexistent')).toThrow(/no element found/);
  });

  it('provides getAllBySelector', () => {
    const result = render(MultiElementComponent);
    cleanup = result.unmount;

    const elements = result.getAllBySelector('h1, p, span');
    expect(elements.length).toBe(3);
  });

  it('provides getByText with string', () => {
    const result = render(MultiElementComponent);
    cleanup = result.unmount;

    const el = result.getByText('Description');
    expect(el.tagName).toBe('P');
  });

  it('provides getByText with RegExp', () => {
    const result = render(MultiElementComponent);
    cleanup = result.unmount;

    const el = result.getByText(/^Title$/);
    expect(el.tagName).toBe('H1');
  });

  it('getByText throws when not found', () => {
    const result = render(MultiElementComponent);
    cleanup = result.unmount;

    expect(() => result.getByText('Not here')).toThrow(/no element found/);
  });

  it('getByText mentions the pattern when a RegExp match fails', () => {
    const result = render(MultiElementComponent);
    cleanup = result.unmount;

    expect(() => result.getByText(/^Not here$/)).toThrow(/\/\^Not here\$\//);
  });
});

describe('fireEvent', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('fires click events', async () => {
    const result = render(createCounterComponent());
    cleanup = result.unmount;

    const btn = result.getBySelector('button');
    const p = result.getBySelector('p');

    expect(p.textContent).toBe('0');

    fireEvent.click(btn);
    await nextTick();

    expect(p.textContent).toBe('1');
  });

  it('fires input events', () => {
    let received = false;
    const comp: ComponentDefinition = {
      render() {
        const input = createElement('input') as HTMLInputElement;
        addEventListener(input, 'input', () => {
          received = true;
        });
        return input;
      },
    };

    const result = mount(comp);
    cleanup = result.unmount;

    fireEvent.input(result.container.querySelector('input')!);
    expect(received).toBe(true);
  });

  it('fires change events', () => {
    let received = false;
    const comp: ComponentDefinition = {
      render() {
        const select = createElement('select');
        addEventListener(select, 'change', () => {
          received = true;
        });
        return select;
      },
    };

    const result = mount(comp);
    cleanup = result.unmount;

    fireEvent.change(result.container.querySelector('select')!);
    expect(received).toBe(true);
  });

  it('fires submit events', () => {
    let received = false;
    const comp: ComponentDefinition = {
      render() {
        const form = createElement('form');
        addEventListener(form, 'submit', (e: Event) => {
          e.preventDefault();
          received = true;
        });
        return form;
      },
    };

    const result = mount(comp);
    cleanup = result.unmount;

    fireEvent.submit(result.container.querySelector('form')!);
    expect(received).toBe(true);
  });

  it('fires keyboard events', () => {
    const keys: string[] = [];
    const comp: ComponentDefinition = {
      render() {
        const input = createElement('input');
        addEventListener(input, 'keydown', (e: Event) => {
          keys.push(`down:${(e as KeyboardEvent).key}`);
        });
        addEventListener(input, 'keyup', (e: Event) => {
          keys.push(`up:${(e as KeyboardEvent).key}`);
        });
        return input;
      },
    };

    const result = mount(comp);
    cleanup = result.unmount;

    const input = result.container.querySelector('input')!;
    fireEvent.keydown(input, { key: 'Enter' });
    fireEvent.keyup(input, { key: 'Enter' });
    expect(keys).toEqual(['down:Enter', 'up:Enter']);
  });

  it('fires focus and blur events', () => {
    let focused = false;
    const comp: ComponentDefinition = {
      render() {
        const input = createElement('input');
        addEventListener(input, 'focus', () => {
          focused = true;
        });
        addEventListener(input, 'blur', () => {
          focused = false;
        });
        return input;
      },
    };

    const result = mount(comp);
    cleanup = result.unmount;

    const input = result.container.querySelector('input')!;
    fireEvent.focus(input);
    expect(focused).toBe(true);

    fireEvent.blur(input);
    expect(focused).toBe(false);
  });

  it('fires custom events', () => {
    let received = false;
    const comp: ComponentDefinition = {
      render() {
        const div = createElement('div');
        addEventListener(div, 'my-event', () => {
          received = true;
        });
        return div;
      },
    };

    const result = mount(comp);
    cleanup = result.unmount;

    fireEvent.custom(result.container.querySelector('div')!, 'my-event');
    expect(received).toBe(true);
  });
});

describe('nextTick()', () => {
  it('resolves as a promise', async () => {
    const result = await nextTick();
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// per-instance components — the exact shape the compiler emits for defineProps
// ---------------------------------------------------------------------------

/**
 * mirrors the compiler's defineProps output:
 *   function __setup(__props) { ...script...; function __render(_ctx){...}; return { __render } }
 *   export default { setup: __setup, render: (__ctx) => __ctx.__render(__ctx) }
 */
function makePerInstanceChild(): ComponentDefinition {
  function __setup(__props: Record<string, unknown>) {
    const { label } = __props as { label: () => string };
    const count = signal(0);
    function __render(): Node {
      const span = createElement('span');
      const t = createTextNode('');
      createEffect(() => setText(t, `${label()}:${count()}`));
      appendChild(span, t);
      addEventListener(span, 'click', () => count.set(count() + 1));
      return span;
    }
    return { __render, count };
  }
  return {
    setup: __setup,
    render: (__ctx: Record<string, unknown>) => (__ctx.__render as (c: unknown) => Node)(__ctx),
  };
}

describe('createIf with a deferred-parent anchor', () => {
  it('renders the branch once the anchor is connected later', async () => {
    const cond = signal(true);
    const anchor = document.createComment('if');
    // do not connect the anchor yet — mimics an else-if branch whose anchor is
    // only inserted after its factory returns.
    const dispose = createIf(
      anchor,
      () => cond(),
      () => {
        const s = createElement('span');
        appendChild(s, createTextNode('T'));
        return s;
      },
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    // nothing rendered while detached; connect, then flush the microtask retry.
    host.appendChild(anchor);
    await Promise.resolve();
    expect(host.textContent).toBe('T');
    dispose();
    document.body.removeChild(host);
  });
});

describe('defineProps emitted shape', () => {
  it('setup receives props and a signal passed as a prop stays reactive', async () => {
    const name = signal('a');
    const node = createComponent(makePerInstanceChild(), { label: name });
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.appendChild(node);

    expect(host.textContent).toBe('a:0');
    name.set('b');
    await nextTick();
    expect(host.textContent).toBe('b:0');
    document.body.removeChild(host);
  });

  it('disposes effects created in setup() when the instance unmounts', async () => {
    let runs = 0;
    const tick = signal(0);
    const def: ComponentDefinition = {
      setup() {
        // a setup-phase effect must be captured and torn down on unmount.
        createEffect(() => {
          tick();
          runs++;
        });
        return { __render: () => createElement('div') };
      },
      render: (ctx: Record<string, unknown>) => (ctx.__render as () => Node)(),
    };
    const node = createComponent(def);
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.appendChild(node);

    expect(runs).toBe(1);
    tick.set(1);
    await nextTick();
    expect(runs).toBe(2);

    // unmount via the cleanup the runtime attaches to the node.
    (node as unknown as { __cleanup: () => void }).__cleanup();
    tick.set(2);
    await nextTick();
    expect(runs).toBe(2); // disposed → no further runs
    document.body.removeChild(host);
  });

  it('each instance gets isolated internal state', async () => {
    const def = makePerInstanceChild();
    const shared = signal('x');
    const a = createComponent(def, { label: shared }) as HTMLElement;
    const b = createComponent(def, { label: shared }) as HTMLElement;
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.appendChild(a);
    host.appendChild(b);

    // bump only the first instance's internal counter.
    a.dispatchEvent(new Event('click'));
    await nextTick();
    expect(a.textContent).toBe('x:1');
    expect(b.textContent).toBe('x:0');
    document.body.removeChild(host);
  });
});

describe('provide / inject context', () => {
  const KEY = Symbol('theme');

  it('a descendant injects a value provided by an ancestor', () => {
    let seen: string | undefined;
    const child: ComponentDefinition = {
      setup() {
        seen = inject<string>(KEY);
        return {};
      },
      render: () => createElement('span'),
    };
    const parent: ComponentDefinition = {
      setup() {
        provide(KEY, 'dark');
        return {};
      },
      // create the child during the parent's render so it links to the parent owner.
      render: () => {
        const root = createElement('div');
        appendChild(root, createComponent(child));
        return root;
      },
    };
    const result = mount(parent);
    expect(seen).toBe('dark');
    result.unmount();
  });

  it('inject returns the fallback when nothing was provided', () => {
    let seen: string | undefined;
    const lone: ComponentDefinition = {
      setup() {
        seen = inject<string>(KEY, 'light');
        return {};
      },
      render: () => createElement('span'),
    };
    const result = mount(lone);
    expect(seen).toBe('light');
    result.unmount();
  });

  it('a nearer ancestor shadows a farther one', () => {
    let seen: string | undefined;
    const grandchild: ComponentDefinition = {
      setup() {
        seen = inject<string>(KEY);
        return {};
      },
      render: () => createElement('span'),
    };
    const middle: ComponentDefinition = {
      setup() {
        provide(KEY, 'inner');
        return {};
      },
      render: () => {
        const root = createElement('div');
        appendChild(root, createComponent(grandchild));
        return root;
      },
    };
    const outer: ComponentDefinition = {
      setup() {
        provide(KEY, 'outer');
        return {};
      },
      render: () => {
        const root = createElement('div');
        appendChild(root, createComponent(middle));
        return root;
      },
    };
    const result = mount(outer);
    expect(seen).toBe('inner');
    result.unmount();
  });
});
