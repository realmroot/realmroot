import {
  Button,
  Field,
  type FormState,
  ImageUp,
  optionalAuthorizationFieldNames,
  Save,
  TextInput,
  Trash2,
  tt,
  useId,
  useState,
} from '../console-shared'
import { MutationError } from './helpers-dialogs'

export function AuthorizationForm({
  buttonLabel,
  defaults,
  error,
  fields,
  onSubmit,
  pending,
}: {
  buttonLabel: string
  defaults: FormState
  error: unknown
  fields: Array<[string, string]>
  onSubmit: (form: FormState) => void
  pending: boolean
}) {
  const [validationError, setValidationError] = useState<string | null>(null)
  return (
    <form
      className="formStack"
      onSubmit={(event) => {
        event.preventDefault()
        const submittedForm = new FormData(event.currentTarget)
        try {
          setValidationError(null)
          onSubmit(Object.fromEntries(fields.map(([name]) => [name, String(submittedForm.get(name) ?? '')])))
        } catch (submitError) {
          setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
        }
      }}
    >
      {fields.map(([name, label]) => (
        <Field key={name} label={label}>
          <TextInput
            defaultValue={defaults[name] ?? ''}
            name={name}
            required={!optionalAuthorizationFieldNames.has(name) && !name.endsWith('Id')}
          />
        </Field>
      ))}
      <Button disabled={pending} type="submit">
        <Save data-icon="inline-start" />
        {buttonLabel}
      </Button>
      {validationError ? (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {validationError}
        </div>
      ) : null}
      <MutationError error={error} />
    </form>
  )
}
export function AuthorizationRows({
  empty,
  rows = [],
}: {
  empty: string
  rows?: Array<{
    id: string
    title: string
    detail: string
    defaults: FormState
    fields: Array<[string, string]>
    onDelete: () => void
    onEdit: (form: FormState) => void
  }>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  if (rows.length === 0)
    return <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div className="rounded-md border border-border p-3" key={row.id}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{row.title}</p>
              <p className="text-sm text-muted-foreground">{row.detail}</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setEditingId(editingId === row.id ? null : row.id)}
                type="button"
                variant="secondary"
              >
                {' '}
                {tt('Edit')}{' '}
              </Button>
              <Button onClick={row.onDelete} type="button" variant="destructive">
                <Trash2 data-icon="inline-start" /> {tt('Delete')}{' '}
              </Button>
            </div>
          </div>
          {editingId === row.id ? (
            <div className="mt-3">
              <AuthorizationForm
                buttonLabel="Save"
                defaults={row.defaults}
                error={null}
                fields={row.fields}
                onSubmit={(form) => {
                  row.onEdit(form)
                  setEditingId(null)
                }}
                pending={false}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
export function AssetUploadControl({
  accept,
  label,
  onFile,
  previewUrl,
}: {
  accept: string
  label: string
  onFile: (file: File) => void
  previewUrl: string | null
}) {
  const inputId = useId()
  return (
    <div className="assetUploadRow">
      <AssetUploadPreview previewUrl={previewUrl} />
      <div className="assetUploadField">
        <span className="assetUploadLabel">{label}</span>
        <label className="assetUploadButton" htmlFor={inputId}>
          <ImageUp data-icon="inline-start" size={16} /> {tt('Choose file')}{' '}
        </label>
        <input
          accept={accept}
          aria-label={label}
          className="assetUploadInput"
          id={inputId}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) onFile(file)
            event.currentTarget.value = ''
          }}
          type="file"
        />
      </div>
    </div>
  )
}
export function AssetUploadPreview({ previewUrl }: { previewUrl: string | null }) {
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null)
  const showPreview = Boolean(previewUrl && failedPreviewUrl !== previewUrl)
  if (showPreview && previewUrl) {
    return (
      <img
        alt=""
        className="assetPreview"
        src={previewUrl}
        width="64"
        height="64"
        onError={() => setFailedPreviewUrl(previewUrl)}
      />
    )
  }
  return (
    <div className="assetPreview text-muted-foreground">
      <ImageUp size={18} />
    </div>
  )
}
