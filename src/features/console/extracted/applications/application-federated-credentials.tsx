import { consoleQueryKeys } from '@/lib/api/console-query-keys'
import {
  createFederatedCredential,
  deleteFederatedCredential,
  listApiResources,
  listFederatedCredentials,
  updateFederatedCredential,
} from '@/lib/api/management'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  createManagementFederatedCredentialRequestSchema,
  Field,
  type FormEvent,
  type ManagementFederatedCredentialResponse,
  Save,
  SelectInput,
  TextArea,
  TextInput,
  Trash2,
  tt,
  type updateManagementFederatedCredentialRequestSchema,
  useMutation,
  useQuery,
  useQueryClient,
} from '../../console-shared'
import { MutationError } from '../../helpers/helpers-dialogs'
import { parseForm } from '../../helpers/helpers-utils'

type JwkRecord = Record<string, unknown>

type KeyMaterial = { jwksUrl?: string; publicKeys?: JwkRecord[] }

export function parseKeyMaterial(jwksUrl: string, publicKeysText: string): KeyMaterial {
  const trimmedUrl = jwksUrl.trim()
  const trimmedKeys = publicKeysText.trim()
  if (trimmedUrl && trimmedKeys) {
    throw new Error('Provide either a JWKS URL or inline public keys, not both.')
  }
  if (trimmedUrl) return { jwksUrl: trimmedUrl }
  if (!trimmedKeys) {
    throw new Error('A federated credential requires either a JWKS URL or one or more public keys.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmedKeys)
  } catch {
    throw new Error('Public keys must be a valid JWK or JWK Set in JSON format.')
  }
  if (parsed && typeof parsed === 'object' && 'keys' in parsed && Array.isArray((parsed as { keys: unknown }).keys)) {
    return { publicKeys: (parsed as { keys: JwkRecord[] }).keys }
  }
  if (Array.isArray(parsed)) return { publicKeys: parsed as JwkRecord[] }
  if (parsed && typeof parsed === 'object') return { publicKeys: [parsed as JwkRecord] }
  throw new Error('Public keys must be a valid JWK or JWK Set in JSON format.')
}

export function parseFederatedCredentialForm(form: FormData): {
  material: KeyMaterial
  base: { name: string; issuer: string; subject: string; audienceResourceId: string }
} {
  return {
    material: parseKeyMaterial(String(form.get('jwksUrl') ?? ''), String(form.get('publicKeys') ?? '')),
    base: {
      name: String(form.get('name') ?? ''),
      issuer: String(form.get('issuer') ?? ''),
      subject: String(form.get('subject') ?? ''),
      audienceResourceId: String(form.get('audienceResourceId') ?? ''),
    },
  }
}

export function ApplicationFederatedCredentialsPanel({ applicationId }: { applicationId: string }) {
  const queryClient = useQueryClient()
  const queryKey = consoleQueryKeys.federatedCredentials(applicationId)
  const credentialsQuery = useQuery({
    queryKey,
    queryFn: () => listFederatedCredentials(applicationId),
  })
  const resourcesQuery = useQuery({
    queryKey: consoleQueryKeys.apiResources,
    queryFn: listApiResources,
  })
  const resources = resourcesQuery.data?.items ?? []
  const invalidate = () => queryClient.invalidateQueries({ queryKey })
  const createMutation = useMutation({
    mutationFn: (input: ReturnType<typeof parseForm<typeof createManagementFederatedCredentialRequestSchema>>) =>
      createFederatedCredential(applicationId, input),
    onSuccess: invalidate,
  })
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: ReturnType<typeof parseForm<typeof updateManagementFederatedCredentialRequestSchema>>
    }) => updateFederatedCredential(applicationId, id, input),
    onSuccess: invalidate,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFederatedCredential(applicationId, id),
    onSuccess: invalidate,
  })
  const credentials = credentialsQuery.data?.credentials ?? []

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{tt('Add federated credential')}</CardTitle>
          <CardDescription>
            {tt(
              'Let an external workload exchange its own OIDC token for an access token, with no client secret to manage.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FederatedCredentialForm
            error={createMutation.error}
            pending={createMutation.isPending}
            resources={resources}
            onSubmit={(material, base) =>
              createMutation.mutate(
                parseForm(createManagementFederatedCredentialRequestSchema, { ...base, ...material }),
              )
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tt('Federated credentials')}</CardTitle>
          <CardDescription>
            {tt('Trusted issuer and subject pairs that may request tokens for this application.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {credentials.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              {tt('No federated credentials yet.')}
            </p>
          ) : (
            <div className="grid gap-2">
              {credentials.map((credential) => (
                <FederatedCredentialRow
                  credential={credential}
                  key={credential.id}
                  onDelete={() => deleteMutation.mutate(credential.id)}
                  onToggle={() => updateMutation.mutate({ id: credential.id, input: { enabled: !credential.enabled } })}
                  pending={updateMutation.isPending || deleteMutation.isPending}
                  resources={resources}
                />
              ))}
            </div>
          )}
          <MutationError error={updateMutation.error ?? deleteMutation.error} />
        </CardContent>
      </Card>
    </div>
  )
}

