// regression tests for the v0.8 security + memory-safety hardening pass.
// each leak test is written so it FAILS against the pre-fix runtime (the
// effect keeps firing / onDestroy never runs) and passes once disposers are
// forwarded to the surrounding scope.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@matthesketh/utopia-core';

import { createComponentInstance, onDestroy } from './component';
import type { ComponentDefinition } from './component';
import { createComponent, createIf, createFor } from './directives';
import { setAttr, setSafeHtml } from './dom';
import { createEffect } from './index';

describe('setAttr URL-scheme + event-handler guards', () => {
  it('drops javascript: in href', () => {
    const a = document.createElement('a');
    setAttr(a, 'href', 'javascript:alert(1)');
    expect(a.getAttribute('href')).toBeNull();
  });

  it('drops vbscript: in href', () => {
    const a = document.createElement('a');
    setAttr(a, 'href', 'vbscript:msgbox(1)');
    expect(a.getAttribute('href')).toBeNull();
  });

  it('keeps safe http/https/relative/mailto urls', () => {
    const a = document.createElement('a');
    for (const href of ['https://ok.test', 'http://ok.test', '/relative', 'mailto:a@b.test']) {
      setAttr(a, 'href', href);
      expect(a.getAttribute('href')).toBe(href);
    }
  });

  it('allows data:image on media src but blocks data:text/html', () => {
    const img = document.createElement('img');
    setAttr(img, 'src', 'data:image/png;base64,iVBORw0KGgo=');
    expect(img.getAttribute('src')).toContain('data:image/png');
    setAttr(img, 'src', 'data:text/html,<script>alert(1)</script>');
    expect(img.getAttribute('src')).toBeNull();
  });

  it('refuses to bind on* event-handler attributes', () => {
    const div = document.createElement('div');
    setAttr(div, 'onclick', 'alert(1)');
    expect(div.getAttribute('onclick')).toBeNull();
    setAttr(div, 'onmouseover', 'alert(1)');
    expect(div.getAttribute('onmouseover')).toBeNull();
  });

  it('blocks javascript: in formaction/xlink:href', () => {
    const btn = document.createElement('button');
    setAttr(btn, 'formaction', 'javascript:alert(1)');
    expect(btn.getAttribute('formaction')).toBeNull();
  });
});

describe('runtime sanitiser drops dangerous subtrees', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  it('removes <style> and its text content, not just the tag', () => {
    const el = document.createElement('div');
    host.appendChild(el);
    setSafeHtml(el, () => '<style>@import "evil"</style><p>ok</p>');
    expect(el.innerHTML).not.toContain('@import');
    expect(el.innerHTML).toContain('<p>ok</p>');
  });

  it('adds rel=noopener to target=_blank links', () => {
    const el = document.createElement('div');
    host.appendChild(el);
    setSafeHtml(el, () => '<a href="https://x.test" target="_blank">x</a>');
    expect(el.innerHTML).toContain('noopener');
  });
});

describe('setSafeHtml effect is disposed on unmount', () => {
  it('stops reacting after the owning component unmounts', () => {
    const sig = signal('<b>a</b>');
    const Comp: ComponentDefinition = {
      render() {
        const el = document.createElement('div');
        setSafeHtml(el, () => sig());
        return el;
      },
    };
    const instance = createComponentInstance(Comp);
    instance.mount(document.body);
    const el = instance.el as HTMLElement;
    expect(el.innerHTML).toContain('a');
    sig.set('<b>b</b>');
    expect(el.innerHTML).toContain('b');

    instance.unmount();
    const frozen = el.innerHTML;
    sig.set('<b>LEAKED</b>');
    expect(el.innerHTML).toBe(frozen);
  });
});

describe('child component cleanup on parent unmount', () => {
  it('runs onDestroy and disposes child effects when the parent unmounts', () => {
    const sig = signal(0);
    let effectRuns = 0;
    let destroyed = 0;

    const Child: ComponentDefinition = {
      setup() {
        onDestroy(() => {
          destroyed++;
        });
        return {};
      },
      render() {
        const el = document.createElement('span');
        createEffect(() => {
          effectRuns++;
          el.textContent = String(sig());
        });
        return el;
      },
    };

    const Parent: ComponentDefinition = {
      render() {
        const div = document.createElement('div');
        div.appendChild(createComponent(Child));
        return div;
      },
    };

    const instance = createComponentInstance(Parent);
    instance.mount(document.body);
    expect(effectRuns).toBe(1);
    sig.set(1);
    expect(effectRuns).toBe(2);

    instance.unmount();
    expect(destroyed).toBe(1);

    const before = effectRuns;
    sig.set(2);
    expect(effectRuns).toBe(before); // disposed — no leaked subscription
  });
});

describe('list rows dispose child components on removal', () => {
  it('runs onDestroy for rows removed from a createFor', () => {
    const parent = document.createElement('div');
    const anchor = document.createComment('for');
    parent.appendChild(anchor);
    document.body.appendChild(parent);

    const items = signal([1, 2, 3]);
    let destroyed = 0;
    const Row: ComponentDefinition = {
      setup() {
        onDestroy(() => {
          destroyed++;
        });
        return {};
      },
      render: () => document.createElement('li'),
    };

    createFor(
      anchor,
      () => items(),
      (item) => createComponent(Row, { item }),
      (item) => item as number,
    );

    expect(parent.querySelectorAll('li').length).toBe(3);
    items.set([1]);
    expect(destroyed).toBe(2);
    expect(parent.querySelectorAll('li').length).toBe(1);
    parent.remove();
  });
});

describe('createIf disposes branch bindings on toggle', () => {
  it('stops the old branch effect after switching branches', () => {
    const parent = document.createElement('div');
    const anchor = document.createComment('if');
    parent.appendChild(anchor);
    document.body.appendChild(parent);

    const cond = signal(true);
    const sig = signal(0);
    let trueRuns = 0;

    createIf(
      anchor,
      () => cond(),
      () => {
        const el = document.createElement('span');
        createEffect(() => {
          trueRuns++;
          el.textContent = String(sig());
        });
        return el;
      },
      () => document.createElement('em'),
    );

    expect(trueRuns).toBe(1);
    sig.set(1);
    expect(trueRuns).toBe(2);

    cond.set(false); // toggle away — true branch must be torn down
    const before = trueRuns;
    sig.set(2);
    expect(trueRuns).toBe(before); // disposed — no leaked subscription
    parent.remove();
  });
});
