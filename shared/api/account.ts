import { z } from 'zod'
import { usernameSchema } from './users'

export const accountProfileUpdateSchema = z.object({
  displayName: z.string().min(1).optional(),
  username: usernameSchema.nullable().optional(),
  avatarAssetId: z.string().min(1).nullable().optional(),
})

export const accountEmailChangeSchema = z.object({
  email: z.email(),
  callbackURL: z.string().optional(),
})

export const accountPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
  revokeOtherSessions: z.boolean().optional(),
})

export type AccountProfileUpdateInput = z.infer<typeof accountProfileUpdateSchema>
export type AccountEmailChangeInput = z.infer<typeof accountEmailChangeSchema>
export type AccountPasswordChangeInput = z.infer<typeof accountPasswordChangeSchema>

export type AccountProfileResponse = {
  user: {
    id: string
    email: string
    emailVerified: boolean
    displayName: string
    name?: string
    username: string | null
    avatarAssetId: string | null
    image: string | null
    role: string | null
  }
}

export type LinkedAccountsResponse = {
  accounts: Array<{
    id: string
    accountId: string
    providerId: string
    createdAt: string
  }>
}

export type ConsentedApplicationsResponse = {
  applications: Array<{
    id: string
    applicationName: string
    applicationSlug: string
    scopes: string[]
    grantedAt: string
    expiresAt: string | null
  }>
}

export type AccountSessionsResponse = {
  sessions: Array<{
    id: string
    expiresAt: string
    createdAt: string
    ipAddress: string | null
    userAgent: string | null
  }>
}

export type AccountSecurityResponse = {
  security: {
    mfa: { enabled: boolean; factors: Array<{ id: string; type: string; verified: boolean | null }> }
    passkeys: { enabled: boolean; count: number }
    policy: {
      mfa: { mode: 'optional' | 'required' }
      passkeys: { enabled: boolean; rpName: string }
    }
  }
}
