// ============================================================================
// @matthesketh/utopia-core — Persisted signals (synced to localStorage)
// ============================================================================

import { signal, type Signal } from './index';

export interface PersistedSignalOptions<T> {
  /** serialise before writing to storage (default JSON.stringify). */
  serialize?: (value: T) => string;
  /** deserialise a stored string (default JSON.parse). */
  deserialize?: (raw: string) => T;
  /**
   * storage backend (default `localStorage`). pass `sessionStorage` for
   * per-session persistence. ignored when no storage is available (e.g. SSR).
   */
  storage?: Storage;
  /**
   * sync the value across tabs via the `storage` event (default true). when a
   * different tab writes the same key, this signal updates to match.
   */
  syncTabs?: boolean;
}

export interface PersistedSignal<T> extends Signal<T> {
  /** stop syncing across tabs and detach the storage listener. */
  close(): void;
}

/**
 * a signal whose value is persisted to web storage and restored on reload.
 *
 * ```ts
 * const theme = persistedSignal('theme', 'dark');
 * theme.set('light'); // written to localStorage['theme']
 * ```
 *
 * SSR-safe: when no storage backend exists the signal behaves like a plain
 * in-memory signal seeded with `initialValue`.
 */
export function persistedSignal<T>(
  key: string,
  initialValue: T,
  options: PersistedSignalOptions<T> = {},
): PersistedSignal<T> {
  const serialize = options.serialize ?? JSON.stringify;
  const deserialize = options.deserialize ?? (JSON.parse as (raw: string) => T);
  const syncTabs = options.syncTabs ?? true;

  const store: Storage | null =
    options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);

  // seed from storage if a value is present, otherwise fall back to the initial.
  let start = initialValue;
  if (store) {
    const raw = store.getItem(key);
    if (raw !== null) {
      try {
        start = deserialize(raw);
      } catch {
        // corrupt/foreign value — keep the initial rather than throwing.
      }
    }
  }

  const inner = signal(start);
  let suppress = false;

  const write = (v: T): void => {
    if (!store) return;
    try {
      store.setItem(key, serialize(v));
    } catch {
      // quota exceeded / disabled storage — value stays in-memory only.
    }
  };

  // persist the seed only if storage had nothing yet, so first read is sticky.
  if (store && store.getItem(key) === null) {
    write(start);
  }

  let onStorage: ((ev: StorageEvent) => void) | null = null;
  if (store && syncTabs && typeof window !== 'undefined') {
    onStorage = (ev: StorageEvent) => {
      if (ev.key !== key || ev.storageArea !== store || ev.newValue === null) return;
      suppress = true;
      try {
        inner.set(deserialize(ev.newValue));
      } catch {
        // ignore an unparseable cross-tab value.
      } finally {
        suppress = false;
      }
    };
    window.addEventListener('storage', onStorage);
  }

  const wrapped = (() => inner()) as PersistedSignal<T>;
  Object.defineProperty(wrapped, 'value', {
    get: () => inner(),
    set: (v: T) => (wrapped as unknown as { set(x: T): void }).set(v),
  });
  (wrapped as unknown as { set(x: T): void }).set = (v: T) => {
    inner.set(v);
    if (!suppress) write(v);
  };
  (wrapped as unknown as { peek(): T }).peek = () => inner.peek();
  (wrapped as unknown as { update(fn: (c: T) => T): void }).update = (fn) =>
    (wrapped as unknown as { set(x: T): void }).set(fn(inner.peek()));
  wrapped.close = () => {
    if (onStorage && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
      onStorage = null;
    }
  };

  return wrapped;
}
