// ============================================================================
// @matthesketh/utopia-email — Resend Adapter
// ============================================================================

import type { EmailAdapter, EmailMessage, EmailResult, ResendConfig } from '../types.js';

/**
 * Create a Resend email adapter.
 *
 * Requires `resend` as a peer dependency.
 */
export function resendAdapter(config: ResendConfig): EmailAdapter {
  let client: import('resend').Resend | null = null;

  async function getClient(): Promise<import('resend').Resend> {
    if (client) return client;

    let ResendCtor: new (apiKey: string) => import('resend').Resend;
    try {
      const mod = await import('resend');
      ResendCtor = mod.Resend ?? mod.default;
    } catch {
      throw new Error(
        '@matthesketh/utopia-email: "resend" package is required for the Resend adapter. ' +
          'Install it with: npm install resend',
      );
    }

    client = new ResendCtor(config.apiKey);
    return client;
  }

  return {
    async send(message: EmailMessage): Promise<EmailResult> {
      try {
        const resend = await getClient();

        const result = await resend.emails.send({
          from: message.from,
          to: Array.isArray(message.to) ? message.to : [message.to],
          cc: message.cc ? (Array.isArray(message.cc) ? message.cc : [message.cc]) : undefined,
          bcc: message.bcc ? (Array.isArray(message.bcc) ? message.bcc : [message.bcc]) : undefined,
          reply_to: message.replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
          attachments: message.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            content_type: a.contentType,
          })),
        });

        return {
          success: true,
          messageId: result.data?.id ?? result.id,
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
