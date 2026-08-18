import {
  type ComponentProps,
  Eye,
  EyeOff,
  Field,
  Fingerprint,
  LoaderCircle,
  Mail,
  ProviderIcon,
  type ReactNode,
  type SignInMode,
  Smartphone,
  Status,
  type SubmitState,
  safeRedirectPath,
  signInWithSocial,
  TextInput,
  tt,
  type useConfigz,
  useEffect,
  useId,
  useRef,
  useState,
  Wallet,
} from './shared'

export function SignInMethodButtons({
  callback,
  emailEnabled,
  onEmailClick,
  onPasskeyClick,
  onPhoneClick,
  onProviderClick,
  onOneTapClick,
  onWalletClick,
  oneTapEnabled,
  passkeyEnabled,
  phoneEnabled,
  phoneVisible,
  providers,
  walletEnabled,
}: {
  callback: string | undefined
  emailEnabled: boolean
  onEmailClick: () => void
  onOneTapClick?: () => void
  onPasskeyClick?: () => void
  onPhoneClick?: () => void
  onProviderClick?: (provider: { providerId: string }) => void
  onWalletClick?: () => void
  oneTapEnabled?: boolean
  passkeyEnabled?: boolean
  phoneEnabled: boolean
  phoneVisible: boolean
  providers: Array<{
    slug: string
    providerId: string
    displayName: string
    icon: string
  }>
  walletEnabled?: boolean
}) {
  if (!emailEnabled && !phoneVisible && !passkeyEnabled && !walletEnabled && !oneTapEnabled && providers.length === 0) {
    return null
  }
  async function onSocialClick(provider: { providerId: string }) {
    if (onProviderClick) {
      onProviderClick(provider)
      return
    }
    const response = await signInWithSocial({
      provider: provider.providerId,
      callbackURL: callback,
      errorCallbackURL: `${window.location.origin}/auth/callback`,
    })
    const redirectUrl = readRedirectUrl(response, {
      allowExternal: true,
    })
    if (redirectUrl) window.location.assign(redirectUrl)
  }
  return (
    <fieldset className="socialGrid">
      <legend>{tt('Available sign-in methods')}</legend>
      {emailEnabled ? (
        <button className="socialButton" onClick={onEmailClick} type="button">
          <span aria-hidden="true" className="providerIcon">
            <Mail size={16} />
          </span>
          <span className="socialButtonText">{tt('Continue with Email')}</span>
        </button>
      ) : null}
      {phoneVisible ? (
        <button className="socialButton" disabled={!phoneEnabled} onClick={onPhoneClick} type="button">
          <span aria-hidden="true" className="providerIcon">
            <Smartphone size={16} />
          </span>
          <span className="socialButtonText">{tt('Continue with Phone')}</span>
        </button>
      ) : null}
      {passkeyEnabled ? (
        <button className="socialButton" onClick={onPasskeyClick} type="button">
          <span aria-hidden="true" className="providerIcon">
            <Fingerprint size={16} />
          </span>
          <span className="socialButtonText">{tt('Continue with Passkey')}</span>
        </button>
      ) : null}
      {walletEnabled ? (
        <button className="socialButton" onClick={onWalletClick} type="button">
          <span aria-hidden="true" className="providerIcon">
            <Wallet size={16} />
          </span>
          <span className="socialButtonText">{tt('Continue with Web3 wallet')}</span>
        </button>
      ) : null}
      {oneTapEnabled ? (
        <button className="socialButton" onClick={onOneTapClick} type="button">
          <ProviderIcon
            provider={{
              displayName: 'OneTap',
              icon: 'onetap',
              providerId: 'one-tap',
            }}
          />
          <span className="socialButtonText">{tt('Continue with OneTap')}</span>
        </button>
      ) : null}
      {providers.map((provider) => (
        <button className="socialButton" key={provider.slug} onClick={() => onSocialClick(provider)} type="button">
          <ProviderIcon provider={provider} />
          <span className="socialButtonText">
            {tt('Continue with')} {provider.displayName}
          </span>
        </button>
      ))}
    </fieldset>
  )
}
export const missingEmailSignUpErrors = new Set(['email_not_found', 'email_is_missing', 'missing_email_signup'])
export const missingEmailSignUpMessage =
  'You do not have an account yet. This sign-in method did not provide account information. Sign in with another method first, then link this method to your account so you can use it next time.'
