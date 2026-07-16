/**
 * @matthesketh/utopia-runtime — Two-way binding (u-model)
 *
 * The compiler emits `applyModel(el, signal, opts)` for a `u-model="signal"`
 * directive. This wires the element's value to the signal in both directions,
 * picking the right property + event for the element kind so a single directive
 * works across text inputs, checkboxes, radios, selects, number/range and
 * textareas.
 */

import { effect } from '@matthesketh/utopia-core';

import { pushDisposer } from '@/component';

/** A writable signal — the value u-model binds to. */
interface ModelSignal {
  (): unknown;
  set(value: unknown): void;
}

/** Modifiers parsed from `u-model.number`, `.trim`, `.lazy`. */
interface ModelOptions {
  /** Coerce the bound value to a number (also implied by type=number/range). */
  number?: boolean;
  /** Trim whitespace from string values. */
  trim?: boolean;
  /** Sync on `change` instead of `input` (commit on blur/enter). */
  lazy?: boolean;
}

/**
 * Bind a form control to a signal in both directions. Captures its effect and
 * listener with the surrounding component scope so both are torn down on unmount.
 */
export function applyModel(el: Element, signal: ModelSignal, opts: ModelOptions = {}): void {
  const type = ((el as HTMLInputElement).type || '').toLowerCase();

  // checkbox: signal holds a boolean, mirrored to `checked`.
  if (type === 'checkbox') {
    const input = el as HTMLInputElement;
    pushDisposer(
      effect(() => {
        input.checked = !!signal();
      }),
    );
    const onChange = (): void => signal.set(input.checked);
    input.addEventListener('change', onChange);
    pushDisposer(() => input.removeEventListener('change', onChange));
    return;
  }

  // radio: signal holds the selected value; this radio is checked when it matches.
  if (type === 'radio') {
    const input = el as HTMLInputElement;
    pushDisposer(
      effect(() => {
        input.checked = signal() === input.value;
      }),
    );
    const onChange = (): void => {
      if (input.checked) signal.set(input.value);
    };
    input.addEventListener('change', onChange);
    pushDisposer(() => input.removeEventListener('change', onChange));
    return;
  }

  // text-like (input/textarea/select): signal holds the value string/number.
  const valueEl = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const isSelect = el.tagName === 'SELECT';
  const isNumber = opts.number || type === 'number' || type === 'range';
  const evt = opts.lazy || isSelect ? 'change' : 'input';

  pushDisposer(
    effect(() => {
      const v = signal();
      const next = v == null ? '' : String(v);
      if (valueEl.value !== next) {
        valueEl.value = next;
        // a <select> bound before its u-for options mount cannot take the value
        // yet; retry once so the displayed selection matches the bound signal.
        if (isSelect && valueEl.value !== next) {
          const want = next;
          requestAnimationFrame(() => {
            if (valueEl.isConnected && valueEl.value !== want) valueEl.value = want;
          });
        }
      }
    }),
  );

  const onInput = (): void => {
    let v: unknown = valueEl.value;
    if (isNumber) {
      if (v === '') {
        v = null;
      } else {
        const n = parseFloat(v as string);
        v = Number.isNaN(n) ? valueEl.value : n;
      }
    } else if (opts.trim) {
      v = (v as string).trim();
    }
    signal.set(v);
  };
  valueEl.addEventListener(evt, onInput);
  pushDisposer(() => valueEl.removeEventListener(evt, onInput));
}
