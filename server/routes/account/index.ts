import type { Context } from 'hono'
import { Hono } from 'hono'
import { getAddress, verifyMessage } from 'viem'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import type { z } from 'zod'
import {
  accountEmailChangeConfirmSchema,
  accountEmailChangeSchema,
  accountPasswordChangeSchema,
  accountProfileUpdateSchema,
  accountWalletAddressLinkSchema,
} from '../../../shared/api/account'
import { linkAccountRequestSchema, unlinkAccountQuerySchema } from '../../../shared/api/connectors'
import { paginationMetadata, paginationQuerySchema } from '../../../shared/api/pagination'
import { badRequest, forbidden } from '../../lib/errors'
import { requireAuth } from '../../middleware/admin'
import { getAuthContext } from '../../middleware/auth-context'
import { type AgentBindings, createAgentService } from '../../modules/agents/context'
import type { AgentService } from '../../modules/agents/service'
import { type ApplicationBindings, createApplicationService } from '../../modules/applications/context'
import { type ConfigzBindings, createConfigzService } from '../../modules/configz/context'
import { type ConfigzAccountCenter, defaultAccountCenterSettings } from '../../modules/configz/service'
import { validateEmailPolicy, validatePasswordPolicy } from '../../modules/security/policy'
import type { SecurityRepository } from '../../modules/security/repository'
import type { UserRepository } from '../../modules/users/repository'
import type { WalletRepository } from '../../modules/wallets/repository'
import type { ManagementAuthApi } from '../auth-api'
import { toBoundaryError } from '../auth-api'
import type { ConfigzServiceFactory } from '../configz'
import { readJson, readQuery } from '../validation'
import { accountSecurityRoutes } from './security'

export type AccountApplicationServiceFactory = (c: Context<{ Bindings: ApplicationBindings }>) => {
  revokeConsent: (consentId: string, userId: string) => Promise<void>
}
export type AccountAgentServiceFactory = (c: Context<{ Bindings: AgentBindings }>) => AgentService

