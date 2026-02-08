import { describe, it, expect } from 'vitest';
import { renderEmail } from './render-email.js';
import {
  createElement,
  createTextNode,
  appendChild,
  setAttr,
} from '@utopia/server/ssr-runtime';

describe('renderEmail', () => {
  it('renders a simple component to email HTML', () => {
    const Component = {
      render: () => {
        const div = createElement('div');
        setAttr(div, 'class', 'content');
        const text = createTextNode('Hello Email');
        appendChild(div, text);
        return div;
      },
    };

    const result = renderEmail(Component);

    // Should produce a full HTML document
    expect(result.html).toContain('<!DOCTYPE html');
    expect(result.html).toContain('Hello Email');
    expect(result.html).toContain('role="presentation"');
    expect(result.html).toContain('<meta');

    // Should produce plain text
    expect(result.text).toContain('Hello Email');
  });

  it('renders with props', () => {
    const Component = {
      setup: (props: any) => ({ name: props.name }),
      render: (ctx: any) => {
        const p = createElement('p');
        appendChild(p, createTextNode(`Hello ${ctx.name}`));
        return p;
      },
    };

    const result = renderEmail(Component, { name: 'World' });
    expect(result.html).toContain('Hello World');
    expect(result.text).toContain('Hello World');
  });

  it('inlines component CSS into style attributes', () => {
    const Component = {
      render: () => {
        const p = createElement('p');
        setAttr(p, 'class', 'text');
        appendChild(p, createTextNode('Styled'));
        return p;
      },
      styles: '.text { color: red; font-size: 16px; }',
    };

    const result = renderEmail(Component);
    // CSS should be inlined
    expect(result.html).toContain('style="');
    expect(result.html).toContain('color: red');
    // CSS should also be in <style> block
    expect(result.html).toContain('.text { color: red;');
  });

  it('skips inlining when skipInlining is true', () => {
    const Component = {
      render: () => {
        const p = createElement('p');
        setAttr(p, 'class', 'text');
        appendChild(p, createTextNode('Not inlined'));
        return p;
      },
      styles: '.text { color: red; }',
    };

    const result = renderEmail(Component, undefined, { skipInlining: true });
    // CSS should NOT be inlined into the <p> tag
    expect(result.html).toMatch(/<p class="text">Not inlined<\/p>/);
    // But should still be in <style> block
    expect(result.html).toContain('.text { color: red; }');
  });

  it('skips style block when skipStyleBlock is true', () => {
    const Component = {
      render: () => {
        const p = createElement('p');
        setAttr(p, 'class', 'text');
        appendChild(p, createTextNode('Test'));
        return p;
      },
      styles: '.text { color: red; }',
    };

    const result = renderEmail(Component, undefined, { skipStyleBlock: true });
    // The component CSS should not appear in a <style> block
    // (only the email reset <style> should be present)
    const styleBlocks = result.html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || [];
    const componentStyleBlock = styleBlocks.find((s) => s.includes('.text'));
    expect(componentStyleBlock).toBeUndefined();
  });

  it('includes preview text', () => {
    const Component = {
      render: () => createElement('div'),
    };

    const result = renderEmail(Component, undefined, {
      previewText: 'Check out our new offer!',
    });

    expect(result.html).toContain('Check out our new offer!');
    expect(result.html).toContain('display: none');
  });

  it('includes head content', () => {
    const Component = {
      render: () => createElement('div'),
    };

    const result = renderEmail(Component, undefined, {
      headContent: '<link rel="stylesheet" href="https://fonts.example.com/font.css">',
    });

    expect(result.html).toContain('fonts.example.com/font.css');
  });

  it('passes subject through to result', () => {
    const Component = {
      render: () => createElement('div'),
    };

    const result = renderEmail(Component, undefined, {
      subject: 'Test Subject',
    });

    expect(result.subject).toBe('Test Subject');
  });

  it('generates plain text with headings uppercase', () => {
    const Component = {
      render: () => {
        const div = createElement('div');
        const h1 = createElement('h1');
        appendChild(h1, createTextNode('Welcome'));
        appendChild(div, h1);
        const p = createElement('p');
        appendChild(p, createTextNode('Thanks for signing up.'));
        appendChild(div, p);
        return div;
      },
    };

    const result = renderEmail(Component);
    expect(result.text).toContain('WELCOME');
    expect(result.text).toContain('Thanks for signing up.');
  });

  it('email document includes XHTML 1.0 Transitional DOCTYPE', () => {
    const Component = {
      render: () => createElement('div'),
    };

    const result = renderEmail(Component);
    expect(result.html).toContain('XHTML 1.0 Transitional');
    expect(result.html).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  it('email document includes MSO conditional', () => {
    const Component = {
      render: () => createElement('div'),
    };

    const result = renderEmail(Component);
    expect(result.html).toContain('<!--[if !mso]><!-->');
  });

  it('email document includes email reset styles', () => {
    const Component = {
      render: () => createElement('div'),
    };

    const result = renderEmail(Component);
    expect(result.html).toContain('-webkit-text-size-adjust');
    expect(result.html).toContain('border-collapse');
  });
});
