// ============================================================================
// EmailSpacer — Vertical spacing
// ============================================================================

import { createElement, appendChild, setAttr } from '@matthesketh/utopia-server/ssr-runtime';

export const EmailSpacer = {
  setup: (props: Record<string, unknown>) => ({
    height: props.height ?? '20px',
  }),
  render: (ctx: Record<string, unknown>) => {
    const table = createElement('table');
    setAttr(table, 'role', 'presentation');
    setAttr(table, 'cellpadding', '0');
    setAttr(table, 'cellspacing', '0');
    setAttr(table, 'border', '0');
    setAttr(table, 'width', '100%');

    const tr = createElement('tr');
    const td = createElement('td');
    setAttr(td, 'style', `height: ${ctx.height}; font-size: 1px; line-height: 1px`);

    // Non-breaking space entity for rendering
    const span = createElement('span');
    setAttr(span, 'style', 'display: block; height: 0; overflow: hidden');
    appendChild(td, span);

    appendChild(tr, td);
    appendChild(table, tr);
    return table;
  },
};
