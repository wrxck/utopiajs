// ============================================================================
// @matthesketh/utopia-core — Shared signals (cross-tab state sync)
// ============================================================================
//
// Provides `sharedSignal()`, a signal that automatically synchronizes its
// value across browser tabs/windows of the same origin using the
// BroadcastChannel API.
//
// On the server (SSR) or in environments without BroadcastChannel, it
// falls back to a regular signal with no cross-tab behavior.
// ============================================================================

import { signal, type Signal } from './index.js';

/**
 * Options for creating a shared signal.
 */
export interface SharedSignalOptions<T> {
  /** Custom serializer (default: JSON.stringify). */
  serialize?: (value: T) => string;
  /** Custom deserializer (default: JSON.parse). */
  deserialize?: (raw: string) => T;
}

/**
 * A shared signal that syncs across browser tabs via BroadcastChannel.
 * Extends the standard Signal interface with a `close()` method to
 * tear down the channel.
 */
export interface SharedSignal<T> extends Signal<T> {
  /** Close the BroadcastChannel and stop syncing. */
  close(): void;
}

/**
 * Creates a reactive signal that synchronizes its value across browser
 * tabs/windows using the BroadcastChannel API.
 *
 * ```ts
 * const theme = sharedSignal('theme', 'light');
 *
 * // Setting in one tab updates all other tabs:
 * theme.set('dark');
 *
 * // Clean up when done:
 * theme.close();
 * ```
 *
 * @param key          A unique channel name for this shared state.
 * @param initialValue The initial value (used if no other tab has broadcast yet).
 * @param options      Optional custom serialization.
 * @returns A SharedSignal with cross-tab sync.
 */
export function sharedSignal<T>(
  key: string,
  initialValue: T,
  options?: SharedSignalOptions<T>,
): SharedSignal<T> {
  const serialize = options?.serialize ?? JSON.stringify;
  const deserialize = options?.deserialize ?? JSON.parse;

  const inner = signal<T>(initialValue);

  // No BroadcastChannel (SSR / older browsers) — return a plain signal.
  if (typeof BroadcastChannel === 'undefined') {
    return Object.assign(inner, { close: () => {} }) as SharedSignal<T>;
  }

  const channel = new BroadcastChannel(`utopia:shared:${key}`);
  let isRemoteUpdate = false;

  // Listen for updates from other tabs.
  channel.onmessage = (event: MessageEvent) => {
    try {
      const value = deserialize(event.data);
      isRemoteUpdate = true;
      inner.set(value);
      isRemoteUpdate = false;
    } catch {
      // Ignore malformed messages.
    }
  };

  // Wrap .set() to broadcast changes to other tabs.
  const originalSet = inner.set.bind(inner);
  const broadcastSet = (newValue: T): void => {
    originalSet(newValue);
    // Only broadcast if this was a local change (not a remote update).
    if (!isRemoteUpdate) {
      try {
        channel.postMessage(serialize(newValue));
      } catch {
        // Ignore serialization failures.
      }
    }
  };

  // Wrap .update() to go through broadcastSet.
  const broadcastUpdate = (fn: (current: T) => T): void => {
    broadcastSet(fn(inner.peek()));
  };

  // Build the SharedSignal by re-assigning set/update and adding close.
  const shared = inner as unknown as SharedSignal<T>;
  (shared as any).set = broadcastSet;
  (shared as any).update = broadcastUpdate;
  (shared as any).close = () => {
    channel.close();
  };

  return shared;
}
