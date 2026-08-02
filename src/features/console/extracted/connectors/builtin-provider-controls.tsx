import {
  Button,
  Field,
  type FormEvent,
  type ManagementSignInSettingsResponse,
  type ReactNode,
  SelectInput,
  SheetClose,
  SheetFooter,
  Switch,
  TextInput,
  tt,
} from '../../console-shared'

export function BuiltinProviderForm({
  children,
  error,
  hasChanges,
  onSubmit,
  pending,
}: {
  children: ReactNode
  error: string | null
  hasChanges: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pending: boolean
}) {
  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      <div className="min-h-0 flex-1 overflow-y-auto px-8">
        <div className="grid gap-4">
          {error ? (
            <div className="text-sm text-destructive" role="alert">
              {error}
            </div>
          ) : null}
          {children}
        </div>
      </div>
      <SheetFooter className="border-t border-border sm:flex-row sm:justify-end">
        <SheetClose asChild>
          <Button type="button" variant="secondary">
            {tt('Close')}
          </Button>
        </SheetClose>
        <Button disabled={!hasChanges || pending} type="submit">
          {pending ? tt('Saving…') : tt('Save')}
        </Button>
      </SheetFooter>
    </form>
  )
}

export function BuiltInProviderSwitch({
  checked,
  description,
  label,
  onCheckedChange,
}: {
  checked: boolean
  description: string
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function NumberSelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: number) => void
  options: Array<{ label: string; value: number }>
  value: number
}) {
  return (
    <Field label={tt(label)}>
      <SelectInput onChange={(event) => onChange(Number(event.target.value))} value={String(value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {tt(option.label)}
          </option>
        ))}
      </SelectInput>
    </Field>
  )
}

export function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: string[]
  value: string
}) {
  return (
    <Field label={tt(label)}>
      <SelectInput onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {tt(option)}
          </option>
        ))}
      </SelectInput>
    </Field>
  )
}

export function SmsProviderFields({
  form,
  setForm,
}: {
  form: ReturnType<typeof defaultPhoneProviderSettings>
  setForm: (
    updater: (
      current: ReturnType<typeof defaultPhoneProviderSettings>,
    ) => ReturnType<typeof defaultPhoneProviderSettings>,
  ) => void
}) {
  if (form.smsProvider === 'twilio')
    return (
      <>
        <TextField
          label="Twilio Account SID"
          onChange={(twilioAccountSid) => setForm((current) => ({ ...current, twilioAccountSid }))}
          value={form.twilioAccountSid}
        />
        <TextField
          label="Twilio Auth Token"
          onChange={(twilioAuthToken) => setForm((current) => ({ ...current, twilioAuthToken }))}
          secret
          value={form.twilioAuthToken}
        />
        <TextField
          label="From number"
          onChange={(twilioFromNumber) => setForm((current) => ({ ...current, twilioFromNumber }))}
          value={form.twilioFromNumber}
        />
      </>
    )
  if (form.smsProvider === 'vonage')
    return (
      <>
        <TextField
          label="Vonage API key"
          onChange={(vonageApiKey) => setForm((current) => ({ ...current, vonageApiKey }))}
          value={form.vonageApiKey}
        />
        <TextField
          label="Vonage API secret"
          onChange={(vonageApiSecret) => setForm((current) => ({ ...current, vonageApiSecret }))}
          secret
          value={form.vonageApiSecret}
        />
        <TextField
          label="From name or number"
          onChange={(vonageFrom) => setForm((current) => ({ ...current, vonageFrom }))}
          value={form.vonageFrom}
        />
      </>
    )
  if (form.smsProvider === 'messagebird')
    return (
      <>
        <TextField
          label="MessageBird access key"
          onChange={(messageBirdAccessKey) => setForm((current) => ({ ...current, messageBirdAccessKey }))}
          secret
          value={form.messageBirdAccessKey}
        />
        <TextField
          label="Originator"
          onChange={(messageBirdOriginator) => setForm((current) => ({ ...current, messageBirdOriginator }))}
          value={form.messageBirdOriginator}
        />
      </>
    )
  return null
}

function TextField({
  label,
  onChange,
  secret,
  value,
}: {
  label: string
  onChange: (value: string) => void
  secret?: boolean
  value: string
}) {
  return (
    <Field label={tt(label)}>
      <TextInput onChange={(event) => onChange(event.target.value)} type={secret ? 'password' : 'text'} value={value} />
    </Field>
  )
}

export function ProviderRuntime({ providerId }: { providerId: string }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm font-semibold">{builtinProviderRuntimeTitle(providerId)}</p>
      <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        {builtinProviderRuntimeDescription(providerId)}
      </p>
    </div>
  )
}

export function submitBuiltIn(event: FormEvent<HTMLFormElement>, update: () => void) {
  event.preventDefault()
  update()
}

export const web3ChainOptions = [
  { id: 1, label: 'Ethereum Mainnet' },
  { id: 137, label: 'Polygon' },
  { id: 8453, label: 'Base' },
  { id: 42161, label: 'Arbitrum One' },
  { id: 10, label: 'Optimism' },
]

export function defaultPhoneProviderSettings(): ManagementSignInSettingsResponse['builtInProviders']['phone'] {
  return {
    enabled: false,
    smsProvider: 'twilio',
    otpLength: 6,
    expiresInSeconds: 300,
    signUpOnVerification: false,
    requireVerification: true,
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioFromNumber: '',
    vonageApiKey: '',
    vonageApiSecret: '',
    vonageFrom: '',
    messageBirdAccessKey: '',
    messageBirdOriginator: '',
  }
}
export function defaultEmailProviderSettings(): ManagementSignInSettingsResponse['builtInProviders']['email'] {
  return { enabled: true, otpLength: 6, expiresInSeconds: 300 }
}
export function defaultWeb3ProviderSettings(): ManagementSignInSettingsResponse['builtInProviders']['web3Wallet'] {
  return { enabled: false, chains: [1], domain: '', emailDomainName: '', allowSignUp: true, ensLookupEnabled: false }
}
export function defaultOneTapProviderSettings(): ManagementSignInSettingsResponse['builtInProviders']['oneTap'] {
  return {
    enabled: false,
    clientId: '',
    autoSelect: false,
    cancelOnTapOutside: true,
    uxMode: 'popup',
    context: 'signin',
    promptBaseDelayMs: 1000,
    promptMaxAttempts: 5,
    disableSignUp: false,
  }
}
function builtinProviderRuntimeTitle(providerId: string) {
  if (providerId === 'phone') return 'SMS runtime'
  if (providerId === 'web3-wallet') return 'Web3 wallet runtime'
  if (providerId === 'passkey') return 'Passkey runtime'
  if (providerId === 'onetap') return 'OneTap runtime'
  return 'Provider runtime'
}
function builtinProviderRuntimeDescription(providerId: string) {
  if (providerId === 'phone') return 'SMS provider is not configured in this runtime.'
  if (providerId === 'web3-wallet') return 'Wallet sign-in is not configured in this runtime.'
  if (providerId === 'passkey') return 'Passkey sign-in is managed by Multi-Factor Auth and is not enabled here.'
  if (providerId === 'onetap') return 'OneTap sign-in is not configured in this runtime.'
  return 'This provider is not configured in this runtime.'
}
