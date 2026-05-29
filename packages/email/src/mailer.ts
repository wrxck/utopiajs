// ============================================================================
// @matthesketh/utopia-email — Mailer abstraction
// ============================================================================

import { renderEmail } from './render-email';
import type { EmailAdapter, EmailResult, MailerSendOptions } from './types';

export interface Mailer {
  send(options: MailerSendOptions): Promise<EmailResult>;
}

/**
 * reject CR/LF in any field that becomes an email header. without this a value
 * like `"hi\r\nBcc: victim@x"` in a subject/recipient could inject extra
 * headers or a new body once an adapter writes raw smtp headers.
 */
function assertNoHeaderInjection(value: string | string[] | undefined, field: string): void {
  if (value === undefined) return;
  const values = Array.isArray(value) ? value : [value];
  for (const v of values) {
    if (typeof v === 'string' && /[\r\n]/.test(v)) {
      throw new Error(`Email header injection detected in "${field}"`);
    }
  }
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
      const { to, from, subject, component, props, renderOptions, cc, bcc, replyTo, attachments } =
        options;

      // Render the component to email HTML + plain text
      const rendered = renderEmail(component, props, {
        ...renderOptions,
        subject,
      });

      const emailSubject = subject ?? rendered.subject ?? '';

      // reject header injection before anything is handed to the adapter.
      assertNoHeaderInjection(to, 'to');
      assertNoHeaderInjection(from, 'from');
      assertNoHeaderInjection(emailSubject, 'subject');
      assertNoHeaderInjection(cc, 'cc');
      assertNoHeaderInjection(bcc, 'bcc');
      assertNoHeaderInjection(replyTo, 'replyTo');

      // send via adapter
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