function FederatedCredentialForm({
  error,
  pending,
  resources,
  onSubmit,
}: {
  error: unknown
  pending: boolean
  resources: Array<{ id: string; name: string; identifier: string }>
  onSubmit: (
    material: KeyMaterial,
    base: { name: string; issuer: string; subject: string; audienceResourceId: string },
  ) => void
}) {
  return (
    <form
      className="formStack"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const { material, base } = parseFederatedCredentialForm(new FormData(event.currentTarget))
        onSubmit(material, base)
      }}
    >
      <Field label={tt('Name')}>
        <TextInput name="name" required />
      </Field>
      <Field label={tt('Issuer')} help={tt('Logical issuer identity, an opaque string. Not dereferenced as a URL.')}>
        <TextInput name="issuer" required />
      </Field>
      <Field label={tt('Subject')} help={tt('Exact subject, or a prefix ending in * to match a range.')}>
        <TextInput name="subject" required />
      </Field>
      <Field label={tt('Audience')} help={tt('The API resource this credential may request tokens for.')}>
        <SelectInput name="audienceResourceId" required defaultValue="">
          <option disabled value="">
            {tt('Select an API resource')}
          </option>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.name} ({resource.identifier})
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label={tt('JWKS URL')} help={tt('Public keys are fetched from this URL.')}>
        <TextInput name="jwksUrl" placeholder="https://issuer.example.com/.well-known/jwks.json" type="url" />
      </Field>
      <Field
        label={tt('Public keys')}
        help={tt('Or paste a JWK or JWK Set as JSON. Provide a JWKS URL or public keys, not both.')}
      >
        <TextArea name="publicKeys" rows={6} placeholder='{ "kty": "RSA", "n": "...", "e": "AQAB" }' />
      </Field>
      <Button disabled={pending} type="submit">
        <Save data-icon="inline-start" />
        {tt('Add credential')}
      </Button>
      <MutationError error={error} />
    </form>
  )
}

function FederatedCredentialRow({
  credential,
  resources,
  pending,
  onToggle,
  onDelete,
}: {
  credential: ManagementFederatedCredentialResponse
  resources: Array<{ id: string; name: string }>
  pending: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const audience = resources.find((resource) => resource.id === credential.audienceResourceId)
  const keyMaterial = credential.jwksUrl
    ? credential.jwksUrl
    : `${credential.publicKeys?.length ?? 0} ${tt('public key(s)')}`
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="font-medium">{credential.name}</p>
            <Badge variant={credential.enabled ? 'default' : 'secondary'}>
              {credential.enabled ? tt('Enabled') : tt('Disabled')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {credential.issuer} · {credential.subject}
          </p>
          <p className="text-xs text-muted-foreground">
            {tt('Audience')}: {audience?.name ?? credential.audienceResourceId} · {keyMaterial}
          </p>
        </div>
        <div className="flex gap-2">
          <Button disabled={pending} onClick={onToggle} type="button" variant="secondary">
            {credential.enabled ? tt('Disable') : tt('Enable')}
          </Button>
          <Button disabled={pending} onClick={onDelete} type="button" variant="danger">
            <Trash2 data-icon="inline-start" /> {tt('Delete')}{' '}
          </Button>
        </div>
      </div>
    </div>
  )
}
