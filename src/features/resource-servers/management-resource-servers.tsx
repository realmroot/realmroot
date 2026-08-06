import type { ApiResource } from '@shared/api/agent-api'
import {
  type ApiResourceContractResponse,
  type ApiResourceVisibility,
  createApiResourceRequestSchema,
  type OrganizationResponse,
  updateApiResourceRequestSchema,
} from '@shared/api/authorization'
import { authorizationDetailsSchema } from '@shared/api/authorization-details'
import type { ConnectorResponse } from '@shared/api/connectors'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Plus, RotateCw } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Field, SelectInput, TextArea, TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FormDialog } from '@/features/management/create-dialogs'
import { DangerConfirmDialog, ErrorState, LoadingState, StatusBadge } from '@/features/management/dialogs'
import {
  OrganizationOwnerField,
  organizationOptions,
  ownerLabel,
  resourceVisibilityLabel,
} from '@/features/management/ownership-controls'
import { ListToolbar, navigateConsoleTab, ResourcePage } from '@/features/management/resource-components'
import type { ApiResourceDetailSection, FormState } from '@/features/management/shared'
import { emptyForm } from '@/features/management/shared'
import { formatDate, nullableString, parseForm, setValue, useAdminMutation } from '@/features/management/utils'
import {
  archiveApiResource,
  consoleQueryKeys,
  createApiResource,
  getApiResource,
  getApiResourceContract,
  listApiResources,
  listConnectors,
  listOrganizations,
  listRoles,
  refreshApiResourceScopeRegistry,
  restoreApiResource,
  updateApiResource,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'

type ResourceEditor = 'details' | 'visibility' | 'connector' | null

export function ApiResourcesPage({ organizationId }: { organizationId?: string } = {}) {
  const [owner, setOwner] = useState(organizationId ?? '')
  const query = useQuery({
    queryKey: [...consoleQueryKeys.apiResources, { ownerOrganizationId: owner || undefined }],
    queryFn: () => listApiResources({ ownerOrganizationId: owner || undefined }),
  })
  const connectorsQuery = useQuery({ queryKey: consoleQueryKeys.connectors, queryFn: listConnectors })
  const organizationsQuery = useQuery({ queryKey: consoleQueryKeys.organizations, queryFn: listOrganizations })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [authorization, setAuthorization] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => setOwner(organizationId ?? ''), [organizationId])
  const createMutation = useAdminMutation({
    mutationFn: createApiResource,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.apiResources })
    },
  })
  const connectors = (connectorsQuery.data?.connectors ?? []).filter(
    (connector) => connector.providerType === 'generic_oauth' && connector.enabled,
  )
  const organizations = organizationsQuery.data?.organizations ?? []
  const resources = query.data?.items ?? []
  const visibleResources = resources.filter((resource) => {
    const matchesSearch = [resource.name, resource.identifier, resource.resourceUrl, resource.description ?? ''].some(
      (value) => value.toLowerCase().includes(search.trim().toLowerCase()),
    )
    const resourceStatus = resource.archivedAt ? 'archived' : resource.enabled ? 'enabled' : 'disabled'
    return (
      matchesSearch &&
      (!authorization || (resource.connectorId ? 'external' : 'native') === authorization) &&
      (!status || resourceStatus === status) &&
      (!owner || resource.ownerOrganizationId === owner)
    )
  })
  return (
    <ResourcePage
      title={tt('Resource servers')}
      description={tt(
        organizationId
          ? 'Manage protected APIs owned by this Organization and their authorization lifecycle.'
          : 'Review protected APIs, their authorization model, ownership, and lifecycle across this Realm.',
      )}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus />
          {tt('New resource server')}
        </Button>
      }
      auxiliary={
        <ApiResourceCreateDialog
          connectors={connectors}
          defaultOwnerOrganizationId={organizationId}
          fixedOwnerOrganizationId={organizationId}
          error={createMutation.errorMessage}
          key={organizationId ?? 'realm'}
          onClose={() => setDialogOpen(false)}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          organizations={organizations}
          pending={createMutation.isPending}
        />
      }
      empty={resources.length === 0}
      emptyDescription="Register a protected API before applications and Agents can request its scopes."
      emptyTitle="No resource servers yet"
      error={query.error ?? organizationsQuery.error ?? connectorsQuery.error}
      loading={query.isLoading || organizationsQuery.isLoading || connectorsQuery.isLoading}
      onRetry={() => Promise.all([query.refetch(), organizationsQuery.refetch(), connectorsQuery.refetch()])}
      tableToolbar={
        <ListToolbar>
          <TextInput
            aria-label={tt('Search resource servers')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search resource servers')}
            value={search}
          />
          <SelectInput
            aria-label={tt('Filter authorization')}
            onChange={(event) => setAuthorization(event.target.value)}
            value={authorization}
          >
            <option value="">{tt('Any authorization')}</option>
            <option value="native">{tt('Native')}</option>
            <option value="external">{tt('External')}</option>
          </SelectInput>
          <SelectInput
            aria-label={tt('Filter status')}
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">{tt('Any status')}</option>
            <option value="enabled">{tt('Enabled')}</option>
            <option value="disabled">{tt('Disabled')}</option>
            <option value="archived">{tt('Archived')}</option>
          </SelectInput>
          {organizationId ? null : (
            <SelectInput
              aria-label={tt('Filter owner')}
              onChange={(event) => setOwner(event.target.value)}
              value={owner}
            >
              <option value="">{tt('Any owner')}</option>
              {organizationOptions(organizations).map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.label}
                </option>
              ))}
            </SelectInput>
          )}
        </ListToolbar>
      }
    >
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[30%]">{tt('Resource server')}</TableHead>
            <TableHead className="w-[13%]">{tt('Authorization')}</TableHead>
            <TableHead className="w-[19%]">{tt('Protected resource')}</TableHead>
            <TableHead className="w-[10%]">{tt('Status')}</TableHead>
            <TableHead className="w-[16%]">{tt('Owner')}</TableHead>
            <TableHead className="w-[10%]">{tt('Updated')}</TableHead>
            <TableHead className="w-14" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleResources.length ? (
            visibleResources.map((resource) => (
              <TableRow key={resource.id}>
                <TableCell className="min-w-0">
                  {organizationId ? (
                    <Link
                      className="block truncate font-medium hover:underline"
                      params={{ organizationId, resourceId: resource.id }}
                      to="/organizations/$organizationId/resource-servers/$resourceId"
                    >
                      {resource.name}
                    </Link>
                  ) : (
                    <Link
                      className="block truncate font-medium hover:underline"
                      params={{ resourceId: resource.id }}
                      to="/console/api-resources/$resourceId"
                    >
                      {resource.name}
                    </Link>
                  )}
                  <span className="block truncate font-mono text-xs text-muted-foreground" title={resource.id}>
                    {resource.id}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{resource.connectorId ? tt('External') : tt('Native')}</Badge>
                </TableCell>
                <TableCell className="truncate font-mono text-xs" title={resource.resourceUrl}>
                  {resource.resourceUrl}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    active={resource.enabled && !resource.archivedAt}
                    activeLabel={tt('Enabled')}
                    inactiveLabel={tt(resource.archivedAt ? 'Archived' : 'Disabled')}
                  />
                </TableCell>
                <TableCell className="truncate" title={ownerLabel(resource.ownerOrganizationId, organizations)}>
                  {ownerLabel(resource.ownerOrganizationId, organizations)}
                </TableCell>
                <TableCell>{formatDate(resource.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    {organizationId ? (
                      <Link
                        params={{ organizationId, resourceId: resource.id }}
                        to="/organizations/$organizationId/resource-servers/$resourceId"
                      >
                        {tt('Open')}
                      </Link>
                    ) : (
                      <Link params={{ resourceId: resource.id }} to="/console/api-resources/$resourceId">
                        {tt('Open')}
                      </Link>
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={7}
              description={
                search || authorization || status || owner
                  ? tt('No resource servers match the current filters.')
                  : tt('Register a protected API before issuing access tokens.')
              }
              title={
                search || authorization || status || owner
                  ? tt('No resource servers found')
                  : tt('No resource servers yet')
              }
            />
          )}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}

function ApiResourceCreateDialog({
  connectors,
  defaultOwnerOrganizationId,
  fixedOwnerOrganizationId,
  error,
  onClose,
  onSubmit,
  open,
  organizations,
  pending,
}: {
  connectors: Array<{ id: string; displayName: string; issuer: string | null }>
  defaultOwnerOrganizationId?: string
  fixedOwnerOrganizationId?: string
  error: string | null
  onClose: () => void
  onSubmit: (input: Parameters<typeof createApiResource>[0]) => void
  open: boolean
  organizations: OrganizationResponse[]
  pending: boolean
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [ownerOrganizationId, setOwnerOrganizationId] = useState('')
  const [visibility, setVisibility] = useState<ApiResourceVisibility>('private')
  const [availableToAgents, setAvailableToAgents] = useState(true)
  const [authorizationDetails, setAuthorizationDetails] = useState('[]')
  const [validationError, setValidationError] = useState<string | null>(null)
  useEffect(() => {
    if (!open || ownerOrganizationId) return
    setOwnerOrganizationId(fixedOwnerOrganizationId ?? defaultOwnerOrganizationId ?? organizations[0]?.id ?? '')
  }, [defaultOwnerOrganizationId, fixedOwnerOrganizationId, open, organizations, ownerOrganizationId])
  return (
    <Dialog open={open}>
      <FormDialog
        description={tt('Register a protected API and choose how its actors become eligible for authority.')}
        error={validationError ?? error}
        onClose={onClose}
        onSubmit={(event) => {
          event.preventDefault()
          try {
            setValidationError(null)
            onSubmit(
              parseForm(createApiResourceRequestSchema, {
                ...form,
                authorizationDetails: form.connectorId ? parseAuthorizationDetails(authorizationDetails) : [],
                ownerOrganizationId,
                visibility,
                availableToAgents,
              }),
            )
          } catch (submitError) {
            setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
          }
        }}
        pending={pending}
        title={tt('New resource server')}
      >
        <Field label={tt('Name')}>
          <TextInput name="name" onChange={(event) => setValue(setForm, 'name', event.target.value)} required />
        </Field>
        <Field label={tt('Identifier')}>
          <TextInput
            name="identifier"
            onChange={(event) => setValue(setForm, 'identifier', event.target.value)}
            required
          />
        </Field>
        <Field label={tt('Protected resource URL')}>
          <TextInput
            name="resourceUrl"
            onChange={(event) => setValue(setForm, 'resourceUrl', event.target.value)}
            required
            type="url"
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
          help={tt(
            'Native uses Realmroot authorization. Selecting a connector delegates authorization to that provider. This cannot be changed after creation.',
          )}
          label={tt('Authorization model')}
        >
          <SelectInput
            name="connectorId"
            onChange={(event) => setValue(setForm, 'connectorId', event.target.value)}
            value={form.connectorId ?? ''}
          >
            <option value="">{tt('Native (Realmroot)')}</option>
            {connectors.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {tt('External')} · {connector.displayName} — {connector.issuer}
              </option>
            ))}
          </SelectInput>
        </Field>
        {form.connectorId ? (
          <Field
            help={tt(
              'Opaque RFC 9396 templates sent to the authorization server. Each array entry must contain a non-empty type.',
            )}
            label={tt('Authorization detail templates')}
          >
            <TextArea
              aria-label={tt('Authorization detail templates')}
              name="authorizationDetails"
              onChange={(event) => setAuthorizationDetails(event.target.value)}
              rows={8}
              value={authorizationDetails}
            />
          </Field>
        ) : null}
        <Field
          help={tt(
            'Visibility controls whether only the owner Organization or all authenticated users and Organizations may access this server.',
          )}
          label={tt('Visibility')}
        >
          <SelectInput
            name="visibility"
            onChange={(event) => setVisibility(event.target.value as ApiResourceVisibility)}
            value={visibility}
          >
            <option value="private">{tt('Owner Organization only')}</option>
            <option value="public">{tt('All authenticated users and Organizations')}</option>
          </SelectInput>
        </Field>
        <div className="flex items-start justify-between gap-4">
          <span>
            <strong className="block text-sm">{tt('Available to Agents')}</strong>
            <small className="text-muted-foreground">
              {tt('Eligible Agent identities may discover and request these scopes.')}
            </small>
          </span>
          <Switch
            aria-label={tt('Available to Agents')}
            checked={availableToAgents}
            onCheckedChange={setAvailableToAgents}
          />
        </div>
        <Field label={tt('Description')}>
          <TextArea
            name="description"
            onChange={(event) => setValue(setForm, 'description', event.target.value)}
            rows={3}
          />
        </Field>
      </FormDialog>
    </Dialog>
  )
}

export function ApiResourceDetailPage({
  organizationId,
  resourceId,
  section = 'overview',
}: {
  organizationId?: string
  resourceId: string
  section?: ApiResourceDetailSection
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedTab, setSelectedTab] = useState<ApiResourceDetailSection>(section)
  const [editor, setEditor] = useState<ResourceEditor>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const resourceQuery = useQuery({
    queryKey: [...consoleQueryKeys.apiResources, resourceId],
    queryFn: () => getApiResource(resourceId),
  })
  const contractQuery = useQuery({
    enabled: selectedTab === 'resources',
    queryFn: () => getApiResourceContract(resourceId),
    queryKey: [...consoleQueryKeys.apiResources, resourceId, 'contract'],
  })
  const connectorsQuery = useQuery({ queryKey: consoleQueryKeys.connectors, queryFn: listConnectors })
  const organizationsQuery = useQuery({ queryKey: consoleQueryKeys.organizations, queryFn: listOrganizations })
  const resource = resourceQuery.data
  const updateMutation = useAdminMutation({
    mutationFn: (input: Parameters<typeof updateApiResource>[1]) => updateApiResource(resourceId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...consoleQueryKeys.apiResources, resourceId], updated)
      setEditor(null)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.apiResources })
    },
  })
  const refreshScopesMutation = useAdminMutation({
    mutationFn: () => refreshApiResourceScopeRegistry(resourceId),
    onSuccess: (updated) => {
      queryClient.setQueryData([...consoleQueryKeys.apiResources, resourceId], updated)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: consoleQueryKeys.apiResources }),
        queryClient.invalidateQueries({ queryKey: [...consoleQueryKeys.apiResources, resourceId, 'contract'] }),
      ])
    },
  })
  const archivalMutation = useMutation({
    mutationFn: (action: 'archive' | 'restore') =>
      action === 'archive' ? archiveApiResource(resourceId) : restoreApiResource(resourceId),
    onSuccess: (updated) => {
      setArchiveOpen(false)
      queryClient.setQueryData([...consoleQueryKeys.apiResources, resourceId], updated)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.apiResources })
    },
  })
  useEffect(() => setSelectedTab(section), [section])
  if (resourceQuery.isLoading || organizationsQuery.isLoading)
    return <LoadingState label={tt('Loading resource server')} />
  const loadError = resourceQuery.error ?? organizationsQuery.error
  if (loadError)
    return (
      <ErrorState
        error={loadError}
        onRetry={() => Promise.all([resourceQuery.refetch(), organizationsQuery.refetch()])}
      />
    )
  if (!resource) return <ErrorState error={new Error(tt('Resource server not found.'))} />
  if (organizationId && resource.ownerOrganizationId !== organizationId) {
    return <ErrorState error={new Error(tt('Resource server does not belong to this Organization.'))} />
  }
  const organizations = organizationsQuery.data?.organizations ?? []
  const mode = resource.connectorId ? 'external' : 'native'
  return (
    <>
      <div className="consoleDetailStack">
        {organizationId ? (
          <Link
            className="consoleBackLink"
            params={{ organizationId }}
            to="/organizations/$organizationId/resource-servers"
          >
            <ArrowLeft />
            {tt('Resource servers')}
          </Link>
        ) : (
          <Link className="consoleBackLink" to="/console/api-resources">
            <ArrowLeft />
            {tt('Resource servers')}
          </Link>
        )}
        <header className="consoleDetailHeader">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1>{resource.name}</h1>
              <Badge variant={resource.archivedAt ? 'outline' : resource.enabled ? 'secondary' : 'outline'}>
                {tt(resource.archivedAt ? 'Archived' : resource.enabled ? 'Enabled' : 'Disabled')}
              </Badge>
            </div>
            <p>{resource.description ?? tt('Protected API registered in this Realm.')}</p>
            <span className="consoleDetailMeta">
              {mode === 'native' ? tt('Native authorization') : tt('External authorization')} · {resource.id}
            </span>
          </div>
        </header>
        <Tabs
          onValueChange={(value) => {
            const next = value as ApiResourceDetailSection
            setSelectedTab(next)
            navigateConsoleTab(
              navigate,
              organizationId
                ? `/organizations/${organizationId}/resource-servers/${resourceId}/${next}`
                : `/console/api-resources/${resourceId}/${next}`,
            )
          }}
          value={selectedTab}
        >
          <TabsList className="w-full" variant="navigation">
            <TabsTrigger value="overview">{tt('Overview')}</TabsTrigger>
            <TabsTrigger value="resources">{tt('Resources')}</TabsTrigger>
            <TabsTrigger value="authority">{tt(mode === 'native' ? 'Roles & grants' : 'Authorization')}</TabsTrigger>
            <TabsTrigger value="settings">{tt('Settings')}</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-5" value="overview">
            <ResourceOverview mode={mode} organizations={organizations} resource={resource} />
          </TabsContent>
          <TabsContent className="mt-5" value="resources">
            <ProtectedResources
              contract={contractQuery.data}
              error={contractQuery.error}
              loading={contractQuery.isLoading}
              onGrantModeChange={(scope, grantMode) =>
                updateMutation.mutate({ scopeGrantModes: [{ scope, grantMode }] })
              }
              onRefresh={() => refreshScopesMutation.mutate(undefined)}
              onRetry={() => contractQuery.refetch()}
              pending={updateMutation.isPending || refreshScopesMutation.isPending}
              resource={resource}
            />
          </TabsContent>
          <TabsContent className="mt-5" value="authority">
            <ResourceAuthority organizationId={organizationId} mode={mode} resource={resource} />
          </TabsContent>
          <TabsContent className="mt-5" value="settings">
            <ResourceSettings
              connectors={connectorsQuery.data?.connectors ?? []}
              mode={mode}
              onArchive={() => setArchiveOpen(true)}
              onEditConnector={() => setEditor('connector')}
              onEditDetails={() => setEditor('details')}
              onEditVisibility={() => setEditor('visibility')}
              onRestore={() => archivalMutation.mutate('restore')}
              onToggle={() => updateMutation.mutate({ enabled: !resource.enabled })}
              organizations={organizations}
              resource={resource}
            />
          </TabsContent>
        </Tabs>
      </div>
      <ResourceEditorSheet
        connectors={(connectorsQuery.data?.connectors ?? []).filter(
          (connector) => connector.providerType === 'generic_oauth',
        )}
        editor={editor}
        error={updateMutation.errorMessage}
        fixedOwnerOrganizationId={organizationId}
        onClose={() => setEditor(null)}
        onSave={(input) => updateMutation.mutate(input)}
        organizations={organizations}
        pending={updateMutation.isPending}
        resource={resource}
      />
      <DangerConfirmDialog
        actionLabel={tt('Archive resource server')}
        description={tt(
          'Archiving revokes active connections, grants, pending requests, and token leases. Restoring does not restore that authority.',
        )}
        error={archivalMutation.error}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => archivalMutation.mutate('archive')}
        open={archiveOpen}
        pending={archivalMutation.isPending}
        title={tt('Archive {{name}}?', { name: resource.name })}
      />
    </>
  )
}

