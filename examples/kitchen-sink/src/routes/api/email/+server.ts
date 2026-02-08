// API route: POST /api/email
// Demonstrates @utopia/email with SMTP adapter

import { createMailer } from '@utopia/email'
import { smtpAdapter } from '@utopia/email/smtp'
import type { IncomingMessage, ServerResponse } from 'node:http'

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
)

export async function POST(req: IncomingMessage, res: ServerResponse) {
  const body = await new Promise<string>((resolve) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk.toString() })
    req.on('end', () => resolve(data))
  })

  const { to, subject } = JSON.parse(body)

  try {
    // In a real app, you'd use a .utopia email component here
    // For this demo, we send a simple HTML email
    const result = await mailer.send({
      to: to ?? 'user@example.com',
      from: 'noreply@matthesketh.pro',
      subject: subject ?? 'Hello from UtopiaJS',
      component: {
        setup: () => ({}),
        render: () => {},
        styles: [],
      },
      props: {},
    })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: false, error: err.message }))
  }
}
