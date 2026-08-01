import { RuleTester } from 'eslint';

import * as parser from '@/parser';
import rule from '@/rules/no-tdz-effect-read';

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

const sfc = (script: string): string =>
  `<template><p>x</p></template>\n<script lang="ts">${script}</script>`;

ruleTester.run('no-tdz-effect-read', rule, {
  valid: [
    // the ordinary shape: everything the effect reads is already declared.
    {
      code: sfc(`
        const count = signal(0);
        effect(() => { render(count()); });
      `),
      filename: 'a.utopia',
    },
    // a function declaration is hoisted, so calling one declared below is fine.
    {
      code: sfc(`
        effect(() => { render(label()); });
        function label() { return 'x'; }
      `),
      filename: 'a.utopia',
    },
    // a `var` is hoisted too — undefined, but never a dead zone error.
    {
      code: sfc(`
        effect(() => { render(later); });
        var later = 1;
      `),
      filename: 'a.utopia',
    },
    // an effect nested inside a function only runs when that function is
    // called, by which time the whole module has evaluated.
    {
      code: sfc(`
        export function start() { effect(() => { render(count()); }); }
        const count = signal(0);
      `),
      filename: 'a.utopia',
    },
    // a deferred closure inside the callback does not run at registration.
    {
      code: sfc(`
        effect(() => {
          window.setTimeout(() => render(count()), 0);
        });
        const count = signal(0);
      `),
      filename: 'a.utopia',
    },
    // the returned cleanup runs on the NEXT change, long after evaluation.
    {
      code: sfc(`
        effect(() => {
          open();
          return () => close(count());
        });
        const count = signal(0);
      `),
      filename: 'a.utopia',
    },
    // a name shadowed inside the callback is a different binding entirely.
    {
      code: sfc(`
        effect(() => { const count = 1; render(count); });
        const count = signal(0);
      `),
      filename: 'a.utopia',
    },
    // a property key that happens to match a later declaration is not a read.
    {
      code: sfc(`
        effect(() => { render(state.count); });
        const count = signal(0);
      `),
      filename: 'a.utopia',
    },
    // an import is bound before the module body runs, wherever it sits.
    {
      code: sfc(`
        effect(() => { render(count()); });
        import { count } from './store';
      `),
      filename: 'a.utopia',
    },
    // no effect at all — nothing to check.
    { code: sfc(`const count = signal(0);`), filename: 'a.utopia' },
  ],
  invalid: [
    // the shipped bug: a top-level effect reading a signal declared below it.
    {
      code: sfc(`
        effect(() => { render(count()); });
        const count = signal(0);
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'tdz', data: { name: 'count' } }],
    },
    // binding the disposer does not change when the callback first runs.
    {
      code: sfc(`
        const stop = effect(() => { render(total()); });
        let total = signal(0);
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'tdz', data: { name: 'total' } }],
    },
    // exported form of the same thing.
    {
      code: sfc(`
        export const stop = effect(() => { render(total()); });
        const total = signal(0);
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'tdz', data: { name: 'total' } }],
    },
    // a class is in a dead zone until its declaration is reached.
    {
      code: sfc(`
        effect(() => { render(new Store()); });
        class Store {}
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'tdz', data: { name: 'Store' } }],
    },
    // an argument evaluated at the call site is just as dead.
    {
      code: sfc(`
        effect(handler, count);
        const count = signal(0);
      `),
      filename: 'a.utopia',
      errors: [{ messageId: 'tdz', data: { name: 'count' } }],
    },
    // every offending read is reported, not just the first.
    {
      code: sfc(`
        effect(() => { render(a(), b()); });
        const a = signal(0);
        const b = signal(0);
      `),
      filename: 'a.utopia',
      errors: [
        { messageId: 'tdz', data: { name: 'a' } },
        { messageId: 'tdz', data: { name: 'b' } },
      ],
    },
  ],
});
