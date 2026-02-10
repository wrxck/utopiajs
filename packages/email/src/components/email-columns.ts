// ============================================================================
// EmailColumns — Table-based multi-column layout
// ============================================================================

import { createElement, appendChild, setAttr } from '@matthesketh/utopia-server/ssr-runtime';
import type { EmailComponentContext } from '../types.js';

export const EmailColumns = {
  setup: (props: Record<string, unknown>) => ({
    columns: props.columns ?? 2,
    gap: props.gap ?? '20px',
  }),
  render: (ctx: EmailComponentContext) => {
    const table = createElement('table');
    setAttr(table, 'role', 'presentation');
    setAttr(table, 'cellpadding', '0');
    setAttr(table, 'cellspacing', '0');
    setAttr(table, 'border', '0');
    setAttr(table, 'width', '100%');

    const tr = createElement('tr');
    const columnCount = Math.min(4, Math.max(1, Number(ctx.columns) || 2));
    const widthPercent = Math.floor(100 / columnCount);

    for (let i = 0; i < columnCount; i++) {
      const td = createElement('td');
      setAttr(td, 'width', `${widthPercent}%`);
      setAttr(td, 'valign', 'top');

      const paddingLeft = i > 0 ? `padding-left: ${ctx.gap}` : '';
      if (paddingLeft) {
        setAttr(td, 'style', paddingLeft);
      }

      // Render slot named "column-{i}" or the default slot for the first column
      const slotName = `column-${i}`;
      if (ctx.$slots[slotName]) {
        appendChild(td, ctx.$slots[slotName]());
      } else if (i === 0 && ctx.$slots.default) {
        appendChild(td, ctx.$slots.default());
      }

      appendChild(tr, td);
    }

    appendChild(table, tr);
    return table;
  },
};
