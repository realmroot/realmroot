import { type ApiResource, createApiResourceSchema } from '@shared/api/agent-api'
import {
  archiveApiResource,
  consoleQueryKeys,
  createApiResource,
  deleteApiResource,
  getApiResource,
  listApiResources,
  listConnectors,
  restoreApiResource,
  updateApiResource,
} from '@/lib/api/management'
import {
  type ApiResourceDetailSection,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  createApiResourceRequestSchema,
  Dialog,
  emptyForm,
  Field,
  type FormState,
  Plus,
  SelectInput,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
  Trash2,
  tt,
  Undo2,
  updateApiResourceRequestSchema,
  useEffect,
  useMutation,
  useNavigate,
  useQuery,
  useQueryClient,
  useState,
  type z,
} from '../console-shared'
import { FormDialog } from '../helpers/helpers-create'
import { DangerConfirmDialog, MutationError, StatusBadge } from '../helpers/helpers-dialogs'
import { AuthorizationForm } from '../helpers/helpers-forms'
import {
  apiResourceDetailTabs,
  DetailTabs,
  ListToolbar,
  navigateConsoleTab,
  ObjectHeader,
  ResourcePage,
} from '../helpers/helpers-resource'
import { parseForm, setValue, useAdminMutation } from '../helpers/helpers-utils'
import { ApiResourceSummaryCard } from './api-resource-summary-card'

