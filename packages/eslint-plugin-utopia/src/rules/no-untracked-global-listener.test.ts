import { RuleTester } from 'eslint';

import * as parser from '@/parser';
import rule from '@/rules/no-untracked-global-listener';

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

const sfc = (script: string): string =>
  `<template><p>x</p></template>\n<script lang="ts">${script}</script>`;

ruleTester.run('no-untracked-global-listener', rule, {
  valid: [
    // no defineProps: setup runs once at import, so the listener is registered
    // once. untidy, but not the per-mount accumulation this rule is about.
    {
      code: sfc(`
        window.addEventListener('resize', onResize);
      `),
      filename: 'a.utopia',
    },
    // the helper registers a disposer for you.
    {
      code: sfc(`
        const { id } = defineProps();
        useEventListener(window, 'resize', onResize);
      `),
      filename: 'a.utopia',
    },
    // paired removal in onDestroy.
    {
      code: sfc(`
        const { id } = defineProps();
        onMount(() => window.addEventListener('resize', onResize));
        onDestroy(() => window.removeEventListener('resize', onResize));
      `),
      filename: 'a.utopia',
    },
    // paired removal in an effect's returned cleanup.
    {
      code: sfc(`
        const { id } = defineProps();
        effect(() => {
          document.addEventListener('keydown', onKey);
          return () => document.removeEventListener('keydown', onKey);
        });
      `),
      filename: 'a.utopia',
    },
    // { once: true } removes itself after firing.
    {
      code: sfc(`
        const { id } = defineProps();
        window.addEventListener('load', onLoad, { once: true });
      `),
      filename: 'a.utopia',
    },
    // an AbortController signal hands teardown to the controller.
    {
      code: sfc(`
        const { id } = defineProps();
        const controller = new AbortController();
        window.addEventListener('scroll', onScroll, { signal: controller.signal });
        onDestroy(() => controller.abort());
      `),
      filename: 'a.utopia',
    },
    // an element listener dies with the element — out of scope.
    {
      code: sfc(`
        const { id } = defineProps();
        button.addEventListener('click', onClick);
      `),
      filename: 'a.utopia',
    },
    // a removal with a dynamic type is taken to cover the matching addition.
    {
      code: sfc(`
        const { id } = defineProps();
        window.addEventListener(eventName, onAny);
        onDestroy(() => window.removeEventListener(eventName, onAny));
      `),
      filename: 'a.utopia',
    },
  ],
  invalid: [
    // the shipped bug: registered per instance, never removed.
    {
      code: sfc(`
        const { id } = defineProps();
        window.addEventListener('resize', onResize);
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'untracked', data: { target: 'window' } }],
    },
    // onMount is per instance too — the mount hook is not teardown.
    {
      code: sfc(`
        const { id } = defineProps();
        onMount(() => document.addEventListener('visibilitychange', onVisible));
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'untracked', data: { target: 'document' } }],
    },
    // globalThis is the same object by another name.
    {
      code: sfc(`
        const { id } = defineProps();
        globalThis.addEventListener('online', onOnline);
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'untracked', data: { target: 'globalThis' } }],
    },
    // a removal for a different event does not cover this one.
    {
      code: sfc(`
        const { id } = defineProps();
        window.addEventListener('resize', onResize);
        onDestroy(() => window.removeEventListener('scroll', onScroll));
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'untracked', data: { target: 'window' } }],
    },
    // { capture: true } is not a teardown arrangement.
    {
      code: sfc(`
        const { id } = defineProps();
        window.addEventListener('resize', onResize, { capture: true });
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'untracked', data: { target: 'window' } }],
    },
    // every unpaired listener is reported.
    {
      code: sfc(`
        const { id } = defineProps();
        window.addEventListener('resize', onResize);
        document.addEventListener('keydown', onKey);
      `),
      filename: 'a.utopia',
      errors: [
        { messageId: 'untracked', data: { target: 'window' } },
        { messageId: 'untracked', data: { target: 'document' } },
      ],
    },
  ],
});
