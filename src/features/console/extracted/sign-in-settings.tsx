import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { SelectInput } from '@/components/product-form'
import {
  hasSettingsChanges,
  SettingsForm,
  SettingsFormField,
  SettingsFormSection,
  SettingsSwitchField,
} from '@/components/settings-form'
import { Switch } from '@/components/ui/switch'
import {
  consoleQueryKeys,
  getBrandingSettings,
  getSecurityPolicy,
  getSignInSettings,
  updateSecurityPolicy,
  updateSignInSettings,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import type { HostedAuthPreviewState } from '../console-shared'
import { useConnectorPreviewProviders } from '../helpers/helpers-dialogs'
import {
  HostedAuthPreview,
  SignInExperienceEditorLayout,
  SignInExperiencePreviewPanel,
} from '../helpers/helpers-preview'
import { ResourcePage } from '../helpers/helpers-resource'
import { useAdminMutation } from '../helpers/helpers-utils'

type SignInForm = {
  signupEnabled: boolean
  usernameEnabled: boolean
  identifierFirst: boolean
  passwordEnabled: boolean
  passkeyEnabled: boolean
  emailCodeEnabled: boolean
  socialEnabled: boolean
  phoneEnabled: boolean
  web3Enabled: boolean
}

const emptyForm: SignInForm = {
  signupEnabled: true,
  usernameEnabled: false,
  identifierFirst: false,
  passwordEnabled: true,
  passkeyEnabled: false,
  emailCodeEnabled: false,
  socialEnabled: true,
  phoneEnabled: false,
  web3Enabled: false,
}

export function SignInSettingsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: consoleQueryKeys.signIn, queryFn: getSignInSettings })
  const branding = useQuery({ queryKey: consoleQueryKeys.branding, queryFn: getBrandingSettings })
  const security = useQuery({ queryKey: consoleQueryKeys.security, queryFn: getSecurityPolicy })
  const connectors = useConnectorPreviewProviders()
  const [form, setForm] = useState<SignInForm>(emptyForm)
  useEffect(() => {
    if (!query.data || !security.data) return
    setForm({
      signupEnabled: query.data.signIn.signupEnabled,
      usernameEnabled: query.data.signIn.usernameEnabled,
      identifierFirst: query.data.signIn.identifierFirst,
      passwordEnabled: query.data.signIn.passwordEnabled,
      passkeyEnabled: security.data.policy.passkeys.enabled,
      emailCodeEnabled: query.data.signIn.emailOtpEnabled,
      socialEnabled: query.data.signIn.socialLoginEnabled,
      phoneEnabled: query.data.builtInProviders.phone.enabled,
      web3Enabled: query.data.builtInProviders.web3Wallet.enabled,
    })
  }, [query.data, security.data])
  const mutation = useAdminMutation({
    mutationFn: async (next: SignInForm) => {
      await Promise.all([
        updateSignInSettings({
          signIn: {
            signupEnabled: next.signupEnabled,
            usernameEnabled: next.usernameEnabled,
            identifierFirst: next.identifierFirst,
            passwordEnabled: next.passwordEnabled,
            emailOtpEnabled: next.emailCodeEnabled,
            socialLoginEnabled: next.socialEnabled,
          },
          builtInProviders: {
            phone: { enabled: next.phoneEnabled },
            web3Wallet: { enabled: next.web3Enabled },
          },
        }),
        updateSecurityPolicy({ policy: { passkeys: { enabled: next.passkeyEnabled } } }),
      ])
      return next
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: consoleQueryKeys.signIn }),
        queryClient.invalidateQueries({ queryKey: consoleQueryKeys.security }),
      ])
    },
  })
  const preview: HostedAuthPreviewState = {
    productName: query.data?.copy.productName ?? 'Realmroot',
    headline: query.data?.copy.headline ?? 'Sign in to Realmroot',
    description: query.data?.copy.description ?? 'Use your account to continue securely.',
    logoUrl: branding.data?.branding.logoUrl ?? undefined,
    primaryColor: branding.data?.branding.primaryColor ?? undefined,
    backgroundColor: branding.data?.branding.backgroundColor ?? undefined,
    passwordEnabled: form.passwordEnabled,
    passkeysEnabled: form.passkeyEnabled,
    emailOtpEnabled: form.emailCodeEnabled,
    oneTapEnabled: query.data?.builtInProviders.oneTap.enabled,
    socialLoginEnabled: form.socialEnabled,
    socialProviders: connectors.providers,
    phoneEnabled: form.phoneEnabled,
    web3WalletEnabled: form.web3Enabled,
    signupEnabled: form.signupEnabled,
    usernameEnabled: form.usernameEnabled,
    identifierFirst: form.identifierFirst,
    termsUri: query.data?.links.termsUri ?? undefined,
    privacyUri: query.data?.links.privacyUri ?? undefined,
    supportEmail: query.data?.links.supportEmail ?? undefined,
  }
  const discard = () => {
    if (!query.data || !security.data) return
    setForm(signInForm(query.data, security.data.policy))
  }
  return (
    <ResourcePage
      title={tt('Sign-in & registration')}
      description={tt(
        'Control account creation, accepted identifiers, and which configured methods appear on hosted sign-in.',
      )}
      aside={
        <SignInExperiencePreviewPanel>
          <HostedAuthPreview preview={preview} />
        </SignInExperiencePreviewPanel>
      }
      error={query.error ?? branding.error ?? security.error ?? connectors.error}
      framed={false}
      loading={query.isLoading || branding.isLoading || security.isLoading}
      onRetry={() => {
        void query.refetch()
        void branding.refetch()
        void security.refetch()
        void connectors.refetch()
      }}
    >
      {query.data && security.data ? (
        <SignInExperienceEditorLayout
          settings={
            <SettingsForm
              className="signInRegistrationForm"
              dirty={hasSettingsChanges(form, signInForm(query.data, security.data.policy))}
              error={mutation.errorMessage}
              onDiscard={discard}
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                mutation.mutate(form)
              }}
              pending={mutation.isPending}
            >
              <SettingsFormSection
                description="Control account creation and accepted sign-in identifiers."
                title="Registration and identifiers"
              >
                <SettingsSwitchField
                  control={
                    <Switch
                      aria-label={tt('Public sign-up')}
                      checked={form.signupEnabled}
                      name="signupEnabled"
                      onCheckedChange={(signupEnabled) => setForm((current) => ({ ...current, signupEnabled }))}
                    />
                  }
                  description="Allow verified visitors to create an account."
                  label="Public sign-up"
                />
                <SettingsSwitchField
                  control={
                    <Switch
                      aria-label={tt('Username sign-in')}
                      checked={form.usernameEnabled}
                      name="usernameEnabled"
                      onCheckedChange={(usernameEnabled) => setForm((current) => ({ ...current, usernameEnabled }))}
                    />
                  }
                  description="Accept username in addition to verified email."
                  label="Username sign-in"
                />
                <SettingsFormField
                  description="Choose whether sign-in asks for identity first or shows credentials together."
                  label="Sign-in sequence"
                >
                  <SelectInput
                    name="signInSequence"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        identifierFirst: event.target.value === 'identifier-first',
                      }))
                    }
                    value={form.identifierFirst ? 'identifier-first' : 'combined'}
                  >
                    <option value="combined">{tt('Identifier and credential together')}</option>
                    <option value="identifier-first">{tt('Identifier first')}</option>
                  </SelectInput>
                </SettingsFormField>
              </SettingsFormSection>
              <SettingsFormSection
                description="Choose which configured connectors appear on hosted sign-in."
                title="Available sign-in methods"
              >
                <SignInSwitch
                  checked={form.passwordEnabled}
                  label="Password"
                  name="passwordEnabled"
                  note="Use the built-in credential connector."
                  onChange={(passwordEnabled) => setForm((current) => ({ ...current, passwordEnabled }))}
                />
                <SignInSwitch
                  checked={form.passkeyEnabled}
                  label="Passkey"
                  name="passkeyEnabled"
                  note="Offer passwordless WebAuthn sign-in."
                  onChange={(passkeyEnabled) => setForm((current) => ({ ...current, passkeyEnabled }))}
                />
                <SignInSwitch
                  checked={form.emailCodeEnabled}
                  label="Email code"
                  name="emailCodeEnabled"
                  note="Send a one-time code to a verified email."
                  onChange={(emailCodeEnabled) => setForm((current) => ({ ...current, emailCodeEnabled }))}
                />
                <SignInSwitch
                  checked={form.socialEnabled}
                  label="Social login"
                  name="socialEnabled"
                  note="Show every enabled social and workforce connector."
                  onChange={(socialEnabled) => setForm((current) => ({ ...current, socialEnabled }))}
                />
                <SignInSwitch
                  checked={form.phoneEnabled}
                  label="Phone"
                  name="phoneEnabled"
                  note="Use the configured SMS connector."
                  onChange={(phoneEnabled) => setForm((current) => ({ ...current, phoneEnabled }))}
                />
                <SignInSwitch
                  checked={form.web3Enabled}
                  label="Web3 wallet"
                  name="web3Enabled"
                  note="Allow configured wallet identity sign-in."
                  onChange={(web3Enabled) => setForm((current) => ({ ...current, web3Enabled }))}
                />
              </SettingsFormSection>
            </SettingsForm>
          }
        />
      ) : null}
    </ResourcePage>
  )
}

function signInForm(
  settings: Awaited<ReturnType<typeof getSignInSettings>>,
  policy: Awaited<ReturnType<typeof getSecurityPolicy>>['policy'],
): SignInForm {
  return {
    signupEnabled: settings.signIn.signupEnabled,
    usernameEnabled: settings.signIn.usernameEnabled,
    identifierFirst: settings.signIn.identifierFirst,
    passwordEnabled: settings.signIn.passwordEnabled,
    passkeyEnabled: policy.passkeys.enabled,
    emailCodeEnabled: settings.signIn.emailOtpEnabled,
    socialEnabled: settings.signIn.socialLoginEnabled,
    phoneEnabled: settings.builtInProviders.phone.enabled,
    web3Enabled: settings.builtInProviders.web3Wallet.enabled,
  }
}

function SignInSwitch({
  checked,
  label,
  name,
  note,
  onChange,
}: {
  checked: boolean
  label: string
  name: string
  note: string
  onChange: (checked: boolean) => void
}) {
  return (
    <SettingsSwitchField
      control={<Switch aria-label={tt(label)} checked={checked} name={name} onCheckedChange={onChange} />}
      description={note}
      label={label}
    />
  )
}
