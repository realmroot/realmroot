import {
  Field,
  type ManagementSignInSettingsResponse,
  type SecurityPolicy,
  SelectInput,
  type SmsProviderId,
  Switch,
  smsProviderOptions,
  TextArea,
  TextInput,
  tt,
  type updateManagementSignInSettingsRequestSchema,
  useEffect,
  useState,
  type z,
} from '@/features/management/shared'
import { shallowEqual } from '@/features/management/utils'
import {
  BuiltInProviderSwitch,
  BuiltinProviderForm,
  defaultEmailProviderSettings,
  defaultOneTapProviderSettings,
  defaultPhoneProviderSettings,
  defaultWeb3ProviderSettings,
  NumberSelectField,
  ProviderRuntime,
  SelectField,
  SmsProviderFields,
  submitBuiltIn,
  web3ChainOptions,
} from './builtin-provider-controls'

type BuiltinProvider = {
  providerId: string
}

const otpLengthOptions = [4, 6, 8].map((value) => ({ label: `${value} digits`, value }))
const codeExpiryOptions = [
  { label: '3 minutes', value: 180 },
  { label: '5 minutes', value: 300 },
  { label: '10 minutes', value: 600 },
  { label: '15 minutes', value: 900 },
]
const promptDelayOptions = [
  { label: '0.5 seconds', value: 500 },
  { label: '1 second', value: 1000 },
  { label: '2 seconds', value: 2000 },
  { label: '3 seconds', value: 3000 },
]
const promptAttemptOptions = [1, 3, 5, 10].map((value) => ({ label: String(value), value }))

