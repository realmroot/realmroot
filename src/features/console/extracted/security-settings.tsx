import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { SelectInput, TextArea, TextInput } from '@/components/product-form'
import {
  hasSettingsChanges,
  SettingsForm,
  SettingsFormField,
  SettingsFormSection,
  SettingsSwitchField,
  SettingsValueField,
} from '@/components/settings-form'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { lines, ResourcePage } from '@/features/management/resource-components'
import { useAdminMutation } from '@/features/management/utils'
import { consoleQueryKeys, getSecurityPolicy, updateSecurityPolicy } from '@/lib/api/management'
import { tt } from '@/lib/i18n'

type SecuritySection = 'sign-in' | 'mfa' | 'abuse'
type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'recaptcha-enterprise'
type SecurityPolicy = Awaited<ReturnType<typeof getSecurityPolicy>>['policy']
type SecurityDraft = {
  authenticatorAppEnabled: boolean
  backupCodesEnabled: boolean
  blockSubaddressing: boolean
  blockedEntries: string
  captchaEnabled: boolean
  captchaProvider: CaptchaProvider
  captchaSecret: string
  cookieCacheSeconds: string
  emailOtpEnabled: boolean
  expiresInSeconds: string
  freshAgeSeconds: string
  mfaMode: 'optional' | 'required'
  minLength: string
  passkeysEnabled: boolean
  projectId: string
  rejectCustomWords: boolean
  rejectSequential: boolean
  rejectUserInfo: boolean
  requiredCharacterTypes: string
  siteKey: string
  customWords: string
  updateAgeSeconds: string
}

