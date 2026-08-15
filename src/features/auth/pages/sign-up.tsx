import { SpaLink } from '@/components/spa-link'
import {
  AuthMethodDivider,
  authPageHref,
  authRequestContext,
  CaptchaTokenField,
  navigateAfterAuth,
  PasswordInput,
  resetCaptchaState,
  SocialButtons,
  SubmitStatus,
  submitRequest,
} from './controls'
import {
  AuthLayout,
  Button,
  callbackURL,
  Field,
  type FormEvent,
  initialSubmitState,
  type ReactNode,
  signUp,
  TextInput,
  tt,
  useConfigz,
  useState,
} from './shared'

export function SignUpPage() {
  const { data: config } = useConfigz()
  const [submit, setSubmit] = useState(initialSubmitState)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [verificationSent, setVerificationSent] = useState(false)
  const authContext = authRequestContext('sign-up')
  const callback = callbackURL()
  const socialProviders = config?.identityProviders ?? []
  const signupEnabled = config?.signIn.signupEnabled !== false && config?.signIn.passwordEnabled !== false
  const resetCaptcha = () => resetCaptchaState(config, setCaptchaToken, setCaptchaResetKey)
  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await submitRequest(setSubmit, async () => {
      try {
        const response = await signUp({
          email,
          name,
          password,
          username: config?.signIn.usernameEnabled && username ? username : undefined,
          callbackURL: callback,
          captchaToken: config?.captcha?.enabled ? captchaToken : undefined,
        })
        if (response.token) {
          navigateAfterAuth(response, callback)
          return 'Account created. Redirecting to Account Center.'
        }
        setVerificationSent(true)
        return 'Account created.'
      } finally {
        resetCaptcha()
      }
    })
  }
  return (
    <AuthLayout
      config={config}
      eyebrow="Create account"
      title={authContext.title ?? tt('Start with your identity.')}
      description={authContext.description ?? tt('Create a hosted account for every connected application.')}
    >
      {signupEnabled ? (
        <SignUpCardBody
          created={verificationSent}
          email={email}
          form={
            <SignUpForm
              captchaConfig={config}
              captchaResetKey={captchaResetKey}
              email={email}
              name={name}
              onCaptchaChange={setCaptchaToken}
              onEmailChange={setEmail}
              onNameChange={setName}
              onPasswordChange={setPassword}
              onSubmit={onSubmit}
              onUsernameChange={setUsername}
              password={password}
              submitLoading={submit.loading}
              username={username}
              usernameEnabled={config?.signIn.usernameEnabled}
            />
          }
          signInAction={<SpaLink to={authPageHref('/auth/sign-in')}>{tt('Already have an account?')}</SpaLink>}
          socialButtons={
            socialProviders.length > 0 ? <SocialButtons callback={callback} providers={socialProviders} /> : undefined
          }
          status={verificationSent ? undefined : <SubmitStatus state={submit} />}
        />
      ) : (
        <SignUpDisabled signInAction={<SpaLink to={authPageHref('/auth/sign-in')}>{tt('Back to sign in')}</SpaLink>} />
      )}
    </AuthLayout>
  )
}
function SignUpDisabled({ signInAction }: { signInAction: ReactNode }) {
  return (
    <>
      <div className="authCardHeader">
        <h2>{tt('Password sign up is not available')}</h2>
        <p>{tt('Use sign in to continue with an enabled passwordless or social method.')}</p>
      </div>
      <div className="authLinks">{signInAction}</div>
    </>
  )
}
export function SignUpCardBody({
  created,
  email,
  form,
  signInAction,
  socialButtons,
  status,
}: {
  created: boolean
  email: string
  form: ReactNode
  signInAction: ReactNode
  socialButtons?: ReactNode
  status?: ReactNode
}) {
  return (
    <>
      {status}
      {created ? (
        <div className="authCardHeader">
          <h2>{tt('Check your inbox')}</h2>
          <p>{tt('We sent a verification message to {{email}}. Verify your address, then sign in.', { email })}</p>
        </div>
      ) : (
        form
      )}
      {!created && socialButtons ? (
        <>
          <AuthMethodDivider />
          {socialButtons}
        </>
      ) : null}
      <div className="authLinks">{signInAction}</div>
    </>
  )
}
export function SignUpForm({
  captchaConfig,
  captchaResetKey,
  email,
  name,
  onCaptchaChange,
  onEmailChange,
  onNameChange,
  onPasswordChange,
  onSubmit,
  onUsernameChange,
  password,
  renderAsForm = true,
  submitLoading = false,
  username,
  usernameEnabled,
}: {
  captchaConfig?: Parameters<typeof CaptchaTokenField>[0]['config']
  captchaResetKey?: string | number
  email: string
  name: string
  onCaptchaChange?: (token: string) => void
  onEmailChange: (value: string) => void
  onNameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onUsernameChange: (value: string) => void
  password: string
  renderAsForm?: boolean
  submitLoading?: boolean
  username: string
  usernameEnabled?: boolean
}) {
  const fields = (
    <>
      <Field label={tt('Name')}>
        <TextInput
          autoComplete="name"
          name="name"
          onChange={(event) => onNameChange(event.target.value)}
          required
          value={name}
        />
      </Field>
      <Field label={tt('Email')}>
        <TextInput
          autoComplete={usernameEnabled ? 'email' : 'username'}
          name="email"
          onChange={(event) => onEmailChange(event.target.value)}
          required
          type="email"
          value={email}
        />
      </Field>
      {usernameEnabled ? (
        <Field label={tt('Username')}>
          <TextInput
            autoComplete="username"
            name="username"
            onChange={(event) => onUsernameChange(event.target.value)}
            value={username}
          />
        </Field>
      ) : null}
      <Field label={tt('Password')}>
        <PasswordInput
          autoComplete="new-password"
          name="password"
          onChange={(event) => onPasswordChange(event.target.value)}
          required
          value={password}
        />
      </Field>
      {captchaConfig && onCaptchaChange ? (
        <CaptchaTokenField key={captchaResetKey} config={captchaConfig} onChange={onCaptchaChange} />
      ) : null}
      <Button disabled={submitLoading} type="submit">
        {' '}
        {tt('Create account')}{' '}
      </Button>
    </>
  )
  if (!renderAsForm) return <div className="formStack">{fields}</div>
  return (
    <form className="formStack" onSubmit={onSubmit}>
      {fields}
    </form>
  )
}
