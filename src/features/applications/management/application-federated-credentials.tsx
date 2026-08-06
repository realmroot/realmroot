import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { MutationError } from '@/features/management/dialogs'
import {
  Badge,
  Button,
  createManagementFederatedCredentialRequestSchema,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  type FormEvent,
  type ManagementFederatedCredentialResponse,
  MoreHorizontal,
  Plus,
  Save,
  SelectInput,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
  TextInput,
  tt,
  type updateManagementFederatedCredentialRequestSchema,
  useMutation,
  useQuery,
  useQueryClient,
  useState,
} from '@/features/management/shared'
import { parseForm } from '@/features/management/utils'
import { consoleQueryKeys } from '@/lib/api/console-query-keys'
import {
  createFederatedCredential,
  deleteFederatedCredential,
  listApiResources,
  listFederatedCredentials,
  updateFederatedCredential,
} from '@/lib/api/management'

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
    queryFn: () => listApiResources(),
  })
  const resources = resourcesQuery.data?.items ?? []
  const invalidate = () => queryClient.invalidateQueries({ queryKey })
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteCredential, setDeleteCredential] = useState<ManagementFederatedCredentialResponse | null>(null)
  const createMutation = useMutation({
    mutationFn: (input: ReturnType<typeof parseForm<typeof createManagementFederatedCredentialRequestSchema>>) =>
      createFederatedCredential(applicationId, input),
    onSuccess: async () => {
      await invalidate()
      setCreateOpen(false)
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: ReturnType<typeof parseForm<typeof updateManagementFederatedCredentialRequestSchema>>
    }) => updateFederatedCredential(applicationId, id, input),
    onSuccess: async () => {
      await invalidate()
      setDeleteCredential(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFederatedCredential(applicationId, id),
    onSuccess: async () => {
      await invalidate()
      setDeleteCredential(null)
    },
  })
  const credentials = credentialsQuery.data?.credentials ?? []

  return (
    <section className="detailSection mt-7">
      <header>
        <div>
          <h2>{tt('Federated credentials')}</h2>
          <p>{tt('Trusted workload issuer and subject pairs that can exchange tokens without a client secret.')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} variant="outline">
          <Plus />
          {tt('Add credential')}
        </Button>
      </header>
      <div className="overflow-hidden rounded-xl border mt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Credential')}</TableHead>
              <TableHead>{tt('Audience')}</TableHead>
              <TableHead>{tt('Key material')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {credentials.length ? (
              credentials.map((credential) => (
                <FederatedCredentialRow
                  credential={credential}
                  key={credential.id}
                  onDelete={() => setDeleteCredential(credential)}
                  onToggle={() => updateMutation.mutate({ id: credential.id, input: { enabled: !credential.enabled } })}
                  pending={updateMutation.isPending || deleteMutation.isPending}
                  resources={resources}
                />
              ))
            ) : (
              <TableEmptyRow
                colSpan={5}
                description={tt('Add a trusted workload identity only when this client needs token exchange.')}
                title={tt('No federated credentials')}
              />
            )}
          </TableBody>
        </Table>
      </div>
      <MutationError error={updateMutation.error ?? deleteMutation.error} />
      <Sheet onOpenChange={setCreateOpen} open={createOpen}>
        <SheetContent className="h-full overflow-hidden sm:max-w-xl">
          <SheetHeader className="shrink-0">
            <SheetTitle>{tt('Add federated credential')}</SheetTitle>
            <SheetDescription>
              {tt('Trust an external workload identity for client authentication and token exchange.')}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
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
          </div>
          <SheetFooter className="shrink-0">
            <Button onClick={() => setCreateOpen(false)} variant="outline">
              {tt('Cancel')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <DestructiveConfirmation
        confirmLabel={deleteMutation.isPending ? tt('Deleting…') : tt('Delete credential')}
        description={tt('The matching workload can no longer exchange its identity token through this application.')}
        error={<MutationError error={deleteMutation.error} />}
        onClose={() => setDeleteCredential(null)}
        onConfirm={() => {
          if (deleteCredential) deleteMutation.mutate(deleteCredential.id)
        }}
        open={deleteCredential !== null}
        pending={deleteMutation.isPending}
        title={tt('Delete federated credential?')}
      />
    </section>
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
  const [validationError, setValidationError] = useState<unknown>(null)

  return (
    <form
      className="formStack"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setValidationError(null)
        try {
          const { material, base } = parseFederatedCredentialForm(new FormData(event.currentTarget))
          onSubmit(material, base)
        } catch (caught) {
          setValidationError(caught)
        }
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
      <MutationError error={validationError ?? error} />
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
    <TableRow>
      <TableCell>
        <span className="font-medium">{credential.name}</span>
        <span className="block font-mono text-xs text-muted-foreground">
          {credential.issuer} · {credential.subject}
        </span>
      </TableCell>
      <TableCell>{audience?.name ?? credential.audienceResourceId}</TableCell>
      <TableCell className="max-w-56 truncate font-mono text-xs">{keyMaterial}</TableCell>
      <TableCell>
        <Badge variant={credential.enabled ? 'secondary' : 'outline'}>
          {credential.enabled ? tt('Enabled') : tt('Disabled')}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={tt('Credential actions')} disabled={pending} size="icon" variant="ghost">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onToggle}>{credential.enabled ? tt('Disable') : tt('Enable')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} variant="destructive">
              {tt('Delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
