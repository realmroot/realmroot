import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { KeyRound, LifeBuoy, Mail, Pencil, Smartphone } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Field, SelectInput, TextArea, TextInput } from '@/components/product-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { consoleQueryKeys, getSecurityPolicy, updateSecurityPolicy } from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import { ErrorState, LoadingState } from '../helpers/helpers-dialogs'
import { lines, ResourcePage } from '../helpers/helpers-resource'
import { useAdminMutation } from '../helpers/helpers-utils'

type SecuritySection = 'sign-in' | 'mfa' | 'abuse'
type SecurityEditor = 'password' | 'sessions' | 'mfa' | 'captcha' | 'blocklist' | null
type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'recaptcha-enterprise'

export function SecurityPoliciesPage({ section = 'sign-in' }: { section?: SecuritySection }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: consoleQueryKeys.security, queryFn: getSecurityPolicy })
  const [active, setActive] = useState<SecuritySection>(section)
  const [editor, setEditor] = useState<SecurityEditor>(null)
  const [captchaProvider, setCaptchaProvider] = useState<CaptchaProvider>('turnstile')
  useEffect(() => setActive(section), [section])
  useEffect(() => {
    if (query.data) setCaptchaProvider(query.data.policy.captcha.provider)
  }, [query.data])
  const mutation = useAdminMutation({
    mutationFn: updateSecurityPolicy,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: consoleQueryKeys.security })
      setEditor(null)
    },
  })
  if (query.isLoading) return <LoadingState label={tt('Loading security policies')} />
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  if (!query.data) return <ErrorState error={new Error(tt('Security policy not found.'))} />
  const policy = query.data.policy
  return (
    <ResourcePage
      title={tt('Security policies')}
      description={tt(
        'Review authentication strength, available factors, and abuse protections enforced across this Realm.',
      )}
      framed={false}
    >
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
          <div className="detailSections">
            <SecuritySectionBlock
              action={
                <Button onClick={() => setEditor('password')} variant="outline">
                  <Pencil />
                  {tt('Edit')}
                </Button>
              }
              description="Password rules applied whenever the built-in password connector is available."
              title="Password policy"
            >
              <DetailRow
                label="Minimum length"
                value={tt('{{count}} characters', { count: policy.password.minLength })}
              />
              <DetailRow label="Required character types" value={String(policy.password.requiredCharacterTypes)} />
              <DetailRow label="Reject user information" value={status(policy.password.rejectUserInfo)} />
              <DetailRow label="Reject sequential values" value={status(policy.password.rejectSequential)} />
              <DetailRow
                label="Custom blocked words"
                value={policy.password.rejectCustomWords ? String(policy.password.customWords.length) : tt('Disabled')}
              />
            </SecuritySectionBlock>
            <SecuritySectionBlock
              action={
                <Button onClick={() => setEditor('sessions')} variant="outline">
                  <Pencil />
                  {tt('Edit')}
                </Button>
              }
              description="Current session lifetimes applied by the authentication runtime."
              title="Session policy"
            >
              <DetailRow label="Session lifetime" value={formatDuration(policy.sessions.expiresInSeconds)} />
              <DetailRow label="Refresh interval" value={formatDuration(policy.sessions.updateAgeSeconds)} />
              <DetailRow label="Fresh authentication window" value={formatDuration(policy.sessions.freshAgeSeconds)} />
              <DetailRow label="Cookie cache" value={formatDuration(policy.sessions.cookieCacheSeconds)} />
            </SecuritySectionBlock>
          </div>
        </TabsContent>
        <TabsContent className="mt-5" value="mfa">
          <div className="detailSections">
            <SecuritySectionBlock
              action={
                <Button onClick={() => setEditor('mfa')} variant="outline">
                  <Pencil />
                  {tt('Edit policy')}
                </Button>
              }
              description="Factors users may enroll and the prompt requirement applied at sign-in."
              title="Available factors"
            >
              <FactorRow
                enabled={policy.passkeys.enabled}
                icon={<KeyRound />}
                label="Passkey"
                note="RP configuration is managed in Builtin connectors."
              />
              <FactorRow
                enabled={policy.mfa.authenticatorAppEnabled ?? true}
                icon={<Smartphone />}
                label="Authenticator app"
                note="Time-based one-time codes."
              />
              <FactorRow
                enabled={policy.mfa.emailOtpEnabled ?? false}
                icon={<Mail />}
                label="Email verification code"
                note="Requires working email delivery."
              />
              <FactorRow
                enabled={policy.mfa.backupCodesEnabled ?? true}
                icon={<LifeBuoy />}
                label="Backup codes"
                note="Recovery codes generated at enrollment."
              />
            </SecuritySectionBlock>
            <SecuritySectionBlock description="When Realmroot requires an additional factor." title="Enforcement">
              <DetailRow
                label="Prompt policy"
                value={policy.mfa.mode === 'required' ? tt('Required') : tt('Optional')}
              />
            </SecuritySectionBlock>
          </div>
        </TabsContent>
        <TabsContent className="mt-5" value="abuse">
          <div className="detailSections">
            <SecuritySectionBlock
              action={
                <Button onClick={() => setEditor('captcha')} variant="outline">
                  <Pencil />
                  {tt('Configure')}
                </Button>
              }
              description="Challenge suspicious hosted sign-up, sign-in, and recovery traffic."
              title="CAPTCHA"
            >
              <DetailRow label="Status" value={status(policy.captcha.enabled)} />
              <DetailRow label="Provider" value={captchaProviderLabel(captchaProvider)} />
              <DetailRow label="Site key" value={policy.captcha.siteKey || tt('Not configured')} />
              <DetailRow
                label="Secret"
                value={policy.captcha.secretConfigured ? tt('Configured') : tt('Not configured')}
              />
            </SecuritySectionBlock>
            <SecuritySectionBlock
              action={
                <Button onClick={() => setEditor('blocklist')} variant="outline">
                  <Pencil />
                  {tt('Edit')}
                </Button>
              }
              description="Reject disposable domains, specific addresses, and unwanted alias patterns."
              title="Email blocklist"
            >
              <DetailRow label="Blocked entries" value={String(policy.blocklist.entries.length)} />
              <DetailRow
                label="Subaddressing"
                value={policy.blocklist.blockSubaddressing ? tt('Blocked') : tt('Allowed')}
              />
            </SecuritySectionBlock>
          </div>
        </TabsContent>
      </Tabs>
      <SecurityEditorSheet
        captchaProvider={captchaProvider}
        editor={editor}
        error={mutation.errorMessage}
        onCaptchaProvider={setCaptchaProvider}
        onClose={() => {
          setCaptchaProvider(policy.captcha.provider)
          setEditor(null)
        }}
        onSave={(input) => mutation.mutate(input)}
        pending={mutation.isPending}
        policy={policy}
      />
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

function SecurityEditorSheet({
  captchaProvider,
  editor,
  error,
  onCaptchaProvider,
  onClose,
  onSave,
  pending,
  policy,
}: {
  captchaProvider: CaptchaProvider
  editor: SecurityEditor
  error?: string | null
  onCaptchaProvider: (provider: CaptchaProvider) => void
  onClose: () => void
  onSave: (input: Parameters<typeof updateSecurityPolicy>[0]) => void
  pending: boolean
  policy: Awaited<ReturnType<typeof getSecurityPolicy>>['policy']
}) {
  const [passkeys, setPasskeys] = useState(policy.passkeys.enabled)
  const [authenticator, setAuthenticator] = useState(policy.mfa.authenticatorAppEnabled ?? true)
  const [emailOtp, setEmailOtp] = useState(policy.mfa.emailOtpEnabled ?? false)
  const [backupCodes, setBackupCodes] = useState(policy.mfa.backupCodesEnabled ?? true)
  const [mfaMode, setMfaMode] = useState(policy.mfa.mode)
  const [rejectCustomWords, setRejectCustomWords] = useState(policy.password.rejectCustomWords)
  const [captchaEnabled, setCaptchaEnabled] = useState(policy.captcha.enabled)
  useEffect(() => {
    if (editor === 'password') setRejectCustomWords(policy.password.rejectCustomWords)
    if (editor === 'mfa') {
      setPasskeys(policy.passkeys.enabled)
      setAuthenticator(policy.mfa.authenticatorAppEnabled ?? true)
      setEmailOtp(policy.mfa.emailOtpEnabled ?? false)
      setBackupCodes(policy.mfa.backupCodesEnabled ?? true)
      setMfaMode(policy.mfa.mode)
    }
    if (editor === 'captcha') setCaptchaEnabled(policy.captcha.enabled)
  }, [editor, policy])
  const formId = editor ? `security-${editor}` : undefined
  const captchaSecretReusable = policy.captcha.secretConfigured && captchaProvider === policy.captcha.provider
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={editor !== null}
    >
      <SheetContent className="h-full overflow-hidden sm:max-w-xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>{tt(editorTitle(editor))}</SheetTitle>
          <SheetDescription>{tt(editorDescription(editor))}</SheetDescription>
        </SheetHeader>
        {editor === 'password' ? (
          <form
            className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-5"
            id={formId}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              onSave({
                policy: {
                  password: {
                    minLength: Number(form.get('minLength')),
                    requiredCharacterTypes: Number(form.get('requiredCharacterTypes')),
                    rejectUserInfo: form.get('rejectUserInfo') === 'on',
                    rejectSequential: form.get('rejectSequential') === 'on',
                    rejectCustomWords,
                    customWords: lines(String(form.get('customWords') ?? '')),
                  },
                },
              })
            }}
          >
            <Field label={tt('Minimum length')}>
              <TextInput
                defaultValue={String(policy.password.minLength)}
                max={128}
                min={8}
                name="minLength"
                required
                type="number"
              />
            </Field>
            <Field label={tt('Required character types')}>
              <SelectInput defaultValue={String(policy.password.requiredCharacterTypes)} name="requiredCharacterTypes">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </SelectInput>
            </Field>
            <SwitchField
              defaultChecked={policy.password.rejectUserInfo}
              label="Reject user information"
              name="rejectUserInfo"
            />
            <SwitchField
              defaultChecked={policy.password.rejectSequential}
              label="Reject repetitive or sequential characters"
              name="rejectSequential"
            />
            <ControlledSwitch checked={rejectCustomWords} label="Reject custom words" onChange={setRejectCustomWords} />
            <Field
              help={
                rejectCustomWords
                  ? tt('One blocked word per line.')
                  : tt('Enable custom word rejection to edit this list.')
              }
              label={tt('Custom words')}
            >
              <TextArea
                defaultValue={policy.password.customWords.join('\n')}
                disabled={!rejectCustomWords}
                name="customWords"
                rows={5}
              />
            </Field>
          </form>
        ) : null}
        {editor === 'sessions' ? (
          <form
            className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-5"
            id={formId}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              onSave({
                policy: {
                  sessions: {
                    expiresInSeconds: Number(form.get('expiresInSeconds')),
                    updateAgeSeconds: Number(form.get('updateAgeSeconds')),
                    freshAgeSeconds: Number(form.get('freshAgeSeconds')),
                    cookieCacheSeconds: Number(form.get('cookieCacheSeconds')),
                  },
                },
              })
            }}
          >
            <DurationSelect
              label="Session lifetime"
              name="expiresInSeconds"
              value={policy.sessions.expiresInSeconds}
              options={sessionLifetimeOptions}
            />
            <DurationSelect
              label="Refresh interval"
              name="updateAgeSeconds"
              value={policy.sessions.updateAgeSeconds}
              options={refreshIntervalOptions}
            />
            <DurationSelect
              label="Fresh authentication window"
              name="freshAgeSeconds"
              value={policy.sessions.freshAgeSeconds}
              options={freshWindowOptions}
            />
            <DurationSelect
              label="Cookie cache"
              name="cookieCacheSeconds"
              value={policy.sessions.cookieCacheSeconds}
              options={cookieCacheOptions}
            />
          </form>
        ) : null}
        {editor === 'mfa' ? (
          <form
            className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-5"
            id={formId}
            onSubmit={(event) => {
              event.preventDefault()
              onSave({
                policy: {
                  mfa: {
                    mode: mfaMode,
                    authenticatorAppEnabled: authenticator,
                    emailOtpEnabled: emailOtp,
                    backupCodesEnabled: backupCodes,
                  },
                  passkeys: { enabled: passkeys },
                },
              })
            }}
          >
            <Field label={tt('Prompt policy')}>
              <SelectInput
                name="mfaMode"
                onChange={(event) => setMfaMode(event.target.value as 'optional' | 'required')}
                value={mfaMode}
              >
                <option value="optional">{tt('Optional')}</option>
                <option value="required">{tt('Required')}</option>
              </SelectInput>
            </Field>
            <ControlledSwitch checked={passkeys} label="Passkey" onChange={setPasskeys} />
            <ControlledSwitch checked={authenticator} label="Authenticator app" onChange={setAuthenticator} />
            <ControlledSwitch checked={emailOtp} label="Email verification code" onChange={setEmailOtp} />
            <ControlledSwitch checked={backupCodes} label="Backup codes" onChange={setBackupCodes} />
          </form>
        ) : null}
        {editor === 'captcha' ? (
          <form
            className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-5"
            id={formId}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const secretKey = String(form.get('secret') ?? '').trim()
              onSave({
                policy: {
                  captcha: {
                    enabled: captchaEnabled,
                    provider: captchaProvider,
                    siteKey: String(form.get('siteKey') ?? ''),
                    projectId: captchaProvider === 'recaptcha-enterprise' ? String(form.get('projectId') ?? '') : null,
                    ...(secretKey ? { secretKey } : {}),
                  },
                },
              })
            }}
          >
            <ControlledSwitch checked={captchaEnabled} label="Enable CAPTCHA" onChange={setCaptchaEnabled} />
            <Field label={tt('Provider')}>
              <SelectInput
                name="captchaProvider"
                onChange={(event) => onCaptchaProvider(event.target.value as CaptchaProvider)}
                value={captchaProvider}
              >
                <option value="turnstile">Cloudflare Turnstile</option>
                <option value="hcaptcha">hCaptcha</option>
                <option value="recaptcha-enterprise">reCAPTCHA Enterprise</option>
              </SelectInput>
            </Field>
            {captchaProvider === 'recaptcha-enterprise' ? (
              <Field label={tt('Project ID')}>
                <TextInput defaultValue={policy.captcha.projectId ?? ''} name="projectId" required={captchaEnabled} />
              </Field>
            ) : null}
            <Field label={tt('Site key')}>
              <TextInput defaultValue={policy.captcha.siteKey} name="siteKey" required={captchaEnabled} />
            </Field>
            <Field label={captchaProvider === 'recaptcha-enterprise' ? tt('API key') : tt('Secret key')}>
              <TextInput
                autoComplete="new-password"
                name="secret"
                placeholder={captchaSecretReusable ? tt('Leave blank to keep the current key') : undefined}
                required={captchaEnabled && !captchaSecretReusable}
                type="password"
              />
            </Field>
          </form>
        ) : null}
        {editor === 'blocklist' ? (
          <form
            className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-5"
            id={formId}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              onSave({
                policy: {
                  blocklist: {
                    blockSubaddressing: form.get('blockSubaddressing') === 'on',
                    entries: lines(String(form.get('entries') ?? '')),
                  },
                },
              })
            }}
          >
            <SwitchField
              defaultChecked={policy.blocklist.blockSubaddressing}
              label="Block email subaddressing"
              name="blockSubaddressing"
            />
            <Field help={tt('One email address or bare domain per line.')} label={tt('Blocked addresses and domains')}>
              <TextArea defaultValue={policy.blocklist.entries.join('\n')} name="entries" rows={8} />
            </Field>
          </form>
        ) : null}
        {error ? (
          <p className="px-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <SheetFooter className="shrink-0">
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending} form={formId} type="submit">
            {pending ? tt('Saving…') : tt('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function SecuritySectionBlock({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode
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
function DetailRow({
  action,
  description,
  label,
  value,
}: {
  action?: ReactNode
  description?: string
  label: string
  value: ReactNode
}) {
  return (
    <div className="detailFlatRow">
      <div>
        <strong>{tt(label)}</strong>
        {description ? <span>{tt(description)}</span> : null}
      </div>
      <span>{value}</span>
      {action ?? <i />}
    </div>
  )
}
function FactorRow({ enabled, icon, label, note }: { enabled: boolean; icon: ReactNode; label: string; note: string }) {
  return (
    <div className="detailFlatRow">
      <div className="flex !grid-cols-none items-start gap-3">
        <span className="mt-0.5 text-primary">{icon}</span>
        <span>
          <strong className="block">{tt(label)}</strong>
          <small className="text-muted-foreground">{tt(note)}</small>
        </span>
      </div>
      <span>
        <Badge variant={enabled ? 'secondary' : 'outline'}>{enabled ? tt('Available') : tt('Disabled')}</Badge>
      </span>
      <i />
    </div>
  )
}
function ControlledSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span>{tt(label)}</span>
      <Switch aria-label={tt(label)} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
function SwitchField({ defaultChecked, label, name }: { defaultChecked: boolean; label: string; name: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span>{tt(label)}</span>
      <Switch aria-label={tt(label)} defaultChecked={defaultChecked} name={name} />
    </div>
  )
}
function status(enabled: boolean) {
  return <Badge variant={enabled ? 'secondary' : 'outline'}>{enabled ? tt('Enabled') : tt('Disabled')}</Badge>
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
function captchaProviderLabel(provider: CaptchaProvider) {
  return { turnstile: 'Cloudflare Turnstile', hcaptcha: 'hCaptcha', 'recaptcha-enterprise': 'reCAPTCHA Enterprise' }[
    provider
  ]
}
function editorTitle(editor: SecurityEditor) {
  return (
    {
      password: 'Edit password policy',
      sessions: 'Edit session policy',
      mfa: 'Edit MFA policy',
      captcha: 'Configure CAPTCHA',
      blocklist: 'Edit email blocklist',
    } as Record<Exclude<SecurityEditor, null>, string>
  )[editor ?? 'password']
}
function editorDescription(editor: SecurityEditor) {
  return (
    {
      password: 'Set the minimum strength required by the built-in password connector.',
      sessions: 'Set how long sessions remain valid and when authentication must be refreshed.',
      mfa: 'Choose available factors and when Realmroot requires an additional factor.',
      captcha: 'Choose a provider and supply the credentials required by its hosted challenge.',
      blocklist: 'Reject known addresses, domains, and unwanted subaddress aliases.',
    } as Record<Exclude<SecurityEditor, null>, string>
  )[editor ?? 'password']
}

const sessionLifetimeOptions = [3600, 28800, 86400, 604800, 2592000, 7776000]
const refreshIntervalOptions = [0, 900, 3600, 86400, 604800]
const freshWindowOptions = [300, 900, 3600, 28800, 86400]
const cookieCacheOptions = [60, 300, 900, 3600]

function DurationSelect({
  label,
  name,
  options,
  value,
}: {
  label: string
  name: string
  options: number[]
  value: number
}) {
  const values = options.includes(value) ? options : [value, ...options]
  return (
    <Field label={tt(label)}>
      <SelectInput defaultValue={String(value)} name={name}>
        {values.map((seconds) => (
          <option key={seconds} value={seconds}>
            {formatDuration(seconds)}
          </option>
        ))}
      </SelectInput>
    </Field>
  )
}
