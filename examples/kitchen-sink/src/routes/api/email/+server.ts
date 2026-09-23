// API route: POST /api/email
// Demonstrates @matthesketh/utopia-email with SMTP adapter

import { createMailer } from '@matthesketh/utopia-email';
import { smtpAdapter } from '@matthesketh/utopia-email/smtp';
import type { RequestEvent } from '@matthesketh/utopia-server';

import Welcome from '../../../emails/Welcome.utopia';

const mailer = createMailer(
  smtpAdapter({
    host: process.env.SMTP_HOST ?? 'smtp.mailtrap.io',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
  }),
);

export async function POST({ request }: RequestEvent) {
  const { to, subject, name } = await request.json();

  try {
    // Welcome.utopia is an ordinary component; its <style> block is inlined
    // into the email by renderEmail.
    const result = await mailer.send({
      to: to ?? 'user@example.com',
      from: 'noreply@matthesketh.pro',
      subject: subject ?? 'Hello from UtopiaJS',
      component: Welcome,
      props: { name: name ?? 'there' },
    });
    return Response.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return Response.json({ success: false, error }, { status: 500 });
  }
}
