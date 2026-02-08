// ============================================================================
// @matthesketh/utopia-email — SendGrid Adapter
// ============================================================================

import type { EmailAdapter, EmailMessage, EmailResult, SendGridConfig } from '../types.js';

/**
 * Create a SendGrid email adapter.
 *
 * Requires `@sendgrid/mail` as a peer dependency.
 */
export function sendgridAdapter(config: SendGridConfig): EmailAdapter {
  let client: any = null;

  async function getClient(): Promise<any> {
    if (client) return client;

    let sgMail: any;
    try {
      const mod = await import('@sendgrid/mail');
      sgMail = mod.default ?? mod;
    } catch {
      throw new Error(
        '@matthesketh/utopia-email: "@sendgrid/mail" package is required for the SendGrid adapter. ' +
        'Install it with: npm install @sendgrid/mail',
      );
    }

    sgMail.setApiKey(config.apiKey);
    client = sgMail;
    return client;
  }

  return {
    async send(message: EmailMessage): Promise<EmailResult> {
      try {
        const sg = await getClient();

        const msg: Record<string, any> = {
          to: Array.isArray(message.to) ? message.to : [message.to],
          from: message.from,
          subject: message.subject,
          html: message.html,
          text: message.text,
        };

        if (message.cc) {
          msg.cc = Array.isArray(message.cc) ? message.cc : [message.cc];
        }
        if (message.bcc) {
          msg.bcc = Array.isArray(message.bcc) ? message.bcc : [message.bcc];
        }
        if (message.replyTo) {
          msg.replyTo = message.replyTo;
        }
        if (message.headers) {
          msg.headers = message.headers;
        }
        if (message.attachments) {
          msg.attachments = message.attachments.map((a) => ({
            filename: a.filename,
            content: typeof a.content === 'string' ? a.content : a.content.toString('base64'),
            type: a.contentType,
            disposition: 'attachment',
          }));
        }

        const [response] = await sg.send(msg);

        return {
          success: true,
          messageId: response?.headers?.['x-message-id'],
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message ?? String(err),
        };
      }
    },
  };
}
