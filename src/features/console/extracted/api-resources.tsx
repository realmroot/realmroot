import { type ApiResource, createApiResourceSchema } from '@shared/api/agent-api'
import { configureExternalResourceAuthorizationRequestSchema } from '@shared/api/external-resources'
import {
  archiveApiResource,
  consoleQueryKeys,
  createApiResource,
  deleteApiResource,
  getApiResource,
  listApiResources,
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
  Field,
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
import { SimpleCreateDialog } from '../helpers/helpers-create'
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
import { parseForm, useAdminMutation } from '../helpers/helpers-utils'
import { ApiResourceSummaryCard } from './api-resource-summary-card'

export function ApiResourcesPage() {
  const query = useQuery({
    queryKey: consoleQueryKeys.apiResources,
    queryFn: listApiResources,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [createMode, setCreateMode] = useState<'native' | 'external'>('native')
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
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setCreateMode('native')
              setDialogOpen(true)
            }}
          >
            <Plus data-icon="inline-start" /> {tt('New local resource')}{' '}
          </Button>
          <Button
            onClick={() => {
              setCreateMode('external')
              setDialogOpen(true)
            }}
            variant="secondary"
          >
            <Plus data-icon="inline-start" /> {tt('New external resource')}{' '}
          </Button>
        </div>
      }
      auxiliary={
        <SimpleCreateDialog
          error={createMutation.errorMessage}
          fields={[
            ['identifier', 'Identifier'],
            ['name', 'Name'],
            ['resourceUrl', 'Resource URL'],
            ['description', 'Description'],
          ]}
          onClose={() => setDialogOpen(false)}
          onSubmit={(form) => {
            const resource = parseForm(createApiResourceRequestSchema, {
              ...form,
              authorizationMode: createMode,
            })
            createMutation.mutate(
              createApiResourceSchema.parse({
                ...resource,
                authorization: createMode === 'external' ? { registrationMode: 'dynamic' } : undefined,
              }),
            )
          }}
          open={dialogOpen}
          pending={createMutation.isPending}
          title={tt(createMode === 'external' ? 'Create external API resource' : 'Create local API resource')}
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
                <TableCell>
                  {resource.authorizationMode === 'external' ? tt('External issuer') : tt('Native (Realmroot)')}
                </TableCell>
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
                            ...(resource.authorizationMode === 'native'
                              ? ([['resourceUrl', 'Resource URL']] as [string, string][])
                              : []),
                            ['description', 'Description'],
                          ]}
                          onSubmit={(form) => {
                            const input = parseForm(updateApiResourceRequestSchema, form)
                            if (resource.authorizationMode === 'native') {
                              updateMutation.mutate(input)
                              return
                            }
                            const { resourceUrl: _resourceUrl, ...externalInput } = input
                            updateMutation.mutate(externalInput)
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
                {resource.authorizationMode === 'external' && !resource.archivedAt ? (
                  <ExternalAuthorizationCard
                    authorization={resource.authorization}
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
  resourceId,
  resourceUrl,
}: {
  authorization: ApiResource['authorization']
  resourceId: string
  resourceUrl: string
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    resourceUrl: '',
    registrationMode: 'dynamic' as 'dynamic' | 'manual',
    clientId: '',
    clientSecret: '',
  })
  useEffect(() => {
    if (!authorization) return
    setForm({
      resourceUrl,
      registrationMode: authorization.registrationMode,
      clientId: authorization.clientId,
      clientSecret: '',
    })
  }, [authorization, resourceUrl])
  const mutation = useMutation({
    mutationFn: (input: {
      resourceUrl: string
      authorization: z.infer<typeof configureExternalResourceAuthorizationRequestSchema>
    }) => updateApiResource(resourceId, input),
    onSuccess: (updated) => queryClient.setQueryData([...consoleQueryKeys.apiResources, resourceId], updated),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('External authorization server')}</CardTitle>
        <CardDescription>
          {tt('Discover the protected resource and configure the OAuth client used for direct Agent token exchange.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate({
              resourceUrl: createApiResourceRequestSchema.shape.resourceUrl.parse(form.resourceUrl),
              authorization: configureExternalResourceAuthorizationRequestSchema.parse({
                registrationMode: form.registrationMode,
                clientId: form.registrationMode === 'manual' ? form.clientId : undefined,
                clientSecret: form.registrationMode === 'manual' ? form.clientSecret : undefined,
              }),
            })
          }}
        >
          <Field label={tt('Protected resource URL')}>
            <TextInput
              onChange={(event) => setForm((current) => ({ ...current, resourceUrl: event.target.value }))}
              required
              type="url"
              value={form.resourceUrl}
            />
          </Field>
          <Field label={tt('Client registration')}>
            <SelectInput
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  registrationMode: event.target.value as 'dynamic' | 'manual',
                }))
              }
              value={form.registrationMode}
            >
              <option value="dynamic">{tt('Dynamic registration (RFC 7591)')}</option>
              <option value="manual">{tt('Pre-registered client')}</option>
            </SelectInput>
          </Field>
          {form.registrationMode === 'manual' ? (
            <>
              <Field label={tt('Client ID')}>
                <TextInput
                  onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))}
                  required
                  value={form.clientId}
                />
              </Field>
              <Field label={tt('Client secret')}>
                <TextInput
                  onChange={(event) => setForm((current) => ({ ...current, clientSecret: event.target.value }))}
                  required
                  type="password"
                  value={form.clientSecret}
                />
              </Field>
            </>
          ) : null}
          {authorization ? (
            <p className="text-xs text-muted-foreground">
              {tt('Issuer')}: {authorization.issuer} · {tt('Status')}: {authorization.status}
            </p>
          ) : null}
          <MutationError error={mutation.error} />
          <Button disabled={mutation.isPending} type="submit">
            {mutation.isPending ? tt('Discovering...') : tt('Discover and configure')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
