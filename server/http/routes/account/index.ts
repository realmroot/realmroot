import { badRequest, forbidden, notFound } from '@server/domain/errors'
import { validateEmailPolicy, validatePasswordPolicy } from '@server/domain/security/policy'
import {
  listAccountOrganizationAgents,
  listAccountOrganizationTeamMembers,
} from '@server/usecases/account-organizations'
import {
  activateAgentIdentity,
  approveAgentEnrollment,
  deactivateAgentIdentity,
  deleteAgentIdentity,
  getPersonalAgent,
  getPublicAgentEnrollment,
  listPersonalAgents,
  recoverAgentIdentity,
  toAgent,
} from '@server/usecases/agent-identities'
import { decideAgentApproval, getAgentApprovalPreview } from '@server/usecases/agents'
import {
  getApplicationAuthorization,
  listApplicationAuthorizations,
  putApplicationAuthorizationRevocation,
} from '@server/usecases/applications'
import { getConfig } from '@server/usecases/configz'
import { resolveDeveloperAccess } from '@server/usecases/developer-access'
import {
  createAccountConnection,
  createProviderConnectionIntent,
  decideAccessRequest,
  disconnectProviderConnection,
  getAccountAccessRequest,
  getAccountAccessRequestByToken,
  getAccountConnection,
  listAccessRequestConnections,
  listAccountAccessRequestAuthorizationDetailCatalog,
  listAccountAccessRequests,
  listAccountConnections,
  listAccountProviderConnections,
  listAccountProviderConnectors,
  listConnectableExternalResources,
  revokeResourceConnection,
} from '@server/usecases/external-resources'
import type { ConfigzAccountCenter } from '@server/usecases/ports'
import {
  accountEmailChangeConfirmSchema,
  accountEmailChangeSchema,
  accountOrganizationTeamMembersResponseSchema,
  accountPasswordChangeSchema,
  accountProfileUpdateSchema,
  accountProviderConnectionsResponseSchema,
  accountProviderConnectorsResponseSchema,
  accountWalletAddressLinkSchema,
  createProviderConnectionIntentSchema,
  providerConnectionIntentSchema,
} from '@shared/api/account'
import {
  accessRequestApprovalsResponseSchema,
  accessRequestSchema,
  accountConnectionSchema,
  accountConnectionsResponseSchema,
  agentEnrollmentSchema,
  agentResponseSchema,
  agentsResponseSchema,
  authorizationDetailCatalogResponseSchema,
  connectableApiResourcesResponseSchema,
  createAccountConnectionSchema,
  decideAccessRequestSchema,
  decideAgentEnrollmentSchema,
} from '@shared/api/agent-api'
import { agentApprovalPreviewSchema, decideAgentApprovalResponseSchema } from '@shared/api/agents'
import {
  listApplicationAuthorizationsQuerySchema,
  listApplicationAuthorizationsResponseSchema,
} from '@shared/api/applications'
import { linkAccountRequestSchema, unlinkAccountQuerySchema } from '@shared/api/connectors'
import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import type { SecurityPolicy } from '@shared/api/security'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { getAddress, verifyMessage } from 'viem'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { z } from 'zod'
import { configzOptions } from '../../app-config'
import { getPrincipal } from '../../middleware/authn'
import { authenticatedUser } from '../../middleware/authz'
import { getDeps } from '../../middleware/deps'
import type { ManagementAuthApi } from '../auth-api'
import { toBoundaryError } from '../auth-api'
import { readJson, readQuery } from '../validation'
import { accountSecurityRoutes } from './security'