function ResourceOverview({
  mode,
  organizations,
  resource,
}: {
  mode: 'native' | 'external'
  organizations: OrganizationResponse[]
  resource: ApiResource
}) {
  return (
    <div className="detailFlatRows">
      <DetailRow label="Owner" value={ownerLabel(resource.ownerOrganizationId, organizations)} />
      <DetailRow
        label="Authorization"
        value={mode === 'native' ? tt('Native · Realmroot') : tt('External OIDC provider')}
      />
      <DetailRow label="Visibility" value={resourceVisibilityLabel(resource.visibility)} />
      <DetailRow label="Available to Agents" value={resource.availableToAgents ? tt('Yes') : tt('No')} />
      <DetailRow label="Protected resource URL" value={<code>{resource.resourceUrl}</code>} />
      <DetailRow label="Identifier" value={<code>{resource.identifier}</code>} />
      <DetailRow label="Created" value={formatDate(resource.createdAt)} />
      <DetailRow label="Last updated" value={formatDate(resource.updatedAt)} />
    </div>
  )
}

function ProtectedResources({
  contract,
  error,
  loading,
  onGrantModeChange,
  onRefresh,
  onRetry,
  pending,
  resource,
}: {
  contract?: ApiResourceContractResponse
  error: Error | null
  loading: boolean
  onGrantModeChange: (scope: string, grantMode: 'automatic' | 'assigned') => void
  onRefresh: () => void
  onRetry: () => void
  pending: boolean
  resource: ApiResource
}) {
  const operations = contract?.operations ?? []
  return (
    <div className="grid gap-5">
      <div className="overflow-hidden rounded-xl border">
        <div className="flex items-center justify-between gap-4 border-b p-4">
          <div>
            <h2 className="font-medium">{tt('Scope registry')}</h2>
            <p className="text-sm text-muted-foreground">
              {tt(
                'Automatic scopes are requestable by visible principals. Assigned scopes require an explicit grant or Role.',
              )}
            </p>
          </div>
          <Button disabled={pending || !resource.enabled} onClick={onRefresh} variant="outline">
            <RotateCw /> {tt('Refresh scopes')}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Scope')}</TableHead>
              <TableHead>{tt('Description')}</TableHead>
              <TableHead>{tt('Grant mode')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resource.scopeRegistry?.scopes.length ? (
              resource.scopeRegistry.scopes.map((scope) => (
                <TableRow key={scope.value}>
                  <TableCell>
                    <code>{scope.value}</code>
                  </TableCell>
                  <TableCell>{scope.description ?? tt('—')}</TableCell>
                  <TableCell>
                    <SelectInput
                      aria-label={tt('Grant mode for {{scope}}', { scope: scope.value })}
                      disabled={pending}
                      onChange={(event) =>
                        onGrantModeChange(scope.value, event.target.value as 'automatic' | 'assigned')
                      }
                      value={scope.grantMode}
                    >
                      <option value="assigned">{tt('Assigned')}</option>
                      <option value="automatic">{tt('Automatic')}</option>
                    </SelectInput>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={3}
                description={tt('Refresh this Resource Server to discover its OAuth scopes.')}
                title={tt('No synchronized scopes')}
              />
            )}
          </TableBody>
        </Table>
      </div>
      {loading ? <LoadingState label={tt('Reading protected resources')} /> : null}
      {error ? <ErrorState error={error} onRetry={onRetry} /> : null}
      {!loading && !error ? (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tt('Resource')}</TableHead>
                <TableHead>{tt('Path')}</TableHead>
                <TableHead>{tt('Required scope')}</TableHead>
                <TableHead>{tt('Description')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operations.length ? (
                operations.map((operation) => (
                  <TableRow key={`${operation.method}:${operation.path}:${operation.operationId ?? ''}`}>
                    <TableCell>
                      <span className="font-medium">
                        {operation.summary ?? operation.operationId ?? tt('Protected operation')}
                      </span>
                      {operation.summary && operation.operationId ? (
                        <code className="mt-0.5 block text-xs text-muted-foreground">{operation.operationId}</code>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <Badge variant="outline">{operation.method}</Badge>
                        <code className="text-xs">{operation.path}</code>
                      </span>
                    </TableCell>
                    <TableCell>
                      <ScopeRequirements scopeSets={operation.requiredScopeSets} />
                    </TableCell>
                    <TableCell className="max-w-80 text-sm text-muted-foreground">
                      {operation.description ?? tt('—')}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyRow
                  colSpan={4}
                  description={tt('The published OpenAPI contract does not declare any OAuth-protected operations.')}
                  title={tt('No protected resources')}
                />
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}

function ScopeRequirements({ scopeSets }: { scopeSets: string[][] }) {
  return (
    <div className="flex max-w-md flex-wrap items-center gap-1.5">
      {scopeSets.map((scopes, index) => (
        <span className="contents" key={scopes.join('\u0000') || 'authenticated'}>
          {index > 0 ? <span className="px-0.5 text-xs text-muted-foreground">{tt('or')}</span> : null}
          <span className="inline-flex flex-wrap items-center gap-1">
            {scopes.length ? (
              scopes.map((scope, scopeIndex) => (
                <span className="contents" key={scope}>
                  {scopeIndex > 0 ? <span className="text-xs text-muted-foreground">+</span> : null}
                  <Badge variant="secondary">
                    <code>{scope}</code>
                  </Badge>
                </span>
              ))
            ) : (
              <Badge variant="outline">{tt('Authenticated')}</Badge>
            )}
          </span>
        </span>
      ))}
    </div>
  )
}

function ResourceAuthority({
  organizationId,
  mode,
  resource,
}: {
  organizationId?: string
  mode: 'native' | 'external'
  resource: ApiResource
}) {
  const rolesQuery = useQuery({
    enabled: mode === 'native' && Boolean(organizationId),
    queryFn: () => listRoles(organizationId!),
    queryKey: [...consoleQueryKeys.roles, organizationId],
  })
  const roles = rolesQuery.data?.roles ?? []
  if (mode === 'external') {
    return (
      <div className="detailFlatRows">
        <DetailRow label="Authority source" value={tt('External OIDC provider')} />
        <DetailRow label="Issuer" value={<code>{resource.authorization?.issuer ?? tt('Not configured')}</code>} />
        <DetailRow
          label="Connection status"
          value={resource.authorization ? tt(resource.authorization.status) : tt('Not configured')}
        />
        <DetailRow
          label="Client registration"
          value={resource.authorization ? tt(resource.authorization.registrationMode) : tt('Not configured')}
        />
      </div>
    )
  }
  if (rolesQuery.isLoading) {
    return <LoadingState label={tt('Loading roles and grants')} />
  }
  const error = rolesQuery.error
  if (error) {
    return <ErrorState error={error} onRetry={() => rolesQuery.refetch()} />
  }
  const rows = roles.flatMap((role) => {
    const permissions = role.scopes.filter((permission) => permission.resourceId === resource.id)
    if (!permissions.length) return []
    return [
      {
        permissions,
        role,
      },
    ]
  })
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Role')}</TableHead>
            <TableHead>{tt('Permissions from this server')}</TableHead>
            <TableHead>{tt('Assignment model')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map(({ permissions, role }) => (
              <TableRow key={role.key}>
                <TableCell>
                  {organizationId ? (
                    <Link
                      className="font-medium hover:underline"
                      params={{ organizationId, roleId: role.key }}
                      to="/organizations/$organizationId/roles/$roleId"
                    >
                      {role.displayName}
                    </Link>
                  ) : (
                    <span className="font-medium">{role.displayName}</span>
                  )}
                  <code className="mt-0.5 block text-xs text-muted-foreground">{role.key}</code>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {permissions.map((permission) => (
                      <Badge key={permission.scope} variant="secondary">
                        <code>{permission.scope}</code>
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{tt('Human members only')}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={3}
              description={tt('Add one of this server’s scopes to an Organization Role to make it reusable.')}
              title={tt('No Roles use this server')}
            />
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function ResourceSettings({
  connectors,
  mode,
  onArchive,
  onEditConnector,
  onEditDetails,
  onEditVisibility,
  onRestore,
  onToggle,
  organizations,
  resource,
}: {
  connectors: ConnectorResponse[]
  mode: 'native' | 'external'
  onArchive: () => void
  onEditConnector: () => void
  onEditDetails: () => void
  onEditVisibility: () => void
  onRestore: () => void
  onToggle: () => void
  organizations: OrganizationResponse[]
  resource: ApiResource
}) {
  const connectorId = resource.authorization?.connectorId ?? resource.connectorId
  const connector = connectors.find((candidate) => candidate.id === connectorId)
  if (resource.archivedAt)
    return (
      <div className="detailFlatRows">
        <DetailRow
          action={<Button onClick={onRestore}>{tt('Restore resource server')}</Button>}
          description="Restoring returns this server as a disabled draft; previous authority is not restored."
          label="Archived resource server"
          value={formatDate(resource.archivedAt)}
        />
      </div>
    )
  return (
    <div className="detailSections">
      <DetailSection
        action={
          <Button onClick={onEditDetails} variant="outline">
            {tt('Edit')}
          </Button>
        }
        description="Identity and protected URL used to recognize this API."
        title="Resource server details"
      >
        <DetailRow label="Name" value={resource.name} />
        <DetailRow label="Identifier" value={<code>{resource.identifier}</code>} />
        <DetailRow label="Protected resource URL" value={<code>{resource.resourceUrl}</code>} />
        <DetailRow label="Description" value={resource.description ?? tt('Not configured')} />
      </DetailSection>
      {mode === 'external' ? (
        <DetailSection
          action={
            <Button onClick={onEditConnector} variant="outline">
              {tt('Edit')}
            </Button>
          }
          description="Reusable OIDC connection used for account authorization and Agent token exchange."
          title="Authorization provider"
        >
          <DetailRow
            label="Connector"
            value={
              connectorId ? (
                <span className="grid gap-0.5">
                  <span>{connector?.displayName ?? connectorId}</span>
                  {connector ? <code className="text-xs text-muted-foreground">{connectorId}</code> : null}
                </span>
              ) : (
                '—'
              )
            }
          />
          <DetailRow label="Issuer" value={resource.authorization?.issuer ?? '—'} />
          <DetailRow
            label="Authorization detail templates"
            value={
              resource.authorizationDetails.length > 0 ? (
                <pre className="max-w-md overflow-x-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(resource.authorizationDetails, null, 2)}
                </pre>
              ) : (
                tt('Not configured')
              )
            }
          />
          <DetailRow label="Connection status" value={resource.authorization?.status ?? tt('Pending validation')} />
        </DetailSection>
      ) : null}
      <DetailSection
        action={
          <Button onClick={onEditVisibility} variant="outline">
            {tt('Edit')}
          </Button>
        }
        description="Choose the responsible Organization and whether this server is private or public. Visibility never grants scopes."
        title="Ownership & access"
      >
        <DetailRow label="Owner" value={ownerLabel(resource.ownerOrganizationId, organizations)} />
        <DetailRow label="Visibility" value={resourceVisibilityLabel(resource.visibility)} />
        <DetailRow
          label="Available to Agents"
          value={<Switch checked={resource.availableToAgents} disabled aria-label={tt('Available to Agents')} />}
        />
      </DetailSection>
      <DetailSection
        description="Control availability and permanently revoke active Realmroot authority."
        title="Lifecycle"
      >
        <DetailRow
          action={
            <Button onClick={onToggle} variant={resource.enabled ? 'destructive' : 'outline'}>
              {resource.enabled ? tt('Disable') : tt('Enable')}
            </Button>
          }
          description="Disabling blocks new access while preserving configuration and grants."
          label="Resource server status"
          value={
            <Badge variant={resource.enabled ? 'secondary' : 'outline'}>
              {resource.enabled ? tt('Enabled') : tt('Disabled')}
            </Badge>
          }
        />
        <DetailRow
          action={
            <Button onClick={onArchive} variant="destructive">
              {tt('Archive')}
            </Button>
          }
          description="Revokes connections, grants, requests, and token leases while preserving audit history."
          label="Archive resource server"
          value={tt('Permanent revocation')}
        />
      </DetailSection>
    </div>
  )
}

function ResourceEditorSheet({
  connectors,
  editor,
  error,
  fixedOwnerOrganizationId,
  onClose,
  onSave,
  organizations,
  pending,
  resource,
}: {
  connectors: Array<{ id: string; displayName: string; issuer: string | null; enabled: boolean }>
  editor: ResourceEditor
  error?: string | null
  fixedOwnerOrganizationId?: string
  onClose: () => void
  onSave: (input: Parameters<typeof updateApiResource>[1]) => void
  organizations: OrganizationResponse[]
  pending: boolean
  resource: ApiResource
}) {
  const [ownerOrganizationId, setOwnerOrganizationId] = useState(resource.ownerOrganizationId)
  const [visibility, setVisibility] = useState<ApiResourceVisibility>(resource.visibility)
  const [agents, setAgents] = useState(resource.availableToAgents)
  const [authorizationDetails, setAuthorizationDetails] = useState(
    JSON.stringify(resource.authorizationDetails, null, 2),
  )
  const [validationError, setValidationError] = useState<string | null>(null)
  useEffect(() => {
    setValidationError(null)
    setAuthorizationDetails(JSON.stringify(resource.authorizationDetails, null, 2))
    if (editor !== 'visibility') return
    setOwnerOrganizationId(resource.ownerOrganizationId)
    setVisibility(resource.visibility)
    setAgents(resource.availableToAgents)
  }, [editor, resource])
  const formId = editor ? `resource-${editor}` : undefined
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={editor !== null}
    >
      <SheetContent className="h-full overflow-hidden sm:max-w-xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>
            {tt(
              editor === 'details'
                ? 'Edit resource server'
                : editor === 'connector'
                  ? 'Change authorization provider'
                  : 'Edit ownership & access',
            )}
          </SheetTitle>
          <SheetDescription>
            {tt(
              editor === 'details'
                ? 'Update the protected API identity and URL.'
                : editor === 'connector'
                  ? 'Choose the configured OIDC connector used by this external server.'
                  : 'Set the responsible Organization and who may request access without changing their permissions.',
            )}
          </SheetDescription>
        </SheetHeader>
        {editor === 'details' ? (
          <form
            className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-5"
            id={formId}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              onSave(
                parseForm(updateApiResourceRequestSchema, {
                  name: form.get('name'),
                  identifier: form.get('identifier'),
                  resourceUrl: form.get('resourceUrl'),
                  description: nullableString(String(form.get('description') ?? '')),
                }),
              )
            }}
          >
            <Field label={tt('Name')}>
              <TextInput defaultValue={resource.name} name="name" required />
            </Field>
            <Field label={tt('Identifier')}>
              <TextInput defaultValue={resource.identifier} name="identifier" required />
            </Field>
            <Field label={tt('Protected resource URL')}>
              <TextInput defaultValue={resource.resourceUrl} name="resourceUrl" required type="url" />
            </Field>
            <Field label={tt('Description')}>
              <TextArea defaultValue={resource.description ?? ''} name="description" rows={4} />
            </Field>
          </form>
        ) : null}
        {editor === 'connector' ? (
          <form
            className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-5"
            id={formId}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              try {
                setValidationError(null)
                onSave({
                  connectorId: String(new FormData(event.currentTarget).get('connectorId') ?? ''),
                  authorizationDetails: parseAuthorizationDetails(authorizationDetails),
                })
              } catch (submitError) {
                setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
              }
            }}
          >
            <Field label={tt('OIDC connector')}>
              <SelectInput defaultValue={resource.connectorId ?? ''} name="connectorId" required>
                {connectors.map((connector) => (
                  <option disabled={!connector.enabled} key={connector.id} value={connector.id}>
                    {connector.displayName} — {connector.issuer}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field
              help={tt(
                'Opaque RFC 9396 templates sent to the authorization server. Each array entry must contain a non-empty type.',
              )}
              label={tt('Authorization detail templates')}
            >
              <TextArea
                aria-label={tt('Authorization detail templates')}
                name="authorizationDetails"
                onChange={(event) => setAuthorizationDetails(event.target.value)}
                rows={10}
                value={authorizationDetails}
              />
            </Field>
          </form>
        ) : null}
        {editor === 'visibility' ? (
          <form
            className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-5"
            id={formId}
            onSubmit={(event) => {
              event.preventDefault()
              onSave({
                ownerOrganizationId,
                visibility,
                availableToAgents: agents,
              })
            }}
          >
            {fixedOwnerOrganizationId ? null : (
              <OrganizationOwnerField
                onChange={setOwnerOrganizationId}
                organizations={organizations}
                value={ownerOrganizationId}
              />
            )}
            <Field
              help={tt(
                'Visibility never grants scopes; grant modes, direct grants, and optional Roles determine authority.',
              )}
              label={tt('Visibility')}
            >
              <SelectInput
                onChange={(event) => setVisibility(event.target.value as ApiResourceVisibility)}
                value={visibility}
              >
                <option value="private">{tt('Owner Organization only')}</option>
                <option value="public">{tt('All authenticated users and Organizations')}</option>
              </SelectInput>
            </Field>
            <div className="flex items-start justify-between gap-4">
              <span>
                <strong className="block text-sm">{tt('Available to Agents')}</strong>
                <small className="text-muted-foreground">
                  {tt('Eligible Agent identities may discover and request these scopes.')}
                </small>
              </span>
              <Switch aria-label={tt('Available to Agents')} checked={agents} onCheckedChange={setAgents} />
            </div>
          </form>
        ) : null}
        {(validationError ?? error) ? (
          <p className="px-4 text-sm text-destructive" role="alert">
            {validationError ?? error}
          </p>
        ) : null}
        <SheetFooter className="shrink-0">
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending} form={formId} type="submit">
            {pending ? tt('Saving…') : tt('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function DetailSection({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode
  children: ReactNode
  description: string
  title: string
}) {
  return (
    <section className="detailSection">
      <header>
        <div>
          <h2>{tt(title)}</h2>
          <p>{tt(description)}</p>
        </div>
        {action}
      </header>
      <div className="detailFlatRows">{children}</div>
    </section>
  )
}

function parseAuthorizationDetails(value: string) {
  return authorizationDetailsSchema.parse(JSON.parse(value))
}

function DetailRow({
  action,
  description,
  label,
  value,
}: {
  action?: ReactNode
  description?: string
  label: string
  value: ReactNode
}) {
  return (
    <div className="detailFlatRow">
      <div>
        <strong>{tt(label)}</strong>
        {description ? <span>{tt(description)}</span> : null}
      </div>
      <span>{value}</span>
      {action ?? <i />}
    </div>
  )
}
