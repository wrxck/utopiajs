/**
 * @matthesketh/utopia-test — Event simulation utilities
 *
 * Provides typed helpers for dispatching DOM events in tests.
 */

type EventInit = Record<string, unknown>;

function dispatch(element: Element, event: Event): void {
  element.dispatchEvent(event);
}

function createMouseEvent(type: string, init?: EventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

function createInputEvent(type: string, init?: EventInit): Event {
  return new Event(type, { bubbles: true, cancelable: true, ...init });
}

function createKeyboardEvent(type: string, init?: EventInit): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
}

function createFocusEvent(type: string, init?: EventInit): FocusEvent {
  return new FocusEvent(type, { bubbles: true, cancelable: true, ...init });
}

export const fireEvent = {
  /** Dispatch a click event. */
  click(element: Element, init?: EventInit): void {
    dispatch(element, createMouseEvent('click', init));
  },

  /** Dispatch an input event. */
  input(element: Element, init?: EventInit): void {
    dispatch(element, createInputEvent('input', init));
  },

  /** Dispatch a change event. */
  change(element: Element, init?: EventInit): void {
    dispatch(element, createInputEvent('change', init));
  },

  /** Dispatch a submit event. */
  submit(element: Element, init?: EventInit): void {
    dispatch(element, new Event('submit', { bubbles: true, cancelable: true, ...init }));
  },

  /** Dispatch a keydown event. */
  keydown(element: Element, init?: EventInit): void {
    dispatch(element, createKeyboardEvent('keydown', init));
  },

  /** Dispatch a keyup event. */
  keyup(element: Element, init?: EventInit): void {
    dispatch(element, createKeyboardEvent('keyup', init));
  },

  /** Dispatch a focus event. */
  focus(element: Element, init?: EventInit): void {
    dispatch(element, createFocusEvent('focus', init));
  },

  /** Dispatch a blur event. */
  blur(element: Element, init?: EventInit): void {
    dispatch(element, createFocusEvent('blur', init));
  },

  /** Dispatch a custom event. */
  custom(element: Element, type: string, init?: EventInit): void {
    dispatch(element, new CustomEvent(type, { bubbles: true, cancelable: true, ...init }));
  },
};
