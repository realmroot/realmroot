import { ArrowLeft, BadgeCheck, Fingerprint, KeyRound, LinkIcon, LoaderCircle, Mail, ShieldCheck } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button, LinkButton } from '@/components/ui/button'
import { Field, TextInput } from '@/components/ui/field'
import { Status } from '@/components/ui/status'
import {
  getCallbackState,
  requestEmailOtp,
  requestEmailOtpPasswordReset,
  requestEmailVerification,
  requestMagicLink,
  requestPasswordReset,
  resetPassword,
  resetPasswordWithEmailOtp,
  signInWithEmailOtp,
  signInWithPassword,
  signInWithUsername,
  signUp,
  verifyEmail,
  verifyEmailOtp,
} from '@/lib/api'
import { callbackURL, useExperienceConfig } from './hooks'

type SubmitState = {
  loading: boolean
  message: string | null
  error: string | null
}

type SignInMode = 'password' | 'magic' | 'otp'

const initialSubmitState: SubmitState = {
  loading: false,
  message: null,
  error: null,
}

export function SignInPage() {
  const { data: config, error, loading } = useExperienceConfig()
  const [mode, setMode] = useState<SignInMode>('password')
  const [submit, setSubmit] = useState(initialSubmitState)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const enabled = config?.signIn
  const callback = callbackURL()

  const socialProviders = config?.identityProviders ?? []
  const methods = useMemo(() => (enabled ? signInMethods(enabled) : []), [enabled])
  const activeMode = methods.some((method) => method.id === mode) ? mode : (methods[0]?.id ?? mode)

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      const useUsername = enabled?.usernameEnabled && !identifier.includes('@')
      const response = useUsername
        ? await signInWithUsername({ username: identifier, password, callbackURL: callback, rememberMe: true })
        : await signInWithPassword({ email: identifier, password, callbackURL: callback, rememberMe: true })
      navigateAfterAuth(response, callback)
      return 'Signed in. Redirecting to the requested application.'
    })
  }

  async function onMagicSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      await requestMagicLink({
        email: identifier,
        callbackURL: callback,
        errorCallbackURL: '/sign-in',
      })
      return 'Magic link sent. Check your email to continue.'
    })
  }

  async function onOtpSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      if (!otp) {
        await requestEmailOtp({ email: identifier, type: 'sign-in' })
        return 'One-time code sent. Enter it here to finish signing in.'
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
      title={config?.copy.headline ?? 'Sign in to continue.'}
      description={config?.copy.description ?? 'Use one of the enabled methods to access this application.'}
    >
      {loading ? <LoadingMessage label="Loading sign-in options" /> : null}
      {error ? <Status tone="error">{error}</Status> : null}

      <div className="authCardHeader">
        <h2>Welcome back</h2>
        <p>Choose the sign-in method configured for this deployment.</p>
      </div>

      {methods.length > 1 ? (
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

      {activeMode === 'password' && enabled?.passwordEnabled ? (
        <form className="formStack" onSubmit={onPasswordSubmit}>
          <Field label={enabled.usernameEnabled ? 'Email or username' : 'Email'}>
            <TextInput
              autoComplete="username"
              onChange={(event) => setIdentifier(event.target.value)}
              required
              type="text"
              value={identifier}
            />
          </Field>
          <Field label="Password">
            <TextInput
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </Field>
          <Button disabled={submit.loading} type="submit">
            <KeyRound size={18} />
            Sign in
          </Button>
        </form>
      ) : null}

      {activeMode === 'magic' && enabled?.magicLinkEnabled ? (
        <form className="formStack" onSubmit={onMagicSubmit}>
          <Field label="Email">
            <TextInput
              autoComplete="email"
              onChange={(event) => setIdentifier(event.target.value)}
              required
              type="email"
              value={identifier}
            />
          </Field>
          <Button disabled={submit.loading} type="submit">
            <LinkIcon size={18} />
            Send magic link
          </Button>
        </form>
      ) : null}

      {activeMode === 'otp' && enabled?.emailOtpEnabled ? (
        <form className="formStack" onSubmit={onOtpSubmit}>
          <Field label="Email">
            <TextInput
              autoComplete="email"
              onChange={(event) => setIdentifier(event.target.value)}
              required
              type="email"
              value={identifier}
            />
          </Field>
          <Field label="One-time code" help="Leave blank to request a new code.">
            <TextInput
              autoComplete="one-time-code"
              inputMode="numeric"
              onChange={(event) => setOtp(event.target.value)}
              value={otp}
            />
          </Field>
          <Button disabled={submit.loading} type="submit">
            <Mail size={18} />
            {otp ? 'Verify code' : 'Send code'}
          </Button>
        </form>
      ) : null}

      <SocialButtons callback={callback} providers={socialProviders} />
      <SubmitStatus state={submit} />

      <div className="authLinks">
        {enabled?.signupEnabled ? <a href="/sign-up">Create account</a> : null}
        {enabled?.passwordEnabled ? <a href="/forgot-password">Forgot password?</a> : null}
      </div>
      <ChallengePreview />
    </AuthLayout>
  )
}

export function SignUpPage() {
  const { data: config } = useExperienceConfig()
  const [submit, setSubmit] = useState(initialSubmitState)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      await signUp({
        email,
        name,
        password,
        username: config?.signIn.usernameEnabled && username ? username : undefined,
        callbackURL: callbackURL(),
      })
      return 'Account created. Check your email if verification is required.'
    })
  }

  return (
    <AuthLayout
      config={config}
      eyebrow="Create account"
      title="Start with your identity."
      description="Create a hosted account for every connected application."
    >
      <form className="formStack" onSubmit={onSubmit}>
        <Field label="Name">
          <TextInput autoComplete="name" onChange={(event) => setName(event.target.value)} required value={name} />
        </Field>
        <Field label="Email">
          <TextInput
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </Field>
        {config?.signIn.usernameEnabled ? (
          <Field label="Username">
            <TextInput autoComplete="username" onChange={(event) => setUsername(event.target.value)} value={username} />
          </Field>
        ) : null}
        <Field label="Password" help="Use at least 8 characters.">
          <TextInput
            autoComplete="new-password"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </Field>
        <Button disabled={submit.loading} type="submit">
          Create account
        </Button>
      </form>
      <SubmitStatus state={submit} />
      <div className="authLinks">
        <a href="/sign-in">Already have an account?</a>
      </div>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const { data: config } = useExperienceConfig()
  const [submit, setSubmit] = useState(initialSubmitState)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [resetMethod, setResetMethod] = useState<'email' | 'otp'>('email')
  const [otpRequested, setOtpRequested] = useState(false)
  const token = new URLSearchParams(window.location.search).get('token')
  const otpResetEnabled = config?.signIn.emailOtpEnabled === true

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
        await requestEmailOtpPasswordReset({ email })
        setOtpRequested(true)
        return 'Password reset code sent.'
      }

      await requestPasswordReset({ email, redirectTo: `${window.location.origin}/forgot-password` })
      return 'Password reset email sent.'
    })
  }

  return (
    <AuthLayout
      config={config}
      eyebrow="Account recovery"
      title="Recover your password."
      description="Request a reset email or finish the reset with a token or one-time code."
    >
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
        {token || otpRequested ? (
          <Field label="New password">
            <TextInput
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
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
        <a href="/sign-in">Back to sign in</a>
      </div>
    </AuthLayout>
  )
}

export function EmailVerificationPage() {
  const { data: config } = useExperienceConfig()
  const [submit, setSubmit] = useState(initialSubmitState)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const token = new URLSearchParams(window.location.search).get('token')

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
      title="Verify your email."
      description="Confirm ownership of your email address before continuing."
    >
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
  const { data: config } = useExperienceConfig()
  const [state, setState] = useState<{ loading: boolean; message: string; href?: string; error?: string }>({
    loading: true,
    message: 'Completing sign-in',
  })

  useEffect(() => {
    let active = true
    getCallbackState(window.location.search)
      .then((result) => {
        if (!active) return
        if (result.error) {
          setState({
            loading: false,
            message: 'Sign-in could not continue.',
            error: result.error.description ?? result.error.code,
          })
          return
        }
        if (result.consent) {
          setState({ loading: false, message: 'Consent is required before redirecting.', href: result.consent.href })
          return
        }
        setState({ loading: false, message: 'Sign-in complete.', href: result.returnTo ?? '/account' })
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            loading: false,
            message: 'Sign-in could not continue.',
            error: error instanceof Error ? error.message : 'Unknown error.',
          })
        }
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <AuthLayout
      config={config}
      eyebrow="Callback"
      title={state.message}
      description="This page handles redirects from hosted authentication and OAuth journeys."
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

function SocialButtons({
  callback,
  providers,
}: {
  callback: string | undefined
  providers: Array<{ slug: string; displayName: string; authorizationUrl: string }>
}) {
  if (providers.length === 0) return null

  return (
    <fieldset className="socialGrid">
      <legend>Social sign-in providers</legend>
      {providers.map((provider) => (
        <a
          className="socialButton"
          href={socialAuthorizationUrl(provider.authorizationUrl, callback)}
          key={provider.slug}
        >
          <BadgeCheck size={18} />
          Continue with {provider.displayName}
        </a>
      ))}
    </fieldset>
  )
}

export function socialAuthorizationUrl(authorizationUrl: string, callback: string | undefined) {
  if (!callback) return authorizationUrl
  const relative = authorizationUrl.startsWith('/')
  const url = new URL(authorizationUrl, window.location.origin)
  url.searchParams.set('callbackURL', callback)
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString()
}

function signInMethods(enabled: NonNullable<ReturnType<typeof useExperienceConfig>['data']>['signIn']) {
  const methods: Array<{ id: SignInMode; label: string }> = []
  if (enabled.passwordEnabled) methods.push({ id: 'password', label: 'Password' })
  if (enabled.magicLinkEnabled) methods.push({ id: 'magic', label: 'Magic link' })
  if (enabled.emailOtpEnabled) methods.push({ id: 'otp', label: 'OTP' })
  return methods
}

function navigateAfterAuth(response: unknown, callback: string | undefined) {
  const redirectUrl = resolveAuthRedirect(response, callback)
  if (window.location.pathname !== redirectUrl) {
    window.location.assign(redirectUrl)
  }
}

export function resolveAuthRedirect(response: unknown, callback: string | undefined) {
  return readRedirectUrl(response) ?? callback ?? '/account'
}

function readRedirectUrl(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null
  if ('url' in response && typeof response.url === 'string') return response.url
  if ('redirectTo' in response && typeof response.redirectTo === 'string') return response.redirectTo
  if ('callbackURL' in response && typeof response.callbackURL === 'string') return response.callbackURL
  return null
}

function ChallengePreview() {
  return (
    <fieldset className="challengeGrid">
      <legend>Additional security challenges</legend>
      <div>
        <ShieldCheck size={18} />
        <span>MFA challenge ready</span>
      </div>
      <div>
        <Fingerprint size={18} />
        <span>Passkey enrollment ready</span>
      </div>
    </fieldset>
  )
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
