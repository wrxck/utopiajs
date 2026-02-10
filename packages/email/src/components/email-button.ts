// ============================================================================
// EmailButton — Bulletproof CTA button using table-based layout
// ============================================================================

import {
  createElement,
  createTextNode,
  appendChild,
  setAttr,
} from '@matthesketh/utopia-server/ssr-runtime';

export const EmailButton = {
  setup: (props: Record<string, unknown>) => ({
    href: props.href ?? '#',
    text: props.text ?? 'Click Here',
    color: props.color ?? '#007bff',
    textColor: props.textColor ?? '#ffffff',
    borderRadius: props.borderRadius ?? '4px',
  }),
  render: (ctx: Record<string, unknown>) => {
    const table = createElement('table');
    setAttr(table, 'role', 'presentation');
    setAttr(table, 'cellpadding', '0');
    setAttr(table, 'cellspacing', '0');
    setAttr(table, 'border', '0');

    const tr = createElement('tr');
    const td = createElement('td');
    setAttr(td, 'align', 'center');
    setAttr(
      td,
      'style',
      `background-color: ${ctx.color}; border-radius: ${ctx.borderRadius}; padding: 12px 24px`,
    );

    const a = createElement('a');
    setAttr(a, 'href', ctx.href);
    setAttr(
      a,
      'style',
      `color: ${ctx.textColor}; text-decoration: none; font-size: 16px; font-weight: bold; display: inline-block`,
    );
    appendChild(a, createTextNode(String(ctx.text)));

    appendChild(td, a);
    appendChild(tr, td);
    appendChild(table, tr);
    return table;
  },
};