export function accountRoutes(
  authApi: ManagementAuthApi,
  users: UserRepository,
  security?: SecurityRepository,
  applicationServiceFactory: AccountApplicationServiceFactory = createApplicationService,
  configzServiceFactory?: ConfigzServiceFactory,
  wallets?: WalletRepository,
  agentServiceFactory: AccountAgentServiceFactory = createAgentService,
) {
  const app = new Hono<{ Bindings: ApplicationBindings & ConfigzBindings & AgentBindings }>()

  app.use('*', requireAuth())

  app.get('/profile', async (c) => c.json({ user: await users.getUser(getAuthContext(c).user!.id) }))

  app.patch('/profile', async (c) => {
    const body = await readJson(c, accountProfileUpdateSchema)
    await assertProfileUpdateAllowed(c, body, configzServiceFactory)
    return c.json({ user: await users.updateProfile(getAuthContext(c).user!.id, body) })
  })

  app.post('/email/change', async (c) => {
    await assertAccountCenterSettingsAllowed(
      c,
      ['profileEditingEnabled', 'emailChangeEnabled'],
      'Email changes are disabled for this account center.',
      configzServiceFactory,
    )
    const body = await readJson(c, accountEmailChangeSchema)
    if (security) validateEmailPolicy(body.email, (await security.getPolicy()).blocklist)

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
      configzServiceFactory,
    )
    const body = await readJson(c, accountEmailChangeConfirmSchema)
    if (security) validateEmailPolicy(body.email, (await security.getPolicy()).blocklist)

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
      configzServiceFactory,
    )
    const body = await readJson(c, accountPasswordChangeSchema)
    if (security) {
      const policy = await security.getPolicy()
      const user = getAuthContext(c).user!
      validatePasswordPolicy(body.newPassword, policy.password, {
        email: user.email,
        name: user.name,
        username: typeof user.username === 'string' ? user.username : null,
      })
    }

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

  if (wallets) {
    app.post('/wallet-addresses', async (c) => {
      await assertAccountCenterAllowed(
        c,
        'connectedAccountsEnabled',
        'Connected account access is disabled for this account center.',
        configzServiceFactory,
      )
      const body = await readJson(c, accountWalletAddressLinkSchema)
      const walletAddress = getAddress(body.walletAddress)
      const config = await accountCenterConfig(c, configzServiceFactory)
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
        configzServiceFactory,
      )
      await wallets.unlinkWalletAddress(getAuthContext(c).user!.id, c.req.param('accountId'))
      return c.body(null, 204)
    })
  }

  app.get('/linked-accounts', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Connected account access is disabled for this account center.',
      configzServiceFactory,
    )
    const page = await users.listLinkedAccounts(getAuthContext(c).user!.id, readQuery(c, paginationQuerySchema))
    return c.json({ accounts: page.items, pagination: paginationMetadata(page) })
  })

  app.post('/linked-accounts', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Connected account access is disabled for this account center.',
      configzServiceFactory,
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
      configzServiceFactory,
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
      configzServiceFactory,
    )
    const page = await users.listConsentedApplications(getAuthContext(c).user!.id, readQuery(c, paginationQuerySchema))
    return c.json({ applications: page.items, pagination: paginationMetadata(page) })
  })

  app.delete('/applications/:consentId', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'connectedAccountsEnabled',
      'Authorized application access is disabled for this account center.',
      configzServiceFactory,
    )
    await applicationServiceFactory(c).revokeConsent(c.req.param('consentId'), getAuthContext(c).user!.id)
    return c.body(null, 204)
  })

  app.get('/sessions', async (c) => {
    await assertAccountCenterAllowed(
      c,
      'sessionsViewEnabled',
      'Session management is disabled for this account center.',
      configzServiceFactory,
    )
    const authContext = getAuthContext(c)
    const page = await users.listSessions(authContext.user!.id, readQuery(c, paginationQuerySchema))
    const currentSessionId = authContext.session?.session.id
    return c.json({
      sessions: page.items.map((session) => ({ ...session, current: session.id === currentSessionId })),
      pagination: paginationMetadata(page),
    })
  })

  app.get('/agents', async (c) => {
    const authContext = getAuthContext(c)
    return c.json(
      await agentServiceFactory(c).listAccountAgents(authContext.user!.id, readQuery(c, paginationQuerySchema)),
    )
  })

  app.delete('/agents/:agentId', async (c) => {
    await agentServiceFactory(c).revokeAccountAgent(c.req.param('agentId'), getAuthContext(c).user!.id)
    return c.body(null, 204)
  })

  app.delete('/agent-capability-grants/:grantId', async (c) => {
    await agentServiceFactory(c).revokeAccountCapabilityGrant(c.req.param('grantId'), getAuthContext(c).user!.id)
    return c.body(null, 204)
  })

  if (security) {
    app.route(
      '/security',
      accountSecurityRoutes(authApi, users, security, (c) => accountCenterSettings(c, configzServiceFactory)),
    )
  }

  return app
}

async function accountCenterSettings(
  c: Context<{ Bindings: ConfigzBindings }>,
  serviceFactory?: ConfigzServiceFactory,
) {
  if (serviceFactory) return (await serviceFactory(c).getConfig()).accountCenter
  if (c.env?.DB) return (await createConfigzService(c).getConfig()).accountCenter
  return defaultAccountCenterSettings
}

async function accountCenterConfig(c: Context<{ Bindings: ConfigzBindings }>, serviceFactory?: ConfigzServiceFactory) {
  if (serviceFactory) return serviceFactory(c).getConfig()
  return createConfigzService(c).getConfig()
}

function siweDomain(c: Context, configuredDomain: string) {
  if (configuredDomain.trim()) return configuredDomain.trim()
  return new URL(c.req.url).host
}

async function assertAccountCenterAllowed(
  c: Context<{ Bindings: ConfigzBindings }>,
  setting: keyof ConfigzAccountCenter,
  message: string,
  serviceFactory?: ConfigzServiceFactory,
) {
  if (!(await accountCenterSettings(c, serviceFactory))[setting]) throw forbidden(message)
}

async function assertAccountCenterSettingsAllowed(
  c: Context<{ Bindings: ConfigzBindings }>,
  settings: Array<keyof ConfigzAccountCenter>,
  message: string,
  serviceFactory?: ConfigzServiceFactory,
) {
  const accountCenter = await accountCenterSettings(c, serviceFactory)
  if (settings.some((setting) => !accountCenter[setting])) throw forbidden(message)
}

async function assertProfileUpdateAllowed(
  c: Context<{ Bindings: ConfigzBindings }>,
  body: z.infer<typeof accountProfileUpdateSchema>,
  serviceFactory?: ConfigzServiceFactory,
) {
  const settings = await accountCenterSettings(c, serviceFactory)
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
