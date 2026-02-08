// ============================================================================
// EmailDivider — Horizontal rule
// ============================================================================

import {
  createElement,
  appendChild,
  setAttr,
} from '@utopia/server/ssr-runtime';

export const EmailDivider = {
  setup: (props: Record<string, any>) => ({
    color: props.color ?? '#e0e0e0',
    width: props.width ?? '100%',
    height: props.height ?? '1px',
  }),
  render: (ctx: any) => {
    const table = createElement('table');
    setAttr(table, 'role', 'presentation');
    setAttr(table, 'cellpadding', '0');
    setAttr(table, 'cellspacing', '0');
    setAttr(table, 'border', '0');
    setAttr(table, 'width', ctx.width);

    const tr = createElement('tr');
    const td = createElement('td');
    setAttr(td, 'style', `border-bottom: ${ctx.height} solid ${ctx.color}; font-size: 1px; line-height: 1px; height: ${ctx.height}`);

    // Non-breaking space to ensure the cell renders
    const nbsp = createElement('span');
    setAttr(nbsp, 'style', 'display: block; height: 0; overflow: hidden');

    appendChild(td, nbsp);
    appendChild(tr, td);
    appendChild(table, tr);
    return table;
  },
};
