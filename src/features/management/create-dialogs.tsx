import type { OrganizationResponse } from '@shared/api/authorization'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { CopyButton, listValue, SwitchRow } from './dialogs'
import { OrganizationOwnerField } from './ownership-controls'
import {
  type ApplicationResponse,
  applicationTypeOptions,
  Button,
  CheckCircle2,
  cn,
  createApplicationRequestSchema,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  emptyForm,
  Field,
  type FormEvent,
  type FormState,
  LinkButton,
  managementCreateUserRequestSchema,
  type ReactNode,
  SelectInput,
  SettingRow,
  TextArea,
  TextInput,
  tt,
  useEffect,
  useState,
  type z,
} from './shared'
import { parseForm, setValue } from './utils'

export function CreateApplicationDialog({
  createdApplication,
  defaultOwnerOrganizationId,
  fixedOwnerOrganizationId,
  error,
  onClose,
  onSubmit,
  open,
  organizations,
  pending,
}: {
  createdApplication:
    | (ApplicationResponse & {
        clientSecret?: string
      })
    | null
  defaultOwnerOrganizationId?: string
  fixedOwnerOrganizationId?: string
  error: string | null
  onClose: () => void
  onSubmit: (input: z.infer<typeof createApplicationRequestSchema>) => void
  open: boolean
  organizations: OrganizationResponse[]
  pending: boolean
}) {
  const [form, setForm] = useState<FormState>({
    clientType: 'public_spa',
    redirectUris: '',
  })
  const [deviceLoginEnabled, setDeviceLoginEnabled] = useState(false)
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')
  const [ownerOrganizationId, setOwnerOrganizationId] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  useEffect(() => {
    if (!open || ownerOrganizationId) return
    setOwnerOrganizationId(fixedOwnerOrganizationId ?? defaultOwnerOrganizationId ?? organizations[0]?.id ?? '')
  }, [defaultOwnerOrganizationId, fixedOwnerOrganizationId, open, organizations, ownerOrganizationId])
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open={open}
    >
      {createdApplication ? (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt('Application created')}</DialogTitle>
            <DialogDescription>
              {' '}
              {tt('Copy the generated credentials, then open the settings page to finish setup.')}{' '}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 p-4 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <CheckCircle2 data-icon="inline-start" />
              {createdApplication.name}
            </div>
            <SettingRow
              label={tt('Client ID')}
              value={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="break-all">{createdApplication.clientId}</code>
                  <CopyButton label={tt('Copy client ID')} value={createdApplication.clientId} />
                </div>
              }
            />
            {createdApplication.clientSecret ? (
              <SettingRow
                label={tt('Client secret')}
                value={
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all">{createdApplication.clientSecret}</code>
                    <CopyButton label={tt('Copy secret')} value={createdApplication.clientSecret} />
                  </div>
                }
              />
            ) : (
              <SettingRow label={tt('Client secret')} value="No secret for public clients" />
            )}
            {createdApplication.clientType === 'machine' ? null : (
              <SettingRow label={tt('Redirect URIs')} value={listValue(createdApplication.redirectUris, ', ')} />
            )}
            <SettingRow
              label={tt('Next step')}
              value={
                createdApplication.clientType === 'machine'
                  ? 'Configure API access and Permissions.'
                  : 'Review redirects, origins, and client metadata.'
              }
            />
          </div>
          <DialogFooter className="m-0">
            <LinkButton
              to={
                fixedOwnerOrganizationId
                  ? `/organizations/${fixedOwnerOrganizationId}/applications/${createdApplication.id}/settings`
                  : `/console/applications/${createdApplication.id}/settings`
              }
              variant="secondary"
            >
              {' '}
              {tt('Open settings')}{' '}
            </LinkButton>
            <Button onClick={onClose} type="button">
              {' '}
              {tt('Done')}{' '}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : (
        <FormDialog
          contentClassName="sm:max-w-2xl"
          description={tt('Register an OAuth client for a user-facing or machine application.')}
          error={validationError ?? error}
          onClose={onClose}
          onSubmit={(event) => {
            event.preventDefault()
            try {
              setValidationError(null)
              onSubmit(
                parseForm(createApplicationRequestSchema, {
                  ...form,
                  ownerOrganizationId,
                  visibility,
                  ...(form.clientType === 'public_native' ? { deviceLoginEnabled } : {}),
                  redirectUris: form.clientType === 'machine' ? [] : form.redirectUris.split('\n').filter(Boolean),
                }),
              )
            } catch (submitError) {
              setValidationError((submitError as Error).message)
            }
          }}
          pending={pending}
          title={tt('Create application')}
        >
          <Field label={tt('Name')}>
            <TextInput name="name" onChange={(event) => setValue(setForm, 'name', event.target.value)} required />
          </Field>
          <Field label={tt('Slug')}>
            <TextInput
              onChange={(event) => setValue(setForm, 'slug', event.target.value)}
              name="slug"
              placeholder="customer-portal"
            />
          </Field>
          {fixedOwnerOrganizationId ? null : (
            <OrganizationOwnerField
              onChange={setOwnerOrganizationId}
              organizations={organizations}
              value={ownerOrganizationId}
            />
          )}
          <Field
            help={tt('Private applications allow only members of the owner Organization to sign in.')}
            label={tt('Visibility')}
          >
            <SelectInput
              name="visibility"
              onChange={(event) => setVisibility(event.target.value as 'public' | 'private')}
              value={visibility}
            >
              <option value="private">{tt('Private')}</option>
              <option value="public">{tt('Public')}</option>
            </SelectInput>
          </Field>
          <ApplicationTypeCards
            onChange={(clientType) => {
              setValue(setForm, 'clientType', clientType)
              if (clientType !== 'public_native') setDeviceLoginEnabled(false)
            }}
            value={form.clientType}
          />
          {form.clientType === 'public_native' ? (
            <SwitchRow
              checked={deviceLoginEnabled}
              label={tt('Device login')}
              onCheckedChange={setDeviceLoginEnabled}
            />
          ) : null}
          {form.clientType === 'machine' ? null : (
            <Field label={tt('Redirect URIs')} help={tt('One URI per line.')}>
              <TextArea
                name="redirectUris"
                onChange={(event) => setValue(setForm, 'redirectUris', event.target.value)}
                required
              />
            </Field>
          )}
        </FormDialog>
      )}
    </Dialog>
  )
}
export function ApplicationTypeCards({ onChange, value }: { onChange: (clientType: string) => void; value: string }) {
  const selected = value
  return (
    <fieldset className="applicationTypeGrid">
      <legend>{tt('Application type')}</legend>
      {applicationTypeOptions.map((option) => (
        <button
          aria-pressed={selected === option.value}
          className={cn('applicationTypeCard', selected === option.value && 'selected')}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          <span className="applicationTypeIcon" aria-hidden="true">
            <option.icon size={18} />
          </span>
          <span>
            <strong>{option.title}</strong>
            <small>{option.description}</small>
          </span>
        </button>
      ))}
    </fieldset>
  )
}
export function CreateUserDialog({
  error,
  onClose,
  onSubmit,
  open,
  pending,
}: {
  error: string | null
  onClose: () => void
  onSubmit: (input: z.infer<typeof managementCreateUserRequestSchema>) => void
  open: boolean
  pending: boolean
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)
  return (
    <Dialog open={open}>
      <FormDialog
        description={tt('Add a human identity that can authenticate in this Realm.')}
        error={validationError ?? error}
        onClose={onClose}
        onSubmit={(event) => {
          event.preventDefault()
          try {
            setValidationError(null)
            onSubmit(parseForm(managementCreateUserRequestSchema, form))
          } catch (submitError) {
            setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
          }
        }}
        pending={pending}
        title={tt('Create user')}
      >
        <Field label={tt('Email')}>
          <TextInput
            autoComplete="email"
            name="email"
            onChange={(event) => setValue(setForm, 'email', event.target.value)}
            required
            type="email"
          />
        </Field>
        <Field label={tt('Display name')}>
          <TextInput
            autoComplete="name"
            name="displayName"
            onChange={(event) => setValue(setForm, 'displayName', event.target.value)}
            required
          />
        </Field>
        <Field label={tt('Username')}>
          <TextInput
            autoComplete="username"
            name="username"
            onChange={(event) => setValue(setForm, 'username', event.target.value)}
          />
        </Field>
        <Field label={tt('Initial password')}>
          <TextInput
            autoComplete="new-password"
            name="password"
            onChange={(event) => setValue(setForm, 'password', event.target.value)}
            type="password"
          />
        </Field>
      </FormDialog>
    </Dialog>
  )
}
export function ConfirmDialog({
  description,
  error,
  onClose,
  onConfirm,
  open,
  pending,
  title,
}: {
  description: string
  error: string | null
  onClose: () => void
  onConfirm: () => void
  open: boolean
  pending: boolean
  title: string
}) {
  return (
    <DestructiveConfirmation
      confirmLabel={pending ? tt('Deleting…') : tt('Delete')}
      description={description}
      error={
        error ? (
          <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</div>
        ) : null
      }
      onClose={onClose}
      onConfirm={onConfirm}
      open={open}
      pending={pending}
      title={title}
    />
  )
}
export function SimpleCreateDialog({
  description,
  error,
  fields,
  onClose,
  onSubmit,
  open,
  pending,
  title,
}: {
  description: string
  error: string | null
  fields: Array<[string, string]>
  onClose: () => void
  onSubmit: (form: FormState) => void
  open: boolean
  pending: boolean
  title: string
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) {
      setForm(emptyForm)
      setValidationError(null)
    }
  }, [open])
  return (
    <Dialog open={open}>
      <FormDialog
        description={description}
        error={validationError ?? error}
        onClose={onClose}
        onSubmit={(event) => {
          event.preventDefault()
          try {
            setValidationError(null)
            onSubmit(form)
          } catch (submitError) {
            setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
          }
        }}
        pending={pending}
        title={title}
      >
        {fields.map(([name, label]) => (
          <Field key={name} label={label}>
            <TextInput
              name={name}
              onChange={(event) => setValue(setForm, name, event.target.value)}
              required={name !== 'description'}
            />
          </Field>
        ))}
      </FormDialog>
    </Dialog>
  )
}
export function FormDialog({
  children,
  contentClassName,
  description,
  error,
  onClose,
  onSubmit,
  pending,
  title,
}: {
  children: ReactNode
  contentClassName?: string
  description: string
  error: string | null
  onClose: () => void
  onSubmit: (event: FormEvent) => void
  pending: boolean
  title: string
}) {
  return (
    <DialogContent className={cn('max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl', contentClassName)}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" onSubmit={onSubmit}>
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {children}
        <DialogFooter className="m-0 -mx-4 -mb-4">
          <Button onClick={onClose} type="button" variant="secondary">
            {' '}
            {tt('Cancel')}{' '}
          </Button>
          <Button disabled={pending} type="submit">
            {pending ? tt('Saving…') : tt('Save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
