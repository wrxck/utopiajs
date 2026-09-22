// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { useHead } from '@/index';

describe('useHead on a server', () => {
  it('is a no-op instead of failing on the missing document', () => {
    // the effect used to throw a ReferenceError on `document`, which the
    // reactive core reported as an effect error on every server render.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(() => useHead(() => ({ title: 'x' }))()).not.toThrow();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