export function ApiResourcesPage() {
  const query = useQuery({
    queryKey: consoleQueryKeys.apiResources,
    queryFn: listApiResources,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const connectorsQuery = useQuery({
    queryKey: consoleQueryKeys.connectors,
    queryFn: listConnectors,
  })
  const oidcConnectors = (connectorsQuery.data?.connectors ?? []).filter(
    (connector) => connector.providerType === 'generic_oauth' && connector.enabled,
  )
  const [search, setSearch] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createApiResource,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.apiResources,
      })
    },
  })
  const resources = query.data?.items ?? []
  const visibleResources = resources.filter((resource) =>
    [resource.name, resource.identifier, resource.resourceUrl, resource.description ?? ''].some((value) =>
      value.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  )
  return (
    <ResourcePage
      title={tt('API resources')}
      description={tt('Register protected APIs, OpenAPI contracts, and permission surfaces.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New API resource')}{' '}
        </Button>
      }
      auxiliary={
        <ApiResourceCreateDialog
          connectors={oidcConnectors}
          error={createMutation.errorMessage}
          onClose={() => setDialogOpen(false)}
          onSubmit={(form) => {
            createMutation.mutate(createApiResourceSchema.parse(parseForm(createApiResourceRequestSchema, form)))
          }}
          open={dialogOpen}
          pending={createMutation.isPending}
        />
      }
      error={query.error}
      empty={resources.length === 0}
      emptyDescription="Register APIs before issuing access tokens for protected resources."
      emptyTitle="No API resources yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      toolbar={
        <ListToolbar>
          <TextInput
            aria-label={tt('Search API resources')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search API resources')}
            value={search}
          />
        </ListToolbar>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Resource')}</TableHead>
            <TableHead>{tt('Resource URL')}</TableHead>
            <TableHead>{tt('Authorization')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleResources.length ? (
            visibleResources.map((resource) => (
              <TableRow key={resource.id}>
                <TableCell>
                  <a className="font-medium hover:underline" href={`/console/api-resources/${resource.id}`}>
                    {resource.name}
                  </a>
                  <div className="text-xs text-muted-foreground">{resource.identifier}</div>
                </TableCell>
                <TableCell>{resource.resourceUrl}</TableCell>
                <TableCell>{resource.connectorId ? tt('External issuer') : tt('Native (Realmroot)')}</TableCell>
                <TableCell>
                  <StatusBadge
                    active={resource.enabled && !resource.archivedAt}
                    activeLabel={tt('Enabled')}
                    inactiveLabel={tt(resource.archivedAt ? 'Archived' : 'Disabled')}
                  />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={4}
              description={
                search
                  ? tt('No API resources match the current search.')
                  : tt('Register APIs before issuing access tokens for protected resources.')
              }
              title={search ? tt('No API resources found') : tt('No API resources yet')}
            />
          )}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}

function ApiResourceCreateDialog({
  connectors,
  error,
  onClose,
  onSubmit,
  open,
  pending,
}: {
  connectors: Array<{ id: string; displayName: string; issuer: string | null }>
  error: string | null
  onClose: () => void
  onSubmit: (form: FormState) => void
  open: boolean
  pending: boolean
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)
  return (
    <Dialog open={open}>
      <FormDialog
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
        title={tt('Create API resource')}
      >
        <Field label={tt('Identifier')}>
          <TextInput onChange={(event) => setValue(setForm, 'identifier', event.target.value)} required />
        </Field>
        <Field label={tt('Name')}>
          <TextInput onChange={(event) => setValue(setForm, 'name', event.target.value)} required />
        </Field>
        <Field label={tt('Resource URL')}>
          <TextInput onChange={(event) => setValue(setForm, 'resourceUrl', event.target.value)} required />
        </Field>
        <Field label={tt('OIDC connector')}>
          <SelectInput
            onChange={(event) => setValue(setForm, 'connectorId', event.target.value)}
            value={form.connectorId ?? ''}
          >
            <option value="">{tt('None — use native authorization')}</option>
            {connectors.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.displayName} — {connector.issuer}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label={tt('Description')}>
          <TextInput onChange={(event) => setValue(setForm, 'description', event.target.value)} />
        </Field>
      </FormDialog>
    </Dialog>
  )
}

export function ApiResourceDetailPage({
  resourceId,
  section = 'settings',
}: {
  resourceId: string
  section?: ApiResourceDetailSection
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedTab, setSelectedTab] = useState<ApiResourceDetailSection>(section)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const resourceQuery = useQuery({
    queryKey: [...consoleQueryKeys.apiResources, resourceId],
    queryFn: () => getApiResource(resourceId),
  })
  const resource = resourceQuery.data
  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof updateApiResourceRequestSchema>) => updateApiResource(resourceId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...consoleQueryKeys.apiResources, resourceId], updated)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.apiResources,
      })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteApiResource(resourceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.apiResources,
      })
      await navigate({ href: '/console/api-resources' })
    },
  })
  const archivalMutation = useMutation({
    mutationFn: (action: 'archive' | 'restore') =>
      action === 'archive' ? archiveApiResource(resourceId) : restoreApiResource(resourceId),
    onSuccess: (updated) => {
      setArchiveConfirmOpen(false)
      queryClient.setQueryData([...consoleQueryKeys.apiResources, resourceId], updated)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.apiResources,
      })
    },
  })
  useEffect(() => setSelectedTab(section), [section])
  return (
    <ResourcePage
      title={resource?.name ?? tt('API resource')}
      description={tt('Manage the protected API URL and authoritative business OpenAPI location.')}
      framed={false}
      error={resourceQuery.error}
      loading={resourceQuery.isLoading}
      onRetry={() => resourceQuery.refetch()}
    >
      {resource ? (
        <div className="consoleDetailStack">
          <a className="consoleBackLink" href="/console/api-resources">
            <Undo2 data-icon="inline-start" /> {tt('Back to API resources')}{' '}
          </a>
          <ObjectHeader
            badge={tt(resource.archivedAt ? 'Archived' : resource.enabled ? 'Enabled' : 'Disabled')}
            id={resource.identifier}
            title={resource.name}
          />
          <DetailTabs
            label={tt('API resource detail sections')}
            onChange={(value) => {
              const next = value as ApiResourceDetailSection
              setSelectedTab(next)
              navigateConsoleTab(navigate, `/console/api-resources/${resourceId}/${next}`)
            }}
            tabs={apiResourceDetailTabs()}
            value={selectedTab}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            {selectedTab === 'settings' ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{tt('Resource settings')}</CardTitle>
                    <CardDescription>
                      {tt('The resource URL is used for OAuth resource requests and access-token audiences.')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {resource.archivedAt ? (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          {tt(
                            'Archived resources remain available for authorization history but cannot be enabled or edited.',
                          )}
                        </p>
                        <Button
                          disabled={archivalMutation.isPending}
                          onClick={() => archivalMutation.mutate('restore')}
                          type="button"
                          variant="secondary"
                        >
                          {tt('Restore resource')}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <AuthorizationForm
                          buttonLabel="Save resource"
                          defaults={{
                            identifier: resource.identifier,
                            name: resource.name,
                            resourceUrl: resource.resourceUrl,
                            description: resource.description ?? '',
                          }}
                          error={updateMutation.error}
                          fields={[
                            ['identifier', 'Identifier'],
                            ['name', 'Name'],
                            ['resourceUrl', 'Resource URL'],
                            ['description', 'Description'],
                          ]}
                          onSubmit={(form) => {
                            updateMutation.mutate(parseForm(updateApiResourceRequestSchema, form))
                          }}
                          pending={updateMutation.isPending}
                        />
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            disabled={updateMutation.isPending}
                            onClick={() =>
                              updateMutation.mutate({
                                enabled: !resource.enabled,
                              })
                            }
                            type="button"
                            variant="secondary"
                          >
                            {resource.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            disabled={archivalMutation.isPending}
                            onClick={() => setArchiveConfirmOpen(true)}
                            type="button"
                            variant="danger"
                          >
                            {tt('Archive resource')}
                          </Button>
                          <Button
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate()}
                            type="button"
                            variant="danger"
                          >
                            <Trash2 data-icon="inline-start" /> {tt('Delete resource')}{' '}
                          </Button>
                        </div>
                      </>
                    )}
                    <MutationError error={archivalMutation.error} />
                    <MutationError error={deleteMutation.error} />
                  </CardContent>
                </Card>
                {resource.connectorId && !resource.archivedAt ? (
                  <ExternalAuthorizationCard
                    authorization={resource.authorization}
                    currentConnectorId={resource.connectorId}
                    resourceId={resource.id}
                    resourceUrl={resource.resourceUrl}
                  />
                ) : null}
              </>
            ) : null}

            <ApiResourceSummaryCard resource={resource} />
          </div>
          <DangerConfirmDialog
            actionLabel={tt('Archive resource')}
            description={tt(
              'Archiving this resource permanently revokes its active connections, access grants, pending requests, and token leases. Restoring the resource will not restore that authorization.',
            )}
            error={archivalMutation.error}
            onClose={() => setArchiveConfirmOpen(false)}
            onConfirm={() => archivalMutation.mutate('archive')}
            open={archiveConfirmOpen}
            pending={archivalMutation.isPending}
            title={tt('Archive API resource')}
          />
        </div>
      ) : null}
    </ResourcePage>
  )
}

