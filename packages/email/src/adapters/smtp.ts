// ============================================================================
// @matthesketh/utopia-email — SMTP Adapter (nodemailer)
// ============================================================================

import type { EmailAdapter, EmailMessage, EmailResult, SmtpConfig } from '../types';

/**
 * Create an SMTP email adapter using nodemailer.
 *
 * Requires `nodemailer` as a peer dependency.
 */
export function smtpAdapter(config: SmtpConfig): EmailAdapter {
  // Cache the in-flight promise (not the resolved transporter) so concurrent
  // sends share one lazily-created transport instead of racing past the null
  // check and each constructing their own connection pool.
  let transporterPromise: Promise<import('nodemailer').Transporter> | null = null;

  function getTransporter(): Promise<import('nodemailer').Transporter> {
    if (!transporterPromise) {
      transporterPromise = createTransporter().catch((err: unknown) => {
        // Allow a later send to retry after a failed initialisation.
        transporterPromise = null;
        throw err;
      });
    }
    return transporterPromise;
  }

  async function createTransporter(): Promise<import('nodemailer').Transporter> {
    let nodemailer: typeof import('nodemailer');
    try {
      nodemailer = await import('nodemailer');
    } catch {
      throw new Error(
        '@matthesketh/utopia-email: "nodemailer" package is required for the SMTP adapter. ' +
          'Install it with: npm install nodemailer',
      );
    }

    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? config.port === 465,
      auth: config.auth,
    });
  }

  return {
    async send(message: EmailMessage): Promise<EmailResult> {
      try {
        const transport = await getTransporter();

        const info = await transport.sendMail({
          from: message.from,
          to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
          cc: message.cc
            ? Array.isArray(message.cc)
              ? message.cc.join(', ')
              : message.cc
            : undefined,
          bcc: message.bcc
            ? Array.isArray(message.bcc)
              ? message.bcc.join(', ')
              : message.bcc
            : undefined,
          replyTo: message.replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
          attachments: message.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
            encoding: a.encoding,
          })),
        });

        return {
          success: true,
          messageId: info.messageId,
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
