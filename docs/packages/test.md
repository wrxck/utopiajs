# @matthesketh/utopia-test

Testing utilities for UtopiaJS components. Designed for use with Vitest and jsdom.

## install

```bash
npm install -D @matthesketh/utopia-test
```

Run tests via:

```bash
utopia test
```

## render()

Mount a component with DOM query helpers. The recommended way to test components.

```ts
import { render } from '@matthesketh/utopia-test'
import Counter from './Counter.utopia'

const { getByText, getBySelector, unmount } = render(Counter)

getByText('count: 0')                     // find by text content, throws if not found
getBySelector('button.increment')         // querySelector, throws if not found
getAllBySelector('li')                     // querySelectorAll, returns Element[]

unmount()                                 // clean up after test
```

`render()` accepts optional `MountOptions`:

```ts
render(Counter, {
  props: { initialCount: 5 },
  target: document.getElementById('test-root')!,
})
```

## mount()

Lower-level mount without query helpers. Returns the container, component instance, and unmount function.

```ts
import { mount } from '@matthesketh/utopia-test'
import MyComponent from './MyComponent.utopia'

const { container, component, unmount } = mount(MyComponent, {
  props: { label: 'hello' },
})

console.log(container.innerHTML)
unmount()
```

## fireEvent

Dispatch DOM events on elements.

```ts
import { render, fireEvent } from '@matthesketh/utopia-test'
import Counter from './Counter.utopia'

const { getBySelector } = render(Counter)
const btn = getBySelector('button')

fireEvent.click(btn)
fireEvent.input(getBySelector('input'), { target: { value: 'hello' } })
fireEvent.submit(getBySelector('form'))
```

## nextTick()

Wait for the next reactive update cycle.

```ts
import { render, fireEvent, nextTick } from '@matthesketh/utopia-test'
import Counter from './Counter.utopia'

const { getBySelector, getByText } = render(Counter)

fireEvent.click(getBySelector('button'))
await nextTick()

getByText('count: 1')
```

## example test

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, nextTick } from '@matthesketh/utopia-test'
import Counter from './Counter.utopia'

describe('Counter', () => {
  let unmount: () => void

  afterEach(() => unmount?.())

  it('increments on click', async () => {
    const result = render(Counter)
    unmount = result.unmount

    result.getByText('count: 0')

    fireEvent.click(result.getBySelector('button'))
    await nextTick()

    result.getByText('count: 1')
  })
})
```
