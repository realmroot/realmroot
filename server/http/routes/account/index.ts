import { badRequest, forbidden } from '@server/domain/errors'
import { validateEmailPolicy, validatePasswordPolicy } from '@server/domain/security/policy'
import {
  approveAgentEnrollment,
  createAdditionalAgentEnrollmentIntent,
  createAgentEnrollmentIntent,
  getAgentEnrollmentIntent,
  listOrganizationAgentIdentities,
  listPersonalAgentIdentities,
  recoverAgentIdentity,
  retireAgentIdentity,
  revokeAgentIdentityHost,
} from '@server/usecases/agent-identities'
import {
  approveAgentAuthorityApproval,
  createAgentAuthorityGrant,
  listAgentAuthorityGrants,
  revokeAgentAuthorityGrant,
} from '@server/usecases/agent-tokens'
import {
  decideAgentApproval,
  listAccountAgents,
  revokeAccountAgent,
  revokeAccountCapabilityGrant,
} from '@server/usecases/agents'
import { revokeConsent } from '@server/usecases/applications'
import { getConfig } from '@server/usecases/configz'
import {
  createExternalAccount,
  createExternalAccountGrant,
  createExternalOAuthIntent,
  listExternalAccounts,
  revokeExternalAccountGrant,
} from '@server/usecases/external-accounts'
import type { ConfigzAccountCenter } from '@server/usecases/ports'
import {
  accountEmailChangeConfirmSchema,
  accountEmailChangeSchema,
  accountPasswordChangeSchema,
  accountProfileUpdateSchema,
  accountWalletAddressLinkSchema,
} from '@shared/api/account'
import {
  agentAuthorityApprovalSchema,
  agentEnrollmentIntentSchema,
  createAdditionalAgentEnrollmentIntentRequestSchema,
  createAgentAuthorityGrantRequestSchema,
  createAgentEnrollmentIntentRequestSchema,
  decideAgentApprovalRequestSchema,
  decideAgentApprovalResponseSchema,
} from '@shared/api/agents'
import { linkAccountRequestSchema, unlinkAccountQuerySchema } from '@shared/api/connectors'
import {
  createExternalAccountGrantRequestSchema,
  createExternalAccountRequestSchema,
  createExternalOAuthIntentRequestSchema,
  externalAccountGrantSchema,
  externalAccountSchema,
} from '@shared/api/external-accounts'
import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import type { SecurityPolicy } from '@shared/api/security'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { getAddress, verifyMessage } from 'viem'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import type { z } from 'zod'
import { configzOptions } from '../../app-config'
import { requireAuth } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { getDeps } from '../../middleware/deps'
import type { ManagementAuthApi } from '../auth-api'
import { toBoundaryError } from '../auth-api'
import { readJson, readQuery } from '../validation'
import { accountSecurityRoutes } from './security'

