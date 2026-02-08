// ============================================================================
// @matthesketh/utopia-email — Email Document Wrapper
// ============================================================================

export interface WrapEmailDocumentOptions {
  /** Rendered body HTML. */
  bodyHtml: string;
  /** Component CSS (for <style> block). */
  css?: string;
  /** Hidden preview text shown in email clients. */
  previewText?: string;
  /** Extra HTML to inject into <head>. */
  headContent?: string;
  /** Skip emitting the <style> block. */
  skipStyleBlock?: boolean;
}

/**
 * Email CSS reset — baseline styles for consistent rendering across clients.
 */
const EMAIL_RESET = `
  body, #body-table { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  td { border-collapse: collapse; }
  img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a img { border: none; }
`.trim();

/**
 * Wrap body HTML in a complete email document.
 *
 * Uses XHTML 1.0 Transitional DOCTYPE for widest email client support.
 * Includes MSO conditionals for Outlook, email CSS reset, and hidden
 * preview text.
 */
export function wrapEmailDocument(options: WrapEmailDocumentOptions): string {
  const { bodyHtml, css, previewText, headContent, skipStyleBlock } = options;

  const previewHtml = previewText
    ? `<span style="display: none; font-size: 1px; color: #ffffff; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">${escapeHtml(previewText)}</span>`
    : '';

  const styleBlock = (!skipStyleBlock && css)
    ? `<style type="text/css">\n${css}\n</style>`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--[if !mso]><!-->
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--<![endif]-->
  <style type="text/css">
  ${EMAIL_RESET}
  </style>
  ${styleBlock}
  ${headContent || ''}
</head>
<body style="margin: 0; padding: 0;">
  ${previewHtml}
  <table role="presentation" id="body-table" cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%;">
    <tr>
      <td align="center" valign="top">
        ${bodyHtml}
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
