import type { EmailMessageBuilder, SendEmail } from '../../../shared/env'
import { type EmailTemplate, renderEmailTemplate } from './templates'

export interface EmailSenderConfig {
  from: string
  fromName?: string
}

export interface TransactionalEmail {
  to: string
  template: EmailTemplate
}

export function createEmailSender(binding: SendEmail, config: EmailSenderConfig) {
  return {
    async send(email: TransactionalEmail) {
      const rendered = renderEmailTemplate(email.template)
      const message: EmailMessageBuilder = {
        to: email.to,
        from: config.fromName ? { email: config.from, name: config.fromName } : config.from,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }

      return binding.send(message)
    },
  }
}

export type TransactionalEmailSender = ReturnType<typeof createEmailSender>
