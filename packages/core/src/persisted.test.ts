// tests for persistedSignal: storage seeding, write-through, cross-instance
// restore, SSR fallback, and corrupt-value tolerance.

import { describe, it, expect } from 'vitest';

import { persistedSignal } from './persisted';

// a minimal in-memory Storage implementation for deterministic tests.
function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => map.set(k, String(v)),
  } as Storage;
}

describe('persistedSignal', () => {
  it('seeds from the initial value and writes it through to storage', () => {
    const storage = memStorage();
    const s = persistedSignal('count', 0, { storage, syncTabs: false });
    expect(s()).toBe(0);
    expect(storage.getItem('count')).toBe('0');
  });

  it('persists updates on set', () => {
    const storage = memStorage();
    const s = persistedSignal('count', 0, { storage, syncTabs: false });
    s.set(5);
    expect(s()).toBe(5);
    expect(storage.getItem('count')).toBe('5');
  });

  it('restores a previously stored value (ignoring the initial)', () => {
    const storage = memStorage();
    storage.setItem('theme', JSON.stringify('light'));
    const s = persistedSignal('theme', 'dark', { storage, syncTabs: false });
    expect(s()).toBe('light');
  });

  it('falls back to the initial value when storage is absent (SSR-safe)', () => {
    const s = persistedSignal('x', 42, { storage: undefined, syncTabs: false });
    // no localStorage in the node test env → behaves as an in-memory signal.
    expect(s()).toBe(42);
    s.set(43);
    expect(s()).toBe(43);
  });

  it('keeps the initial value when the stored value is corrupt', () => {
    const storage = memStorage();
    storage.setItem('obj', '{not valid json');
    const s = persistedSignal('obj', { ok: true }, { storage, syncTabs: false });
    expect(s()).toEqual({ ok: true });
  });

  it('supports update()', () => {
    const storage = memStorage();
    const s = persistedSignal('n', 1, { storage, syncTabs: false });
    s.update((n) => n + 9);
    expect(s()).toBe(10);
    expect(storage.getItem('n')).toBe('10');
  });
});
