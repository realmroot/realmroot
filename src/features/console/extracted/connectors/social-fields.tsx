import {
  Button,
  type ConnectorTemplate,
  Copy,
  Field,
  type FormState,
  SelectInput,
  type SetStateAction,
  TextInput,
  tt,
  useId,
} from '@/features/management/shared'
import { connectorFieldLabel, setValue } from '@/features/management/utils'

export function GenericConnectorFields({
  form,
  isExisting,
  setForm,
}: {
  form: FormState
  isExisting: boolean
  setForm: (value: SetStateAction<FormState>) => void
}) {
  return (
    <div className="grid gap-4">
      <ConnectorTextField
        form={form}
        field="issuer"
        help={isExisting ? 'The issuer is fixed after discovery. Recreate the connector to change it.' : undefined}
        label="OIDC issuer"
        readOnly={isExisting}
        setForm={setForm}
        required
      />
      {form.registrationMode !== 'dynamic' ? (
        <>
          <ConnectorTextField form={form} field="clientId" label="Client ID" setForm={setForm} required />
          <ConnectorTextField
            form={form}
            field="clientSecret"
            help={isExisting ? 'Leave blank to keep the current secret.' : undefined}
            label="Client Secret"
            setForm={setForm}
            required={!isExisting}
            secret
          />
        </>
      ) : null}
      <ConnectorTextField
        form={form}
        field="scopes"
        help="Space-separated OAuth scopes."
        label="Scopes"
        setForm={setForm}
      />
    </div>
  )
}

function ConnectorTextField({
  field,
  form,
  help,
  label,
  readOnly,
  required,
  secret,
  setForm,
}: {
  field: string
  form: FormState
  help?: string
  label: string
  readOnly?: boolean
  required?: boolean
  secret?: boolean
  setForm: (value: SetStateAction<FormState>) => void
}) {
  return (
    <Field help={help} label={label}>
      <TextInput
        name={field}
        onChange={(event) => setValue(setForm, field, event.target.value)}
        readOnly={readOnly}
        required={required}
        type={secret ? 'password' : 'text'}
        value={form[field] ?? ''}
      />
    </Field>
  )
}

export function CallbackUrlField({ value }: { value: string }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{tt('Callback URL')}</label>
      <div className="flex gap-2">
        <TextInput className="font-mono" id={id} name="callbackUrl" readOnly value={value} />
        <Button onClick={() => navigator.clipboard.writeText(value)} type="button" variant="secondary">
          <Copy data-icon="inline-start" /> {tt('Copy')}{' '}
        </Button>
      </div>
    </div>
  )
}

export function ResourceAuthorizationFields({
  form,
  isExisting,
  setForm,
}: {
  form: FormState
  isExisting: boolean
  setForm: (value: SetStateAction<FormState>) => void
}) {
  const dynamic = form.resourceRegistrationMode === 'dynamic'
  return (
    <div className="grid gap-4 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">{tt('Resource authorization')}</p>
        <p className="text-xs text-muted-foreground">
          {tt('Configure the external authorization server used when Agents access this provider’s APIs.')}
        </p>
      </div>
      <ConnectorTextField
        field="resourceIssuer"
        form={form}
        label="Authorization server issuer"
        required
        setForm={setForm}
      />
      {!isExisting ? (
        <Field label={tt('Resource client registration')}>
          <SelectInput
            name="resourceRegistrationMode"
            onChange={(event) => setValue(setForm, 'resourceRegistrationMode', event.target.value)}
            value={form.resourceRegistrationMode ?? 'manual'}
          >
            <option value="manual">{tt('Pre-registered client')}</option>
            <option value="dynamic">{tt('Dynamic registration (RFC 7591)')}</option>
          </SelectInput>
        </Field>
      ) : null}
      {!dynamic ? (
        <>
          <ConnectorTextField
            field="resourceClientId"
            form={form}
            label="Resource client ID"
            required
            setForm={setForm}
          />
          <ConnectorTextField
            field="resourceClientSecret"
            form={form}
            help={isExisting ? 'Leave blank to keep the current resource client secret.' : undefined}
            label="Resource client secret"
            required={!isExisting}
            secret
            setForm={setForm}
          />
        </>
      ) : null}
      <CallbackUrlField value={resourceAuthorizationCallbackUrl()} />
    </div>
  )
}

export function resourceAuthorizationCallbackUrl() {
  return `${window.location.origin}/api/account-connections/oauth/callback`
}

export function ConnectorDynamicFields({
  form,
  isExisting,
  setForm,
  template,
}: {
  form: FormState
  isExisting: boolean
  setForm: (value: SetStateAction<FormState>) => void
  template: ConnectorTemplate | null
}) {
  const fields = connectorTemplateFields(template)
  if (!fields.length) return null
  return (
    <div className="grid gap-4">
      {fields.map((field) => {
        const value = form[field.formKey] ?? ''
        return (
          <Field help={fieldHelp(field, isExisting)} key={field.formKey} label={field.label}>
            <TextInput
              name={field.formKey}
              onChange={(event) => setValue(setForm, field.formKey, event.target.value)}
              required={field.required && !(field.key === 'clientSecret' && isExisting)}
              type={field.secret ? 'password' : 'text'}
              value={value}
            />
          </Field>
        )
      })}
    </div>
  )
}

export function connectorCallbackUrl(providerId: string) {
  return `${window.location.origin}/api/auth/callback/${providerId}`
}

type ConnectorTemplateField = {
  formKey: string
  key: string
  label: string
  required: boolean
  secret: boolean
}

function fieldHelp(field: ConnectorTemplateField, isExisting: boolean): string {
  if (field.key === 'clientSecret' && isExisting) return tt('Leave blank to keep the current secret.')
  return field.required ? tt('Required by this Better Auth provider.') : tt('Optional provider parameter.')
}

function connectorTemplateFields(template: ConnectorTemplate | null): ConnectorTemplateField[] {
  if (!template) return []
  const fields = new Map<string, ConnectorTemplateField>()
  for (const field of template.requiredFields) addConnectorTemplateField(fields, field, true)
  for (const field of template.optionalFields) addConnectorTemplateField(fields, field, false)
  return Array.from(fields.values())
}

function addConnectorTemplateField(fields: Map<string, ConnectorTemplateField>, field: string, required: boolean) {
  if (!connectorProductFields.has(field)) return
  const metadataPrefix = 'providerMetadata.'
  const key = field.startsWith(metadataPrefix) ? field.slice(metadataPrefix.length) : field
  const formKey = field.startsWith(metadataPrefix) ? `metadata.${key}` : field
  const existing = fields.get(formKey)
  fields.set(formKey, {
    formKey,
    key,
    label: connectorFieldLabel(key),
    required: existing?.required || required,
    secret: key.toLowerCase().includes('secret'),
  })
}

const connectorProductFields = new Set([
  'clientId',
  'clientSecret',
  'providerMetadata.domain',
  'providerMetadata.region',
  'providerMetadata.userPoolId',
])
