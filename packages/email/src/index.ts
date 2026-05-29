// ============================================================================
// @matthesketh/utopia-email — Public API
// ============================================================================

export { renderEmail } from './render-email';
export { createMailer } from './mailer';
export { inlineCSS } from './css-inliner';
export { htmlToText } from './html-to-text';

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
} from './components/index';

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
} from './types';
