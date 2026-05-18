import { describe, expect, it, vi } from 'vitest'
import { createEmailSender } from './sender'
import { renderEmailTemplate } from './templates'

describe('createEmailSender', () => {
  it('sends rendered transactional email through the injected binding', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'email-1' })
    const sender = createEmailSender(
      { send },
      {
        from: 'noreply@example.com',
        fromName: 'FlareAuth',
      },
    )

    await expect(
      sender.send({
        to: 'user@example.com',
        template: {
          type: 'verification',
          url: 'https://auth.example.com/verify',
        },
      }),
    ).resolves.toEqual({ messageId: 'email-1' })

    expect(send).toHaveBeenCalledWith({
      to: 'user@example.com',
      from: {
        email: 'noreply@example.com',
        name: 'FlareAuth',
      },
      subject: 'Verify your email address',
      text: 'Verify your email address\n\nhttps://auth.example.com/verify',
      html: '<p>Verify your email address</p><p><a href="https://auth.example.com/verify">https://auth.example.com/verify</a></p>',
    })
  })
})

describe('renderEmailTemplate', () => {
  it('renders auth and security notification templates', () => {
    expect([
      renderEmailTemplate({ type: 'password-reset', url: 'https://auth.example.com/reset' }).subject,
      renderEmailTemplate({ type: 'invitation', inviterName: 'Admin', url: 'https://auth.example.com/invite' }).subject,
      renderEmailTemplate({ type: 'magic-link', url: 'https://auth.example.com/magic', otp: '123456' }).text,
      renderEmailTemplate({ type: 'otp', otp: '654321' }).text,
      renderEmailTemplate({ type: 'security-notification', title: 'New login', body: 'A new login was detected.' })
        .subject,
    ]).toEqual([
      'Reset your password',
      'You were invited to FlareAuth',
      'Sign in to FlareAuth\n\nhttps://auth.example.com/magic\n\nYour one-time code is 123456.',
      'Your one-time code is 654321.',
      'New login',
    ])
  })
})
