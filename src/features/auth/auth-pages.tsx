import { ArrowLeft, ArrowRight, CircleAlert, Eye, EyeOff, KeyRound, LinkIcon, LoaderCircle, Mail } from 'lucide-react'
import { type ComponentProps, type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button, LinkButton } from '@/components/ui/button'
import { Field, TextInput } from '@/components/ui/field'
import { Status } from '@/components/ui/status'
import {
  requestEmailOtp,
  requestEmailOtpPasswordReset,
  requestEmailVerification,
  requestMagicLink,
  requestPasswordReset,
  resetPassword,
  resetPasswordWithEmailOtp,
  signInWithEmailOtp,
  signInWithPassword,
  signInWithSocial,
  signInWithUsername,
  signUp,
  verifyEmail,
  verifyEmailOtp,
} from '@/lib/auth-client'
import { callbackURL, safeRedirectPath, useConfigz } from './hooks'

type SubmitState = {
  loading: boolean
  message: string | null
  error: string | null
}

type SignInMode = 'password' | 'magic' | 'otp'

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback': () => void
          'error-callback': () => void
        },
      ) => string
      remove: (widget: string) => void
    }
  }
}

const initialSubmitState: SubmitState = {
  loading: false,
  message: null,
  error: null,
}

export function SignInPage() {
  const { data: config, error, loading } = useConfigz()
  const [mode, setMode] = useState<SignInMode>('password')
  const [submit, setSubmit] = useState(initialSubmitState)
  const [identifier, setIdentifier] = useState('')
  const [identifierConfirmed, setIdentifierConfirmed] = useState(false)
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const enabled = config?.signIn
  const callback = callbackURL()
  const authContext = authRequestContext('sign-in')
  const identifierFirst = enabled?.identifierFirst === true
  const showIdentifierStep = identifierFirst && !identifierConfirmed

  const socialProviders = config?.identityProviders ?? []
  const methods = useMemo(() => (enabled ? signInMethods(enabled) : []), [enabled])
  const activeMode = methods.some((method) => method.id === mode) ? mode : (methods[0]?.id ?? mode)
  const needsEmailIdentifier = identifierFirst && activeMode !== 'password' && !identifier.includes('@')
  const resetCaptcha = () => resetCaptchaState(config, setCaptchaToken, setCaptchaResetKey)

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      try {
        const useUsername = enabled?.usernameEnabled && !identifier.includes('@')
        const response = useUsername
          ? await signInWithUsername({
              username: identifier,
              password,
              callbackURL: callback,
              rememberMe: true,
              captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
            })
          : await signInWithPassword({
              email: identifier,
              password,
              callbackURL: callback,
              rememberMe: true,
              captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
            })
        navigateAfterAuth(response, callback)
        return 'Signed in. Redirecting to the requested application.'
      } finally {
        resetCaptcha()
      }
    })
  }

  async function onMagicSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      try {
        await requestMagicLink({
          email: identifier,
          callbackURL: callback,
          errorCallbackURL: authPageHref('/sign-in'),
          captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
        })
        return 'Magic link sent. Check your email to continue.'
      } finally {
        resetCaptcha()
      }
    })
  }

  async function onOtpSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      if (!otp) {
        try {
          await requestEmailOtp({
            email: identifier,
            type: 'sign-in',
            captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
          })
          return 'One-time code sent. Enter it here to finish signing in.'
        } finally {
          resetCaptcha()
        }
      }

      const response = await signInWithEmailOtp({ email: identifier, otp })
      navigateAfterAuth(response, callback)
      return 'Code accepted. Redirecting to the requested application.'
    })
  }

  return (
    <AuthLayout
      config={config}
      eyebrow="Hosted sign-in"
      title={authContext.title ?? config?.copy.headline ?? 'Sign in to continue.'}
      description={
        authContext.description ??
        config?.copy.description ??
        'Use one of the enabled methods to access this application.'
      }
    >
      {loading ? <LoadingMessage label="Loading sign-in options" /> : null}
      {error ? <Status tone="error">{error}</Status> : null}
      {!loading && !error && methods.length === 0 ? (
        <Status tone="warning">No sign-in methods are enabled. Contact the workspace administrator.</Status>
      ) : null}

      <div className="authCardHeader">
        <h2>{showIdentifierStep ? 'Enter your identifier' : 'Choose how to continue'}</h2>
        <p>
          {showIdentifierStep ? 'Start with the email or username for your hosted account.' : methodHelp(activeMode)}
        </p>
      </div>

      {showIdentifierStep ? (
        <form
          className="formStack"
          onSubmit={(event) => {
            event.preventDefault()
            setIdentifierConfirmed(true)
          }}
        >
          <Field label={enabled?.usernameEnabled ? 'Email or username' : 'Email'}>
            <TextInput
              autoComplete="username"
              onChange={(event) => setIdentifier(event.target.value)}
              required
              type="text"
              value={identifier}
            />
          </Field>
          <Button type="submit">
            <ArrowRight size={18} />
            Continue
          </Button>
        </form>
      ) : null}

      {!showIdentifierStep && methods.length > 1 ? (
        <div className="segmented" role="tablist" aria-label="Sign-in method">
          {methods.map((method) => (
            <button
              className={activeMode === method.id ? 'active' : ''}
              key={method.id}
              onClick={() => setMode(method.id)}
              type="button"
            >
              {method.label}
            </button>
          ))}
        </div>
      ) : null}

      {!showIdentifierStep && identifierFirst && !needsEmailIdentifier ? (
        <div className="identitySummary">
          <span>Signing in as</span>
          <strong>{identifier}</strong>
          <button onClick={() => setIdentifierConfirmed(false)} type="button">
            Change
          </button>
        </div>
      ) : null}

      {!showIdentifierStep && activeMode === 'password' && enabled?.passwordEnabled ? (
        <form className="formStack" onSubmit={onPasswordSubmit}>
          {!identifierFirst ? (
            <Field label={enabled.usernameEnabled ? 'Email or username' : 'Email'}>
              <TextInput
                autoComplete="username"
                onChange={(event) => setIdentifier(event.target.value)}
                required
                type="text"
                value={identifier}
              />
            </Field>
          ) : null}
          <Field label="Password">
            <PasswordInput
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              value={password}
            />
          </Field>
          <CaptchaTokenField key={captchaResetKey} config={config} onChange={setCaptchaToken} />
          <Button disabled={submit.loading} type="submit">
            <KeyRound size={18} />
            Sign in
          </Button>
        </form>
      ) : null}

      {!showIdentifierStep && activeMode === 'magic' && enabled?.magicLinkEnabled ? (
        <form className="formStack" onSubmit={onMagicSubmit}>
          {!identifierFirst || needsEmailIdentifier ? (
            <Field label="Email">
              <TextInput
                autoComplete="email"
                onChange={(event) => setIdentifier(event.target.value)}
                required
                type="email"
                value={identifier}
              />
            </Field>
          ) : null}
          <CaptchaTokenField key={captchaResetKey} config={config} onChange={setCaptchaToken} />
          <Button disabled={submit.loading} type="submit">
            <LinkIcon size={18} />
            Send magic link
          </Button>
        </form>
      ) : null}

      {!showIdentifierStep && activeMode === 'otp' && enabled?.emailOtpEnabled ? (
        <form className="formStack" onSubmit={onOtpSubmit}>
          {!identifierFirst || needsEmailIdentifier ? (
            <Field label="Email">
              <TextInput
                autoComplete="email"
                onChange={(event) => setIdentifier(event.target.value)}
                required
                type="email"
                value={identifier}
              />
            </Field>
          ) : null}
          <Field label="One-time code" help="Request a code first, then enter the code from your email.">
            <TextInput
              autoComplete="one-time-code"
              inputMode="numeric"
              onChange={(event) => setOtp(event.target.value)}
              value={otp}
            />
          </Field>
          {!otp ? <CaptchaTokenField key={captchaResetKey} config={config} onChange={setCaptchaToken} /> : null}
          <Button disabled={submit.loading} type="submit">
            <Mail size={18} />
            {otp ? 'Verify code' : 'Send code'}
          </Button>
        </form>
      ) : null}

      {!showIdentifierStep ? <SocialButtons callback={callback} providers={socialProviders} /> : null}
      <SubmitStatus state={submit} />

      <div className="authLinks">
        {enabled?.signupEnabled ? <a href={authPageHref('/sign-up')}>Create account</a> : null}
        {enabled?.passwordEnabled ? <a href={authPageHref('/forgot-password')}>Forgot password?</a> : null}
      </div>
    </AuthLayout>
  )
}

