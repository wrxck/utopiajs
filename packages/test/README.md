# @matthesketh/utopia-test

Testing utilities for UtopiaJS components. Mount components in jsdom, query the DOM, and simulate events.

## Install

```bash
pnpm add -D @matthesketh/utopia-test vitest
```

## Usage

Write tests inside `<test>` blocks in your `.utopia` files:

```html
<template>
  <button @click="increment">Count: {{ count() }}</button>
</template>

<script>
import { signal } from '@matthesketh/utopia-core';
const count = signal(0);
const increment = () => count.set(count() + 1);
</script>

<test>
import { describe, it, expect } from 'vitest';
import { render, fireEvent, nextTick } from '@matthesketh/utopia-test';

describe('Counter', () => {
  it('increments on click', async () => {
    const { getByText } = render(self);
    const btn = getByText('Count: 0');
    fireEvent.click(btn);
    await nextTick();
    expect(btn.textContent).toBe('Count: 1');
  });
});
</test>
```

Run with:

```bash
utopia test
```

The `self` import is auto-generated — it refers to the component defined in the same file.

## API

### `mount(definition, options?)`

Mount a component into the DOM.

```ts
const { container, component, unmount } = mount(MyComponent, {
  props: { title: 'Hello' },
});
```

**Returns:** `{ container, component, unmount }`

### `render(definition, options?)`

Mount a component with query helpers.

```ts
const { getBySelector, getAllBySelector, getByText, unmount } = render(MyComponent);
```

**Returns:** Everything from `mount()` plus:

| Helper | Description |
|--------|-------------|
| `getBySelector(css)` | Query one element by CSS selector (throws if not found) |
| `getAllBySelector(css)` | Query all matching elements |
| `getByText(text \| RegExp)` | Find element by text content (throws if not found) |

### `fireEvent`

Simulate DOM events:

```ts
fireEvent.click(element);
fireEvent.input(element);
fireEvent.change(element);
fireEvent.submit(element);
fireEvent.keydown(element, { key: 'Enter' });
fireEvent.keyup(element);
fireEvent.focus(element);
fireEvent.blur(element);
fireEvent.custom(element, 'my-event', { detail: 42 });
```

### `nextTick()`

Wait for pending signal effects to flush. Re-exported from `@matthesketh/utopia-runtime`.

```ts
count.set(5);
await nextTick();
expect(el.textContent).toBe('5');
```

## Vitest Plugin

The package also exports a Vite/Vitest plugin at `@matthesketh/utopia-test/plugin`:

```ts
import { utopiaTestPlugin } from '@matthesketh/utopia-test/plugin';
```

This plugin extracts `<test>` blocks from `.utopia` files and generates companion `.utopia.test.ts` files that vitest discovers automatically. Generated files are cleaned up after the test run.

The `utopia test` CLI command injects this plugin automatically — you only need the manual import if configuring vitest yourself.

## License

MIT
