// ============================================================================
// EmailHeading — h1-h3 with safe inline styles
// ============================================================================

import {
  createElement,
  appendChild,
  setAttr,
} from '@matthesketh/utopia-server/ssr-runtime';

const HEADING_SIZES: Record<number, string> = {
  1: '28px',
  2: '22px',
  3: '18px',
};

export const EmailHeading = {
  setup: (props: Record<string, any>) => ({
    level: Math.min(3, Math.max(1, props.level ?? 1)),
    color: props.color ?? '#333333',
    align: props.align ?? 'left',
  }),
  render: (ctx: any) => {
    const tag = `h${ctx.level}` as 'h1' | 'h2' | 'h3';
    const el = createElement(tag);
    const fontSize = HEADING_SIZES[ctx.level] || '28px';
    setAttr(el, 'style', `margin: 0 0 10px 0; font-size: ${fontSize}; line-height: 1.3; color: ${ctx.color}; text-align: ${ctx.align}`);

    if (ctx.$slots.default) {
      appendChild(el, ctx.$slots.default());
    }

    return el;
  },
};
