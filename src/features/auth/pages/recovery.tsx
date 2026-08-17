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
  resetPasswordWithToken,
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
  const search = new URLSearchParams(window.location.search)
  const resetToken = search.get('token')
  const invalidLink = search.get('mode') === 'link' && Boolean(search.get('error'))
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
  const linkReset = Boolean(resetToken)
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
      if (resetToken) {
        if (password !== confirmPassword) throw new Error(tt('New passwords do not match.'))
        await resetPasswordWithToken({ token: resetToken, newPassword: password })
        return 'Password reset.'
      }
      if (otpRequested) {
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
  function changeEmail() {
    setEmail('')
    setOtp('')
    setPassword('')
    setConfirmPassword('')
    setOtpRequested(false)
    setResendSeconds(0)
    setSubmit(initialSubmitState)
  }

  const title = resetComplete
    ? tt('Password reset.')
    : invalidLink
      ? tt('Reset link expired.')
      : linkReset
        ? (authContext.title ?? tt('Choose a new password.'))
        : otpRequested
          ? tt('Check your email.')
          : (authContext.title ?? tt('Recover your password.'))
  const description = resetComplete
    ? tt('Your password has been changed. Sign in with your new password to continue.')
    : invalidLink
      ? tt('Request a new email code to continue recovering your account.')
      : linkReset
        ? (authContext.description ?? tt('Enter and confirm the new password for your account.'))
        : otpRequested
          ? tt('Enter the one-time code sent to {{email}}, then choose a new password.', { email })
          : (authContext.description ?? tt('Enter your email address to receive a one-time password reset code.'))

  return (
    <AuthLayout
      config={config}
      eyebrow="Account recovery"
      layout={resetComplete || invalidLink ? 'focused' : undefined}
      title={title}
      description={description}
    >
      {resetComplete ? (
        <LinkButton to={authPageHref('/auth/sign-in')}>{tt('Continue to sign in')}</LinkButton>
      ) : invalidLink ? (
        <>
          <Status tone="error">{tt('This password reset link is invalid or has expired.')}</Status>
          <LinkButton to={authPageHref('/auth/forgot-password')}>{tt('Use an email code instead')}</LinkButton>
        </>
      ) : (
        <>
          <SubmitStatus state={submit} />
          <form className="formStack" onSubmit={onSubmit}>
            {!otpRequested && !linkReset ? (
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
            {!otpRequested && !linkReset ? (
              <CaptchaTokenField key={captchaResetKey} config={config} onChange={setCaptchaToken} />
            ) : null}
            {otpRequested ? (
              <Field label={tt('One-time code')}>
                <TextInput
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  name="otp"
                  onChange={(event) => setOtp(event.target.value)}
                  required
                  value={otp}
                />
              </Field>
            ) : null}
            {otpRequested ? (
              <div className="authLinks">
                <button className="authInlineAction" disabled={submit.loading} onClick={changeEmail} type="button">
                  {tt('Use a different email')}
                </button>
                <button
                  className="authInlineAction"
                  disabled={submit.loading || resendSeconds > 0}
                  onClick={() => submitRequest(setSubmit, requestResetCode)}
                  type="button"
                >
                  {resendSeconds > 0
                    ? tt('Resend code in {{seconds}}s', { seconds: resendSeconds })
                    : tt('Resend code')}
                </button>
              </div>
            ) : null}
            {otpRequested ? (
              <input autoComplete="username" hidden name="username" readOnly type="text" value={email} />
            ) : null}
            {otpRequested || linkReset ? (
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
            {otpRequested || linkReset ? (
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
              {otpRequested || linkReset ? tt('Reset password') : tt('Send reset code')}
            </Button>
          </form>
        </>
      )}
      {!resetComplete && !invalidLink ? (
        <div className="authLinks">
          {linkReset ? (
            <SpaLink to={authPageHref('/auth/forgot-password')}>{tt('Use an email code instead')}</SpaLink>
          ) : null}
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
