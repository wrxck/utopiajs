// ============================================================================
// shared.test.ts — Tests for sharedSignal (cross-tab state sync)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effect } from './index';
import { sharedSignal, type SharedSignal } from './shared';

// ---------------------------------------------------------------------------
// BroadcastChannel mock
// ---------------------------------------------------------------------------

// Track all channels by name so we can simulate cross-tab messaging.
const channels: Map<string, Set<{ onmessage: ((e: MessageEvent) => void) | null; postMessage: (data: any) => void }>> = new Map();

class MockBroadcastChannel {
  name: string;
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    if (!channels.has(name)) {
      channels.set(name, new Set());
    }
    channels.get(name)!.add(this);
  }

  postMessage(data: any): void {
    const group = channels.get(this.name);
    if (!group) return;
    for (const ch of group) {
      if (ch !== this && ch.onmessage) {
        // Simulate async delivery (like real BroadcastChannel).
        ch.onmessage(new MessageEvent('message', { data }));
      }
    }
  }

  close(): void {
    const group = channels.get(this.name);
    if (group) {
      group.delete(this);
      if (group.size === 0) channels.delete(this.name);
    }
  }
}

beforeEach(() => {
  channels.clear();
  (globalThis as any).BroadcastChannel = MockBroadcastChannel;
});

afterEach(() => {
  channels.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sharedSignal', () => {
  it('behaves as a normal signal for reads and writes', () => {
    const s = sharedSignal('test-basic', 0);
    expect(s()).toBe(0);
    expect(s.peek()).toBe(0);

    s.set(42);
    expect(s()).toBe(42);

    s.update((n) => n + 1);
    expect(s()).toBe(43);

    s.close();
  });

  it('syncs value from one tab to another', () => {
    const tab1 = sharedSignal('test-sync', 'hello');
    const tab2 = sharedSignal('test-sync', 'hello');

    tab1.set('world');
    expect(tab2()).toBe('world');

    tab1.close();
    tab2.close();
  });

  it('syncs in both directions', () => {
    const tab1 = sharedSignal('test-bidir', 0);
    const tab2 = sharedSignal('test-bidir', 0);

    tab1.set(10);
    expect(tab2()).toBe(10);

    tab2.set(20);
    expect(tab1()).toBe(20);

    tab1.close();
    tab2.close();
  });

  it('triggers reactive effects on remote updates', () => {
    const tab1 = sharedSignal('test-effect', 'a');
    const tab2 = sharedSignal('test-effect', 'a');

    const values: string[] = [];
    const dispose = effect(() => {
      values.push(tab2());
    });

    expect(values).toEqual(['a']);

    tab1.set('b');
    expect(values).toEqual(['a', 'b']);

    dispose();
    tab1.close();
    tab2.close();
  });

  it('update() broadcasts the new value', () => {
    const tab1 = sharedSignal('test-update', 5);
    const tab2 = sharedSignal('test-update', 5);

    tab1.update((n) => n * 2);
    expect(tab2()).toBe(10);

    tab1.close();
    tab2.close();
  });

  it('does not echo remote updates back to the channel', () => {
    const tab1 = sharedSignal('test-no-echo', 0);
    const tab2 = sharedSignal('test-no-echo', 0);

    // Spy on postMessage of tab2's underlying channel.
    const group = channels.get('utopia:shared:test-no-echo')!;
    const tab2Channel = Array.from(group)[1];
    const postSpy = vi.spyOn(tab2Channel, 'postMessage');

    // When tab1 sets, tab2 receives but should NOT re-broadcast.
    tab1.set(99);
    expect(tab2()).toBe(99);
    expect(postSpy).not.toHaveBeenCalled();

    postSpy.mockRestore();
    tab1.close();
    tab2.close();
  });

  it('supports custom serialization', () => {
    const tab1 = sharedSignal('test-custom', new Date('2025-01-01'), {
      serialize: (d) => d.toISOString(),
      deserialize: (s) => new Date(s),
    });
    const tab2 = sharedSignal('test-custom', new Date('2000-01-01'), {
      serialize: (d) => d.toISOString(),
      deserialize: (s) => new Date(s),
    });

    tab1.set(new Date('2030-06-15'));
    expect(tab2().toISOString()).toBe('2030-06-15T00:00:00.000Z');

    tab1.close();
    tab2.close();
  });

  it('stops syncing after close()', () => {
    const tab1 = sharedSignal('test-close', 0);
    const tab2 = sharedSignal('test-close', 0);

    tab2.close();

    tab1.set(42);
    // tab2 should NOT have updated since its channel is closed.
    expect(tab2()).toBe(0);

    tab1.close();
  });

  it('works as a plain signal when BroadcastChannel is unavailable', () => {
    // Remove BroadcastChannel to simulate SSR / unsupported env.
    delete (globalThis as any).BroadcastChannel;

    const s = sharedSignal('test-no-bc', 'hello');
    expect(s()).toBe('hello');
    s.set('world');
    expect(s()).toBe('world');

    // close() should not throw.
    s.close();
  });

  it('syncs across 3+ tabs', () => {
    const tab1 = sharedSignal('test-multi', 0);
    const tab2 = sharedSignal('test-multi', 0);
    const tab3 = sharedSignal('test-multi', 0);

    tab1.set(7);
    expect(tab2()).toBe(7);
    expect(tab3()).toBe(7);

    tab1.close();
    tab2.close();
    tab3.close();
  });
});
