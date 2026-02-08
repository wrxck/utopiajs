// ============================================================================
// EmailCard — Content card with background and border
// ============================================================================

import {
  createElement,
  appendChild,
  setAttr,
} from '@utopia/server/ssr-runtime';

export const EmailCard = {
  setup: (props: Record<string, any>) => ({
    backgroundColor: props.backgroundColor ?? '#ffffff',
    padding: props.padding ?? '20px',
    borderRadius: props.borderRadius ?? '4px',
    borderColor: props.borderColor ?? '#e0e0e0',
  }),
  render: (ctx: any) => {
    const table = createElement('table');
    setAttr(table, 'role', 'presentation');
    setAttr(table, 'cellpadding', '0');
    setAttr(table, 'cellspacing', '0');
    setAttr(table, 'border', '0');
    setAttr(table, 'width', '100%');

    const tr = createElement('tr');
    const td = createElement('td');
    setAttr(td, 'style', `background-color: ${ctx.backgroundColor}; padding: ${ctx.padding}; border-radius: ${ctx.borderRadius}; border: 1px solid ${ctx.borderColor}`);

    if (ctx.$slots.default) {
      appendChild(td, ctx.$slots.default());
    }

    appendChild(tr, td);
    appendChild(table, tr);
    return table;
  },
};