export function accountRoutes(authApi: ManagementAuthApi, securityPolicy?: SecurityPolicy, canonicalOrigin?: string) {
  const app = new Hono()

  app.use('*', authenticatedUser())

  app.get('/profile', async (c) => c.json(await accountProfile(c)))

  app.get('/developer-console-access', async (c) => {
    const deps = getDeps(c)
    return c.json(await resolveDeveloperAccess(deps, await deps.users.getUser(getPrincipal(c).user!.id)))
  })

  app.get('/organization-context', (c) =>
    c.json({ activeOrganizationId: getPrincipal(c).session?.session.activeOrganizationId ?? null }),
  )

  app.patch('/profile', async (c) => {
    const body = await readJson(c, accountProfileUpdateSchema)
    await assertProfileUpdateAllowed(c, body, securityPolicy)
    await getDeps(c).users.updateProfile(getPrincipal(c).user!.id, body)
    return c.json(await accountProfile(c))
  })

  app.post('/email/change', async (c) => {
    await assertAccountCenterSettingsAllowed(
      c,
      ['profileEditingEnabled', 'emailChangeEnabled'],
      'Email changes are disabled for this account center.',
      securityPolicy,
    )
    const body = await readJson(c, accountEmailChangeSchema)
    validateEmailPolicy(body.email, (await getDeps(c).security.getPolicy()).blocklist)

    try {
      return c.json(
        await authApi.requestEmailChangeEmailOTP({
          body: {
            newEmail: body.email,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/email/confirm', async (c) => {
    await assertAccountCenterSettingsAllowed(
      c,
      ['profileEditingEnabled', 'emailChangeEnabled'],
      'Email changes are disabled for this account center.',
      securityPolicy,
    )
    const body = await readJson(c, accountEmailChangeConfirmSchema)
    validateEmailPolicy(body.email, (await getDeps(c).security.getPolicy()).blocklist)

    try {
      return c.json(
        await authApi.changeEmailEmailOTP({
          body: {
            newEmail: body.email,
            otp: body.otp,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/email/verification', async (c) => {
    const email = getPrincipal(c).user!.email

    if (!email) {
      throw badRequest('Current user email is required.')
    }

    try {
      return c.json(
        await authApi.sendVerificationEmail({
          body: { email },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/password/change', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'passwordChangeEnabled',
      'Password changes are disabled for this account center.',
      securityPolicy,
    )
    const body = await readJson(c, accountPasswordChangeSchema)
    const policy = await getDeps(c).security.getPolicy()
    const user = getPrincipal(c).user!
    validatePasswordPolicy(body.newPassword, policy.password, {
      email: user.email,
      name: user.name,
      username: typeof user.username === 'string' ? user.username : null,
    })

    try {
      return await authApi.changePassword({
        asResponse: true,
        body: {
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
          revokeOtherSessions: body.revokeOtherSessions,
        },
        headers: c.req.raw.headers,
      })
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/wallet-addresses', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Connected account access is disabled for this account center.',
      securityPolicy,
    )
    const wallets = getDeps(c).wallets
    const body = await readJson(c, accountWalletAddressLinkSchema)
    const walletAddress = getAddress(body.walletAddress)
    const config = await accountCenterConfig(c, securityPolicy)
    if (!config.builtInProviders.web3Wallet.enabled) {
      throw forbidden('Web3 wallet linking is disabled.')
    }
    if (!config.builtInProviders.web3Wallet.chains.includes(body.chainId)) {
      throw badRequest('This wallet network is not enabled.')
    }

    const nonce = await wallets.getSiweNonce(walletAddress, body.chainId)
    if (!nonce || new Date() > nonce.expiresAt) throw forbidden('Invalid or expired wallet challenge.')
    const nonceValue = nonce.value.split(':')[0]

    const message = parseSiweMessage(body.message)
    const valid = validateSiweMessage({
      address: walletAddress as `0x${string}`,
      domain: siweDomain(c, ''),
      message,
      nonce: nonceValue,
    })
    if (!valid || message.chainId !== body.chainId) throw forbidden('Invalid wallet challenge.')

    const verified = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message: body.message,
      signature: body.signature as `0x${string}`,
    })
    if (!verified) throw forbidden('Invalid wallet signature.')

    await wallets.deleteSiweNonce(walletAddress, body.chainId)
    await wallets.linkWalletAddress(getPrincipal(c).user!.id, {
      address: walletAddress,
      chainId: body.chainId,
    })
    return c.json({}, 201)
  })

  app.delete('/wallet-addresses/:accountId', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Connected account access is disabled for this account center.',
      securityPolicy,
    )
    await getDeps(c).wallets.unlinkWalletAddress(getPrincipal(c).user!.id, c.req.param('accountId'))
    return c.body(null, 204)
  })

  app.get('/linked-accounts', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Connected account access is disabled for this account center.',
      securityPolicy,
    )
    const page = await getDeps(c).users.listLinkedAccounts(
      getPrincipal(c).user!.id,
      readQuery(c, paginationQuerySchema),
    )
    return c.json({ items: page.items, pagination: paginationMetadata(page) })
  })

  app.post('/linked-accounts', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Connected account access is disabled for this account center.',
      securityPolicy,
    )
    const body = await readJson(c, linkAccountRequestSchema)

    try {
      if (body.providerType === 'generic_oauth') {
        return c.json(
          await authApi.oAuth2LinkAccount({
            body: {
              providerId: body.providerId,
              callbackURL: body.callbackURL,
              errorCallbackURL: body.errorCallbackURL,
              scopes: body.scopes,
            },
            headers: c.req.raw.headers,
          }),
        )
      }

      return c.json(
        await authApi.linkSocialAccount({
          body: {
            provider: body.providerId,
            callbackURL: body.callbackURL,
            errorCallbackURL: body.errorCallbackURL,
            scopes: body.scopes,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.delete('/linked-accounts/:providerId', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Connected account access is disabled for this account center.',
      securityPolicy,
    )
    const query = readQuery(c, unlinkAccountQuerySchema)

    try {
      return c.json(
        await authApi.unlinkAccount({
          body: {
            providerId: c.req.param('providerId'),
            accountId: query.accountId,
          },
          headers: c.req.raw.headers,
        }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/application-authorizations', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Authorized application access is disabled for this account center.',
      securityPolicy,
    )
    return c.json(
      listApplicationAuthorizationsResponseSchema.parse(
        await listApplicationAuthorizations(getDeps(c), {
          ...readQuery(c, listApplicationAuthorizationsQuerySchema),
          userId: getPrincipal(c).user!.id,
          status: 'active',
        }),
      ),
    )
  })

  app.delete('/application-authorizations/:authorizationId', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Authorized application access is disabled for this account center.',
      securityPolicy,
    )
    const authorization = await getApplicationAuthorization(getDeps(c), c.req.param('authorizationId'))
    if (authorization.user.id !== getPrincipal(c).user!.id) {
      throw notFound('Application authorization was not found.')
    }
    await putApplicationAuthorizationRevocation(getDeps(c), authorization.id)
    return c.body(null, 204)
  })

  app.get('/sessions', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'sessionsViewEnabled',
      'Session management is disabled for this account center.',
      securityPolicy,
    )
    const authContext = getPrincipal(c)
    const page = await getDeps(c).users.listSessions(authContext.user!.id, readQuery(c, paginationQuerySchema))
    const currentSessionId = authContext.session?.session.id
    return c.json({
      items: page.items.map((session) => ({ ...session, current: session.id === currentSessionId })),
      pagination: paginationMetadata(page),
    })
  })

  app.get('/agents', async (c) => {
    return c.json(
      agentsResponseSchema.parse(
        await listPersonalAgents(getDeps(c), getPrincipal(c).user!.id, readQuery(c, paginationQuerySchema)),
      ),
    )
  })

  app.get('/agents/:agentId', async (c) => {
    return c.json(
      agentResponseSchema.parse({
        agent: await getPersonalAgent(getDeps(c), c.req.param('agentId'), getPrincipal(c).user!.id),
      }),
    )
  })

  app.delete('/agents/:agentId', async (c) => {
    await deleteAgentIdentity(getDeps(c), c.req.param('agentId'), getPrincipal(c).user!.id)
    return c.body(null, 204)
  })

  app.put('/agents/:agentId/activation', async (c) => {
    await activateAgentIdentity(getDeps(c), c.req.param('agentId'), getPrincipal(c).user!.id)
    return c.body(null, 204)
  })

  app.delete('/agents/:agentId/activation', async (c) => {
    await deactivateAgentIdentity(getDeps(c), c.req.param('agentId'), getPrincipal(c).user!.id)
    return c.body(null, 204)
  })

  app.post('/agents/:agentId/recovery', async (c) => {
    await recoverAgentIdentity(getDeps(c), c.req.param('agentId'), getPrincipal(c).user!.id)
    return c.body(null, 202)
  })

  app.get('/organizations/:organizationId/agents', async (c) => {
    return c.json(
      await listAccountOrganizationAgents(
        getDeps(c),
        c.req.param('organizationId'),
        getPrincipal(c).user!.id,
        readQuery(c, paginationQuerySchema),
      ),
    )
  })

  app.get('/organizations/:organizationId/teams/:teamId/members', async (c) => {
    return c.json(
      accountOrganizationTeamMembersResponseSchema.parse(
        await listAccountOrganizationTeamMembers(
          getDeps(c),
          c.req.param('organizationId'),
          c.req.param('teamId'),
          getPrincipal(c).user!.id,
          readQuery(c, paginationQuerySchema),
        ),
      ),
    )
  })

  app.get('/agent-enrollments/:enrollmentId', async (c) => {
    return c.json(
      agentEnrollmentSchema.parse(
        await getPublicAgentEnrollment(getDeps(c), c.req.param('enrollmentId'), getPrincipal(c).user!.id),
      ),
    )
  })

  app.get('/agent-approvals/:agentId', async (c) => {
    const query = readQuery(c, z.object({ user_code: z.string().trim().min(1) }))
    return c.json(
      agentApprovalPreviewSchema.parse(
        await getAgentApprovalPreview(
          getDeps(c),
          { agentId: c.req.param('agentId'), userCode: query.user_code },
          getPrincipal(c).user!.id,
        ),
      ),
    )
  })

  app.put('/agent-enrollments/:enrollmentId/decision', async (c) => {
    const input = await readJson(c, decideAgentEnrollmentSchema)
    if (input.kind === 'protocol') {
      const result = await decideAgentApproval(
        getDeps(c),
        {
          agentId: c.req.param('enrollmentId'),
          userCode: input.userCode,
          action: input.decision,
          capabilities: [],
        },
        getPrincipal(c).user!.id,
      )
      return c.json(decideAgentApprovalResponseSchema.parse(result))
    }
    const result = await approveAgentEnrollment(
      getDeps(c),
      c.req.param('enrollmentId'),
      `${(canonicalOrigin ?? new URL(c.req.url).origin).replace(/\/$/, '')}/api/auth`,
      getPrincipal(c).user!.id,
    )
    return c.json(agentResponseSchema.parse({ agent: toAgent(result.identity) }))
  })

  app.get('/account-connections', async (c) => {
    const pagination = readQuery(c, paginationQuerySchema)
    const approvalToken = c.req.query('approvalToken')
    return c.json(
      accountConnectionsResponseSchema.parse(
        approvalToken
          ? await listAccessRequestConnections(getDeps(c), approvalToken, getPrincipal(c).user!.id, pagination)
          : await listAccountConnections(getDeps(c), getPrincipal(c).user!.id, pagination),
      ),
    )
  })

  app.get('/provider-connectors', async (c) => {
    return c.json(
      accountProviderConnectorsResponseSchema.parse(
        await listAccountProviderConnectors(getDeps(c), readQuery(c, paginationQuerySchema)),
      ),
    )
  })

  app.get('/provider-connections', async (c) => {
    return c.json(
      accountProviderConnectionsResponseSchema.parse(
        await listAccountProviderConnections(getDeps(c), getPrincipal(c).user!.id, readQuery(c, paginationQuerySchema)),
      ),
    )
  })

  app.post('/provider-connection-intents', async (c) => {
    const origin = canonicalOrigin ?? new URL(c.req.url).origin
    const input = await readJson(c, createProviderConnectionIntentSchema)
    const result = await createProviderConnectionIntent(
      getDeps(c),
      input.connectorId,
      getPrincipal(c).user!.id,
      origin,
      accountConnectionSigner(authApi, origin),
    )
    return c.json(providerConnectionIntentSchema.parse(result), 201)
  })

  app.delete('/provider-connections/:connectionId', async (c) => {
    const origin = canonicalOrigin ?? new URL(c.req.url).origin
    await disconnectProviderConnection(
      getDeps(c),
      c.req.param('connectionId'),
      getPrincipal(c).user!.id,
      accountConnectionSigner(authApi, origin),
    )
    return c.body(null, 204)
  })

  app.get('/api-resources', async (c) => {
    const resources = (await listConnectableExternalResources(getDeps(c))).items
    return c.json(
      connectableApiResourcesResponseSchema.parse({
        items: resources,
        pagination: {
          limit: resources.length || 1,
          offset: 0,
          total: resources.length,
          hasMore: false,
          nextOffset: null,
        },
      }),
    )
  })

  app.post('/account-connections', async (c) => {
    const origin = canonicalOrigin ?? new URL(c.req.url).origin
    const result = await createAccountConnection(
      getDeps(c),
      await readJson(c, createAccountConnectionSchema),
      getPrincipal(c).user!.id,
      origin,
      accountConnectionSigner(authApi, origin),
    )
    c.header('Location', `/api/account/account-connections/${encodeURIComponent(result.id)}`)
    return c.json(accountConnectionSchema.parse(result), 201)
  })

  app.get('/account-connections/:connectionId', async (c) => {
    return c.json(
      accountConnectionSchema.parse(
        await getAccountConnection(getDeps(c), c.req.param('connectionId'), getPrincipal(c).user!.id),
      ),
    )
  })

  app.delete('/account-connections/:connectionId', async (c) => {
    await revokeResourceConnection(getDeps(c), c.req.param('connectionId'), getPrincipal(c).user!.id)
    return c.body(null, 204)
  })

  app.get('/access-requests', async (c) => {
    const query = readQuery(c, paginationQuerySchema.extend({ approvalToken: z.string().trim().min(1).optional() }))
    if (query.approvalToken) {
      const request = await getAccountAccessRequestByToken(getDeps(c), query.approvalToken, getPrincipal(c).user!.id)
      return c.json(
        accessRequestApprovalsResponseSchema.parse({
          items: [request],
          pagination: { limit: query.limit, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
      )
    }
    return c.json(
      accessRequestApprovalsResponseSchema.parse(
        await listAccountAccessRequests(getDeps(c), getPrincipal(c).user!.id, {
          limit: query.limit,
          offset: query.offset,
        }),
      ),
    )
  })

  app.get('/access-requests/:requestId/authorization-detail-catalog', async (c) => {
    const query = readQuery(c, paginationQuerySchema.extend({ approvalToken: z.string().trim().min(1) }))
    return c.json(
      authorizationDetailCatalogResponseSchema.parse(
        await listAccountAccessRequestAuthorizationDetailCatalog(
          getDeps(c),
          c.req.param('requestId'),
          query.approvalToken,
          getPrincipal(c).user!.id,
          query,
        ),
      ),
    )
  })

  app.get('/access-requests/:requestId', async (c) => {
    return c.json(
      accessRequestSchema.parse(
        await getAccountAccessRequest(
          getDeps(c),
          c.req.param('requestId'),
          getPrincipal(c).user!.id,
          c.req.query('approvalToken'),
        ),
      ),
    )
  })

  app.put('/access-requests/:requestId/decision', async (c) => {
    const result = await decideAccessRequest(
      getDeps(c),
      c.req.param('requestId'),
      await readJson(c, decideAccessRequestSchema),
      getPrincipal(c).user!.id,
    )
    return c.json(accessRequestSchema.parse(result))
  })

  app.route(
    '/security',
    accountSecurityRoutes(authApi, (c) => accountCenterSettings(c, securityPolicy)),
  )

  return app
}

function accountConnectionSigner(authApi: ManagementAuthApi, origin: string) {
  if (!authApi.signJWT) return undefined
  return {
    issuer: `${origin.replace(/\/$/, '')}/api/auth`,
    sign: (payload: Record<string, unknown>, type: 'JWT' | 'at+jwt') =>
      authApi.signJWT!({ body: { payload, overrideOptions: { jwt: { type } } }, asResponse: false }).then(
        ({ token }) => token,
      ),
  }
}

async function accountProfile(c: Context) {
  const deps = getDeps(c)
  const profile = await deps.users.getPublicProfile(getPrincipal(c).user!.id)
  return {
    user: {
      ...profile.user,
      bio: profile.bio,
      location: profile.location,
      links: profile.links,
    },
  }
}

async function accountCenterSettings(c: Context, securityPolicy?: SecurityPolicy): Promise<ConfigzAccountCenter> {
  return (await getConfig(getDeps(c), configzOptions(c, securityPolicy))).accountCenter
}

async function accountCenterConfig(c: Context, securityPolicy?: SecurityPolicy) {
  return getConfig(getDeps(c), configzOptions(c, securityPolicy))
}

function siweDomain(c: Context, configuredDomain: string) {
  if (configuredDomain.trim()) return configuredDomain.trim()
  return new URL(c.req.url).host
}

async function assertAccountCenterAllowed(
  c: Context,
  setting: keyof ConfigzAccountCenter,
  message: string,
  securityPolicy?: SecurityPolicy,
) {
  if (!(await accountCenterSettings(c, securityPolicy))[setting]) throw forbidden(message)
}

async function assertAccountCenterSettingsAllowed(
  c: Context,
  settings: Array<keyof ConfigzAccountCenter>,
  message: string,
  securityPolicy?: SecurityPolicy,
) {
  const accountCenter = await accountCenterSettings(c, securityPolicy)
  if (settings.some((setting) => !accountCenter[setting])) throw forbidden(message)
}

async function assertProfileUpdateAllowed(
  c: Context,
  body: z.infer<typeof accountProfileUpdateSchema>,
  securityPolicy?: SecurityPolicy,
) {
  const settings = await accountCenterSettings(c, securityPolicy)
  if (!settings.profileEditingEnabled) throw forbidden('Profile editing is disabled for this account center.')
  if (body.displayName !== undefined && !settings.displayNameEditable) {
    throw forbidden('Display name editing is disabled for this account center.')
  }
  if (body.username !== undefined && !settings.usernameEditable) {
    throw forbidden('Username editing is disabled for this account center.')
  }
  if (body.avatarAssetId !== undefined && !settings.avatarEditable) {
    throw forbidden('Avatar editing is disabled for this account center.')
  }
}
