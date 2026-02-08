// ============================================================================
// @matthesketh/utopia-email — renderEmail (core orchestrator)
// ============================================================================

import { renderToString } from '@matthesketh/utopia-server';
import { inlineCSS } from './css-inliner.js';
import { htmlToText } from './html-to-text.js';
import { wrapEmailDocument } from './email-document.js';
import type { RenderEmailOptions, RenderEmailResult } from './types.js';

/**
 * Render a UtopiaJS component as a complete email document.
 *
 * Pipeline:
 *   1. renderToString(component, props) → { html: bodyHtml, css }
 *   2. inlineCSS(bodyHtml, css)         → bodyHtml with style="" attrs
 *   3. wrapEmailDocument(...)           → full HTML document
 *   4. htmlToText(fullHtml)             → plain text fallback
 *   5. Return { html, text, subject? }
 */
export function renderEmail(
  component: any,
  props?: Record<string, any>,
  options?: RenderEmailOptions,
): RenderEmailResult {
  const {
    subject,
    previewText,
    skipInlining = false,
    skipStyleBlock = false,
    headContent,
  } = options ?? {};

  // Step 1: Render component to HTML + CSS
  const { html: bodyHtml, css } = renderToString(component, props);

  // Step 2: Inline CSS into style attributes
  const inlinedBody = skipInlining ? bodyHtml : inlineCSS(bodyHtml, css);

  // Step 3: Wrap in email document
  const fullHtml = wrapEmailDocument({
    bodyHtml: inlinedBody,
    css,
    previewText,
    headContent,
    skipStyleBlock,
  });

  // Step 4: Generate plain text fallback
  const text = htmlToText(fullHtml);

  return {
    html: fullHtml,
    text,
    subject,
  };
}
