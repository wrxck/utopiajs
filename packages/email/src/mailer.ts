// ============================================================================
// @matthesketh/utopia-email — Mailer abstraction
// ============================================================================

import { renderEmail } from './render-email.js';
import type {
  EmailAdapter,
  EmailResult,
  MailerSendOptions,
} from './types.js';

export interface Mailer {
  send(options: MailerSendOptions): Promise<EmailResult>;
}

/**
 * Create a mailer instance with the given adapter.
 *
 * Usage:
 * ```ts
 * const mailer = createMailer(smtpAdapter({ host: '...', port: 587 }));
 * await mailer.send({
 *   to: 'user@example.com',
 *   from: 'noreply@example.com',
 *   subject: 'Welcome!',
 *   component: WelcomeEmail,
 *   props: { name: 'Alice' },
 * });
 * ```
 */
export function createMailer(adapter: EmailAdapter): Mailer {
  return {
    async send(options: MailerSendOptions): Promise<EmailResult> {
      const {
        to,
        from,
        subject,
        component,
        props,
        renderOptions,
        cc,
        bcc,
        replyTo,
        attachments,
      } = options;

      // Render the component to email HTML + plain text
      const rendered = renderEmail(component, props, {
        ...renderOptions,
        subject,
      });

      const emailSubject = subject ?? rendered.subject ?? '';

      // Send via adapter
      return adapter.send({
        to,
        from,
        subject: emailSubject,
        html: rendered.html,
        text: rendered.text,
        cc,
        bcc,
        replyTo,
        attachments,
      });
    },
  };
}
