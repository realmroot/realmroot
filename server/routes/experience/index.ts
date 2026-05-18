import { type Context, Hono } from 'hono'
import type { ExperienceCallbackQuery } from '../../../shared/api/experience'
import {
  emailOtpPasswordResetRequestSchema,
  emailOtpPasswordResetSchema,
  emailOtpRequestSchema,
  emailOtpSignInSchema,
  emailOtpVerificationSchema,
  emailVerificationRequestSchema,
  emailVerificationSchema,
  experienceCallbackQuerySchema,
  magicLinkRequestSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  passwordSignInRequestSchema,
  signUpRequestSchema,
  usernameAvailabilityRequestSchema,
  usernameSignInRequestSchema,
} from '../../../shared/api/experience'
import { forbidden } from '../../lib/errors'
import { createExperienceService, type ExperienceBindings } from '../../modules/experience/context'
import type { SetupRepository } from '../../modules/setup/repository'
import { type ExperienceAuthApi, toBoundaryError } from '../auth-api'
import { readJson, readQuery } from '../validation'

type ExperienceServicePort = {
  getConfig: () => Promise<{
    signIn: {
      passwordEnabled: boolean
      signupEnabled: boolean
      magicLinkEnabled: boolean
      emailOtpEnabled: boolean
      usernameEnabled: boolean
    }
  }>
  getCallbackState: (query: ExperienceCallbackQuery) => Promise<unknown>
}

export function createExperienceRoutes(
  authApi: ExperienceAuthApi,
  createService: (c: Context<{ Bindings: ExperienceBindings }>) => ExperienceServicePort = createExperienceService,
  setup?: SetupRepository,
) {
  const app = new Hono<{ Bindings: ExperienceBindings }>()

  app.get('/', async (c) => c.json(await createService(c).getConfig()))

  app.get('/callback', async (c) =>
    c.json(await createService(c).getCallbackState(readQuery(c, experienceCallbackQuerySchema))),
  )

  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET') {
      await requireSetupComplete(setup)
    }

    await next()
  })

  app.post('/sign-ins/password', async (c) => {
    const body = await readJson(c, passwordSignInRequestSchema)
    await requireMethod(createService(c), 'password')
    return callAuth(() => authApi.signInEmail({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/sign-ins/username', async (c) => {
    const body = await readJson(c, usernameSignInRequestSchema)
    await requireMethod(createService(c), 'username')
    return callAuth(() => authApi.signInUsername({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/sign-ups', async (c) => {
    const body = await readJson(c, signUpRequestSchema)
    await requireMethod(createService(c), 'signup')
    return callAuth(() => authApi.signUpEmail({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.delete('/session', async (c) => callAuth(() => authApi.signOut({ headers: c.req.raw.headers, asResponse: true })))

  app.post('/password-reset-requests', async (c) => {
    const body = await readJson(c, passwordResetRequestSchema)
    await requireMethod(createService(c), 'password')
    return callAuth(() => authApi.requestPasswordReset({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/password-resets', async (c) => {
    const body = await readJson(c, passwordResetSchema)
    await requireMethod(createService(c), 'password')
    return callAuth(() => authApi.resetPassword({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/email-verification-requests', async (c) => {
    const body = await readJson(c, emailVerificationRequestSchema)
    return callAuth(() => authApi.sendVerificationEmail({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/email-verifications', async (c) => {
    const body = await readJson(c, emailVerificationSchema)
    return callAuth(() =>
      authApi.verifyEmail({
        query: {
          token: body.token,
          callbackURL: body.callbackURL,
        },
        headers: c.req.raw.headers,
        asResponse: true,
      }),
    )
  })

  app.post('/magic-links', async (c) => {
    const body = await readJson(c, magicLinkRequestSchema)
    await requireMethod(createService(c), 'magicLink')
    return callAuth(() => authApi.signInMagicLink({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/email-otps', async (c) => {
    const body = await readJson(c, emailOtpRequestSchema)
    await requireMethod(createService(c), body.type === 'forget-password' ? 'password' : 'emailOtp')
    return callAuth(() => authApi.sendVerificationOTP({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/email-otp/sign-ins', async (c) => {
    const body = await readJson(c, emailOtpSignInSchema)
    await requireMethod(createService(c), 'emailOtp')
    return callAuth(() => authApi.signInEmailOTP({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/email-otp/email-verifications', async (c) => {
    const body = await readJson(c, emailOtpVerificationSchema)
    return callAuth(() => authApi.verifyEmailOTP({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/email-otp/password-reset-requests', async (c) => {
    const body = await readJson(c, emailOtpPasswordResetRequestSchema)
    await requireMethod(createService(c), 'password')
    await requireMethod(createService(c), 'emailOtp')
    return callAuth(() => authApi.requestPasswordResetEmailOTP({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/email-otp/password-resets', async (c) => {
    const body = await readJson(c, emailOtpPasswordResetSchema)
    await requireMethod(createService(c), 'password')
    await requireMethod(createService(c), 'emailOtp')
    return callAuth(() => authApi.resetPasswordEmailOTP({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  app.post('/usernames/availability', async (c) => {
    const body = await readJson(c, usernameAvailabilityRequestSchema)
    await requireMethod(createService(c), 'username')
    return callAuth(() => authApi.isUsernameAvailable({ body, headers: c.req.raw.headers, asResponse: true }))
  })

  return app
}

async function requireSetupComplete(setup: SetupRepository | undefined) {
  if (setup && !(await setup.hasUsers())) {
    throw forbidden('Complete first-admin setup before using auth flows.')
  }
}

async function callAuth<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toBoundaryError(error)
  }
}

type ExperienceMethod = 'password' | 'signup' | 'magicLink' | 'emailOtp' | 'username'

async function requireMethod(service: ExperienceServicePort, method: ExperienceMethod) {
  const config = await service.getConfig()
  const enabled = {
    password: config.signIn.passwordEnabled,
    signup: config.signIn.signupEnabled && config.signIn.passwordEnabled,
    magicLink: config.signIn.magicLinkEnabled && config.signIn.signupEnabled,
    emailOtp: config.signIn.emailOtpEnabled && config.signIn.signupEnabled,
    username: config.signIn.usernameEnabled && config.signIn.passwordEnabled,
  } satisfies Record<ExperienceMethod, boolean>

  if (!enabled[method]) {
    throw forbidden('This sign-in method is not enabled.')
  }
}
