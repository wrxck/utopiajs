# @matthesketh/utopia-email

Template-based email rendering for UtopiaJS. Render `.utopia` components to email-safe HTML with CSS inlining and plain text fallback. Adapter pattern for sending via SMTP, Resend, or SendGrid.

## Install

```bash
pnpm add @matthesketh/utopia-email
```

Install a provider SDK as needed:

```bash
pnpm add nodemailer     # for SMTP
pnpm add resend         # for Resend
pnpm add @sendgrid/mail # for SendGrid
```

## Usage

```ts
import { createMailer } from '@matthesketh/utopia-email';
import { smtpAdapter } from '@matthesketh/utopia-email/smtp';
import WelcomeEmail from './emails/Welcome.utopia';

const mailer = createMailer(smtpAdapter({
  host: 'smtp.example.com',
  port: 587,
  auth: { user: 'user', pass: 'pass' },
}));

await mailer.send({
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Welcome!',
  component: WelcomeEmail,
  props: { name: 'Alice' },
});
```

## API

| Export | Description |
|--------|-------------|
| `createMailer(adapter)` | Create a mailer instance |
| `renderEmail(component, props?, options?)` | Render to `{ html, text, subject }` without sending |
| `inlineCSS(html, css)` | Inline CSS into `style=""` attributes |
| `htmlToText(html)` | Convert HTML to plain text |

**Built-in components:** `EmailLayout`, `EmailButton`, `EmailCard`, `EmailDivider`, `EmailHeading`, `EmailText`, `EmailImage`, `EmailColumns`, `EmailSpacer`.

**Adapters:** `@matthesketh/utopia-email/smtp`, `@matthesketh/utopia-email/resend`, `@matthesketh/utopia-email/sendgrid`.

See [docs/email.md](../../docs/email.md) for the full rendering pipeline, component reference, and type documentation.

## License

MIT