export function SignUpPage() {
  const { data: config } = useConfigz()
  const [submit, setSubmit] = useState(initialSubmitState)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const created = submit.message !== null && submit.error === null
  const authContext = authRequestContext('sign-up')
  const callback = callbackURL()
  const socialProviders = config?.identityProviders ?? []
  const resetCaptcha = () => resetCaptchaState(config, setCaptchaToken, setCaptchaResetKey)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      try {
        await signUp({
          email,
          name,
          password,
          username: config?.signIn.usernameEnabled && username ? username : undefined,
          callbackURL: callback,
          captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
        })
        return 'Account created. Check your email if verification is required.'
      } finally {
        resetCaptcha()
      }
    })
  }

  return (
    <AuthLayout
      config={config}
      eyebrow="Create account"
      title={authContext.title ?? 'Start with your identity.'}
      description={authContext.description ?? 'Create a hosted account for every connected application.'}
    >
      {created ? (
        <div className="authCardHeader">
          <h2>Check your inbox</h2>
          <p>Use the verification message if this deployment requires confirmed email before continuing.</p>
        </div>
      ) : null}
      {created ? null : (
        <form className="formStack" onSubmit={onSubmit}>
          <Field label="Name">
            <TextInput autoComplete="name" onChange={(event) => setName(event.target.value)} required value={name} />
          </Field>
          <Field label="Email">
            <TextInput
              autoComplete={config?.signIn.usernameEnabled ? 'email' : 'username'}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </Field>
          {config?.signIn.usernameEnabled ? (
            <Field label="Username">
              <TextInput
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                value={username}
              />
            </Field>
          ) : null}
          <Field label="Password">
            <PasswordInput
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              value={password}
            />
          </Field>
          <CaptchaTokenField key={captchaResetKey} config={config} onChange={setCaptchaToken} />
          <Button disabled={submit.loading} type="submit">
            Create account
          </Button>
        </form>
      )}
      {created ? null : <SocialButtons callback={callback} providers={socialProviders} />}
      <SubmitStatus state={submit} />
      <div className="authLinks">
        <a href={authPageHref('/sign-in')}>Already have an account?</a>
      </div>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const { data: config } = useConfigz()
  const [submit, setSubmit] = useState(initialSubmitState)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [resetMethod, setResetMethod] = useState<'email' | 'otp'>('email')
  const [otpRequested, setOtpRequested] = useState(false)
  const token = new URLSearchParams(window.location.search).get('token')
  const otpResetEnabled = config?.signIn.emailOtpEnabled === true
  const authContext = authRequestContext('recovery')
  const resetCaptcha = () => resetCaptchaState(config, setCaptchaToken, setCaptchaResetKey)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      if (token) {
        await resetPassword({ token, newPassword: password })
        return 'Password reset. You can sign in with the new password.'
      }

      if (otpRequested && otp && password) {
        await resetPasswordWithEmailOtp({ email, otp, password })
        return 'Password reset. You can sign in with the new password.'
      }

      if (resetMethod === 'otp' && otpResetEnabled) {
        try {
          await requestEmailOtpPasswordReset({
            email,
            captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
          })
          setOtpRequested(true)
          return 'Password reset code sent.'
        } finally {
          resetCaptcha()
        }
      }

      try {
        await requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}${authPageHref('/forgot-password')}`,
          captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
        })
        return 'Password reset email sent.'
      } finally {
        resetCaptcha()
      }
    })
  }

  return (
    <AuthLayout
      config={config}
      eyebrow="Account recovery"
      title={authContext.title ?? 'Recover your password.'}
      description={
        authContext.description ?? 'Request a reset email or finish the reset with a token or one-time code.'
      }
    >
      <div className="authCardHeader">
        <h2>{token || otpRequested ? 'Set a new password' : 'Choose a recovery method'}</h2>
        <p>
          {token || otpRequested
            ? 'Enter the new password for this account.'
            : 'Use a reset link or a one-time code sent to your email.'}
        </p>
      </div>
      <form className="formStack" onSubmit={onSubmit}>
        {otpResetEnabled && !token ? (
          <div className="segmented" role="tablist" aria-label="Password reset method">
            <button
              className={resetMethod === 'email' ? 'active' : ''}
              onClick={() => setResetMethod('email')}
              type="button"
            >
              Email link
            </button>
            <button
              className={resetMethod === 'otp' ? 'active' : ''}
              onClick={() => setResetMethod('otp')}
              type="button"
            >
              OTP code
            </button>
          </div>
        ) : null}
        {!token ? (
          <Field label="Email">
            <TextInput
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </Field>
        ) : null}
        {!token && !otpRequested ? (
          <CaptchaTokenField key={captchaResetKey} config={config} onChange={setCaptchaToken} />
        ) : null}
        {otpResetEnabled && resetMethod === 'otp' && otpRequested && !token ? (
          <Field label="One-time code">
            <TextInput
              autoComplete="one-time-code"
              inputMode="numeric"
              onChange={(event) => setOtp(event.target.value)}
              value={otp}
            />
          </Field>
        ) : null}
        {token || otpRequested ? <input autoComplete="username" hidden readOnly type="text" value={email} /> : null}
        {token || otpRequested ? (
          <Field label="New password">
            <PasswordInput
              autoComplete="new-password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              value={password}
            />
          </Field>
        ) : null}
        <Button disabled={submit.loading} type="submit">
          {token || otpRequested
            ? 'Reset password'
            : resetMethod === 'otp' && otpResetEnabled
              ? 'Send reset code'
              : 'Send reset email'}
        </Button>
      </form>
      <SubmitStatus state={submit} />
      <div className="authLinks">
        {otpRequested && !token ? (
          <button
            onClick={() => {
              setOtpRequested(false)
              setOtp('')
              setPassword('')
            }}
            type="button"
          >
            <ArrowLeft size={16} />
            Change recovery method
          </button>
        ) : null}
        <a href={authPageHref('/sign-in')}>Back to sign in</a>
      </div>
    </AuthLayout>
  )
}

export function EmailVerificationPage() {
  const { data: config } = useConfigz()
  const [submit, setSubmit] = useState(initialSubmitState)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const token = new URLSearchParams(window.location.search).get('token')
  const authContext = authRequestContext('verification')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      if (token) {
        await verifyEmail({ token, callbackURL: callbackURL() })
        return 'Email verified.'
      }

      if (otp) {
        await verifyEmailOtp({ email, otp })
        return 'Email verified.'
      }

      await requestEmailVerification({ email, callbackURL: callbackURL() })
      return 'Verification email sent.'
    })
  }

  return (
    <AuthLayout
      config={config}
      eyebrow="Email verification"
      title={authContext.title ?? 'Verify your email.'}
      description={authContext.description ?? 'Confirm ownership of your email address before continuing.'}
    >
      <div className="authCardHeader">
        <h2>{token ? 'Verify this email link' : 'Confirm your inbox'}</h2>
        <p>{token ? 'Complete verification with this secure link.' : 'Send a verification email or enter a code.'}</p>
      </div>
      <form className="formStack" onSubmit={onSubmit}>
        {!token ? (
          <Field label="Email">
            <TextInput
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </Field>
        ) : null}
        {config?.signIn.emailOtpEnabled && !token ? (
          <Field label="One-time code">
            <TextInput
              autoComplete="one-time-code"
              inputMode="numeric"
              onChange={(event) => setOtp(event.target.value)}
              value={otp}
            />
          </Field>
        ) : null}
        <Button disabled={submit.loading} type="submit">
          {token || otp ? 'Verify email' : 'Send verification'}
        </Button>
      </form>
      <SubmitStatus state={submit} />
    </AuthLayout>
  )
}

export function AuthCallbackPage() {
  const { data: config } = useConfigz()
  const [state, setState] = useState<{ loading: boolean; message: string; href?: string; error?: string }>({
    loading: true,
    message: 'Completing sign-in',
  })

  useEffect(() => {
    setState(readCallbackState(window.location.search))
  }, [])

  return (
    <AuthLayout
      backHref={state.error ? '/sign-in' : undefined}
      config={config}
      eyebrow="Callback"
      icon={state.error ? <CircleAlert aria-hidden="true" size={28} /> : undefined}
      title={state.message}
      description="This page handles redirects from hosted authentication and OAuth journeys."
      variant={state.error ? 'message' : 'form'}
    >
      {state.loading ? <LoadingMessage label="Checking callback state" /> : null}
      {state.error ? <Status tone="error">{state.error}</Status> : null}
      {state.href ? (
        <LinkButton href={state.href}>
          <ArrowLeft size={18} />
          Continue
        </LinkButton>
      ) : null}
    </AuthLayout>
  )
}

function readCallbackState(search: string): { loading: false; message: string; href?: string; error?: string } {
  const params = new URLSearchParams(search)
  const error = params.get('error')
  if (error) {
    return {
      loading: false,
      message: 'Sign-in could not continue.',
      error: params.get('error_description') ?? error,
    }
  }

  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  if (clientId && redirectUri) {
    const consentParams = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri })
    const state = params.get('state')
    if (state) consentParams.set('state', state)
    return {
      loading: false,
      message: 'Consent is required before redirecting.',
      href: safeRedirectPath(`/oauth/consent?${consentParams.toString()}`),
    }
  }

  return {
    loading: false,
    message: 'Sign-in complete.',
    href: safeRedirectPath(params.get('return_to')) ?? '/profile',
  }
}

function SocialButtons({
  callback,
  providers,
}: {
  callback: string | undefined
  providers: Array<{ slug: string; providerId: string; displayName: string; icon: string }>
}) {
  if (providers.length === 0) return null

  async function onSocialClick(provider: { providerId: string }) {
    const response = await signInWithSocial({ provider: provider.providerId, callbackURL: callback })
    const redirectUrl = readRedirectUrl(response, { allowExternal: true })
    if (redirectUrl) window.location.assign(redirectUrl)
  }

  return (
    <fieldset className="socialGrid">
      <legend>Social sign-in providers</legend>
      {providers.map((provider) => (
        <button className="socialButton" key={provider.slug} onClick={() => onSocialClick(provider)} type="button">
          <span aria-hidden="true" className="providerIcon">
            {providerIconLabel(provider)}
          </span>
          <span className="socialButtonText">Continue with {provider.displayName}</span>
        </button>
      ))}
    </fieldset>
  )
}

function providerIconLabel(provider: { displayName: string; icon: string }) {
  if (provider.icon === 'github') return 'GH'
  if (provider.icon === 'google') return 'G'
  if (provider.icon === 'microsoft') return 'MS'
  if (provider.icon === 'gitlab') return 'GL'
  if (provider.icon === 'facebook') return 'f'
  if (provider.icon === 'apple') return 'A'
  return provider.displayName.slice(0, 2).toUpperCase()
}

function signInMethods(enabled: NonNullable<ReturnType<typeof useConfigz>['data']>['signIn']) {
  const methods: Array<{ id: SignInMode; label: string }> = []
  if (enabled.passwordEnabled) methods.push({ id: 'password', label: 'Password' })
  if (enabled.magicLinkEnabled) methods.push({ id: 'magic', label: 'Magic link' })
  if (enabled.emailOtpEnabled) methods.push({ id: 'otp', label: 'OTP' })
  return methods
}

function methodHelp(mode: SignInMode) {
  if (mode === 'magic') return 'Receive a secure sign-in link at your email address.'
  if (mode === 'otp') return 'Use a short one-time code sent to your email.'
  return 'Use your password for this hosted account.'
}

function authRequestContext(intent: 'sign-in' | 'sign-up' | 'recovery' | 'verification') {
  const params = new URLSearchParams(window.location.search)
  const redirectUri = params.get('redirect_uri')
  if (!params.has('client_id') || !redirectUri) return {}

  const destination = redirectDestination(redirectUri)
  const fallbackTitle =
    intent === 'sign-up'
      ? 'Create an account for the requested application.'
      : intent === 'recovery'
        ? 'Recover access for the requested application.'
        : intent === 'verification'
          ? 'Verify your email for the requested application.'
          : 'Continue to the requested application.'
  const fallbackDescription =
    intent === 'sign-up'
      ? 'Create a hosted account to continue.'
      : intent === 'recovery'
        ? 'Recover your hosted account before continuing.'
        : intent === 'verification'
          ? 'Confirm your email address before continuing.'
          : 'Sign in with your hosted account to continue.'

  if (!destination) {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
    }
  }

  return {
    title:
      intent === 'sign-up'
        ? `Create an account for ${destination}.`
        : intent === 'recovery'
          ? `Recover access for ${destination}.`
          : intent === 'verification'
            ? `Verify your email for ${destination}.`
            : `Continue to ${destination}.`,
    description:
      intent === 'sign-up'
        ? `Create a hosted account to continue to ${destination}.`
        : intent === 'recovery'
          ? `Recover your hosted account before continuing to ${destination}.`
          : intent === 'verification'
            ? `Confirm your email address before continuing to ${destination}.`
            : `Sign in with your hosted account to continue to ${destination}.`,
  }
}

function redirectDestination(redirectUri: string) {
  try {
    return new URL(redirectUri).host
  } catch {
    return null
  }
}

function authPageHref(path: string) {
  const params = authContinuationParams()
  return params.size > 0 ? `${path}?${params.toString()}` : path
}

function authContinuationParams() {
  const params = new URLSearchParams(window.location.search)
  const continuation = new URLSearchParams()
  for (const name of [
    'client_id',
    'redirect_uri',
    'response_type',
    'scope',
    'state',
    'code_challenge',
    'code_challenge_method',
    'nonce',
  ]) {
    const value = params.get(name)
    if (value) continuation.set(name, value)
  }
  return continuation.has('client_id') && continuation.has('redirect_uri') ? continuation : new URLSearchParams()
}

function navigateAfterAuth(response: unknown, callback: string | undefined) {
  const redirectUrl = resolveAuthRedirect(response, callback)
  if (window.location.pathname !== redirectUrl) {
    window.location.assign(redirectUrl)
  }
}

export function resolveAuthRedirect(response: unknown, callback: string | undefined) {
  return readRedirectUrl(response) ?? safeRedirectPath(callback) ?? '/profile'
}

function readRedirectUrl(response: unknown, options: { allowExternal?: boolean } = {}): string | null {
  if (typeof response !== 'object' || response === null) return null
  if ('url' in response && typeof response.url === 'string') return safeAuthRedirect(response.url, options)
  if ('redirectTo' in response && typeof response.redirectTo === 'string') return safeAuthRedirect(response.redirectTo)
  if ('callbackURL' in response && typeof response.callbackURL === 'string')
    return safeAuthRedirect(response.callbackURL)
  return null
}

function safeAuthRedirect(value: string, options: { allowExternal?: boolean } = {}) {
  if (options.allowExternal) return value
  return safeRedirectPath(value) ?? null
}

function LoadingMessage({ label }: { label: string }) {
  return (
    <Status>
      <LoaderCircle className="spin" size={18} />
      {label}
    </Status>
  )
}

function SubmitStatus({ state }: { state: SubmitState }) {
  if (state.error) return <Status tone="error">{state.error}</Status>
  if (state.message) return <Status tone="success">{state.message}</Status>
  return null
}

function PasswordInput(props: Omit<ComponentProps<typeof TextInput>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="passwordField">
      <TextInput {...props} type={visible ? 'text' : 'password'} />
      <button
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((value) => !value)}
        type="button"
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}

function CaptchaTokenField({
  config,
  onChange,
}: {
  config: ReturnType<typeof useConfigz>['data']
  onChange: (value: string) => void
}) {
  const widgetId = useId()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!config?.captcha?.enabled || !config.captcha.siteKey || !containerRef.current) return

    let disposed = false
    let widget: string | null = null

    loadTurnstileScript()
      .then(() => {
        if (disposed || !containerRef.current || !window.turnstile) return
        widget = window.turnstile.render(containerRef.current, {
          sitekey: config.captcha.siteKey,
          callback: onChange,
          'expired-callback': () => onChange(''),
          'error-callback': () => onChange(''),
        })
      })
      .catch(() => onChange(''))

    return () => {
      disposed = true
      onChange('')
      if (widget && window.turnstile) window.turnstile.remove(widget)
    }
  }, [config?.captcha?.enabled, config?.captcha?.siteKey, onChange])

  if (!config?.captcha?.enabled) return null

  return (
    <Field label="CAPTCHA">
      <div>
        <div aria-describedby={`${widgetId}-status`} ref={containerRef} />
        <span className="sr-only" id={`${widgetId}-status`}>
          Complete the CAPTCHA challenge to continue.
        </span>
      </div>
    </Field>
  )
}

function resetCaptchaState(
  config: ReturnType<typeof useConfigz>['data'],
  setCaptchaToken: (value: string) => void,
  setCaptchaResetKey: (updater: (value: number) => number) => void,
) {
  if (!config?.captcha?.enabled) return
  setCaptchaToken('')
  setCaptchaResetKey((value) => value + 1)
}

let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('CAPTCHA script failed to load.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.dataset.turnstileScript = 'true'
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('CAPTCHA script failed to load.')), { once: true })
    document.head.appendChild(script)
  })

  return turnstileScriptPromise
}

async function submitRequest(setSubmit: (state: SubmitState) => void, operation: () => Promise<string>) {
  setSubmit({ loading: true, message: null, error: null })
  try {
    setSubmit({ loading: false, message: await operation(), error: null })
  } catch (error) {
    setSubmit({
      loading: false,
      message: null,
      error: error instanceof Error ? error.message : 'Request failed.',
    })
  }
}
