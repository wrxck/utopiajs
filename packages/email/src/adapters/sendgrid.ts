// ============================================================================
// @matthesketh/utopia-email — SendGrid Adapter
// ============================================================================

import type { EmailAdapter, EmailMessage, EmailResult, SendGridConfig } from '../types';

/**
 * Create a SendGrid email adapter.
 *
 * Requires `@sendgrid/mail` as a peer dependency.
 */
interface SendGridClient {
  setApiKey(key: string): void;
  send(
    msg: Record<string, unknown>,
  ): Promise<[{ statusCode: number; headers: Record<string, string> }, Record<string, unknown>]>;
}

export function sendgridAdapter(config: SendGridConfig): EmailAdapter {
  // Cache the in-flight promise (not the resolved client) so concurrent sends
  // share one lazily-initialised client instead of racing past the null check
  // and each initialising their own.
  let clientPromise: Promise<SendGridClient> | null = null;

  function getClient(): Promise<SendGridClient> {
    if (!clientPromise) {
      clientPromise = createClient().catch((err: unknown) => {
        // Allow a later send to retry after a failed initialisation.
        clientPromise = null;
        throw err;
      });
    }
    return clientPromise;
  }

  async function createClient(): Promise<SendGridClient> {
    let sgMail: SendGridClient;
    try {
      const mod = await import('@sendgrid/mail');
      sgMail = (mod.default ?? mod) as unknown as SendGridClient;
    } catch {
      throw new Error(
        '@matthesketh/utopia-email: "@sendgrid/mail" package is required for the SendGrid adapter. ' +
          'Install it with: npm install @sendgrid/mail',
      );
    }

    sgMail.setApiKey(config.apiKey);
    return sgMail;
  }

  return {
    async send(message: EmailMessage): Promise<EmailResult> {
      try {
        const sg = await getClient();

        const msg: Record<string, unknown> = {
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
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
