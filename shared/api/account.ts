import { z } from 'zod'
import type { Agent } from './agent-api'
import type { PaginationMetadata } from './pagination'
import { accountProfileLinkSchema } from './public-profiles'
import { usernameSchema } from './users'

const providerCapabilitySchema = z.object({ available: z.boolean(), active: z.boolean() })

export const accountProviderConnectorSchema = z.object({
  id: z.string(),
  slug: z.string(),
  providerId: z.string(),
  providerType: z.string(),
  displayName: z.string(),
  capabilities: z.object({
    signIn: z.object({ available: z.boolean() }),
    agentAccess: z.object({ available: z.boolean() }),
    connection: z.object({ method: z.enum(['provider_authorization', 'sign_in']).nullable() }),
  }),
})

export const createProviderConnectionIntentSchema = z.object({ connectorId: z.string().trim().min(1) })

export const providerConnectionIntentSchema = z.object({
  id: z.string(),
  connectorId: z.string(),
  authorizationUrl: z.url(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})

export const accountProviderConnectionSchema = z.object({
  id: z.string(),
  connector: accountProviderConnectorSchema,
  displayName: z.string(),
  externalSubject: z.string(),
  capabilities: z.object({
    signIn: providerCapabilitySchema,
    agentAccess: providerCapabilitySchema.extend({
      authorizationCount: z.number().int().nonnegative(),
      resourceNames: z.array(z.string()),
    }),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const accountProviderConnectorsResponseSchema = z.object({
  items: z.array(accountProviderConnectorSchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
})

export const accountProviderConnectionsResponseSchema = z.object({
  items: z.array(accountProviderConnectionSchema),
  pagination: accountProviderConnectorsResponseSchema.shape.pagination,
})

export type AccountProviderConnector = z.infer<typeof accountProviderConnectorSchema>
export type AccountProviderConnection = z.infer<typeof accountProviderConnectionSchema>
export type CreateProviderConnectionIntentInput = z.infer<typeof createProviderConnectionIntentSchema>
export type ProviderConnectionIntent = z.infer<typeof providerConnectionIntentSchema>

export const accountProfileUpdateSchema = z.object({
  displayName: z.string().min(1).optional(),
  username: usernameSchema.nullable().optional(),
  avatarAssetId: z.string().min(1).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  location: z.string().trim().max(100).nullable().optional(),
  links: z.array(accountProfileLinkSchema).max(10).optional(),
})

export const accountEmailChangeSchema = z.object({
  email: z.email(),
  callbackURL: z.string().optional(),
})

export const accountEmailChangeConfirmSchema = z.object({
  email: z.email(),
  otp: z.string().min(1),
})

export const accountPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
  revokeOtherSessions: z.boolean().optional(),
})

export const accountWalletAddressLinkSchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  walletAddress: z
    .string()
    .regex(/^0[xX][a-fA-F0-9]{40}$/i)
    .length(42),
  chainId: z.number().int().positive(),
})

export type AccountProfileUpdateInput = z.infer<typeof accountProfileUpdateSchema>
export type AccountEmailChangeInput = z.infer<typeof accountEmailChangeSchema>
export type AccountEmailChangeConfirmInput = z.infer<typeof accountEmailChangeConfirmSchema>
export type AccountPasswordChangeInput = z.infer<typeof accountPasswordChangeSchema>
export type AccountWalletAddressLinkInput = z.infer<typeof accountWalletAddressLinkSchema>

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
    bio: string | null
    location: string | null
    links: Array<z.infer<typeof accountProfileLinkSchema>>
    role: string | null
  }
}

export type DeveloperConsoleAccessResponse = {
  canCreateOrganization: boolean
  showOrganizations: boolean
  platformOperator: boolean
  consoleOrganizations: Array<{
    organizationId: string
    accessLevel: 'owner' | 'admin' | 'developer'
  }>
}

export type AccountOrganizationContextResponse = {
  activeOrganizationId: string | null
}

export type AccountOrganizationAgentsResponse = {
  items: Agent[]
  pagination: PaginationMetadata
}

export type AccountOrganizationTeamMember = {
  id: string
  teamId: string
  userId: string
  createdAt: string
}

export type AccountOrganizationTeamMembersResponse = {
  items: AccountOrganizationTeamMember[]
  pagination: PaginationMetadata
}

export type LinkedAccountsResponse = {
  items: Array<{
    id: string
    accountId: string
    providerId: string
    createdAt: string
  }>
  pagination: PaginationMetadata
}

export type AccountSessionsResponse = {
  items: Array<{
    id: string
    expiresAt: string
    createdAt: string
    ipAddress: string | null
    userAgent: string | null
    current: boolean
  }>
  pagination: PaginationMetadata
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

export type { AccountAgent, AccountAgentGrant, AccountAgentsResponse } from './agents'
