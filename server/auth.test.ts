import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { createAuth } from './auth'
import type { Database } from './db/client'

describe('createAuth OAuth Provider metadata', () => {
  it('serves OIDC discovery from the mounted Better Auth issuer', async () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
    )

    const response = await createApp(auth).request('/api/auth/.well-known/openid-configuration')

    expect(response.status).toBe(200)
    const metadata = (await response.json()) as {
      token_endpoint_auth_methods_supported: string[]
    }

    expect(metadata).toMatchObject({
      issuer: 'https://auth.example.com/api/auth',
      authorization_endpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      token_endpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwks_uri: 'https://auth.example.com/api/auth/jwks',
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    })
    expect(metadata.token_endpoint_auth_methods_supported).not.toContain('none')
  })

  it('wires Better Auth email flows to the transactional email sender', async () => {
    const emailSender = createEmailSenderMock()
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      emailSender,
    )

    await auth.options.emailVerification?.sendVerificationEmail?.({
      user: createUser(),
      url: 'https://auth.example.com/verify',
      token: 'verification-token',
    })
    await auth.options.emailAndPassword?.sendResetPassword?.({
      user: createUser(),
      url: 'https://auth.example.com/reset',
      token: 'reset-token',
    })
    await auth.options.emailAndPassword?.onPasswordReset?.({
      user: createUser(),
    })

    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: {
        type: 'verification',
        url: 'https://auth.example.com/verify',
      },
    })
    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: {
        type: 'password-reset',
        url: 'https://auth.example.com/reset',
      },
    })
    expect(emailSender.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      template: {
        type: 'security-notification',
        title: 'Your password was changed',
        body: 'Your FlareAuth password was changed. If this was not you, reset your password immediately.',
      },
    })
  })

  it('exposes magic link, email OTP, and organization invitation APIs', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
    )

    expect(Object.keys(auth.api)).toEqual(
      expect.arrayContaining([
        'signInMagicLink',
        'sendVerificationOTP',
        'requestPasswordResetEmailOTP',
        'createInvitation',
      ]),
    )
  })

  it('configures account profile fields and email changes', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
    )

    expect(auth.options.user?.changeEmail?.enabled).toBe(true)
    expect(auth.options.user?.additionalFields).toMatchObject({
      username: {
        type: 'string',
        required: false,
        unique: true,
        fieldName: 'username',
      },
      avatarAssetId: {
        type: 'string',
        required: false,
        fieldName: 'avatar_asset_id',
      },
    })
  })
})

function createEmailSenderMock() {
  return {
    send: vi.fn().mockResolvedValue({ messageId: 'email-1' }),
  }
}

function createUser() {
  return {
    id: 'user-1',
    name: 'User',
    email: 'user@example.com',
    emailVerified: false,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