export function accountRoutes(authApi: ManagementAuthApi, securityPolicy?: SecurityPolicy, canonicalOrigin?: string) {
  const app = new Hono()

  app.use('*', requireAuth())

  app.get('/profile', async (c) => c.json({ user: await getDeps(c).users.getUser(getAuthContext(c).user!.id) }))

  app.patch('/profile', async (c) => {
    const body = await readJson(c, accountProfileUpdateSchema)
    await assertProfileUpdateAllowed(c, body, securityPolicy)
    return c.json({ user: await getDeps(c).users.updateProfile(getAuthContext(c).user!.id, body) })
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
    const email = getAuthContext(c).user!.email

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
    const user = getAuthContext(c).user!
    validatePasswordPolicy(body.newPassword, policy.password, {
      email: user.email,
      name: user.name,
      username: typeof user.username === 'string' ? user.username : null,
    })

    try {
      return c.json(
        await authApi.changePassword({
          body: {
            currentPassword: body.currentPassword,
            newPassword: body.newPassword,
            revokeOtherSessions: body.revokeOtherSessions,
          },
          headers: c.req.raw.headers,
        }),
      )
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
    await wallets.linkWalletAddress(getAuthContext(c).user!.id, {
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
    await getDeps(c).wallets.unlinkWalletAddress(getAuthContext(c).user!.id, c.req.param('accountId'))
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
      getAuthContext(c).user!.id,
      readQuery(c, paginationQuerySchema),
    )
    return c.json({ accounts: page.items, pagination: paginationMetadata(page) })
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

  app.get('/applications', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Authorized application access is disabled for this account center.',
      securityPolicy,
    )
    const page = await getDeps(c).users.listConsentedApplications(
      getAuthContext(c).user!.id,
      readQuery(c, paginationQuerySchema),
    )
    return c.json({ applications: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/applications/:consentId', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Authorized application access is disabled for this account center.',
      securityPolicy,
    )
    await revokeConsent(getDeps(c), c.req.param('consentId'), getAuthContext(c).user!.id)
    return c.body(null, 204)
  })

  app.get('/sessions', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'sessionsViewEnabled',
      'Session management is disabled for this account center.',
      securityPolicy,
    )
    const authContext = getAuthContext(c)
    const page = await getDeps(c).users.listSessions(authContext.user!.id, readQuery(c, paginationQuerySchema))
    const currentSessionId = authContext.session?.session.id
    return c.json({
      sessions: page.items.map((session) => ({ ...session, current: session.id === currentSessionId })),
      pagination: paginationMetadata(page),
    })
  })

  app.get('/agents', async (c) => {
    const authContext = getAuthContext(c)
    return c.json(await listAccountAgents(getDeps(c), authContext.user!.id, readQuery(c, paginationQuerySchema)))
  })

  app.post('/agent-approvals/:agentId/decisions', async (c) => {
    const result = await decideAgentApproval(
      getDeps(c),
      {
        agentId: c.req.param('agentId'),
        ...(await readJson(c, decideAgentApprovalRequestSchema)),
      },
      getAuthContext(c).user!.id,
    )
    return c.json(decideAgentApprovalResponseSchema.parse(result))
  })

  app.get('/agent-identities', async (c) => {
    return c.json(await listPersonalAgentIdentities(getDeps(c), getAuthContext(c).user!.id))
  })

  app.get('/organizations/:organizationId/agent-identities', async (c) => {
    return c.json(
      await listOrganizationAgentIdentities(getDeps(c), c.req.param('organizationId'), getAuthContext(c).user!.id),
    )
  })

  app.post('/agent-enrollment-intents', async (c) => {
    const intent = await createAgentEnrollmentIntent(
      getDeps(c),
      await readJson(c, createAgentEnrollmentIntentRequestSchema),
      getAuthContext(c).user!.id,
    )
    return c.json(intent, 202)
  })

  app.post('/agent-identities/:identityId/enrollment-intents', async (c) => {
    const body = await readJson(c, createAdditionalAgentEnrollmentIntentRequestSchema)
    const intent = await createAdditionalAgentEnrollmentIntent(
      getDeps(c),
      c.req.param('identityId'),
      body.protocolAgentId,
      getAuthContext(c).user!.id,
    )
    return c.json(intent, 202)
  })

  app.post('/agent-enrollment-intents/:intentId/approvals', async (c) => {
    const result = await approveAgentEnrollment(
      getDeps(c),
      c.req.param('intentId'),
      `${(canonicalOrigin ?? new URL(c.req.url).origin).replace(/\/$/, '')}/api/auth`,
      getAuthContext(c).user!.id,
    )
    return c.json(result, 201)
  })

  app.get('/agent-enrollment-intents/:intentId', async (c) => {
    const intent = await getAgentEnrollmentIntent(getDeps(c), c.req.param('intentId'), getAuthContext(c).user!.id)
    return c.json(agentEnrollmentIntentSchema.parse(intent))
  })

  app.delete('/agent-identities/:identityId/hosts/:protocolAgentId', async (c) => {
    await revokeAgentIdentityHost(
      getDeps(c),
      c.req.param('identityId'),
      c.req.param('protocolAgentId'),
      getAuthContext(c).user!.id,
    )
    return c.body(null, 204)
  })

  app.post('/agent-identities/:identityId/recoveries', async (c) => {
    await recoverAgentIdentity(getDeps(c), c.req.param('identityId'), getAuthContext(c).user!.id)
    return c.body(null, 202)
  })

  app.delete('/agent-identities/:identityId', async (c) => {
    await retireAgentIdentity(getDeps(c), c.req.param('identityId'), getAuthContext(c).user!.id)
    return c.body(null, 204)
  })

  app.get('/agent-identities/:identityId/authority-grants', async (c) => {
    return c.json(await listAgentAuthorityGrants(getDeps(c), c.req.param('identityId'), getAuthContext(c).user!.id))
  })

  app.post('/agent-identities/:identityId/authority-grants', async (c) => {
    return c.json(
      await createAgentAuthorityGrant(
        getDeps(c),
        c.req.param('identityId'),
        await readJson(c, createAgentAuthorityGrantRequestSchema),
        getAuthContext(c).user!.id,
      ),
      201,
    )
  })

  app.delete('/agent-identities/:identityId/authority-grants/:grantId', async (c) => {
    await revokeAgentAuthorityGrant(
      getDeps(c),
      c.req.param('identityId'),
      c.req.param('grantId'),
      getAuthContext(c).user!.id,
    )
    return c.body(null, 204)
  })

  app.post('/agent-identities/:identityId/authority-grants/:grantId/approvals/:approvalId', async (c) => {
    const approval = await approveAgentAuthorityApproval(
      getDeps(c),
      c.req.param('identityId'),
      c.req.param('grantId'),
      c.req.param('approvalId'),
      getAuthContext(c).user!.id,
    )
    return c.json(agentAuthorityApprovalSchema.parse(approval))
  })

  app.delete('/agents/:agentId', async (c) => {
    await revokeAccountAgent(getDeps(c), c.req.param('agentId'), getAuthContext(c).user!.id)
    return c.body(null, 204)
  })

  app.delete('/agent-capability-grants/:grantId', async (c) => {
    await revokeAccountCapabilityGrant(getDeps(c), c.req.param('grantId'), getAuthContext(c).user!.id)
    return c.body(null, 204)
  })

  app.get('/external-accounts', async (c) => {
    const result = await listExternalAccounts(getDeps(c), getAuthContext(c).user!.id)
    return c.json({ externalAccounts: result.externalAccounts.map((account) => externalAccountSchema.parse(account)) })
  })

  app.post('/external-accounts', async (c) => {
    const account = await createExternalAccount(
      getDeps(c),
      await readJson(c, createExternalAccountRequestSchema),
      getAuthContext(c).user!.id,
    )
    return c.json(externalAccountSchema.parse(account), 201)
  })

  app.post('/external-oauth-intents', async (c) => {
    return c.json(
      await createExternalOAuthIntent(
        getDeps(c),
        await readJson(c, createExternalOAuthIntentRequestSchema),
        getAuthContext(c).user!.id,
        canonicalOrigin ?? new URL(c.req.url).origin,
      ),
      201,
    )
  })

  app.post('/external-accounts/:externalAccountId/grants', async (c) => {
    const grant = await createExternalAccountGrant(
      getDeps(c),
      c.req.param('externalAccountId'),
      await readJson(c, createExternalAccountGrantRequestSchema),
      getAuthContext(c).user!.id,
    )
    return c.json(externalAccountGrantSchema.parse(grant), 201)
  })

  app.delete('/external-accounts/:externalAccountId/grants/:grantId', async (c) => {
    await revokeExternalAccountGrant(
      getDeps(c),
      c.req.param('externalAccountId'),
      c.req.param('grantId'),
      getAuthContext(c).user!.id,
    )
    return c.body(null, 204)
  })

  app.route(
    '/security',
    accountSecurityRoutes(authApi, (c) => accountCenterSettings(c, securityPolicy)),
  )

  return app
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