export function SecurityPoliciesPage({ section = 'sign-in' }: { section?: SecuritySection }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: consoleQueryKeys.security, queryFn: getSecurityPolicy })
  const [active, setActive] = useState<SecuritySection>(section)
  const [draft, setDraft] = useState<SecurityDraft | null>(null)
  useEffect(() => setActive(section), [section])
  useEffect(() => {
    if (query.data) setDraft(securityDraft(query.data.policy))
  }, [query.data])
  const mutation = useAdminMutation({
    mutationFn: updateSecurityPolicy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: consoleQueryKeys.security }),
  })
  const pageDescription = tt('Set the protections that guard identity, sessions, and hosted authentication.')
  const pageTitle = tt('Security policies')

  if (query.isLoading)
    return (
      <ResourcePage description={pageDescription} framed={false} loading title={pageTitle}>
        <div />
      </ResourcePage>
    )
  if (query.error)
    return (
      <ResourcePage
        description={pageDescription}
        error={query.error}
        framed={false}
        onRetry={() => query.refetch()}
        title={pageTitle}
      >
        <div />
      </ResourcePage>
    )
  if (!query.data || !draft)
    return (
      <ResourcePage
        description={pageDescription}
        error={new Error(tt('Security policy not found.'))}
        framed={false}
        title={pageTitle}
      >
        <div />
      </ResourcePage>
    )

  const policy = query.data.policy
  const change = <Key extends keyof SecurityDraft>(key: Key, value: SecurityDraft[Key]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    mutation.mutate(securityUpdate(active, draft))
  }
  const captchaSecretReusable = policy.captcha.secretConfigured && draft.captchaProvider === policy.captcha.provider

  return (
    <ResourcePage description={pageDescription} framed={false} title={pageTitle}>
      <Tabs
        onValueChange={(value) => {
          const next = value as SecuritySection
          setActive(next)
          void navigate({ to: `/console/security/${next}` })
        }}
        value={active}
      >
        <TabsList className="w-full" variant="navigation">
          <TabsTrigger value="sign-in">{tt('Sign-in security')}</TabsTrigger>
          <TabsTrigger value="mfa">{tt('MFA')}</TabsTrigger>
          <TabsTrigger value="abuse">{tt('Abuse prevention')}</TabsTrigger>
        </TabsList>
        <TabsContent className="mt-5" value="sign-in">
          <SettingsForm
            dirty={hasSettingsChanges(
              securityUpdate('sign-in', draft),
              securityUpdate('sign-in', securityDraft(policy)),
            )}
            error={mutation.errorMessage}
            onDiscard={() => setDraft(securityDraft(policy))}
            onSubmit={save}
            pending={mutation.isPending}
          >
            <SettingsFormSection
              description="Password rules applied whenever the built-in password connector is available."
              title="Password policy"
            >
              <SettingsFormField label="Minimum length">
                <TextInput
                  max={128}
                  min={8}
                  name="minLength"
                  onChange={(event) => change('minLength', event.target.value)}
                  required
                  type="number"
                  value={draft.minLength}
                />
              </SettingsFormField>
              <SettingsFormField label="Required character types">
                <SelectInput
                  name="requiredCharacterTypes"
                  onChange={(event) => change('requiredCharacterTypes', event.target.value)}
                  value={draft.requiredCharacterTypes}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </SelectInput>
              </SettingsFormField>
              <SecuritySwitch
                checked={draft.rejectUserInfo}
                description="Prevent passwords derived from the user's profile."
                label="Reject user information"
                name="rejectUserInfo"
                onChange={(value) => change('rejectUserInfo', value)}
              />
              <SecuritySwitch
                checked={draft.rejectSequential}
                description="Reject repetitive or sequential character patterns."
                label="Reject repetitive or sequential characters"
                name="rejectSequential"
                onChange={(value) => change('rejectSequential', value)}
              />
              <SecuritySwitch
                checked={draft.rejectCustomWords}
                description="Reject Realm-specific words listed below."
                label="Reject custom words"
                name="rejectCustomWords"
                onChange={(value) => change('rejectCustomWords', value)}
              />
              <SettingsFormField
                description={
                  draft.rejectCustomWords
                    ? 'One blocked word per line.'
                    : 'Enable custom word rejection to edit this list.'
                }
                label="Custom words"
              >
                <TextArea
                  disabled={!draft.rejectCustomWords}
                  name="customWords"
                  onChange={(event) => change('customWords', event.target.value)}
                  rows={5}
                  value={draft.customWords}
                />
              </SettingsFormField>
            </SettingsFormSection>
            <SettingsFormSection
              description="Current session lifetimes applied by the authentication runtime."
              title="Session policy"
            >
              <DurationSelect
                label="Session lifetime"
                name="expiresInSeconds"
                onChange={(value) => change('expiresInSeconds', value)}
                options={sessionLifetimeOptions}
                value={draft.expiresInSeconds}
              />
              <DurationSelect
                label="Refresh interval"
                name="updateAgeSeconds"
                onChange={(value) => change('updateAgeSeconds', value)}
                options={refreshIntervalOptions}
                value={draft.updateAgeSeconds}
              />
              <DurationSelect
                label="Fresh authentication window"
                name="freshAgeSeconds"
                onChange={(value) => change('freshAgeSeconds', value)}
                options={freshWindowOptions}
                value={draft.freshAgeSeconds}
              />
              <DurationSelect
                label="Cookie cache"
                name="cookieCacheSeconds"
                onChange={(value) => change('cookieCacheSeconds', value)}
                options={cookieCacheOptions}
                value={draft.cookieCacheSeconds}
              />
            </SettingsFormSection>
          </SettingsForm>
        </TabsContent>
        <TabsContent className="mt-5" value="mfa">
          <SettingsForm
            dirty={hasSettingsChanges(securityUpdate('mfa', draft), securityUpdate('mfa', securityDraft(policy)))}
            error={mutation.errorMessage}
            onDiscard={() => setDraft(securityDraft(policy))}
            onSubmit={save}
            pending={mutation.isPending}
          >
            <SettingsFormSection
              description="Choose available factors and when Realmroot requires an additional factor."
              title="Available factors"
            >
              <SettingsFormField
                description="Choose whether the second factor is optional or required."
                label="Prompt policy"
              >
                <SelectInput
                  name="mfaMode"
                  onChange={(event) => change('mfaMode', event.target.value as SecurityDraft['mfaMode'])}
                  value={draft.mfaMode}
                >
                  <option value="optional">{tt('Optional')}</option>
                  <option value="required">{tt('Required')}</option>
                </SelectInput>
              </SettingsFormField>
              <SecuritySwitch
                checked={draft.passkeysEnabled}
                description="RP configuration is managed in Builtin connectors."
                label="Passkey"
                name="passkeysEnabled"
                onChange={(value) => change('passkeysEnabled', value)}
              />
              <SecuritySwitch
                checked={draft.authenticatorAppEnabled}
                description="Time-based one-time codes."
                label="Authenticator app"
                name="authenticatorAppEnabled"
                onChange={(value) => change('authenticatorAppEnabled', value)}
              />
              <SecuritySwitch
                checked={draft.emailOtpEnabled}
                description="Requires working email delivery."
                label="Email verification code"
                name="emailOtpEnabled"
                onChange={(value) => change('emailOtpEnabled', value)}
              />
              <SecuritySwitch
                checked={draft.backupCodesEnabled}
                description="Recovery codes generated at enrollment."
                label="Backup codes"
                name="backupCodesEnabled"
                onChange={(value) => change('backupCodesEnabled', value)}
              />
            </SettingsFormSection>
          </SettingsForm>
        </TabsContent>
        <TabsContent className="mt-5" value="abuse">
          <SettingsForm
            dirty={hasSettingsChanges(securityUpdate('abuse', draft), securityUpdate('abuse', securityDraft(policy)))}
            error={mutation.errorMessage}
            onDiscard={() => setDraft(securityDraft(policy))}
            onSubmit={save}
            pending={mutation.isPending}
          >
            <SettingsFormSection
              description="Challenge suspicious hosted sign-up, sign-in, and recovery traffic."
              title="CAPTCHA"
            >
              <SecuritySwitch
                checked={draft.captchaEnabled}
                description="Require a hosted challenge when risk controls request it."
                label="Enable CAPTCHA"
                name="captchaEnabled"
                onChange={(value) => change('captchaEnabled', value)}
              />
              <SettingsFormField label="Provider">
                <SelectInput
                  disabled={!draft.captchaEnabled}
                  name="captchaProvider"
                  onChange={(event) => change('captchaProvider', event.target.value as CaptchaProvider)}
                  value={draft.captchaProvider}
                >
                  <option value="turnstile">Cloudflare Turnstile</option>
                  <option value="hcaptcha">hCaptcha</option>
                  <option value="recaptcha-enterprise">reCAPTCHA Enterprise</option>
                </SelectInput>
              </SettingsFormField>
              {draft.captchaProvider === 'recaptcha-enterprise' ? (
                <SettingsFormField label="Project ID">
                  <TextInput
                    disabled={!draft.captchaEnabled}
                    name="projectId"
                    onChange={(event) => change('projectId', event.target.value)}
                    required={draft.captchaEnabled}
                    value={draft.projectId}
                  />
                </SettingsFormField>
              ) : null}
              <SettingsFormField label="Site key">
                <TextInput
                  disabled={!draft.captchaEnabled}
                  name="siteKey"
                  onChange={(event) => change('siteKey', event.target.value)}
                  required={draft.captchaEnabled}
                  value={draft.siteKey}
                />
              </SettingsFormField>
              <SettingsFormField
                description={captchaSecretReusable ? 'Leave blank to keep the current key.' : undefined}
                label={draft.captchaProvider === 'recaptcha-enterprise' ? 'API key' : 'Secret key'}
              >
                <TextInput
                  autoComplete="new-password"
                  disabled={!draft.captchaEnabled}
                  name="secret"
                  onChange={(event) => change('captchaSecret', event.target.value)}
                  placeholder={captchaSecretReusable ? tt('Leave blank to keep the current key') : undefined}
                  required={draft.captchaEnabled && !captchaSecretReusable}
                  type="password"
                  value={draft.captchaSecret}
                />
              </SettingsFormField>
              <SettingsValueField
                label="Secret status"
                value={
                  <Badge variant={policy.captcha.secretConfigured ? 'secondary' : 'outline'}>
                    {policy.captcha.secretConfigured ? tt('Configured') : tt('Not configured')}
                  </Badge>
                }
              />
            </SettingsFormSection>
            <SettingsFormSection
              description="Reject disposable domains, specific addresses, and unwanted alias patterns."
              title="Email blocklist"
            >
              <SecuritySwitch
                checked={draft.blockSubaddressing}
                description="Reject aliases such as name+tag@example.com."
                label="Block email subaddressing"
                name="blockSubaddressing"
                onChange={(value) => change('blockSubaddressing', value)}
              />
              <SettingsFormField
                description="One email address or bare domain per line."
                label="Blocked addresses and domains"
              >
                <TextArea
                  name="entries"
                  onChange={(event) => change('blockedEntries', event.target.value)}
                  rows={8}
                  value={draft.blockedEntries}
                />
              </SettingsFormField>
            </SettingsFormSection>
          </SettingsForm>
        </TabsContent>
      </Tabs>
    </ResourcePage>
  )
}

