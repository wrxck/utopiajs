// ============================================================================
// EmailLayout — Responsive table wrapper for email content
// ============================================================================

import { createElement, appendChild, setAttr } from '@matthesketh/utopia-server/ssr-runtime';
import type { EmailComponentContext } from '../types.js';

export const EmailLayout = {
  setup: (props: Record<string, unknown>) => ({
    width: props.width ?? 600,
    backgroundColor: props.backgroundColor ?? '#ffffff',
    fontFamily: props.fontFamily ?? 'Arial, Helvetica, sans-serif',
  }),
  render: (ctx: EmailComponentContext) => {
    const table = createElement('table');
    setAttr(table, 'role', 'presentation');
    setAttr(table, 'cellpadding', '0');
    setAttr(table, 'cellspacing', '0');
    setAttr(table, 'border', '0');
    setAttr(table, 'width', String(ctx.width));
    setAttr(
      table,
      'style',
      `max-width: ${ctx.width}px; width: 100%; margin: 0 auto; background-color: ${ctx.backgroundColor}; font-family: ${ctx.fontFamily}`,
    );

    const tr = createElement('tr');
    const td = createElement('td');
    setAttr(td, 'style', 'padding: 0');

    if (ctx.$slots.default) {
      appendChild(td, ctx.$slots.default());
    }

    appendChild(tr, td);
    appendChild(table, tr);
    return table;
  },
};
