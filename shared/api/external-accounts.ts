import { z } from 'zod'

export const externalCredentialKindSchema = z.enum(['oauth', 'bearer', 'header'])
export const externalAccountOwnerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user') }),
  z.object({ type: z.literal('organization'), organizationId: z.string().min(1) }),
  z.object({ type: z.literal('agent'), agentIdentityId: z.string().min(1) }),
])

export const createExternalAccountRequestSchema = z.object({
  connectorId: z.string().min(1),
  owner: externalAccountOwnerSchema,
  displayName: z.string().trim().min(1),
  credential: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('bearer'), token: z.string().min(1) }),
    z.object({ kind: z.literal('header'), value: z.string().min(1) }),
  ]),
})

export const createExternalOAuthIntentRequestSchema = z.object({
  connectorId: z.string().min(1),
  owner: externalAccountOwnerSchema,
  displayName: z.string().trim().min(1),
  scopes: z.array(z.string().trim().min(1)).optional(),
})

export const externalOAuthCallbackQuerySchema = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
})

export const createExternalAccountGrantRequestSchema = z.object({
  agentIdentityId: z.string().min(1),
  scopes: z.array(z.string().trim().min(1)).default([]),
  allowedMethods: z.array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])).min(1),
  allowedPathPrefixes: z.array(z.string().startsWith('/')).min(1),
  expiresAt: z.iso.datetime().optional(),
})

export const externalAccountSchema = z.object({
  id: z.string(),
  connectorId: z.string(),
  owner: z.discriminatedUnion('type', [
    z.object({ type: z.literal('user'), userId: z.string() }),
    z.object({ type: z.literal('organization'), organizationId: z.string() }),
    z.object({ type: z.literal('agent'), agentIdentityId: z.string() }),
  ]),
  externalSubject: z.string().nullable(),
  displayName: z.string(),
  status: z.enum(['active', 'revoked']),
  credentialKind: externalCredentialKindSchema,
  credentialConfigured: z.literal(true),
  credentialExpiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const externalAccountGrantSchema = z.object({
  id: z.string(),
  externalAccountId: z.string(),
  agentIdentityId: z.string(),
  scopes: z.array(z.string()),
  allowedMethods: z.array(z.string()),
  allowedPathPrefixes: z.array(z.string()),
  status: z.enum(['active', 'revoked']),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type CreateExternalAccountRequest = z.infer<typeof createExternalAccountRequestSchema>
export type CreateExternalOAuthIntentRequest = z.infer<typeof createExternalOAuthIntentRequestSchema>
export type CreateExternalAccountGrantRequest = z.infer<typeof createExternalAccountGrantRequestSchema>
