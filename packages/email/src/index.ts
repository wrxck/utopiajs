// ============================================================================
// @matthesketh/utopia-email — Public API
// ============================================================================

export { renderEmail } from './render-email.js';
export { createMailer } from './mailer.js';
export { inlineCSS } from './css-inliner.js';
export { htmlToText } from './html-to-text.js';

export {
  EmailLayout,
  EmailButton,
  EmailCard,
  EmailDivider,
  EmailHeading,
  EmailText,
  EmailImage,
  EmailColumns,
  EmailSpacer,
} from './components/index.js';

export type {
  RenderEmailOptions,
  RenderEmailResult,
  EmailAdapter,
  EmailMessage,
  EmailResult,
  EmailAttachment,
  MailerSendOptions,
  SmtpConfig,
  ResendConfig,
  SendGridConfig,
} from './types.js';
