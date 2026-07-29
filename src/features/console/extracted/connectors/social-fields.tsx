import {
  Button,
  type ConnectorTemplate,
  Copy,
  Field,
  type FormState,
  type SetStateAction,
  TextInput,
  tt,
  useId,
} from '../../console-shared'
import { connectorFieldLabel, setValue } from '../../helpers/helpers-utils'

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
      <ConnectorTextField form={form} field="issuer" label="OIDC issuer" setForm={setForm} />
      <ConnectorTextField form={form} field="authorizationEndpoint" label="Authorization endpoint" setForm={setForm} />
      <ConnectorTextField form={form} field="tokenEndpoint" label="Token endpoint" setForm={setForm} />
      <ConnectorTextField form={form} field="userInfoEndpoint" label="UserInfo endpoint" setForm={setForm} />
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
  required,
  secret,
  setForm,
}: {
  field: string
  form: FormState
  help?: string
  label: string
  required?: boolean
  secret?: boolean
  setForm: (value: SetStateAction<FormState>) => void
}) {
  return (
    <Field help={help} label={label}>
      <TextInput
        onChange={(event) => setValue(setForm, field, event.target.value)}
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
        <TextInput className="font-mono" id={id} readOnly value={value} />
        <Button onClick={() => navigator.clipboard.writeText(value)} type="button" variant="secondary">
          <Copy data-icon="inline-start" /> {tt('Copy')}{' '}
        </Button>
      </div>
    </div>
  )
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
