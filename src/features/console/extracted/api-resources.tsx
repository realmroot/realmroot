import { type ApiResource, createApiResourceSchema } from '@shared/api/agent-api'
import { configureExternalResourceAuthorizationRequestSchema } from '@shared/api/external-resources'
import {
  consoleQueryKeys,
  createApiPermission,
  createApiResource,
  createApiScope,
  deleteApiPermission,
  deleteApiResource,
  deleteApiScope,
  getApiResource,
  listApiPermissions,
  listApiResources,
  listApiScopes,
  updateApiPermission,
  updateApiResource,
  updateApiScope,
} from '@/lib/api/management'
import {
  type ApiResourceDetailSection,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  createApiPermissionRequestSchema,
  createApiResourceRequestSchema,
  createApiScopeRequestSchema,
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
  updateApiPermissionRequestSchema,
  updateApiResourceRequestSchema,
  updateApiScopeRequestSchema,
  useEffect,
  useMutation,
  useNavigate,
  useQuery,
  useQueryClient,
  useState,
  type z,
} from '../console-shared'
import { SimpleCreateDialog } from '../helpers/helpers-create'
import { MutationError, StatusBadge } from '../helpers/helpers-dialogs'
import { AuthorizationForm, AuthorizationRows } from '../helpers/helpers-forms'
import {
  apiResourceDetailTabs,
  DetailTabs,
  ListToolbar,
  navigateConsoleTab,
  ObjectHeader,
  ResourcePage,
} from '../helpers/helpers-resource'
import { nullableString, parseForm, useAdminMutation } from '../helpers/helpers-utils'
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
    [resource.name, resource.identifier, resource.audience, resource.description ?? ''].some((value) =>
      value.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  )
  return (
    <ResourcePage
      title={tt('API resources')}
      description={tt('Register protected APIs, audiences, scopes, and permission surfaces.')}
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
            ['audience', 'Audience'],
            ['description', 'Description'],
            ...(createMode === 'external' ? [['resourceUrl', 'Protected resource URL'] as [string, string]] : []),
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
                authorization:
                  createMode === 'external'
                    ? { resourceUrl: form.resourceUrl, registrationMode: 'dynamic' }
                    : undefined,
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
            <TableHead>{tt('Audience')}</TableHead>
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
                <TableCell>{resource.audience}</TableCell>
                <TableCell>
                  {resource.authorizationMode === 'external' ? tt('External issuer') : tt('Native (FlareAuth)')}
                </TableCell>
                <TableCell>
                  <StatusBadge active={resource.enabled} activeLabel="Enabled" inactiveLabel="Disabled" />
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
  const resourceQuery = useQuery({
    queryKey: [...consoleQueryKeys.apiResources, resourceId],
    queryFn: () => getApiResource(resourceId),
  })
  const scopesQuery = useQuery({
    queryKey: [...consoleQueryKeys.apiResources, resourceId, 'scopes'],
    queryFn: () => listApiScopes(resourceId),
    enabled: selectedTab === 'scopes',
  })
  const permissionsQuery = useQuery({
    queryKey: [...consoleQueryKeys.apiResources, resourceId, 'permissions'],
    queryFn: () => listApiPermissions(resourceId),
    enabled: selectedTab === 'permissions',
  })
  const resource = resourceQuery.data
  const refreshChildren = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: [...consoleQueryKeys.apiResources, resourceId, 'scopes'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...consoleQueryKeys.apiResources, resourceId, 'permissions'],
      }),
    ])
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
  const createScopeMutation = useMutation({
    mutationFn: (input: z.infer<typeof createApiScopeRequestSchema>) => createApiScope(resourceId, input),
    onSuccess: refreshChildren,
  })
  const updateScopeMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: z.infer<typeof updateApiScopeRequestSchema> }) =>
      updateApiScope(resourceId, id, input),
    onSuccess: refreshChildren,
  })
  const deleteScopeMutation = useMutation({
    mutationFn: (id: string) => deleteApiScope(resourceId, id),
    onSuccess: refreshChildren,
  })
  const createPermissionMutation = useMutation({
    mutationFn: (input: z.infer<typeof createApiPermissionRequestSchema>) => createApiPermission(resourceId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...consoleQueryKeys.apiResources, resourceId, 'permissions'],
      }),
  })
  const updatePermissionMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: z.infer<typeof updateApiPermissionRequestSchema> }) =>
      updateApiPermission(resourceId, id, input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...consoleQueryKeys.apiResources, resourceId, 'permissions'],
      }),
  })
  const deletePermissionMutation = useMutation({
    mutationFn: (id: string) => deleteApiPermission(resourceId, id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...consoleQueryKeys.apiResources, resourceId, 'permissions'],
      }),
  })
  useEffect(() => setSelectedTab(section), [section])
  return (
    <ResourcePage
      title={resource?.name ?? tt('API resource')}
      description={tt('Manage the protected API audience, OAuth scopes, and permission keys used by RBAC roles.')}
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
            badge={resource.enabled ? 'Enabled' : 'Disabled'}
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
                      {' '}
                      {tt('Audience is emitted into authorization claims for matching OAuth resource requests.')}{' '}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <AuthorizationForm
                      buttonLabel="Save resource"
                      defaults={{
                        identifier: resource.identifier,
                        name: resource.name,
                        audience: resource.audience,
                        description: resource.description ?? '',
                        tokenClaimsNamespace: resource.tokenClaimsNamespace ?? '',
                      }}
                      error={updateMutation.error}
                      fields={[
                        ['identifier', 'Identifier'],
                        ['name', 'Name'],
                        ['audience', 'Audience'],
                        ['description', 'Description'],
                        ['tokenClaimsNamespace', 'Token claims namespace'],
                      ]}
                      onSubmit={(form) =>
                        updateMutation.mutate(
                          parseForm(updateApiResourceRequestSchema, {
                            ...form,
                            tokenClaimsNamespace: nullableString(form.tokenClaimsNamespace ?? ''),
                          }),
                        )
                      }
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
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate()}
                        type="button"
                        variant="danger"
                      >
                        <Trash2 data-icon="inline-start" /> {tt('Delete resource')}{' '}
                      </Button>
                    </div>
                    <MutationError error={deleteMutation.error} />
                  </CardContent>
                </Card>
                {resource.authorizationMode === 'external' ? (
                  <ExternalAuthorizationCard authorization={resource.authorization} resourceId={resource.id} />
                ) : null}
              </>
            ) : null}

            {selectedTab === 'scopes' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Scopes')}</CardTitle>
                  <CardDescription>
                    {' '}
                    {tt('Scopes become OAuth scope strings and can also drive token claim inclusion.')}{' '}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <AuthorizationForm
                    buttonLabel="Create scope"
                    defaults={{
                      value: '',
                      description: '',
                      tokenClaimName: '',
                    }}
                    error={createScopeMutation.error}
                    fields={[
                      ['value', 'Value'],
                      ['description', 'Description'],
                      ['tokenClaimName', 'Token claim name'],
                    ]}
                    onSubmit={(form) => createScopeMutation.mutate(parseForm(createApiScopeRequestSchema, form))}
                    pending={createScopeMutation.isPending}
                  />
                  <AuthorizationRows
                    empty={tt('No scopes yet.')}
                    rows={scopesQuery.data?.scopes.map((scope) => ({
                      id: scope.id,
                      title: scope.value,
                      detail: scope.description ?? 'No description',
                      defaults: {
                        value: scope.value,
                        description: scope.description ?? '',
                        tokenClaimName: scope.tokenClaimName ?? '',
                      },
                      fields: [
                        ['value', 'Value'],
                        ['description', 'Description'],
                        ['tokenClaimName', 'Token claim name'],
                      ],
                      onDelete: () => deleteScopeMutation.mutate(scope.id),
                      onEdit: (form) =>
                        updateScopeMutation.mutate({
                          id: scope.id,
                          input: parseForm(updateApiScopeRequestSchema, form),
                        }),
                    }))}
                  />
                  <MutationError error={updateScopeMutation.error ?? deleteScopeMutation.error} />
                </CardContent>
              </Card>
            ) : null}

            {selectedTab === 'permissions' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Permissions')}</CardTitle>
                  <CardDescription>
                    {' '}
                    {tt('Permissions are assigned to roles and emitted through authorization claims.')}{' '}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <AuthorizationForm
                    buttonLabel="Create permission"
                    defaults={{
                      key: '',
                      description: '',
                      tokenClaimValue: '',
                      scopeId: '',
                    }}
                    error={createPermissionMutation.error}
                    fields={[
                      ['key', 'Key'],
                      ['description', 'Description'],
                      ['scopeId', 'Scope ID'],
                      ['tokenClaimValue', 'Token claim value'],
                    ]}
                    onSubmit={(form) =>
                      createPermissionMutation.mutate(parseForm(createApiPermissionRequestSchema, form))
                    }
                    pending={createPermissionMutation.isPending}
                  />
                  <AuthorizationRows
                    empty={tt('No permissions yet.')}
                    rows={permissionsQuery.data?.permissions.map((permission) => ({
                      id: permission.id,
                      title: permission.key,
                      detail: permission.description ?? permission.scopeId ?? 'No description',
                      defaults: {
                        key: permission.key,
                        description: permission.description ?? '',
                        scopeId: permission.scopeId ?? '',
                        tokenClaimValue: permission.tokenClaimValue ?? '',
                      },
                      fields: [
                        ['key', 'Key'],
                        ['description', 'Description'],
                        ['scopeId', 'Scope ID'],
                        ['tokenClaimValue', 'Token claim value'],
                      ],
                      onDelete: () => deletePermissionMutation.mutate(permission.id),
                      onEdit: (form) =>
                        updatePermissionMutation.mutate({
                          id: permission.id,
                          input: parseForm(updateApiPermissionRequestSchema, form),
                        }),
                    }))}
                  />
                  <MutationError error={updatePermissionMutation.error ?? deletePermissionMutation.error} />
                </CardContent>
              </Card>
            ) : null}
            <ApiResourceSummaryCard
              permissionsCount={permissionsQuery.data?.permissions.length ?? 0}
              resource={resource}
              scopesCount={scopesQuery.data?.scopes.length ?? 0}
            />
          </div>
        </div>
      ) : null}
    </ResourcePage>
  )
}

function ExternalAuthorizationCard({
  authorization,
  resourceId,
}: {
  authorization: ApiResource['authorization']
  resourceId: string
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
      resourceUrl: authorization.resourceUrl,
      registrationMode: authorization.registrationMode,
      clientId: authorization.clientId,
      clientSecret: '',
    })
  }, [authorization])
  const mutation = useMutation({
    mutationFn: (input: z.infer<typeof configureExternalResourceAuthorizationRequestSchema>) =>
      updateApiResource(resourceId, { authorization: input }),
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
            mutation.mutate(
              configureExternalResourceAuthorizationRequestSchema.parse({
                resourceUrl: form.resourceUrl,
                registrationMode: form.registrationMode,
                clientId: form.registrationMode === 'manual' ? form.clientId : undefined,
                clientSecret: form.registrationMode === 'manual' ? form.clientSecret : undefined,
              }),
            )
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
