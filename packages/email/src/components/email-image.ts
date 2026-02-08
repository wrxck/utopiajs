// ============================================================================
// EmailImage — Image with explicit dimensions
// ============================================================================

import {
  createElement,
  appendChild,
  setAttr,
} from '@utopia/server/ssr-runtime';

export const EmailImage = {
  setup: (props: Record<string, any>) => ({
    src: props.src ?? '',
    alt: props.alt ?? '',
    width: props.width,
    height: props.height,
    align: props.align ?? 'center',
  }),
  render: (ctx: any) => {
    const img = createElement('img');
    setAttr(img, 'src', ctx.src);
    setAttr(img, 'alt', ctx.alt);

    let style = 'display: block; border: 0; outline: none; text-decoration: none';
    if (ctx.width) {
      setAttr(img, 'width', String(ctx.width));
      style += `; max-width: ${ctx.width}px`;
    }
    if (ctx.height) {
      setAttr(img, 'height', String(ctx.height));
    }

    setAttr(img, 'style', style);

    // Wrap in a div for alignment
    if (ctx.align !== 'left') {
      const wrapper = createElement('div');
      setAttr(wrapper, 'style', `text-align: ${ctx.align}`);
      appendChild(wrapper, img);
      return wrapper;
    }

    return img;
  },
};
