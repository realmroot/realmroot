import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { SelectInput } from '@/components/product-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
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
import { HostedAuthPreview, SignInExperienceEditorLayout } from '../helpers/helpers-preview'
import { ResourcePage } from '../helpers/helpers-resource'
import { useAdminMutation } from '../helpers/helpers-utils'

type Editor = 'registration' | 'methods' | null
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
  const [editor, setEditor] = useState<Editor>(null)
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
      setEditor(null)
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
  const closeEditor = () => {
    if (query.data && security.data) {
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
    }
    setEditor(null)
  }
  return (
    <ResourcePage
      title={tt('Sign-in & registration')}
      description={tt(
        'Control account creation, accepted identifiers, and which configured methods appear on hosted sign-in.',
      )}
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
          preview={<HostedAuthPreview preview={preview} />}
          settings={
            <div className="detailSections">
              <SettingsBlock
                action={
                  <Button onClick={() => setEditor('registration')} variant="outline">
                    {tt('Edit')}
                  </Button>
                }
                description="Control account creation and accepted sign-in identifiers."
                title="Registration and identifiers"
              >
                <DetailRow label="Public sign-up" value={enabled(form.signupEnabled)} />
                <DetailRow label="Username sign-in" value={enabled(form.usernameEnabled)} />
                <DetailRow
                  label="Sign-in sequence"
                  value={form.identifierFirst ? tt('Identifier first') : tt('Identifier and credential together')}
                />
              </SettingsBlock>
              <SettingsBlock
                action={
                  <Button onClick={() => setEditor('methods')} variant="outline">
                    {tt('Edit')}
                  </Button>
                }
                description="Choose which configured connectors appear on hosted sign-in."
                title="Available sign-in methods"
              >
                <DetailRow label="Password" value={enabled(form.passwordEnabled)} />
                <DetailRow label="Passkey" value={enabled(form.passkeyEnabled)} />
                <DetailRow label="Email code" value={enabled(form.emailCodeEnabled)} />
                <DetailRow label="Social login" value={enabled(form.socialEnabled)} />
                <DetailRow label="Phone" value={enabled(form.phoneEnabled)} />
                <DetailRow label="Web3 wallet" value={enabled(form.web3Enabled)} />
              </SettingsBlock>
            </div>
          }
        />
      ) : null}
      <SignInEditor
        editor={editor}
        error={mutation.errorMessage}
        form={form}
        onChange={setForm}
        onClose={closeEditor}
        onSave={() => mutation.mutate(form)}
        pending={mutation.isPending}
      />
    </ResourcePage>
  )
}

function SignInEditor({
  editor,
  error,
  form,
  onChange,
  onClose,
  onSave,
  pending,
}: {
  editor: Editor
  error?: string | null
  form: SignInForm
  onChange: (form: SignInForm) => void
  onClose: () => void
  onSave: () => void
  pending: boolean
}) {
  return (
    <Sheet
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={editor !== null}
    >
      <SheetContent className="h-full overflow-hidden" side="left">
        <SheetHeader className="shrink-0">
          <SheetTitle>
            {tt(editor === 'methods' ? 'Available sign-in methods' : 'Registration and identifiers')}
          </SheetTitle>
          <SheetDescription>
            {tt(
              editor === 'methods'
                ? 'Only enabled and configured connectors appear on hosted sign-in.'
                : 'Choose who can register and how the first sign-in step behaves.',
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-5">
          {editor === 'registration' ? (
            <>
              <ControlledSwitch
                checked={form.signupEnabled}
                label="Public sign-up"
                name="signupEnabled"
                note="Allow verified visitors to create an account."
                onChange={(signupEnabled) => onChange({ ...form, signupEnabled })}
              />
              <ControlledSwitch
                checked={form.usernameEnabled}
                label="Username sign-in"
                name="usernameEnabled"
                note="Accept username in addition to verified email."
                onChange={(usernameEnabled) => onChange({ ...form, usernameEnabled })}
              />
              <label className="grid gap-2 text-sm" htmlFor="sign-in-sequence">
                <span className="font-medium">{tt('Sign-in sequence')}</span>
                <SelectInput
                  id="sign-in-sequence"
                  name="signInSequence"
                  onChange={(event) =>
                    onChange({ ...form, identifierFirst: event.target.value === 'identifier-first' })
                  }
                  value={form.identifierFirst ? 'identifier-first' : 'combined'}
                >
                  <option value="combined">{tt('Identifier and credential together')}</option>
                  <option value="identifier-first">{tt('Identifier first')}</option>
                </SelectInput>
              </label>
            </>
          ) : null}
          {editor === 'methods' ? (
            <>
              <ControlledSwitch
                checked={form.passwordEnabled}
                label="Password"
                name="passwordEnabled"
                note="Use the built-in credential connector."
                onChange={(passwordEnabled) => onChange({ ...form, passwordEnabled })}
              />
              <ControlledSwitch
                checked={form.passkeyEnabled}
                label="Passkey"
                name="passkeyEnabled"
                note="Offer passwordless WebAuthn sign-in."
                onChange={(passkeyEnabled) => onChange({ ...form, passkeyEnabled })}
              />
              <ControlledSwitch
                checked={form.emailCodeEnabled}
                label="Email code"
                name="emailCodeEnabled"
                note="Send a one-time code to a verified email."
                onChange={(emailCodeEnabled) => onChange({ ...form, emailCodeEnabled })}
              />
              <ControlledSwitch
                checked={form.socialEnabled}
                label="Social login"
                name="socialEnabled"
                note="Show every enabled social and workforce connector."
                onChange={(socialEnabled) => onChange({ ...form, socialEnabled })}
              />
              <ControlledSwitch
                checked={form.phoneEnabled}
                label="Phone"
                name="phoneEnabled"
                note="Use the configured SMS connector."
                onChange={(phoneEnabled) => onChange({ ...form, phoneEnabled })}
              />
              <ControlledSwitch
                checked={form.web3Enabled}
                label="Web3 wallet"
                name="web3Enabled"
                note="Allow configured wallet identity sign-in."
                onChange={(web3Enabled) => onChange({ ...form, web3Enabled })}
              />
            </>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <SheetFooter className="shrink-0">
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending} onClick={onSave}>
            {pending ? tt('Saving…') : tt('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function SettingsBlock({
  action,
  children,
  description,
  title,
}: {
  action: ReactNode
  children: ReactNode
  description: string
  title: string
}) {
  return (
    <section className="detailSection">
      <header>
        <div>
          <h2>{tt(title)}</h2>
          <p>{tt(description)}</p>
        </div>
        {action}
      </header>
      <div className="detailFlatRows">{children}</div>
    </section>
  )
}
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detailFlatRow">
      <div>
        <strong>{tt(label)}</strong>
      </div>
      <span>{value}</span>
      <i />
    </div>
  )
}
function ControlledSwitch({
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
    <div className="flex items-start justify-between gap-4">
      <span>
        <strong className="block text-sm">{tt(label)}</strong>
        <small className="text-muted-foreground">{tt(note)}</small>
      </span>
      <Switch aria-label={tt(label)} checked={checked} name={name} onCheckedChange={onChange} />
    </div>
  )
}
function enabled(value: boolean) {
  return <Badge variant={value ? 'secondary' : 'outline'}>{value ? tt('Enabled') : tt('Disabled')}</Badge>
}
