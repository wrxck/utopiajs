import type { VElement, VNode } from '@matthesketh/utopia-server';
import { renderToString } from '@matthesketh/utopia-server';
import {
  appendChild,
  createComponent,
  createElement,
  createTextNode,
} from '@matthesketh/utopia-server/ssr-runtime';
import { describe, expect, it } from 'vitest';

import {
  EmailButton,
  EmailCard,
  EmailColumns,
  EmailDivider,
  EmailHeading,
  EmailImage,
  EmailLayout,
  EmailSpacer,
  EmailText,
} from '@/components/index';

describe('Email Components', () => {
  describe('EmailLayout', () => {
    it('renders a table-based layout', () => {
      const { html } = renderToString(EmailLayout, { width: 600 });
      expect(html).toContain('<table');
      expect(html).toContain('role="presentation"');
      expect(html).toContain('max-width: 600px');
    });

    it('uses default props', () => {
      const { html } = renderToString(EmailLayout);
      expect(html).toContain('600px');
      expect(html).toContain('Arial');
    });

    it('renders slot content', () => {
      const node = createComponent(
        EmailLayout,
        { width: 600 },
        {
          default: () => {
            const p = createElement('p');
            appendChild(p, createTextNode('Hello'));
            return p;
          },
        },
      ) as VElement;
      const { html } = { html: serializeTree(node) };
      expect(html).toContain('Hello');
    });
  });

  describe('EmailButton', () => {
    it('renders a table-based button', () => {
      const { html } = renderToString(EmailButton, {
        href: 'https://example.com',
        text: 'Click Me',
      });
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('Click Me');
      expect(html).toContain('<table');
    });

    it('uses default colors', () => {
      const { html } = renderToString(EmailButton, {
        href: '#',
        text: 'Go',
      });
      expect(html).toContain('#007bff');
      expect(html).toContain('#ffffff');
    });

    it('accepts custom colors', () => {
      const { html } = renderToString(EmailButton, {
        href: '#',
        text: 'Go',
        color: '#ff0000',
        textColor: '#000000',
      });
      expect(html).toContain('#ff0000');
      expect(html).toContain('#000000');
    });
  });

  describe('EmailCard', () => {
    it('renders a bordered card', () => {
      const { html } = renderToString(EmailCard);
      expect(html).toContain('<table');
      expect(html).toContain('border: 1px solid');
      expect(html).toContain('border-radius');
    });

    it('renders slot content', () => {
      const node = createComponent(
        EmailCard,
        {},
        {
          default: () => {
            const span = createElement('span');
            appendChild(span, createTextNode('Card content'));
            return span;
          },
        },
      ) as VElement;
      expect(serializeTree(node)).toContain('Card content');
    });
  });

  describe('EmailDivider', () => {
    it('renders a horizontal rule', () => {
      const { html } = renderToString(EmailDivider);
      expect(html).toContain('border-bottom');
      expect(html).toContain('#e0e0e0');
    });

    it('accepts custom color', () => {
      const { html } = renderToString(EmailDivider, { color: '#cccccc' });
      expect(html).toContain('#cccccc');
    });
  });

  describe('EmailHeading', () => {
    it('renders an h1 by default', () => {
      const node = createComponent(
        EmailHeading,
        {},
        {
          default: () => createTextNode('Title'),
        },
      ) as VElement;
      expect(node.tag).toBe('h1');
      expect(serializeTree(node)).toContain('28px');
    });

    it('renders h2 and h3', () => {
      const h2 = createComponent(
        EmailHeading,
        { level: 2 },
        {
          default: () => createTextNode('Sub'),
        },
      ) as VElement;
      expect(h2.tag).toBe('h2');
      expect(serializeTree(h2)).toContain('22px');

      const h3 = createComponent(
        EmailHeading,
        { level: 3 },
        {
          default: () => createTextNode('Minor'),
        },
      ) as VElement;
      expect(h3.tag).toBe('h3');
      expect(serializeTree(h3)).toContain('18px');
    });
  });

  describe('EmailText', () => {
    it('renders a paragraph', () => {
      const node = createComponent(
        EmailText,
        {},
        {
          default: () => createTextNode('Hello world'),
        },
      ) as VElement;
      expect(node.tag).toBe('p');
      expect(serializeTree(node)).toContain('Hello world');
      expect(serializeTree(node)).toContain('16px');
    });

    it('accepts custom font size', () => {
      const node = createComponent(
        EmailText,
        { fontSize: '14px' },
        {
          default: () => createTextNode('Small'),
        },
      ) as VElement;
      expect(serializeTree(node)).toContain('14px');
    });
  });

  describe('EmailImage', () => {
    it('renders an img with src and alt', () => {
      const { html } = renderToString(EmailImage, {
        src: 'https://example.com/img.png',
        alt: 'Test image',
        width: 200,
        height: 100,
      });
      expect(html).toContain('src="https://example.com/img.png"');
      expect(html).toContain('alt="Test image"');
      expect(html).toContain('width="200"');
      expect(html).toContain('height="100"');
    });

    it('wraps in div for center alignment', () => {
      const { html } = renderToString(EmailImage, {
        src: 'test.png',
        alt: 'test',
        align: 'center',
      });
      expect(html).toContain('text-align: center');
    });

    it('does not wrap for left alignment', () => {
      const { html } = renderToString(EmailImage, {
        src: 'test.png',
        alt: 'test',
        align: 'left',
      });
      expect(html).toMatch(/^<img /);
    });
  });

  describe('EmailColumns', () => {
    it('renders a table with 2 columns by default', () => {
      const { html } = renderToString(EmailColumns);
      const tdMatches = html.match(/<td /g);
      expect(tdMatches).toHaveLength(2);
      expect(html).toContain('width="50%"');
    });

    it('renders 3 columns', () => {
      const { html } = renderToString(EmailColumns, { columns: 3 });
      const tdMatches = html.match(/<td /g);
      expect(tdMatches).toHaveLength(3);
      expect(html).toContain('width="33%"');
    });
  });

  describe('EmailSpacer', () => {
    it('renders a spacer with default height', () => {
      const { html } = renderToString(EmailSpacer);
      expect(html).toContain('height: 20px');
    });

    it('renders a spacer with custom height', () => {
      const { html } = renderToString(EmailSpacer, { height: '40px' });
      expect(html).toContain('height: 40px');
    });
  });

  describe('EmailButton — defaults', () => {
    it('falls back to default href, text and border radius', () => {
      const { html } = renderToString(EmailButton);
      expect(html).toContain('href="#"');
      expect(html).toContain('Click Here');
      expect(html).toContain('border-radius: 4px');
    });

    it('accepts a custom border radius', () => {
      const { html } = renderToString(EmailButton, { borderRadius: '10px' });
      expect(html).toContain('border-radius: 10px');
    });
  });

  describe('EmailHeading — level clamping', () => {
    it('clamps levels above 3 down to h3', () => {
      const node = createComponent(EmailHeading, { level: 99 }) as VElement;
      expect(node.tag).toBe('h3');
    });

    it('clamps invalid levels to h1', () => {
      expect((createComponent(EmailHeading, { level: 0 }) as VElement).tag).toBe('h1');
      expect((createComponent(EmailHeading, { level: 'nope' }) as VElement).tag).toBe('h1');
    });

    it('falls back to the h1 font size for fractional levels', () => {
      // 1.5 survives the clamp; there is no size entry for it.
      const node = createComponent(EmailHeading, { level: 1.5 }) as VElement;
      expect(node.attrs.style).toContain('font-size: 28px');
    });

    it('applies custom color and alignment', () => {
      const node = createComponent(EmailHeading, { color: '#111111', align: 'center' }) as VElement;
      expect(node.attrs.style).toContain('color: #111111');
      expect(node.attrs.style).toContain('text-align: center');
    });
  });

  describe('EmailText — without slot content', () => {
    it('renders an empty paragraph', () => {
      const { html } = renderToString(EmailText);
      expect(html).toMatch(/^<p [^>]*><\/p>$/);
    });
  });

  describe('EmailImage — defaults', () => {
    it('renders empty src/alt and no dimensions when props are omitted', () => {
      const node = createComponent(EmailImage, {}) as VElement;
      // Default align is center, so the img is wrapped in a div.
      expect(node.tag).toBe('div');
      const img = node.children[0] as VElement;
      expect(img.attrs.src).toBe('');
      expect(img.attrs.alt).toBe('');
      expect(img.attrs.width).toBeUndefined();
      expect(img.attrs.height).toBeUndefined();
      expect(img.attrs.style).not.toContain('max-width');
    });
  });

  describe('EmailColumns — slots and clamping', () => {
    it('renders named column slots', () => {
      const node = createComponent(
        EmailColumns,
        { columns: 2 },
        {
          'column-0': () => {
            const s = createElement('span');
            appendChild(s, createTextNode('First'));
            return s;
          },
          'column-1': () => {
            const s = createElement('span');
            appendChild(s, createTextNode('Second'));
            return s;
          },
        },
      ) as VElement;
      const html = serializeTree(node);
      expect(html).toContain('First');
      expect(html).toContain('Second');
      // Only the second column gets the gap padding.
      expect(html.match(/padding-left/g)).toHaveLength(1);
    });

    it('falls back to the default slot for the first column', () => {
      const node = createComponent(
        EmailColumns,
        { columns: 2 },
        {
          default: () => {
            const s = createElement('span');
            appendChild(s, createTextNode('Only'));
            return s;
          },
        },
      ) as VElement;
      expect(serializeTree(node)).toContain('Only');
    });

    it('clamps the column count between 1 and 4', () => {
      const many = renderToString(EmailColumns, { columns: 99 }).html;
      expect(many.match(/<td /g)).toHaveLength(4);
      const few = renderToString(EmailColumns, { columns: -3 }).html;
      expect(few.match(/<td /g)).toHaveLength(1);
      const invalid = renderToString(EmailColumns, { columns: 'nope' }).html;
      expect(invalid.match(/<td /g)).toHaveLength(2);
    });
  });
});

// Helper to serialize a VNode tree (simplified version of serializeVNode)
function serializeTree(node: VNode): string {
  if (node.type === 2) return node.text;
  if (node.type === 3) return `<!--${node.text}-->`;
  if (node.type === 1) {
    let html = `<${node.tag}`;
    for (const [name, value] of Object.entries(node.attrs)) {
      html += value === '' ? ` ${name}` : ` ${name}="${value}"`;
    }
    html += '>';
    for (const child of node.children) {
      html += serializeTree(child);
    }
    html += `</${node.tag}>`;
    return html;
  }
  return '';
}
