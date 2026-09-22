/**
 * Several useHead() callers at once — a layout and a page, say.
 *
 * Each call used to clear every managed tag and apply only its own config,
 * so two callers erased each other, and one caller's cleanup removed the
 * other's tags as well.
 */

import { createRoot, signal } from '@matthesketh/utopia-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetHead, useHead } from '@/index';

beforeEach(() => {
  resetHead();
  document.title = '';
});

const meta = (name: string): string | null =>
  document.head.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;

describe('useHead with several callers', () => {
  it('merges the entries, a later one winning per tag', () => {
    const stopLayout = useHead(() => ({
      titleTemplate: '%s | Site',
      title: 'Site',
      meta: [
        { name: 'description', content: 'site description' },
        { name: 'author', content: 'me' },
      ],
      link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    }));
    const stopPage = useHead(() => ({
      title: 'Post',
      meta: [{ name: 'description', content: 'post description' }],
      link: [{ rel: 'canonical', href: '/post' }],
    }));

    expect(document.title).toBe('Post | Site');
    expect(meta('description')).toBe('post description');
    expect(meta('author')).toBe('me');
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull();
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);

    // removing the page restores the layout's part of the head.
    stopPage();
    expect(meta('description')).toBe('site description');
    expect(meta('author')).toBe('me');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    stopLayout();
    expect(meta('author')).toBeNull();
  });

  it('keeps first-run order when an earlier entry changes', () => {
    const layoutTitle = signal('Layout');
    useHead(() => ({ title: layoutTitle() }));
    useHead(() => ({ title: 'Page' }));
    layoutTitle.set('Layout 2');
    expect(document.title).toBe('Page');
  });

  it('drops an entry when its owning root is disposed, as on unmount', async () => {
    useHead(() => ({ meta: [{ name: 'author', content: 'layout' }] }));
    const dispose = createRoot((d) => {
      useHead(() => ({ meta: [{ name: 'description', content: 'page' }] }));
      return d;
    });
    expect(meta('description')).toBe('page');

    dispose();
    await Promise.resolve();
    expect(meta('description')).toBeNull();
    expect(meta('author')).toBe('layout');
  });
});
