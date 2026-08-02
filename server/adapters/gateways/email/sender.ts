import type { EmailMessageBuilder, SendEmail } from '@server/env'
import type { EmailGateway } from '@server/usecases/ports'
import type { EmailServiceSettings } from '@shared/api/management'
import { type EmailTemplate, renderEmailTemplate } from './templates'

export interface EmailSenderConfig {
  from: string
  fromName?: string
  replyTo?: string
}

export interface TransactionalEmail {
  to: string
  template: EmailTemplate
}

export function createEmailSender(binding: SendEmail, config: EmailSenderConfig): EmailGateway {
  return {
    async send(email: TransactionalEmail) {
      const rendered = renderEmailTemplate(email.template)
      const message: EmailMessageBuilder = {
        to: email.to,
        from: config.fromName ? { email: config.from, name: config.fromName } : config.from,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
      }

      return binding.send(message)
    },
  }
}

export function createConfiguredEmailSender(
  binding: SendEmail | undefined,
  loadSettings: () => Promise<EmailServiceSettings | null>,
  fallback?: EmailSenderConfig,
): EmailGateway {
  return {
    async send(email) {
      const stored = await loadSettings()
      if (stored && !stored.enabled) throw new Error('Email delivery is disabled.')
      const settings = stored
        ? {
            from: stored.fromEmail,
            ...(stored.fromName ? { fromName: stored.fromName } : {}),
            ...(stored.replyToEmail ? { replyTo: stored.replyToEmail } : {}),
          }
        : fallback
      if (!settings) throw new Error('Email sender settings are not configured.')
      if (!binding) throw new Error('Cloudflare Email binding is not configured for this deployment.')
      return createEmailSender(binding, settings).send(email)
    },
  }
}

export type TransactionalEmailSender = ReturnType<typeof createEmailSender>