export function redirectToMissingEmailSignUp() {
  const params = new URLSearchParams({
    error: 'missing_email_signup',
    error_description: missingEmailSignUpMessage,
  })
  window.location.assign(`/auth/callback?${params.toString()}`)
}
export function SignInCardBody({
  children,
  footer,
  methodButtons,
  showDivider,
}: {
  children: ReactNode
  footer?: ReactNode
  methodButtons?: ReactNode
  showDivider: boolean
}) {
  return (
    <>
      {footer}
      {children}
      {showDivider ? <AuthMethodDivider /> : null}
      {methodButtons}
    </>
  )
}
export function AuthMethodDivider() {
  return (
    <div className="authMethodDivider" aria-hidden="true">
      <span>{tt('or')}</span>
    </div>
  )
}
export function SocialButtons({
  callback,
  providers,
}: {
  callback: string | undefined
  providers: Array<{
    slug: string
    providerId: string
    displayName: string
    icon: string
  }>
}) {
  return (
    <SignInMethodButtons
      callback={callback}
      emailEnabled={false}
      onEmailClick={() => undefined}
      oneTapEnabled={false}
      passkeyEnabled={false}
      phoneEnabled={false}
      phoneVisible={false}
      providers={providers}
      walletEnabled={false}
    />
  )
}
export function primarySignInMode(
  enabled: NonNullable<ReturnType<typeof useConfigz>['data']>['signIn'],
): SignInMode | null {
  if (enabled.passwordEnabled) return 'password'
  if (enabled.emailOtpEnabled) return 'otp'
  return null
}
export function authRequestContext(intent: 'sign-in' | 'sign-up' | 'recovery' | 'verification') {
  const params = new URLSearchParams(window.location.search)
  const redirectUri = params.get('redirect_uri')
  if (!params.has('client_id') || !redirectUri) return {}
  const destination = redirectDestination(redirectUri)
  const fallbackTitle =
    intent === 'sign-up'
      ? tt('Create an account for the requested application.')
      : intent === 'recovery'
        ? tt('Recover access for the requested application.')
        : intent === 'verification'
          ? tt('Verify your email for the requested application.')
          : tt('Continue to the requested application.')
  const fallbackDescription =
    intent === 'sign-up'
      ? tt('Create a hosted account to continue.')
      : intent === 'recovery'
        ? tt('Recover your hosted account before continuing.')
        : intent === 'verification'
          ? tt('Confirm your email address before continuing.')
          : tt('Sign in with your hosted account to continue.')
  if (!destination) {
    return {
      title: fallbackTitle,
      description: fallbackDescription,
    }
  }
  return {
    title:
      intent === 'sign-up'
        ? tt('Create an account for {{destination}}.', { destination })
        : intent === 'recovery'
          ? tt('Recover access for {{destination}}.', { destination })
          : intent === 'verification'
            ? tt('Verify your email for {{destination}}.', { destination })
            : tt('Continue to {{destination}}.', { destination }),
    description:
      intent === 'sign-up'
        ? tt('Create a hosted account to continue to {{destination}}.', { destination })
        : intent === 'recovery'
          ? tt('Recover your hosted account before continuing to {{destination}}.', { destination })
          : intent === 'verification'
            ? tt('Confirm your email address before continuing to {{destination}}.', { destination })
            : tt('Sign in with your hosted account to continue to {{destination}}.', { destination }),
  }
}
export function localizedHostedCopy(value: string | undefined, defaultValue: string) {
  return !value || value === defaultValue ? tt(defaultValue) : value
}
export function redirectDestination(redirectUri: string) {
  try {
    return new URL(redirectUri).host
  } catch {
    return null
  }
}
export function authPageHref(path: string) {
  const params = authContinuationParams()
  return params.size > 0 ? `${path}?${params.toString()}` : path
}
export function authContinuationParams() {
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
    'resource',
  ]) {
    for (const value of params.getAll(name)) {
      if (value) continuation.append(name, value)
    }
  }
  return continuation.has('client_id') && continuation.has('redirect_uri') ? continuation : new URLSearchParams()
}
export function navigateAfterAuth(response: unknown, callback: string | undefined) {
  const redirectUrl = resolveAuthRedirect(response, callback)
  if (window.location.pathname !== redirectUrl) {
    window.location.assign(redirectUrl)
  }
}
export function resolveAuthRedirect(response: unknown, callback: string | undefined) {
  return readRedirectUrl(response) ?? safeRedirectPath(callback) ?? '/profile'
}
export function requiresTwoFactor(response: unknown): response is {
  twoFactorRedirect: true
  twoFactorMethods?: string[]
} {
  return (
    typeof response === 'object' &&
    response !== null &&
    'twoFactorRedirect' in response &&
    response.twoFactorRedirect === true
  )
}
export function readRedirectUrl(
  response: unknown,
  options: {
    allowExternal?: boolean
  } = {},
): string | null {
  if (typeof response !== 'object' || response === null) return null
  if ('url' in response && typeof response.url === 'string') return safeAuthRedirect(response.url, options)
  if ('redirectTo' in response && typeof response.redirectTo === 'string') return safeAuthRedirect(response.redirectTo)
  if ('callbackURL' in response && typeof response.callbackURL === 'string')
    return safeAuthRedirect(response.callbackURL)
  return null
}
export function safeAuthRedirect(
  value: string,
  options: {
    allowExternal?: boolean
  } = {},
) {
  if (options.allowExternal) return value
  return safeRedirectPath(value) ?? null
}
export function LoadingMessage({ label }: { label: string }) {
  return (
    <Status>
      <LoaderCircle className="spin" size={18} />
      {label}
    </Status>
  )
}
export function SubmitStatus({ state }: { state: SubmitState }) {
  if (state.error) return <Status tone="error">{state.error}</Status>
  if (state.message) return <Status tone="success">{state.message}</Status>
  return null
}
export function PasswordInput(props: Omit<ComponentProps<typeof TextInput>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="passwordField">
      <TextInput {...props} type={visible ? 'text' : 'password'} />
      <button
        aria-label={visible ? tt('Hide password') : tt('Show password')}
        onClick={() => setVisible((value) => !value)}
        type="button"
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}
export function CaptchaTokenField({
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
    let widget: string | number | null = null
    const provider = config.captcha.provider
    loadCaptchaScript(provider)
      .then(() => {
        if (disposed || !containerRef.current) return
        const api = captchaWidgetApi(provider)
        widget = api.render(containerRef.current, {
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
      if (widget !== null) captchaWidgetApi(provider).dispose(widget)
    }
  }, [config?.captcha?.enabled, config?.captcha?.provider, config?.captcha?.siteKey, onChange])
  if (!config?.captcha?.enabled) return null
  return (
    <Field label={tt('CAPTCHA')}>
      <div>
        <div aria-describedby={`${widgetId}-status`} ref={containerRef} />
        <span className="sr-only" id={`${widgetId}-status`}>
          {' '}
          {tt('Complete the CAPTCHA challenge to continue.')}{' '}
        </span>
      </div>
    </Field>
  )
}
export function resetCaptchaState(
  config: ReturnType<typeof useConfigz>['data'],
  setCaptchaToken: (value: string) => void,
  setCaptchaResetKey: (updater: (value: number) => number) => void,
) {
  if (!config?.captcha?.enabled) return
  setCaptchaToken('')
  setCaptchaResetKey((value) => value + 1)
}
type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'recaptcha-enterprise'
const captchaScriptPromises = new Map<CaptchaProvider, Promise<void>>()

function loadCaptchaScript(provider: CaptchaProvider) {
  if (captchaWidgetReady(provider)) return Promise.resolve()
  const pending = captchaScriptPromises.get(provider)
  if (pending) return pending
  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-captcha-provider="${provider}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), {
        once: true,
      })
      existing.addEventListener(
        'error',
        () => {
          existing.remove()
          reject(new Error('CAPTCHA script failed to load.'))
        },
        {
          once: true,
        },
      )
      return
    }
    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.dataset.captchaProvider = provider
    if (provider === 'turnstile') script.dataset.turnstileScript = 'true'
    script.src = captchaScriptUrl(provider)
    script.addEventListener('load', () => resolve(), {
      once: true,
    })
    script.addEventListener(
      'error',
      () => {
        script.remove()
        reject(new Error('CAPTCHA script failed to load.'))
      },
      {
        once: true,
      },
    )
    document.head.appendChild(script)
  })
  const tracked = promise.catch((error) => {
    captchaScriptPromises.delete(provider)
    throw error
  })
  captchaScriptPromises.set(provider, tracked)
  return tracked
}

