import { describe, it, expect } from 'vitest';
import { renderToString } from '@matthesketh/utopia-server';
import {
  createElement,
  createTextNode,
  appendChild,
  createComponent,
} from '@matthesketh/utopia-server/ssr-runtime';
import type { VElement, VNode } from '@matthesketh/utopia-server';
import {
  EmailLayout,
  EmailButton,
  EmailCard,
  EmailDivider,
  EmailHeading,
  EmailText,
  EmailImage,
  EmailColumns,
  EmailSpacer,
} from './components/index.js';

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
