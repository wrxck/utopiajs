// ============================================================================
// @matthesketh/utopia-email — Resend Adapter
// ============================================================================

import type { EmailAdapter, EmailMessage, EmailResult, ResendConfig } from '../types';

/**
 * Create a Resend email adapter.
 *
 * Requires `resend` as a peer dependency.
 */
export function resendAdapter(config: ResendConfig): EmailAdapter {
  // Cache the in-flight promise (not the resolved client) so concurrent sends
  // share one lazily-created client instead of racing past the null check and
  // each constructing their own.
  let clientPromise: Promise<import('resend').Resend> | null = null;

  function getClient(): Promise<import('resend').Resend> {
    if (!clientPromise) {
      clientPromise = createClient().catch((err: unknown) => {
        // Allow a later send to retry after a failed initialisation.
        clientPromise = null;
        throw err;
      });
    }
    return clientPromise;
  }

  async function createClient(): Promise<import('resend').Resend> {
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

    return new ResendCtor(config.apiKey);
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

        // resend v3+ does not throw on API errors — it resolves
        // { data: null, error }; report those as failures, not successes.
        if (result.error) {
          return {
            success: false,
            error: result.error.message ?? String(result.error),
          };
        }

        return {
          success: true,
          messageId: result.data?.id,
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
