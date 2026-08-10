import { SpaLink } from '@/components/spa-link'
import {
  authPageHref,
  authRequestContext,
  CaptchaTokenField,
  LoadingMessage,
  localizedHostedCopy,
  navigateAfterAuth,
  PasswordInput,
  primarySignInMode,
  redirectToMissingEmailSignUp,
  requiresTwoFactor,
  resetCaptchaState,
  SignInCardBody,
  SignInMethodButtons,
  SubmitStatus,
  submitRequest,
} from './controls'
import { signInWithEthereum, signInWithGoogleOneTap } from './provider-auth'
import {
  ApiRequestError,
  ArrowRight,
  AuthLayout,
  Button,
  callbackURL,
  Field,
  type FormEvent,
  initialSubmitState,
  KeyRound,
  Mail,
  requestEmailOtp,
  requestPhoneOtp,
  type SignInMode,
  type SignInStep,
  Smartphone,
  Status,
  signInWithEmailOtp,
  signInWithPasskey,
  signInWithPassword,
  signInWithUsername,
  TextInput,
  tt,
  useConfigz,
  useEffect,
  useMemo,
  useRef,
  useState,
  verifyPhoneNumber,
  verifySignInTotp,
} from './shared'

export function SignInPage() {
  const { data: config, error, loading } = useConfigz()
  const [mode, setMode] = useState<SignInMode | null>(null)
  const [step, setStep] = useState<SignInStep>('credential')
  const [submit, setSubmit] = useState(initialSubmitState)
  const [identifier, setIdentifier] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [identifierConfirmed, setIdentifierConfirmed] = useState(false)
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorMethods, setTwoFactorMethods] = useState<string[] | null>(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const enabled = config?.signIn
  const callback = callbackURL()
  const authContext = authRequestContext('sign-in')
  const identifierFirst = enabled?.identifierFirst === true
  const socialProviders = config?.identityProviders ?? []
  const primaryMode = useMemo(() => (enabled ? primarySignInMode(enabled) : null), [enabled])
  const previousPrimaryMode = useRef(primaryMode)
  const activeMode = mode ?? primaryMode
  const showIdentifierStep = identifierFirst && !identifierConfirmed && activeMode !== null
  const needsEmailIdentifier = identifierFirst && activeMode !== 'password' && !identifier.includes('@')
  const resetCaptcha = () => resetCaptchaState(config, setCaptchaToken, setCaptchaResetKey)
  const backToSignIn = () => {
    setMode(null)
    setStep('credential')
    setOtp('')
    setSubmit(initialSubmitState)
    resetCaptcha()
  }
  useEffect(() => {
    const previous = previousPrimaryMode.current
    previousPrimaryMode.current = primaryMode
    if (previous === null) return
    setMode((current) => (current === primaryMode ? current : null))
    setStep('credential')
    setOtp('')
  }, [primaryMode])
  useEffect(() => {
    if (config?.onboarding.required) window.location.assign(config.onboarding.href)
  }, [config?.onboarding.href, config?.onboarding.required])
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
        if (requiresTwoFactor(response)) {
          setTwoFactorMethods(response.twoFactorMethods ?? [])
          return 'Enter your verification code to finish signing in.'
        }
        navigateAfterAuth(response, callback)
        return 'Signed in. Redirecting to the requested application.'
      } finally {
        resetCaptcha()
      }
    })
  }
  async function onTwoFactorSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      const response = await verifySignInTotp({
        code: twoFactorCode,
        trustDevice: true,
      })
      navigateAfterAuth(response, callback)
      return 'Code accepted. Redirecting to the requested application.'
    })
  }
  async function onOtpSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      if (step !== 'otp-code') {
        return sendOtpCode()
      }
      const response = await signInWithEmailOtp({
        email: identifier,
        otp,
      })
      navigateAfterAuth(response, callback)
      return 'Code accepted. Redirecting to the requested application.'
    })
  }
  async function onPhoneSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      if (step !== 'otp-code') {
        await requestPhoneOtp({
          phoneNumber,
        })
        setOtp('')
        setStep('otp-code')
        return 'One-time code sent. Enter it here to finish signing in.'
      }
      const response = await verifyPhoneNumber({
        phoneNumber,
        code: otp,
      })
      navigateAfterAuth(response, callback)
      return 'Code accepted. Redirecting to the requested application.'
    })
  }
  async function onPasskeySubmit() {
    await submitRequest(setSubmit, async () => {
      const response = await signInWithPasskey()
      navigateAfterAuth(response, callback)
      return 'Signed in with passkey. Redirecting to the requested application.'
    })
  }
  async function onWalletSubmit() {
    await submitRequest(setSubmit, async () => {
      try {
        const response = await signInWithEthereum(config?.builtInProviders.web3Wallet.chains ?? [1], callback)
        navigateAfterAuth(response, callback)
        return 'Signed in with wallet. Redirecting to the requested application.'
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 403) {
          redirectToMissingEmailSignUp()
          return 'Redirecting to sign-in help.'
        }
        throw error
      }
    })
  }
  async function onOneTapSubmit() {
    await submitRequest(setSubmit, async () => {
      const response = await signInWithGoogleOneTap(config?.builtInProviders.oneTap, callback)
      navigateAfterAuth(response, callback)
      return 'Signed in with Google One Tap. Redirecting to the requested application.'
    })
  }
  async function sendOtpCode() {
    try {
      await requestEmailOtp({
        email: identifier,
        type: 'sign-in',
        captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
      })
      setOtp('')
      setStep('otp-code')
      return 'One-time code sent. Enter it here to finish signing in.'
    } finally {
      resetCaptcha()
    }
  }
  const methodButtons =
    mode === null && !showIdentifierStep && enabled ? (
      <SignInMethodButtons
        callback={callback}
        emailEnabled={enabled.emailOtpEnabled && primaryMode !== 'otp'}
        onEmailClick={() => {
          setMode('otp')
          setStep('credential')
          setPassword('')
          setOtp('')
        }}
        onPasskeyClick={onPasskeySubmit}
        onPhoneClick={() => {
          setMode('phone')
          setStep('credential')
          setPassword('')
          setOtp('')
        }}
        onOneTapClick={onOneTapSubmit}
        onWalletClick={onWalletSubmit}
        oneTapEnabled={Boolean(config?.builtInProviders?.oneTap?.enabled)}
        passkeyEnabled={Boolean(config?.security.passkeysEnabled)}
        phoneEnabled={Boolean(config?.builtInProviders?.phone?.enabled) && primaryMode !== 'phone'}
        phoneVisible={Boolean(config?.builtInProviders?.phone?.enabled) && primaryMode !== 'phone'}
        providers={socialProviders}
        walletEnabled={Boolean(config?.builtInProviders?.web3Wallet?.enabled)}
      />
    ) : null
  const hasPrimarySignInSurface = Boolean(!twoFactorMethods && !showIdentifierStep && activeMode)
  return (
    <AuthLayout
      config={config}
      eyebrow="Hosted sign-in"
      title={authContext.title ?? localizedHostedCopy(config?.copy.headline, 'Sign in to Realmroot')}
      description={
        authContext.description ??
        localizedHostedCopy(config?.copy.description, 'Use your account to continue securely.')
      }
    >
      {loading ? <LoadingMessage label={tt('Loading sign-in options')} /> : null}
      {error ? <Status tone="error">{error}</Status> : null}
      {!loading &&
      !error &&
      !primaryMode &&
      socialProviders.length === 0 &&
      !config?.builtInProviders.phone.enabled &&
      !config?.security.passkeysEnabled &&
      !config?.builtInProviders.web3Wallet.enabled &&
      !config?.builtInProviders.oneTap.enabled ? (
        <Status tone="warning">{tt('No sign-in methods are enabled. Contact the Realm operator.')}</Status>
      ) : null}

      <SignInCardBody
        footer={<SubmitStatus state={submit} />}
        methodButtons={methodButtons}
        showDivider={Boolean(methodButtons && hasPrimarySignInSurface)}
      >
        {twoFactorMethods ? <Status>{tt('Enter the current code from your authenticator app.')}</Status> : null}
        {step === 'otp-code' ? (
          <Status>
            {tt('Code sent to')} {identifier}
            {tt('. Enter it below to continue.')}
          </Status>
        ) : null}

        {twoFactorMethods ? (
          <form className="formStack" onSubmit={onTwoFactorSubmit}>
            <h2 className="authStepTitle">{tt('Verify your sign-in')}</h2>
            <Field label={tt('Authenticator code')}>
              <TextInput
                autoComplete="one-time-code"
                inputMode="numeric"
                name="totp-code"
                onChange={(event) => setTwoFactorCode(event.target.value)}
                required
                value={twoFactorCode}
              />
            </Field>
            <Button disabled={submit.loading} type="submit">
              <KeyRound size={18} /> {tt('Verify code')}{' '}
            </Button>
          </form>
        ) : null}

        {!twoFactorMethods && showIdentifierStep ? (
          <form
            className="formStack"
            onSubmit={(event) => {
              event.preventDefault()
              setIdentifierConfirmed(true)
            }}
          >
            <Field label={enabled?.usernameEnabled ? tt('Email or username') : tt('Email')}>
              <TextInput
                autoComplete="username"
                name="identifier"
                onChange={(event) => setIdentifier(event.target.value)}
                required
                type="text"
                value={identifier}
              />
            </Field>
            <Button type="submit">
              <ArrowRight size={18} /> {tt('Continue')}{' '}
            </Button>
          </form>
        ) : null}

        {!twoFactorMethods && !showIdentifierStep && identifierFirst && !needsEmailIdentifier ? (
          <div className="identitySummary">
            <span>{tt('Signing in as')}</span>
            <strong>{identifier}</strong>
            <button onClick={() => setIdentifierConfirmed(false)} type="button">
              {' '}
              {tt('Change')}{' '}
            </button>
          </div>
        ) : null}

        {!twoFactorMethods && !showIdentifierStep && activeMode === 'password' && enabled?.passwordEnabled ? (
          <form className="formStack" onSubmit={onPasswordSubmit}>
            {!identifierFirst ? (
              <Field label={enabled.usernameEnabled ? tt('Email or username') : tt('Email')}>
                <TextInput
                  autoComplete="username"
                  name="identifier"
                  onChange={(event) => setIdentifier(event.target.value)}
                  required
                  type="text"
                  value={identifier}
                />
              </Field>
            ) : null}
            <Field label={tt('Password')}>
              <PasswordInput
                autoComplete="current-password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                value={password}
              />
            </Field>
            {enabled.passwordEnabled ? (
              <SpaLink className="authFieldLink" to={authPageHref('/auth/forgot-password')}>
                {' '}
                {tt('Forgot password?')}{' '}
              </SpaLink>
            ) : null}
            <CaptchaTokenField key={captchaResetKey} config={config} onChange={setCaptchaToken} />
            <Button disabled={submit.loading} type="submit">
              <KeyRound size={18} /> {tt('Sign in')}{' '}
            </Button>
            {enabled.signupEnabled ? (
              <p className="authSignupPrompt">
                {tt('No account yet?')} <SpaLink to={authPageHref('/auth/sign-up')}>{tt('Create account')}</SpaLink>
              </p>
            ) : null}
          </form>
        ) : null}

        {!twoFactorMethods && !showIdentifierStep && activeMode === 'otp' && enabled?.emailOtpEnabled ? (
          <form className="formStack" onSubmit={onOtpSubmit}>
            {step !== 'otp-code' && (!identifierFirst || needsEmailIdentifier) ? (
              <Field label={tt('Email')}>
                <TextInput
                  autoComplete="email"
                  name="email"
                  onChange={(event) => setIdentifier(event.target.value)}
                  required
                  type="email"
                  value={identifier}
                />
              </Field>
            ) : null}
            {step === 'otp-code' ? (
              <Field label={tt('Verification code')} help={tt('Enter the code from your email.')}>
                <TextInput
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  name="email-otp"
                  onChange={(event) => setOtp(event.target.value)}
                  required
                  value={otp}
                />
              </Field>
            ) : null}
            {step !== 'otp-code' ? (
              <CaptchaTokenField key={captchaResetKey} config={config} onChange={setCaptchaToken} />
            ) : null}
            <Button disabled={submit.loading} type="submit">
              <Mail size={18} />
              {step === 'otp-code' ? 'Verify code' : 'Send code'}
            </Button>
            {step !== 'otp-code' ? (
              <button className="authBackAction" onClick={backToSignIn} type="button">
                {' '}
                {tt('Back to sign in')}{' '}
              </button>
            ) : null}
            {step === 'otp-code' ? (
              <button
                className="authInlineAction"
                disabled={submit.loading}
                onClick={() => submitRequest(setSubmit, sendOtpCode)}
                type="button"
              >
                {' '}
                {tt('Resend code')}{' '}
              </button>
            ) : null}
          </form>
        ) : null}

        {!twoFactorMethods &&
        !showIdentifierStep &&
        activeMode === 'phone' &&
        config?.builtInProviders?.phone?.enabled ? (
          <form className="formStack" onSubmit={onPhoneSubmit}>
            {step !== 'otp-code' ? (
              <Field label={tt('Phone')}>
                <TextInput
                  autoComplete="tel"
                  inputMode="tel"
                  name="phone"
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="+15555550123"
                  required
                  type="tel"
                  value={phoneNumber}
                />
              </Field>
            ) : null}
            {step === 'otp-code' ? (
              <Field label={tt('Verification code')} help={tt('Enter the code from your phone.')}>
                <TextInput
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  name="phone-otp"
                  onChange={(event) => setOtp(event.target.value)}
                  required
                  value={otp}
                />
              </Field>
            ) : null}
            <Button disabled={submit.loading} type="submit">
              <Smartphone size={18} />
              {step === 'otp-code' ? 'Verify code' : 'Send code'}
            </Button>
            {step !== 'otp-code' ? (
              <button className="authBackAction" onClick={backToSignIn} type="button">
                {' '}
                {tt('Back to sign in')}{' '}
              </button>
            ) : null}
            {step === 'otp-code' ? (
              <button
                className="authInlineAction"
                disabled={submit.loading}
                onClick={() =>
                  submitRequest(setSubmit, async () => {
                    await requestPhoneOtp({
                      phoneNumber,
                    })
                    return 'One-time code sent. Enter it here to finish signing in.'
                  })
                }
                type="button"
              >
                {' '}
                {tt('Resend code')}{' '}
              </button>
            ) : null}
          </form>
        ) : null}
      </SignInCardBody>
    </AuthLayout>
  )
}
