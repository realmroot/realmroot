import { badRequest, forbidden } from '@server/domain/errors'
import type { ConfigzAccountCenter } from '@server/usecases/ports'
import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import {
  securityBackupCodesRequestSchema,
  securityPasskeyUpdateSchema,
  securityTotpDisableSchema,
  securityTotpEnrollmentSchema,
  securityTotpVerificationSchema,
} from '@shared/api/security'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { requireAuth } from '../../../middleware/admin'
import { getAuthContext } from '../../../middleware/auth-context'
import { getDeps } from '../../../middleware/deps'
import type { ManagementAuthApi } from '../../auth-api'
import { toBoundaryError } from '../../auth-api'
import { readJson, readQuery } from '../../validation'

type AccountCenterSettingsReader = (c: Context) => Promise<ConfigzAccountCenter>

export function accountSecurityRoutes(authApi: ManagementAuthApi, accountCenterSettings?: AccountCenterSettingsReader) {
  const app = new Hono()

  app.use('*', requireAuth())

  app.get('/', async (c) => c.json({ security: await getDeps(c).security.getSecurityState(currentUserId(c)) }))

  app.get('/mfa', async (c) => {
    const state = await getDeps(c).security.getSecurityState(currentUserId(c))
    return c.json({ mfa: state.mfa, policy: state.policy.mfa })
  })

  app.post('/mfa/totp-enrollment', async (c) => {
    const body = await readJson(c, securityTotpEnrollmentSchema)
    await assertAuthenticatorAppEnabled(c)

    try {
      return c.json(await authApi.enableTwoFactor({ body, headers: c.req.raw.headers }), 201)
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/mfa/totp-verification', async (c) => {
    const body = await readJson(c, securityTotpVerificationSchema)
    await assertAuthenticatorAppEnabled(c)

    try {
      return c.json(await authApi.verifyTOTP({ body, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.delete('/mfa/totp', async (c) => {
    const state = await getDeps(c).security.getSecurityState(currentUserId(c))

    if (state.policy.mfa.mode === 'required') {
      throw forbidden('MFA cannot be disabled while it is required for this deployment.')
    }

    const body = await readJson(c, securityTotpDisableSchema)

    try {
      return c.json(await authApi.disableTwoFactor({ body, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.post('/mfa/backup-codes', async (c) => {
    const body = await readJson(c, securityBackupCodesRequestSchema)

    try {
      return c.json(await authApi.generateBackupCodes({ body, headers: c.req.raw.headers }), 201)
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/passkeys', async (c) => {
    const security = getDeps(c).security
    const state = await security.getSecurityState(currentUserId(c))
    const page = await security.listPasskeys(currentUserId(c), readQuery(c, paginationQuerySchema))
    return c.json({ passkeys: page.items, policy: state.policy.passkeys, pagination: paginationMetadata(page) })
  })

  app.patch('/passkeys/:id', async (c) => {
    await assertPasskeysEnabled(c)
    const body = await readJson(c, securityPasskeyUpdateSchema)

    try {
      return c.json(
        await authApi.updatePasskey({ body: { id: c.req.param('id'), name: body.name }, headers: c.req.raw.headers }),
      )
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.delete('/passkeys/:id', async (c) => {
    await assertPasskeysEnabled(c)

    try {
      return c.json(await authApi.deletePasskey({ body: { id: c.req.param('id') }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.get('/sessions', async (c) => {
    await assertSessionsEnabled(c, accountCenterSettings)
    const authContext = getAuthContext(c)
    const page = await getDeps(c).users.listSessions(authContext.user!.id, readQuery(c, paginationQuerySchema))
    const currentSessionId = authContext.session?.session.id
    return c.json({
      sessions: page.items.map((session) => ({ ...session, current: session.id === currentSessionId })),
      pagination: paginationMetadata(page),
    })
  })

  app.delete('/sessions', async (c) => {
    await assertSessionsEnabled(c, accountCenterSettings)
    try {
      return c.json(await authApi.revokeOtherSessions({ headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  app.delete('/sessions/:sessionId', async (c) => {
    await assertSessionsEnabled(c, accountCenterSettings)
    const token = await getDeps(c).security.getSessionToken(currentUserId(c), c.req.param('sessionId'))

    try {
      return c.json(await authApi.revokeSession({ body: { token }, headers: c.req.raw.headers }))
    } catch (error) {
      throw toBoundaryError(error)
    }
  })

  return app
}

function currentUserId(c: Context): string {
  return getAuthContext(c).user!.id
}

async function assertPasskeysEnabled(c: Context) {
  const state = await getDeps(c).security.getSecurityState(currentUserId(c))

  if (!state.policy.passkeys.enabled) {
    throw badRequest('Passkeys are disabled for this deployment.')
  }
}

async function assertAuthenticatorAppEnabled(c: Context) {
  const state = await getDeps(c).security.getSecurityState(currentUserId(c))

  if (!state.policy.mfa.authenticatorAppEnabled) {
    throw badRequest('Authenticator app MFA is disabled for this deployment.')
  }
}

async function assertSessionsEnabled(c: Context, accountCenterSettings?: AccountCenterSettingsReader) {
  if (accountCenterSettings && !(await accountCenterSettings(c)).sessionsViewEnabled) {
    throw forbidden('Session management is disabled for this account center.')
  }
}
