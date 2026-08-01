// ============================================================================
// @matthesketh/utopia-email — Public API
// ============================================================================

export {
  EmailButton,
  EmailCard,
  EmailColumns,
  EmailDivider,
  EmailHeading,
  EmailImage,
  EmailLayout,
  EmailSpacer,
  EmailText,
} from '@/components/index';
export { inlineCSS } from '@/css-inliner';
export { htmlToText } from '@/html-to-text';
export { createMailer } from '@/mailer';
export { renderEmail } from '@/render-email';
export type {
  EmailAdapter,
  EmailAttachment,
  EmailMessage,
  EmailResult,
  MailerSendOptions,
  RenderEmailOptions,
  RenderEmailResult,
  ResendConfig,
  SendGridConfig,
  SmtpConfig,
} from '@/types';