function captchaScriptUrl(provider: CaptchaProvider) {
  if (provider === 'turnstile') return 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  if (provider === 'hcaptcha') return 'https://js.hcaptcha.com/1/api.js?render=explicit'
  return 'https://www.google.com/recaptcha/enterprise.js?render=explicit'
}

function captchaWidgetReady(provider: CaptchaProvider) {
  if (provider === 'turnstile') return Boolean(window.turnstile)
  if (provider === 'hcaptcha') return Boolean(window.hcaptcha)
  return Boolean(window.grecaptcha?.enterprise)
}

function captchaWidgetApi(provider: CaptchaProvider) {
  if (provider === 'turnstile' && window.turnstile) {
    return {
      render: window.turnstile.render,
      dispose: (widget: string | number) => window.turnstile?.remove(String(widget)),
    }
  }
  if (provider === 'hcaptcha' && window.hcaptcha) {
    return { render: window.hcaptcha.render, dispose: (widget: string | number) => window.hcaptcha?.remove(widget) }
  }
  if (provider === 'recaptcha-enterprise' && window.grecaptcha?.enterprise) {
    return {
      render: window.grecaptcha.enterprise.render,
      dispose: (widget: string | number) => window.grecaptcha?.enterprise.reset(Number(widget)),
    }
  }
  throw new Error('CAPTCHA provider script did not initialize.')
}
export async function submitRequest(setSubmit: (state: SubmitState) => void, operation: () => Promise<string>) {
  setSubmit({
    loading: true,
    message: null,
    error: null,
  })
  try {
    setSubmit({
      loading: false,
      message: tt(await operation()),
      error: null,
    })
  } catch (error) {
    setSubmit({
      loading: false,
      message: null,
      error: error instanceof Error ? tt(error.message) : tt('Request failed.'),
    })
  }
}