function ExternalAuthorizationCard({
  authorization,
  currentConnectorId,
  resourceId,
  resourceUrl,
}: {
  authorization: ApiResource['authorization']
  currentConnectorId: string
  resourceId: string
  resourceUrl: string
}) {
  const queryClient = useQueryClient()
  const connectorsQuery = useQuery({
    queryKey: consoleQueryKeys.connectors,
    queryFn: listConnectors,
  })
  const oidcConnectors = (connectorsQuery.data?.connectors ?? []).filter(
    (connector) => connector.providerType === 'generic_oauth',
  )
  const [connectorId, setConnectorId] = useState('')
  useEffect(() => {
    setConnectorId(currentConnectorId)
  }, [currentConnectorId])
  const mutation = useMutation({
    mutationFn: (nextConnectorId: string) => updateApiResource(resourceId, { connectorId: nextConnectorId }),
    onSuccess: (updated) => {
      queryClient.setQueryData([...consoleQueryKeys.apiResources, resourceId], updated)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.apiResources })
    },
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('OIDC connector')}</CardTitle>
        <CardDescription>
          {tt('Associate a reusable OIDC client for account authorization and direct Agent token exchange.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            {tt('Protected resource URL')}: {resourceUrl}
          </p>
          {authorization ? (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                {oidcConnectors.find((connector) => connector.id === authorization.connectorId)?.displayName ??
                  authorization.connectorId}
              </div>
              <div className="text-xs text-muted-foreground">
                {authorization.issuer} · {tt('Status')}: {tt(authorization.status)}
              </div>
            </div>
          ) : null}
          {oidcConnectors.length ? (
            <SelectInput
              aria-label={tt('OIDC connector')}
              onChange={(event) => setConnectorId(event.target.value)}
              value={connectorId}
            >
              <option value="">{tt('Select an OIDC connector')}</option>
              {oidcConnectors.map((connector) => (
                <option disabled={!connector.enabled} key={connector.id} value={connector.id}>
                  {connector.displayName} — {connector.issuer}
                </option>
              ))}
            </SelectInput>
          ) : !authorization ? (
            <p className="text-sm text-muted-foreground">
              {tt('Create an OIDC connector on the Connectors page before enabling this resource.')}{' '}
              <a className="font-medium underline" href="/console/connectors">
                {tt('Open Connectors')}
              </a>
            </p>
          ) : null}
          <MutationError error={mutation.error} />
          <div className="flex flex-wrap gap-2">
            {oidcConnectors.length ? (
              <Button
                disabled={
                  !connectorId ||
                  connectorId === authorization?.connectorId ||
                  !oidcConnectors.find((connector) => connector.id === connectorId)?.enabled ||
                  mutation.isPending
                }
                onClick={() => mutation.mutate(connectorId)}
                type="button"
              >
                {mutation.isPending ? tt('Validating...') : tt('Change connector')}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
