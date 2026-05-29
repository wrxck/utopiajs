// regression test for the v0.8 helmet hardening pass: descriptor values are
// escaped before being interpolated into a querySelector, so a crafted value
// cannot throw a SyntaxError out of the reactive head update.

import { describe, it, expect, afterEach } from 'vitest';

import { setMeta, resetHead } from './head';

describe('helmet builds safe attribute selectors', () => {
  afterEach(() => resetHead());

  it('does not throw when a descriptor value contains a quote/bracket', () => {
    expect(() => setMeta({ name: 'x"]injection', content: 'v' })).not.toThrow();
    expect(document.head.querySelector('meta[content="v"]')).not.toBeNull();
  });

  it('updates rather than duplicates a meta on repeated calls', () => {
    setMeta({ name: 'description', content: 'first' });
    setMeta({ name: 'description', content: 'second' });
    expect(document.head.querySelectorAll('meta[name="description"]').length).toBe(1);
  });
});
