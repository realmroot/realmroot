import {
  AuthCardFrame,
  Button,
  type CSSProperties,
  cn,
  Eye,
  type HostedAuthPreviewFlow,
  type HostedAuthPreviewState,
  KeyRound,
  SignInCardBody,
  SignInMethodButtons,
  type SignInMode,
  type SignInPreviewSurface,
  SignUpCardBody,
  SignUpForm,
  Tabs,
  TabsList,
  TabsTrigger,
  tt,
  useState,
} from '../console-shared'
import { customCssProperties } from './helpers-utils'

export function HostedAuthPreview({ preview }: { preview: HostedAuthPreviewState }) {
  const [surface, setSurface] = useState<SignInPreviewSurface>('desktop')
  const [flow, setFlow] = useState<HostedAuthPreviewFlow>('sign-in')
  const [signupForm, setSignupForm] = useState({
    email: '',
    name: '',
    password: '',
    username: '',
  })
  const previewStyle = {
    '--brand-primary': preview.primaryColor ?? '#b42318',
    '--brand-background': preview.backgroundColor ?? '#f7f3ee',
    ...customCssProperties(preview.customCss ?? ''),
  } as CSSProperties
  const productName = preview.productName || 'Realmroot'
  const primaryMode = hostedAuthMode(preview)
  const previewMode = flow === 'email' ? 'otp' : primaryMode
  const socialProviders = preview.socialProviders ?? []
  const effectiveFlow =
    flow === 'sign-up' && !passwordSignupEnabled(preview)
      ? 'sign-in'
      : flow === 'email' && !preview.emailOtpEnabled
        ? 'sign-in'
        : flow
  const legalLinks = [
    preview.termsUri ? ['Terms', preview.termsUri] : null,
    preview.privacyUri ? ['Privacy', preview.privacyUri] : null,
    preview.supportEmail ? ['Support', `mailto:${preview.supportEmail}`] : null,
  ].filter((link): link is [string, string] => link !== null)
  const previewTitle =
    effectiveFlow === 'sign-up' ? tt('Create account') : localizedHostedCopy(preview.headline, 'Sign in to Realmroot')
  return (
    <div className="hostedPreviewShell">
      <div className="hostedPreviewHeader">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">{tt('Live preview')}</p>
          <h2>{tt('Hosted sign-in')}</h2>
        </div>
        <Tabs setValue={(value) => setSurface(value as SignInPreviewSurface)} value={surface}>
          <TabsList aria-label={tt('Preview viewport')}>
            <TabsTrigger value="desktop">{tt('Desktop')}</TabsTrigger>
            <TabsTrigger value="mobile">{tt('Mobile')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div
        className={cn('brandingPreview hostedAuthPreview', surface === 'mobile' && 'hostedAuthPreview-mobile')}
        style={previewStyle}
      >
        <AuthCardFrame
          ariaLabel={`${productName} hosted sign-in preview`}
          brand={
            <div className="brand brandLink">
              <PreviewBrandMark logoUrl={preview.logoUrl} productName={productName} />
              <span>{productName}</span>
            </div>
          }
          className="hostedAuthPanel"
          description={localizedHostedCopy(preview.description, 'Use your account to continue securely.')}
          eyebrow="Hosted sign-in"
          headingLevel={2}
          legalLinks={legalLinks}
          productName={productName}
          title={previewTitle}
          titleId="hosted-preview-title"
        >
          {effectiveFlow === 'sign-up' ? (
            <SignUpCardBody
              created={false}
              form={
                <SignUpForm
                  email={signupForm.email}
                  name={signupForm.name}
                  onEmailChange={(email) =>
                    setSignupForm((current) => ({
                      ...current,
                      email,
                    }))
                  }
                  onNameChange={(name) =>
                    setSignupForm((current) => ({
                      ...current,
                      name,
                    }))
                  }
                  onPasswordChange={(password) =>
                    setSignupForm((current) => ({
                      ...current,
                      password,
                    }))
                  }
                  onSubmit={(event) => event.preventDefault()}
                  onUsernameChange={(username) =>
                    setSignupForm((current) => ({
                      ...current,
                      username,
                    }))
                  }
                  password={signupForm.password}
                  username={signupForm.username}
                  usernameEnabled={preview.usernameEnabled}
                />
              }
              signInAction={
                <button className="authSignupLink" onClick={() => setFlow('sign-in')} type="button">
                  {' '}
                  {tt('Already have an account?')}{' '}
                </button>
              }
              socialButtons={
                preview.socialLoginEnabled && socialProviders.length > 0 ? (
                  <SignInMethodButtons
                    callback={undefined}
                    emailEnabled={false}
                    onEmailClick={() => undefined}
                    oneTapEnabled={false}
                    onProviderClick={() => undefined}
                    passkeyEnabled={false}
                    phoneEnabled={false}
                    phoneVisible={false}
                    providers={socialProviders}
                    walletEnabled={false}
                  />
                ) : null
              }
            />
          ) : (
            <SignInCardBody
              footer={null}
              methodButtons={
                preview.emailOtpEnabled ||
                preview.phoneEnabled ||
                preview.passkeysEnabled ||
                preview.oneTapEnabled ||
                preview.web3WalletEnabled ||
                (preview.socialLoginEnabled && socialProviders.length > 0) ? (
                  <SignInMethodButtons
                    callback={undefined}
                    emailEnabled={Boolean(preview.emailOtpEnabled)}
                    onEmailClick={() => setFlow('email')}
                    onOneTapClick={() => undefined}
                    onPasskeyClick={() => undefined}
                    onPhoneClick={() => undefined}
                    onProviderClick={() => undefined}
                    onWalletClick={() => undefined}
                    oneTapEnabled={Boolean(preview.oneTapEnabled)}
                    passkeyEnabled={Boolean(preview.passkeysEnabled)}
                    phoneEnabled={Boolean(preview.phoneEnabled)}
                    phoneVisible={Boolean(preview.phoneEnabled)}
                    providers={preview.socialLoginEnabled ? socialProviders : []}
                    walletEnabled={Boolean(preview.web3WalletEnabled)}
                  />
                ) : null
              }
              showDivider={Boolean(
                previewMode &&
                  (preview.emailOtpEnabled ||
                    preview.phoneEnabled ||
                    preview.passkeysEnabled ||
                    preview.oneTapEnabled ||
                    preview.web3WalletEnabled ||
                    (preview.socialLoginEnabled && socialProviders.length > 0)),
              )}
            >
              <div className="formStack">
                <label className="field">
                  {effectiveFlow === 'email' || !preview.usernameEnabled ? tt('Email') : tt('Email or username')}
                  <input className="textInput" readOnly type={effectiveFlow === 'email' ? 'email' : 'text'} value="" />
                </label>
                {previewMode === 'password' && !preview.identifierFirst ? (
                  <label className="field">
                    {' '}
                    {tt('Password')} <input className="textInput" readOnly type="password" value="" />
                  </label>
                ) : null}
                <button className="uiButton uiButton-primary w-full" type="button">
                  <KeyRound data-icon="inline-start" size={16} />
                  {preview.identifierFirst && effectiveFlow === 'sign-in'
                    ? 'Continue'
                    : previewSignInAction(previewMode)}
                </button>
                {effectiveFlow === 'email' ? (
                  <button className="authBackAction" onClick={() => setFlow('sign-in')} type="button">
                    {' '}
                    {tt('Back to sign in')}{' '}
                  </button>
                ) : null}
                {effectiveFlow === 'sign-in' && passwordSignupEnabled(preview) ? (
                  <p className="authSignupPrompt">
                    {tt('No account yet?')}{' '}
                    <button className="authSignupLink" onClick={() => setFlow('sign-up')} type="button">
                      {tt('Create account')}
                    </button>
                  </p>
                ) : null}
              </div>
            </SignInCardBody>
          )}
        </AuthCardFrame>
      </div>
      <Button onClick={() => window.open('/auth/sign-in', '_blank', 'noopener')} type="button" variant="secondary">
        <Eye data-icon="inline-start" /> {tt('Open hosted sign-in')}{' '}
      </Button>
    </div>
  )
}
export function PreviewBrandMark({ logoUrl, productName }: { logoUrl?: string | null; productName: string }) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  const brandInitial = productName.trim().slice(0, 1).toUpperCase() || 'F'
  const showLogo = Boolean(logoUrl && failedLogoUrl !== logoUrl)
  if (showLogo && logoUrl) {
    return (
      <img
        className="brandLogo"
        src={logoUrl}
        alt=""
        width="36"
        height="36"
        onError={() => setFailedLogoUrl(logoUrl)}
      />
    )
  }
  return <span className="brandMark">{brandInitial}</span>
}
export function localizedHostedCopy(value: string | undefined, defaultValue: string) {
  return !value || value === defaultValue ? tt(defaultValue) : value
}
export function hostedAuthMode(preview: HostedAuthPreviewState): SignInMode | null {
  if (preview.passwordEnabled !== false) return 'password'
  if (preview.emailOtpEnabled) return 'otp'
  return null
}
export function passwordSignupEnabled(preview: HostedAuthPreviewState) {
  return preview.signupEnabled && preview.passwordEnabled !== false
}
export function previewSignInAction(mode: SignInMode | null) {
  if (mode === 'otp') return tt('Send code')
  return tt('Sign in')
}
