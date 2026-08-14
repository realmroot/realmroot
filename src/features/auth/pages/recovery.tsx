import { SpaLink } from '@/components/spa-link'
import {
  authPageHref,
  authRequestContext,
  CaptchaTokenField,
  LoadingMessage,
  missingEmailSignUpErrors,
  missingEmailSignUpMessage,
  PasswordInput,
  resetCaptchaState,
  SubmitStatus,
  submitRequest,
} from './controls'
import {
  ArrowRight,
  AuthLayout,
  Button,
  CircleAlert,
  callbackURL,
  Field,
  type FormEvent,
  initialSubmitState,
  LinkButton,
  passwordResetResendCooldownSeconds,
  requestEmailOtp,
  requestEmailOtpPasswordReset,
  resetPasswordWithEmailOtp,
  Status,
  safeRedirectPath,
  TextInput,
  tt,
  useConfigz,
  useEffect,
  useState,
  verifyEmail,
  verifyEmailOtp,
} from './shared'

export function ForgotPasswordPage() {
  const { data: config } = useConfigz()
  const [submit, setSubmit] = useState(initialSubmitState)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [otpRequested, setOtpRequested] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const authContext = authRequestContext('recovery')
  const resetComplete = submit.message === 'Password reset.' && submit.error === null
  const resetCaptcha = () => resetCaptchaState(config, setCaptchaToken, setCaptchaResetKey)
  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendSeconds])
  async function requestResetCode() {
    try {
      await requestEmailOtpPasswordReset({
        email,
        captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
      })
      setOtp('')
      setOtpRequested(true)
      setResendSeconds(passwordResetResendCooldownSeconds)
      return 'Password reset code sent.'
    } finally {
      resetCaptcha()
    }
  }
  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      if (otpRequested && otp && password) {
        if (password !== confirmPassword) throw new Error(tt('New passwords do not match.'))
        await resetPasswordWithEmailOtp({
          email,
          otp,
          password,
        })
        return 'Password reset.'
      }
      return requestResetCode()
    })
  }
  return (
    <AuthLayout
      config={config}
      eyebrow="Account recovery"
      layout={resetComplete ? 'focused' : undefined}
      title={resetComplete ? tt('Password reset.') : (authContext.title ?? tt('Recover your password.'))}
      description={
        resetComplete
          ? tt('Your password has been changed. Sign in with your new password to continue.')
          : (authContext.description ?? tt('Request a one-time code and set a new password for your account.'))
      }
    >
      {!resetComplete ? <SubmitStatus state={submit} /> : null}
      {resetComplete ? (
        <LinkButton to={authPageHref('/auth/sign-in')}>{tt('Continue to sign in')}</LinkButton>
      ) : (
        <form className="formStack" onSubmit={onSubmit}>
          <Field label={tt('Email')}>
            <TextInput
              autoComplete="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              readOnly={otpRequested}
              required
              type="email"
              value={email}
            />
          </Field>
          {!otpRequested ? (
            <CaptchaTokenField key={captchaResetKey} config={config} onChange={setCaptchaToken} />
          ) : null}
          {otpRequested ? (
            <Field label={tt('One-time code')}>
              <TextInput
                autoComplete="one-time-code"
                inputMode="numeric"
                name="otp"
                onChange={(event) => setOtp(event.target.value)}
                value={otp}
              />
            </Field>
          ) : null}
          {otpRequested ? (
            <button
              className="authInlineAction"
              disabled={submit.loading || resendSeconds > 0}
              onClick={() => submitRequest(setSubmit, requestResetCode)}
              type="button"
            >
              {resendSeconds > 0 ? tt('Resend code in {{seconds}}s', { seconds: resendSeconds }) : tt('Resend code')}
            </button>
          ) : null}
          {otpRequested ? (
            <input autoComplete="username" hidden name="username" readOnly type="text" value={email} />
          ) : null}
          {otpRequested ? (
            <Field label={tt('New password')}>
              <PasswordInput
                autoComplete="new-password"
                minLength={8}
                name="new-password"
                onChange={(event) => setPassword(event.target.value)}
                required
                value={password}
              />
            </Field>
          ) : null}
          {otpRequested ? (
            <Field label={tt('Confirm new password')}>
              <PasswordInput
                autoComplete="new-password"
                minLength={8}
                name="confirm-new-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                value={confirmPassword}
              />
            </Field>
          ) : null}
          <Button disabled={submit.loading} type="submit">
            {otpRequested ? tt('Reset password') : tt('Send reset code')}
          </Button>
        </form>
      )}
      {!resetComplete ? (
        <div className="authLinks">
          <SpaLink to={authPageHref('/auth/sign-in')}>{tt('Back to sign in')}</SpaLink>
        </div>
      ) : null}
    </AuthLayout>
  )
}
export function EmailVerificationPage() {
  const { data: config } = useConfigz()
  const [submit, setSubmit] = useState(initialSubmitState)
  const search = new URLSearchParams(window.location.search)
  const [email, setEmail] = useState(search.get('email') ?? '')
  const [otp, setOtp] = useState('')
  const token = search.get('token')
  const authContext = authRequestContext('verification')
  const verified = submit.message === 'Email verified.' && submit.error === null
  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      if (token) {
        await verifyEmail({
          token,
          callbackURL: callbackURL(),
        })
        return 'Email verified.'
      }
      if (otp) {
        await verifyEmailOtp({
          email,
          otp,
        })
        return 'Email verified.'
      }
      await requestEmailOtp({
        email,
        type: 'email-verification',
      })
      return 'Verification code sent.'
    })
  }
  return (
    <AuthLayout
      config={config}
      eyebrow="Email verification"
      layout="focused"
      title={verified ? tt('Email verified.') : (authContext.title ?? tt('Verify your email.'))}
      description={
        verified
          ? tt('Your email address is confirmed. You can now sign in to continue.')
          : (authContext.description ?? tt('Confirm ownership of your email address before continuing.'))
      }
    >
      {verified ? (
        <LinkButton to={authPageHref('/auth/sign-in')}>{tt('Continue to sign in')}</LinkButton>
      ) : (
        <>
          <SubmitStatus state={submit} />
          <div className="authCardHeader">
            <h2>{token ? tt('Verify this email link') : tt('Confirm your inbox')}</h2>
            <p>
              {token
                ? tt('Complete verification with this secure link.')
                : tt('Send a verification email or enter a code.')}
            </p>
          </div>
          <form className="formStack" onSubmit={onSubmit}>
            {!token ? (
              <Field label={tt('Email')}>
                <TextInput
                  autoComplete="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </Field>
            ) : null}
            {!token ? (
              <Field label={tt('One-time code')}>
                <TextInput
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  name="otp"
                  onChange={(event) => setOtp(event.target.value)}
                  value={otp}
                />
              </Field>
            ) : null}
            <Button disabled={submit.loading} type="submit">
              {token || otp ? tt('Verify email') : tt('Send verification')}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}
export function AuthCallbackPage() {
  const { data: config } = useConfigz()
  const [state, setState] = useState<{
    loading: boolean
    message: string
    href?: string
    error?: string
  }>({
    loading: true,
    message: tt('Completing sign-in'),
  })
  useEffect(() => {
    setState(readCallbackState(window.location.search))
  }, [])
  return (
    <AuthLayout
      backHref={state.error ? '/auth/sign-in' : undefined}
      config={config}
      eyebrow="Callback"
      icon={state.error ? <CircleAlert aria-hidden="true" size={28} /> : undefined}
      layout="focused"
      title={state.message}
      description={
        state.error ? tt('Review the error below, then return to sign in.') : tt('Continue to the next step.')
      }
      variant={state.error ? 'message' : 'form'}
    >
      {state.loading ? <LoadingMessage label={tt('Checking callback state')} /> : null}
      {state.error ? <Status tone="error">{state.error}</Status> : null}
      {state.href ? (
        <LinkButton to={state.href}>
          {tt('Continue')} <ArrowRight size={18} />
        </LinkButton>
      ) : null}
    </AuthLayout>
  )
}
function readCallbackState(search: string): {
  loading: false
  message: string
  href?: string
  error?: string
} {
  const params = new URLSearchParams(search)
  const error = params.get('error')
  if (error) {
    return {
      loading: false,
      message: tt('Sign-in could not continue.'),
      error: missingEmailSignUpErrors.has(error)
        ? tt(missingEmailSignUpMessage)
        : tt(params.get('error_description') ?? error),
    }
  }
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  if (clientId && redirectUri) {
    const consentParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
    })
    const state = params.get('state')
    if (state) consentParams.set('state', state)
    return {
      loading: false,
      message: tt('Consent is required before redirecting.'),
      href: safeRedirectPath(`/auth/consent?${consentParams.toString()}`),
    }
  }
  return {
    loading: false,
    message: tt('Sign-in complete.'),
    href: safeRedirectPath(params.get('return_to')) ?? '/profile',
  }
}