export function MfaPage() {
  return <SecurityPoliciesPage section="mfa" />
}
export function SecurityPasswordPolicyPage() {
  return <SecurityPoliciesPage section="sign-in" />
}
export function SecurityCaptchaPage() {
  return <SecurityPoliciesPage section="abuse" />
}
export function SecurityBlocklistPage() {
  return <SecurityPoliciesPage section="abuse" />
}
export function SecurityGeneralPage() {
  return <SecurityPoliciesPage section="sign-in" />
}

function SecuritySwitch({
  checked,
  description,
  label,
  name,
  onChange,
}: {
  checked: boolean
  description: string
  label: string
  name: string
  onChange: (checked: boolean) => void
}) {
  return (
    <SettingsSwitchField
      control={<Switch aria-label={tt(label)} checked={checked} name={name} onCheckedChange={onChange} />}
      description={description}
      label={label}
    />
  )
}

function securityDraft(policy: SecurityPolicy): SecurityDraft {
  return {
    authenticatorAppEnabled: policy.mfa.authenticatorAppEnabled ?? true,
    backupCodesEnabled: policy.mfa.backupCodesEnabled ?? true,
    blockSubaddressing: policy.blocklist.blockSubaddressing,
    blockedEntries: policy.blocklist.entries.join('\n'),
    captchaEnabled: policy.captcha.enabled,
    captchaProvider: policy.captcha.provider,
    captchaSecret: '',
    cookieCacheSeconds: String(policy.sessions.cookieCacheSeconds),
    customWords: policy.password.customWords.join('\n'),
    emailOtpEnabled: policy.mfa.emailOtpEnabled ?? false,
    expiresInSeconds: String(policy.sessions.expiresInSeconds),
    freshAgeSeconds: String(policy.sessions.freshAgeSeconds),
    mfaMode: policy.mfa.mode,
    minLength: String(policy.password.minLength),
    passkeysEnabled: policy.passkeys.enabled,
    projectId: policy.captcha.projectId ?? '',
    rejectCustomWords: policy.password.rejectCustomWords,
    rejectSequential: policy.password.rejectSequential,
    rejectUserInfo: policy.password.rejectUserInfo,
    requiredCharacterTypes: String(policy.password.requiredCharacterTypes),
    siteKey: policy.captcha.siteKey,
    updateAgeSeconds: String(policy.sessions.updateAgeSeconds),
  }
}

