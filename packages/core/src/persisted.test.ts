// tests for persistedSignal: storage seeding, write-through, cross-instance
// restore, SSR fallback, and corrupt-value tolerance.

import { describe, it, expect, vi } from 'vitest';

import { effect } from '@/index';
import { persistedSignal } from '@/persisted';

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

  it('keeps storage in sync when an effect corrects a locally-set value', () => {
    const storage = memStorage();
    const s = persistedSignal('clamp-local', 5, { storage, syncTabs: false });
    const dispose = effect(() => {
      const v = s();
      if (v > 10) s.set(10);
    });

    s.set(99);
    expect(s()).toBe(10);
    expect(storage.getItem('clamp-local')).toBe('10');
    dispose();
  });

  it('supports assignment through the .value setter', () => {
    const storage = memStorage();
    const s = persistedSignal('val-setter', 1, { storage, syncTabs: false });
    (s as { value: number }).value = 42;
    expect(s()).toBe(42);
    expect(s.value).toBe(42);
    expect(s.peek()).toBe(42);
    expect(storage.getItem('val-setter')).toBe('42');
  });

  it('applies a cross-tab storage event and ignores unrelated ones', () => {
    const key = 'sync-guards-test';
    localStorage.removeItem(key);
    const s = persistedSignal(key, 'a');

    // unrelated key — ignored.
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'other', newValue: '"x"', storageArea: localStorage }),
    );
    expect(s()).toBe('a');

    // removal (newValue null) — ignored.
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: null, storageArea: localStorage }),
    );
    expect(s()).toBe('a');

    // different storage area — ignored.
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: '"x"', storageArea: sessionStorage }),
    );
    expect(s()).toBe('a');

    // matching event — applied.
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: '"b"', storageArea: localStorage }),
    );
    expect(s()).toBe('b');

    // unparseable cross-tab value — ignored, previous value kept.
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: '{broken', storageArea: localStorage }),
    );
    expect(s()).toBe('b');

    s.close();
    localStorage.removeItem(key);
  });

  it('stops applying cross-tab events after close()', () => {
    const key = 'close-test';
    localStorage.removeItem(key);
    const s = persistedSignal(key, 1);
    s.close();
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: '2', storageArea: localStorage }),
    );
    expect(s()).toBe(1);
    // closing twice is safe.
    s.close();
    localStorage.removeItem(key);
  });

  it('keeps the value in memory when the storage write fails (quota)', () => {
    const storage = memStorage();
    const s = persistedSignal('quota', 1, { storage, syncTabs: false });
    const failingSet = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    s.set(2);
    expect(s()).toBe(2); // in-memory value updated
    expect(storage.getItem('quota')).toBe('1'); // storage unchanged
    failingSet.mockRestore();
  });

  it('behaves as an in-memory signal when no storage backend exists at all', () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      const s = persistedSignal('no-storage', 5);
      expect(s()).toBe(5);
      s.set(6);
      expect(s()).toBe(6);
      s.update((n) => n + 1);
      expect(s()).toBe(7);
      s.close(); // no listener attached — must not throw
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('persists a write made by an effect reacting to a cross-tab update', () => {
    // an effect that clamps/normalises the value in response to a cross-tab
    // update issues a legitimate local set() — it must reach storage, not be
    // swallowed by the remote-update guard.
    const key = 'persist-clamp-test';
    localStorage.removeItem(key);
    const s = persistedSignal(key, 5);
    const dispose = effect(() => {
      const v = s();
      if (v > 10) s.set(10);
    });

    // simulate another tab writing 99 to the same key.
    localStorage.setItem(key, '99');
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: '99', storageArea: localStorage }),
    );

    expect(s()).toBe(10);
    expect(localStorage.getItem(key)).toBe('10');

    dispose();
    s.close();
    localStorage.removeItem(key);
  });
});
