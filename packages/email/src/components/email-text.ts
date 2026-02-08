// ============================================================================
// EmailText — Paragraph with safe typography
// ============================================================================

import {
  createElement,
  appendChild,
  setAttr,
} from '@utopia/server/ssr-runtime';

export const EmailText = {
  setup: (props: Record<string, any>) => ({
    color: props.color ?? '#333333',
    fontSize: props.fontSize ?? '16px',
    lineHeight: props.lineHeight ?? '1.5',
    align: props.align ?? 'left',
  }),
  render: (ctx: any) => {
    const p = createElement('p');
    setAttr(p, 'style', `margin: 0 0 16px 0; font-size: ${ctx.fontSize}; line-height: ${ctx.lineHeight}; color: ${ctx.color}; text-align: ${ctx.align}`);

    if (ctx.$slots.default) {
      appendChild(p, ctx.$slots.default());
    }

    return p;
  },
};