function securityUpdate(section: SecuritySection, draft: SecurityDraft) {
  if (section === 'sign-in') {
    return {
      policy: {
        password: {
          minLength: Number(draft.minLength),
          requiredCharacterTypes: Number(draft.requiredCharacterTypes),
          rejectUserInfo: draft.rejectUserInfo,
          rejectSequential: draft.rejectSequential,
          rejectCustomWords: draft.rejectCustomWords,
          customWords: lines(draft.customWords),
        },
        sessions: {
          expiresInSeconds: Number(draft.expiresInSeconds),
          updateAgeSeconds: Number(draft.updateAgeSeconds),
          freshAgeSeconds: Number(draft.freshAgeSeconds),
          cookieCacheSeconds: Number(draft.cookieCacheSeconds),
        },
      },
    }
  }
  if (section === 'mfa') {
    return {
      policy: {
        mfa: {
          mode: draft.mfaMode,
          authenticatorAppEnabled: draft.authenticatorAppEnabled,
          emailOtpEnabled: draft.emailOtpEnabled,
          backupCodesEnabled: draft.backupCodesEnabled,
        },
        passkeys: { enabled: draft.passkeysEnabled },
      },
    }
  }
  const secretKey = draft.captchaSecret.trim()
  return {
    policy: {
      captcha: {
        enabled: draft.captchaEnabled,
        provider: draft.captchaProvider,
        siteKey: draft.siteKey,
        projectId: draft.captchaProvider === 'recaptcha-enterprise' ? draft.projectId : null,
        ...(secretKey ? { secretKey } : {}),
      },
      blocklist: {
        blockSubaddressing: draft.blockSubaddressing,
        entries: lines(draft.blockedEntries),
      },
    },
  }
}

const sessionLifetimeOptions = [3600, 28800, 86400, 604800, 2592000, 7776000]
const refreshIntervalOptions = [0, 900, 3600, 86400, 604800]
const freshWindowOptions = [300, 900, 3600, 28800, 86400]
const cookieCacheOptions = [60, 300, 900, 3600]

function DurationSelect({
  label,
  name,
  onChange,
  options,
  value,
}: {
  label: string
  name: string
  onChange: (value: string) => void
  options: number[]
  value: string
}) {
  const numberValue = Number(value)
  const values = options.includes(numberValue) ? options : [numberValue, ...options]
  return (
    <SettingsFormField label={label}>
      <SelectInput name={name} onChange={(event) => onChange(event.target.value)} value={value}>
        {values.map((seconds) => (
          <option key={seconds} value={seconds}>
            {formatDuration(seconds)}
          </option>
        ))}
      </SelectInput>
    </SettingsFormField>
  )
}

function formatDuration(seconds: number) {
  if (seconds === 0) return tt('Every request')
  if (seconds >= 86400) return durationLabel(Math.round(seconds / 86400), 'day')
  if (seconds >= 3600) return durationLabel(Math.round(seconds / 3600), 'hour')
  return durationLabel(Math.round(seconds / 60), 'minute')
}

function durationLabel(count: number, unit: 'day' | 'hour' | 'minute') {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}
