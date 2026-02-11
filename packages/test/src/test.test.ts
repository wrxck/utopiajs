/**
 * Tests for @matthesketh/utopia-test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mount, render, fireEvent, nextTick } from './index';
import { signal } from '@matthesketh/utopia-core';
import type { ComponentDefinition } from '@matthesketh/utopia-runtime';
import {
  createElement,
  createTextNode,
  setText,
  appendChild,
  addEventListener,
  setAttr,
  createEffect,
} from '@matthesketh/utopia-runtime';

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
    let key = '';
    const comp: ComponentDefinition = {
      render() {
        const input = createElement('input');
        addEventListener(input, 'keydown', (e: Event) => {
          key = (e as KeyboardEvent).key;
        });
        return input;
      },
    };

    const result = mount(comp);
    cleanup = result.unmount;

    fireEvent.keydown(result.container.querySelector('input')!, { key: 'Enter' });
    expect(key).toBe('Enter');
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