export function BuiltinProviderPanel({
  builtInProviders,
  error,
  onUpdatePasskey,
  onUpdateSignIn,
  pending,
  provider,
  security,
}: {
  builtInProviders: ManagementSignInSettingsResponse['builtInProviders'] | null
  error: string | null
  onUpdatePasskey: (input: SecurityPolicy['passkeys']) => void
  onUpdateSignIn: (input: z.infer<typeof updateManagementSignInSettingsRequestSchema>) => void
  pending: boolean
  provider: BuiltinProvider
  security: SecurityPolicy | null
}) {
  const [emailForm, setEmailForm] = useState(defaultEmailProviderSettings())
  const [passkeyForm, setPasskeyForm] = useState({ enabled: false, origins: '', rpId: '', rpName: '' })
  const [passkeyAllowSignUp, setPasskeyAllowSignUp] = useState(true)
  const [phoneForm, setPhoneForm] = useState(defaultPhoneProviderSettings())
  const [web3Form, setWeb3Form] = useState(defaultWeb3ProviderSettings())
  const [oneTapForm, setOneTapForm] = useState(defaultOneTapProviderSettings())
  useEffect(() => {
    setPasskeyForm({
      enabled: security?.passkeys.enabled ?? false,
      origins: security?.passkeys.origins.join('\n') ?? '',
      rpId: security?.passkeys.rpId ?? '',
      rpName: security?.passkeys.rpName ?? '',
    })
  }, [security])
  useEffect(() => {
    setEmailForm({ ...defaultEmailProviderSettings(), ...(builtInProviders?.email ?? {}) })
    setPhoneForm({ ...defaultPhoneProviderSettings(), ...(builtInProviders?.phone ?? {}) })
    setWeb3Form({ ...defaultWeb3ProviderSettings(), ...(builtInProviders?.web3Wallet ?? {}) })
    setPasskeyAllowSignUp(builtInProviders?.passkey.allowSignUp ?? true)
    setOneTapForm({ ...defaultOneTapProviderSettings(), ...(builtInProviders?.oneTap ?? {}) })
  }, [builtInProviders])

  if (provider.providerId === 'email') {
    const loaded = { ...defaultEmailProviderSettings(), ...(builtInProviders?.email ?? {}) }
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={!shallowEqual(emailForm, loaded)}
        onSubmit={(event) => submitBuiltIn(event, () => onUpdateSignIn({ builtInProviders: { email: emailForm } }))}
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={emailForm.enabled}
          description={tt('Allow users to receive a one-time sign-in code by email.')}
          label={tt('Enabled')}
          onCheckedChange={(enabled) => setEmailForm((current) => ({ ...current, enabled }))}
        />
        <NumberSelectField
          label="OTP length"
          onChange={(otpLength) => setEmailForm((current) => ({ ...current, otpLength }))}
          options={otpLengthOptions}
          value={emailForm.otpLength}
        />
        <NumberSelectField
          label="Code expiry"
          onChange={(expiresInSeconds) => setEmailForm((current) => ({ ...current, expiresInSeconds }))}
          options={codeExpiryOptions}
          value={emailForm.expiresInSeconds}
        />
      </BuiltinProviderForm>
    )
  }

  if (provider.providerId === 'passkey') {
    const loadedAllowSignUp = builtInProviders?.passkey.allowSignUp ?? true
    const loadedPasskey = {
      enabled: security?.passkeys.enabled ?? false,
      origins: security?.passkeys.origins.join('\n') ?? '',
      rpId: security?.passkeys.rpId ?? '',
      rpName: security?.passkeys.rpName ?? '',
    }
    const hasPasskeyChanges = !shallowEqual(passkeyForm, loadedPasskey)
    const hasChanges = hasPasskeyChanges || passkeyAllowSignUp !== loadedAllowSignUp
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={hasChanges}
        onSubmit={(event) =>
          submitBuiltIn(event, () => {
            if (hasPasskeyChanges) {
              onUpdatePasskey({
                enabled: passkeyForm.enabled,
                origins: passkeyForm.origins
                  .split(/\r?\n/)
                  .map((value) => value.trim())
                  .filter(Boolean),
                rpId: passkeyForm.rpId.trim(),
                rpName: passkeyForm.rpName.trim(),
              })
            }
            if (passkeyAllowSignUp !== loadedAllowSignUp) {
              onUpdateSignIn({ builtInProviders: { passkey: { allowSignUp: passkeyAllowSignUp } } })
            }
          })
        }
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={passkeyForm.enabled}
          description={tt('Use WebAuthn passkeys for this Realm.')}
          label={tt('Enabled')}
          onCheckedChange={(enabled) => setPasskeyForm((current) => ({ ...current, enabled }))}
        />
        <BuiltInProviderSwitch
          checked={passkeyAllowSignUp}
          description={tt(
            'Allow passkeys to participate in the registration path. If a new user has no account information, they will be asked to sign in with another method first and then bind a passkey.',
          )}
          label={tt('Allow for sign-up')}
          onCheckedChange={setPasskeyAllowSignUp}
        />
        <Field label={tt('Relying party name')}>
          <TextInput
            onChange={(event) => setPasskeyForm((current) => ({ ...current, rpName: event.target.value }))}
            required
            value={passkeyForm.rpName}
          />
        </Field>
        <Field
          help={tt('Use the registrable domain shared by the hosted authentication pages.')}
          label={tt('Relying party ID')}
        >
          <TextInput
            onChange={(event) => setPasskeyForm((current) => ({ ...current, rpId: event.target.value }))}
            required
            value={passkeyForm.rpId}
          />
        </Field>
        <Field help={tt('One origin per line. Use HTTPS outside local development.')} label={tt('Allowed origins')}>
          <TextArea
            onChange={(event) => setPasskeyForm((current) => ({ ...current, origins: event.target.value }))}
            required
            rows={4}
            value={passkeyForm.origins}
          />
        </Field>
      </BuiltinProviderForm>
    )
  }

  if (provider.providerId === 'phone') {
    const loaded = { ...defaultPhoneProviderSettings(), ...(builtInProviders?.phone ?? {}) }
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={!shallowEqual(phoneForm, loaded)}
        onSubmit={(event) => submitBuiltIn(event, () => onUpdateSignIn({ builtInProviders: { phone: phoneForm } }))}
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={phoneForm.enabled}
          description={tt('Show phone number sign-in and verification flows.')}
          label={tt('Enabled')}
          onCheckedChange={(enabled) => setPhoneForm((current) => ({ ...current, enabled }))}
        />
        <Field label={tt('SMS provider')}>
          <SelectInput
            onChange={(event) =>
              setPhoneForm((current) => ({ ...current, smsProvider: event.target.value as SmsProviderId }))
            }
            value={phoneForm.smsProvider}
          >
            {smsProviderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <SmsProviderFields form={phoneForm} setForm={setPhoneForm} />
        <NumberSelectField
          label="OTP length"
          onChange={(otpLength) => setPhoneForm((current) => ({ ...current, otpLength }))}
          options={otpLengthOptions}
          value={phoneForm.otpLength}
        />
        <NumberSelectField
          label="Code expiry"
          onChange={(expiresInSeconds) => setPhoneForm((current) => ({ ...current, expiresInSeconds }))}
          options={codeExpiryOptions}
          value={phoneForm.expiresInSeconds}
        />
        <BuiltInProviderSwitch
          checked={phoneForm.requireVerification}
          description={tt('Require phone verification before phone sign-in.')}
          label={tt('Require verification')}
          onCheckedChange={(requireVerification) => setPhoneForm((current) => ({ ...current, requireVerification }))}
        />
      </BuiltinProviderForm>
    )
  }

  if (provider.providerId === 'web3-wallet') {
    const loaded = { ...defaultWeb3ProviderSettings(), ...(builtInProviders?.web3Wallet ?? {}) }
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={!shallowEqual(web3Form, loaded)}
        onSubmit={(event) => submitBuiltIn(event, () => onUpdateSignIn({ builtInProviders: { web3Wallet: web3Form } }))}
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={web3Form.enabled}
          description={tt('Enable Sign In With Ethereum wallet authentication.')}
          label={tt('Enabled')}
          onCheckedChange={(enabled) => setWeb3Form((current) => ({ ...current, enabled }))}
        />
        <Field label={tt('Enabled chains')}>
          <div className="grid gap-3">
            {web3ChainOptions.map((chain) => (
              <div
                className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2"
                key={chain.id}
              >
                <span className="text-sm font-medium">{chain.label}</span>
                <Switch
                  aria-label={chain.label}
                  checked={web3Form.chains.includes(chain.id)}
                  onCheckedChange={(checked) =>
                    setWeb3Form((current) => ({
                      ...current,
                      chains: checked
                        ? Array.from(new Set([...current.chains, chain.id]))
                        : current.chains.filter((id) => id !== chain.id),
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </Field>
        <BuiltInProviderSwitch
          checked={web3Form.allowSignUp}
          description={tt(
            'Allow wallets to participate in the registration path. If a new user has no account information, they will be asked to sign in with another method first and then bind a wallet.',
          )}
          label={tt('Allow for sign-up')}
          onCheckedChange={(allowSignUp) => setWeb3Form((current) => ({ ...current, allowSignUp }))}
        />
        <BuiltInProviderSwitch
          checked={web3Form.ensLookupEnabled}
          description={tt('Use ENS lookup for wallet display names and avatars when available.')}
          label={tt('ENS lookup')}
          onCheckedChange={(ensLookupEnabled) => setWeb3Form((current) => ({ ...current, ensLookupEnabled }))}
        />
      </BuiltinProviderForm>
    )
  }

  if (provider.providerId === 'onetap') {
    const loaded = { ...defaultOneTapProviderSettings(), ...(builtInProviders?.oneTap ?? {}) }
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={!shallowEqual(oneTapForm, loaded)}
        onSubmit={(event) => submitBuiltIn(event, () => onUpdateSignIn({ builtInProviders: { oneTap: oneTapForm } }))}
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={oneTapForm.enabled}
          description={tt('Enable Google One Tap on hosted sign-in.')}
          label={tt('Enabled')}
          onCheckedChange={(enabled) => setOneTapForm((current) => ({ ...current, enabled }))}
        />
        <Field label={tt('Client ID')}>
          <TextInput
            onChange={(event) => setOneTapForm((current) => ({ ...current, clientId: event.target.value }))}
            value={oneTapForm.clientId}
          />
        </Field>
        <SelectField
          label="UX mode"
          onChange={(uxMode) => setOneTapForm((current) => ({ ...current, uxMode: uxMode as never }))}
          options={['popup', 'redirect']}
          value={oneTapForm.uxMode}
        />
        <SelectField
          label="Context"
          onChange={(context) => setOneTapForm((current) => ({ ...current, context: context as never }))}
          options={['signin', 'signup', 'use']}
          value={oneTapForm.context}
        />
        <BuiltInProviderSwitch
          checked={oneTapForm.autoSelect}
          description={tt('Automatically select the Google account when possible.')}
          label={tt('Auto select')}
          onCheckedChange={(autoSelect) => setOneTapForm((current) => ({ ...current, autoSelect }))}
        />
        <BuiltInProviderSwitch
          checked={oneTapForm.cancelOnTapOutside}
          description={tt('Allow the prompt to close when users tap outside it.')}
          label={tt('Cancel on outside tap')}
          onCheckedChange={(cancelOnTapOutside) => setOneTapForm((current) => ({ ...current, cancelOnTapOutside }))}
        />
        <NumberSelectField
          label="Prompt base delay"
          onChange={(promptBaseDelayMs) => setOneTapForm((current) => ({ ...current, promptBaseDelayMs }))}
          options={promptDelayOptions}
          value={oneTapForm.promptBaseDelayMs}
        />
        <NumberSelectField
          label="Prompt max attempts"
          onChange={(promptMaxAttempts) => setOneTapForm((current) => ({ ...current, promptMaxAttempts }))}
          options={promptAttemptOptions}
          value={oneTapForm.promptMaxAttempts}
        />
      </BuiltinProviderForm>
    )
  }

  return <ProviderRuntime providerId={provider.providerId} />
}
