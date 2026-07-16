/**
 * Tests for the binding helpers: applyModel (u-model two-way binding) and the
 * normalizeClass / normalizeStyle value normalisers used by :class / :style.
 */

import { describe, expect, it } from 'vitest';

import { signal } from '@matthesketh/utopia-core';

import { applyModel, normalizeClass, normalizeStyle, setAttr, setShow } from '@/index';
import { nextTick } from '@/scheduler';

describe('normalizeClass', () => {
  it('passes a string through', () => {
    expect(normalizeClass('a b')).toBe('a b');
  });

  it('keeps object keys with truthy values', () => {
    expect(normalizeClass({ a: true, b: false, c: 1 })).toBe('a c');
  });

  it('flattens arrays of strings/objects (incl. nested)', () => {
    expect(normalizeClass(['a', { b: true, c: false }, ['d', { e: true }]])).toBe('a b d e');
  });

  it('returns empty string for nullish/other', () => {
    expect(normalizeClass(null)).toBe('');
    expect(normalizeClass(undefined)).toBe('');
    expect(normalizeClass(123)).toBe('');
  });
});

describe('normalizeStyle', () => {
  it('passes a string through', () => {
    expect(normalizeStyle('color: red')).toBe('color: red');
  });

  it('passes an object through', () => {
    expect(normalizeStyle({ color: 'red' })).toEqual({ color: 'red' });
  });

  it('merges an array of objects/strings (later wins)', () => {
    expect(normalizeStyle([{ color: 'red' }, 'color: blue; font-size: 12px'])).toEqual({
      color: 'blue',
      'font-size': '12px',
    });
  });

  it('returns undefined for nullish', () => {
    expect(normalizeStyle(null)).toBeUndefined();
    expect(normalizeStyle(undefined)).toBeUndefined();
  });
});

describe('setAttr class/style with array bindings', () => {
  it('applies an array :class to an element', () => {
    const el = document.createElement('div');
    setAttr(el, 'class', ['chip', { active: true, hidden: false }]);
    expect(el.className).toBe('chip active');
  });

  it('applies an array :style to an element', () => {
    const el = document.createElement('div');
    setAttr(el, 'style', [{ color: 'red' }, { fontSize: '12px' }]);
    expect(el.style.color).toBe('red');
    expect(el.style.fontSize).toBe('12px');
  });
});

describe('setShow', () => {
  it('toggles display and restores the author-set inline value (not block)', async () => {
    const el = document.createElement('div');
    el.style.display = 'flex';
    const vis = signal(true);
    setShow(el, () => vis());
    // shown at start: the original inline display is preserved.
    expect(el.style.display).toBe('flex');
    vis.set(false);
    await nextTick();
    expect(el.style.display).toBe('none');
    vis.set(true);
    await nextTick();
    // restored to what the author set, not clobbered to 'block'.
    expect(el.style.display).toBe('flex');
  });

  it('falls back to the stylesheet display when there is no inline display', async () => {
    const el = document.createElement('div');
    const vis = signal(false);
    setShow(el, () => vis());
    expect(el.style.display).toBe('none');
    vis.set(true);
    await nextTick();
    // empty inline display → the stylesheet rule applies again.
    expect(el.style.display).toBe('');
  });

  it('keeps the same DOM node across a hide/show cycle (state survives)', async () => {
    const el = document.createElement('div');
    const marker = document.createElement('span');
    el.appendChild(marker);
    const vis = signal(true);
    setShow(el, () => vis());
    vis.set(false);
    await nextTick();
    vis.set(true);
    await nextTick();
    // unlike u-if, the child (and any native state) is never torn down.
    expect(el.firstChild).toBe(marker);
  });
});

describe('applyModel', () => {
  it('binds a text input both ways', async () => {
    const el = document.createElement('input');
    const value = signal('hi');
    applyModel(el, value);
    expect(el.value).toBe('hi'); // signal → element (initial)

    el.value = 'bye';
    el.dispatchEvent(new Event('input'));
    expect(value()).toBe('bye'); // element → signal

    value.set('again');
    await nextTick();
    expect(el.value).toBe('again'); // signal → element (reactive)
  });

  it('coerces number inputs to numbers', () => {
    const el = document.createElement('input');
    el.type = 'number';
    const age = signal<number | null>(5);
    applyModel(el, age);
    expect(el.value).toBe('5');

    el.value = '42';
    el.dispatchEvent(new Event('input'));
    expect(age()).toBe(42);

    el.value = '';
    el.dispatchEvent(new Event('input'));
    expect(age()).toBeNull();
  });

  it('trims when the .trim modifier is set', () => {
    const el = document.createElement('input');
    const name = signal('');
    applyModel(el, name, { trim: true });
    el.value = '  Matt  ';
    el.dispatchEvent(new Event('input'));
    expect(name()).toBe('Matt');
  });

  it('uses change instead of input when lazy', () => {
    const el = document.createElement('input');
    const v = signal('');
    applyModel(el, v, { lazy: true });
    el.value = 'typed';
    el.dispatchEvent(new Event('input'));
    expect(v()).toBe(''); // input ignored
    el.dispatchEvent(new Event('change'));
    expect(v()).toBe('typed');
  });

  it('binds a checkbox to a boolean', async () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    const on = signal(false);
    applyModel(el, on);
    expect(el.checked).toBe(false);

    el.checked = true;
    el.dispatchEvent(new Event('change'));
    expect(on()).toBe(true);

    on.set(false);
    await nextTick();
    expect(el.checked).toBe(false);
  });

  it('binds radios to the selected value', async () => {
    const a = document.createElement('input');
    a.type = 'radio';
    a.value = 'a';
    const b = document.createElement('input');
    b.type = 'radio';
    b.value = 'b';
    const choice = signal('a');
    applyModel(a, choice);
    applyModel(b, choice);
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);

    b.checked = true;
    b.dispatchEvent(new Event('change'));
    expect(choice()).toBe('b');

    choice.set('a');
    await nextTick();
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);
  });

  it('binds a select on change', () => {
    const el = document.createElement('select');
    for (const v of ['a', 'b', 'c']) {
      const opt = document.createElement('option');
      opt.value = v;
      el.appendChild(opt);
    }
    const sel = signal('b');
    applyModel(el, sel);
    expect(el.value).toBe('b');

    el.value = 'c';
    el.dispatchEvent(new Event('change'));
    expect(sel()).toBe('c');
  });
});
