import {
  type ApplicationResponse,
  createApplicationRequestSchema,
  replaceRedirectUrisRequestSchema,
  updateApplicationRequestSchema,
} from '@shared/api/applications'
import {
  type assignRoleRequestSchema,
  createApiPermissionRequestSchema,
  createApiResourceRequestSchema,
  createApiScopeRequestSchema,
  createOrganizationRequestSchema,
  createRoleRequestSchema,
  tokenClaimsSchema,
  updateApiPermissionRequestSchema,
  updateApiResourceRequestSchema,
  updateApiScopeRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { hostedCustomCssSchema } from '@shared/api/configz'
import type { ConnectorResponse, ConnectorTemplate } from '@shared/api/connectors'
import {
  createManagementConnectorRequestSchema,
  type ManagementReadinessItem,
  type ManagementUserResponse,
  managementCreateUserRequestSchema,
  managementUpdateUserRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementConnectorRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  ImageUp,
  ListChecks,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  Undo2,
} from 'lucide-react'
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from 'react'
import type { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  adminQueryKeys,
  assignApplicationRole,
  assignMemberRole,
  assignUserRole,
  banUser,
  createApiPermission,
  createApiResource,
  createApiScope,
  createApplication,
  createConnector,
  createOrganization,
  createRole,
  createUser,
  deleteApiPermission,
  deleteApiResource,
  deleteApiScope,
  deleteApplication,
  deleteConnector,
  deleteRole,
  deleteUser,
  deleteUserPasskey,
  getAdminDashboard,
  getAdminReadiness,
  getApiResource,
  getApplication,
  getBrandingSettings,
  getConnector,
  getConnectorReadiness,
  getRole,
  getSecurityPolicy,
  getSignInSettings,
  getUser,
  getUserSecurity,
  listApiPermissions,
  listApiResources,
  listApiScopes,
  listApplicationClientSecrets,
  listApplications,
  listConnectors,
  listConnectorTemplates,
  listOrganizations,
  listRolePermissions,
  listRoles,
  listUserApplications,
  listUserLinkedAccounts,
  listUserPasskeys,
  listUserSessions,
  listUsers,
  replaceApplicationRedirectUris,
  replaceRolePermissions,
  requestPasswordReset,
  requestUserPasswordReset,
  revokeUserSession,
  revokeUserSessions,
  rotateApplicationClientSecret,
  unbanUser,
  updateApiPermission,
  updateApiResource,
  updateApiScope,
  updateApplication,
  updateBrandingSettings,
  updateConnector,
  updateRole,
  updateSignInSettings,
  updateUser,
  uploadApplicationLogo,
  uploadBrandingFavicon,
  uploadBrandingLogo,
  uploadOrganizationLogo,
} from '@/lib/api/management'
import { cn } from '@/lib/utils'

type FormState = Record<string, string>

const emptyForm: FormState = {}
const tokenClaimsObjectSchema = tokenClaimsSchema.optional()
const optionalAuthorizationFieldNames = new Set([
  'description',
  'tokenClaimName',
  'tokenClaimValue',
  'tokenClaimsNamespace',
])

export function AdminDashboardPage() {
  const query = useQuery({ queryKey: adminQueryKeys.dashboard, queryFn: getAdminDashboard })

  if (query.isLoading) return <LoadingState label="Loading Console dashboard" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />

  const dashboard = query.data
  if (!dashboard) return null

  return (
    <>
      <PageHeader
        breadcrumb={['Overview']}
        eyebrow="Dashboard"
        title="Tenant health"
        description="Track identity volume, setup readiness, activity signals, and standards-based integration metadata."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          detail="Tenant identities available to hosted auth."
          label="Total users"
          value={dashboard.users.pagination.total}
        />
        <MetricCard
          detail="Users created in the last 24 hours. Activity API pending."
          label="New users"
          pending
          value="--"
        />
        <MetricCard
          detail="Daily and weekly active users. Activity API pending."
          label="Active users"
          pending
          value="DAU -- / WAU --"
        />
        <MetricCard detail="Monthly active users. Activity API pending." label="Monthly active" pending value="--" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Setup progress</CardTitle>
                <CardDescription>Readiness checklist for operating the tenant in production.</CardDescription>
              </div>
              <Badge variant={dashboard.applications.pagination.total > 0 ? 'secondary' : 'outline'}>
                {dashboard.applications.pagination.total > 0 ? 'Ready' : 'Action needed'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SetupItem
              complete={dashboard.applications.pagination.total > 0}
              label="Create an OIDC application"
              value={dashboard.applications.pagination.total > 0 ? 'Client configured' : 'Required before app sign-in'}
            />
            <SetupItem
              complete={dashboard.connectors.pagination.total > 0}
              label="Configure identity connectors"
              value={dashboard.connectors.pagination.total > 0 ? 'Connector available' : 'Password sign-in still works'}
            />
            <SetupItem
              complete={dashboard.security.policy.passkeys.enabled || dashboard.security.policy.mfa.mode === 'required'}
              label="Review security policy"
              value={`MFA ${dashboard.security.policy.mfa.mode}; passkeys ${
                dashboard.security.policy.passkeys.enabled ? 'enabled' : 'disabled'
              }`}
            />
            <SetupItem
              complete={dashboard.users.pagination.total > 0}
              label="Invite or create users"
              value={`${dashboard.users.pagination.total} user${dashboard.users.pagination.total === 1 ? '' : 's'}`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>OIDC endpoints</CardTitle>
            <CardDescription>Use discovery for client configuration and environment validation.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <SettingRow label="Issuer" value={`${window.location.origin}/api/auth`} />
            <SettingRow
              label="Discovery"
              value={`${window.location.origin}/api/auth/.well-known/openid-configuration`}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => window.open('/api/auth/.well-known/openid-configuration', '_blank', 'noopener')}
                type="button"
                variant="secondary"
              >
                <ExternalLink data-icon="inline-start" />
                Discovery
              </Button>
              <Button
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/auth`)}
                type="button"
                variant="ghost"
              >
                <Copy data-icon="inline-start" />
                Copy issuer
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <DashboardListCard
          description="Most recent OIDC clients and operational state."
          empty="Create an application to start routing sign-in requests."
          title="Recent applications"
        >
          {dashboard.applications.applications.slice(0, 4).map((application) => (
            <SummaryRow
              key={application.id}
              meta={application.clientId}
              status={<StatusBadge active={!application.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />}
              title={application.name}
            />
          ))}
        </DashboardListCard>
        <DashboardListCard
          description="Recent identities available to the tenant."
          empty="Create a user to verify account-center flows."
          title="Recent users"
        >
          {dashboard.users.users.slice(0, 4).map((user) => (
            <SummaryRow
              key={user.id}
              meta={user.email ?? user.id}
              status={<StatusBadge active={!user.banned} activeLabel="Active" inactiveLabel="Banned" />}
              title={user.name ?? user.email ?? user.id}
            />
          ))}
        </DashboardListCard>
        <DashboardListCard
          description="Identity providers available in hosted auth."
          empty="Add a connector when social or OAuth sign-in is needed."
          title="Connectors"
        >
          {dashboard.connectors.connectors.slice(0, 4).map((connector) => (
            <SummaryRow
              key={connector.id}
              meta={connector.providerId}
              status={<StatusBadge active={connector.enabled} activeLabel="Enabled" inactiveLabel="Disabled" />}
              title={connector.displayName}
            />
          ))}
        </DashboardListCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Security status</CardTitle>
            <CardDescription>Current tenant security policy from the management boundary.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <SettingRow label="MFA policy" value={dashboard.security.policy.mfa.mode} />
            <SettingRow label="Passkeys" value={dashboard.security.policy.passkeys.enabled ? 'Enabled' : 'Disabled'} />
            <SettingRow label="Session lifetime" value={`${dashboard.security.policy.sessions.expiresInSeconds}s`} />
            <SettingRow
              label="Password sign-in"
              value={dashboard.signIn.signIn.passwordEnabled ? 'Enabled' : 'Disabled'}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Health signals</CardTitle>
            <CardDescription>Signals that affect production readiness and operations.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <HealthRow icon={<Server aria-hidden="true" />} label="Runtime" value="Cloudflare Workers" />
            <HealthRow
              icon={<ShieldCheck aria-hidden="true" />}
              label="Sessions"
              value={`${dashboard.security.policy.sessions.freshAgeSeconds}s fresh age`}
            />
            <HealthRow
              icon={<ListChecks aria-hidden="true" />}
              label="Authorization"
              value={`${dashboard.roles.pagination.total} roles, ${dashboard.apiResources.pagination.total} API resources`}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}

export function ApplicationsPage() {
  const query = useQuery({ queryKey: adminQueryKeys.applications, queryFn: listApplications })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedTab, setSelectedTab] = useState<'my-apps' | 'third-party'>('my-apps')
  const [search, setSearch] = useState('')
  const [createdSecret, setCreatedSecret] = useState<{ clientId: string; clientSecret: string } | null>(null)
  const createMutation = useAdminMutation({
    mutationFn: createApplication,
    onSuccess: (application) => {
      setDialogOpen(false)
      if (application.clientSecret) {
        setCreatedSecret({ clientId: application.clientId, clientSecret: application.clientSecret })
      }
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.readiness }),
      ])
    },
  })
  const logoMutation = useAdminMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => uploadApplicationLogo(id, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications }),
  })
  const applications = query.data?.applications ?? []
  const visibleApplications = applications.filter((application) => {
    const matchesTab = selectedTab === 'my-apps' ? application.firstParty : !application.firstParty
    const matchesSearch =
      search.trim().length === 0 ||
      [application.name, application.clientId, application.slug].some((value) =>
        value.toLowerCase().includes(search.trim().toLowerCase()),
      )
    return matchesTab && matchesSearch
  })

  return (
    <ResourcePage
      title="Applications"
      description="Manage OIDC clients, redirect URIs, grant types, and client security posture."
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" />
          New application
        </Button>
      }
      auxiliary={
        <>
          <CreateApplicationDialog
            error={createMutation.errorMessage}
            onClose={() => setDialogOpen(false)}
            onSubmit={createMutation.mutate}
            open={dialogOpen}
            pending={createMutation.isPending}
          />
          <SecretDisclosureDialog
            clientId={createdSecret?.clientId ?? null}
            clientSecret={createdSecret?.clientSecret ?? null}
            onClose={() => setCreatedSecret(null)}
            open={createdSecret !== null}
          />
        </>
      }
      error={query.error}
      empty={applications.length === 0}
      emptyDescription="Create your first OIDC client to connect an application to hosted authentication."
      emptyTitle="No applications yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <Tabs setValue={(value) => setSelectedTab(value as 'my-apps' | 'third-party')} value={selectedTab}>
        <div className="consoleToolbar border-b border-border p-4">
          <TabsList aria-label="Application lists">
            <TabsTrigger value="my-apps">My apps</TabsTrigger>
            <TabsTrigger value="third-party">Third-party apps</TabsTrigger>
          </TabsList>
          <TextInput
            aria-label="Search applications"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search applications"
            value={search}
          />
        </div>
        <TabsContent value="my-apps">
          <ApplicationsTableContent
            applications={visibleApplications}
            emptyDescription={
              search
                ? 'No applications match the current search in this tab.'
                : 'Applications created by external publishers will appear here when available.'
            }
            emptyTitle={search ? 'No applications found' : 'No applications in this tab'}
            hasApplications={applications.length > 0}
            onLogoFile={(id, file) => logoMutation.mutate({ id, file })}
            onToggleDisabled={(application) =>
              updateApplication(application.id, { disabled: !application.disabled }).then(() =>
                queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications }),
              )
            }
          />
        </TabsContent>
        <TabsContent value="third-party">
          <ApplicationsTableContent
            applications={visibleApplications}
            emptyDescription={
              search
                ? 'No applications match the current search in this tab.'
                : 'Applications created by external publishers will appear here when available.'
            }
            emptyTitle={search ? 'No applications found' : 'No applications in this tab'}
            hasApplications={applications.length > 0}
            onLogoFile={(id, file) => logoMutation.mutate({ id, file })}
            onToggleDisabled={(application) =>
              updateApplication(application.id, { disabled: !application.disabled }).then(() =>
                queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications }),
              )
            }
          />
        </TabsContent>
      </Tabs>
      {logoMutation.errorMessage ? <p className="p-4 text-sm text-destructive">{logoMutation.errorMessage}</p> : null}
    </ResourcePage>
  )
}

export function ApplicationDetailPage({ applicationId }: { applicationId: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState<'settings' | 'branding'>('settings')
  const query = useQuery({
    queryKey: [...adminQueryKeys.applications, applicationId],
    queryFn: () => getApplication(applicationId),
  })
  const secretsQuery = useQuery({
    queryKey: [...adminQueryKeys.applications, applicationId, 'client-secrets'],
    queryFn: () => listApplicationClientSecrets(applicationId),
    enabled: query.data?.public === false,
  })
  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof updateApplicationRequestSchema>) => updateApplication(applicationId, input),
    onSuccess: (application) => {
      queryClient.setQueryData([...adminQueryKeys.applications, applicationId], application)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications })
    },
  })
  const redirectMutation = useMutation({
    mutationFn: (input: z.infer<typeof replaceRedirectUrisRequestSchema>) =>
      replaceApplicationRedirectUris(applicationId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.applications, applicationId] }),
  })
  const rotateMutation = useMutation({
    mutationFn: () => rotateApplicationClientSecret(applicationId),
    onSuccess: (result) => {
      setRotatedSecret(result.clientSecret)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.applications, applicationId] }),
        queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.applications, applicationId, 'client-secrets'] }),
      ])
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteApplication(applicationId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.readiness }),
      ])
      await navigate({ to: '/console/applications' })
    },
  })
  const logoMutation = useAdminMutation({
    mutationFn: (file: File) => uploadApplicationLogo(applicationId, file),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.applications, applicationId] }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications }),
      ]),
  })

  const application = query.data

  return (
    <ResourcePage
      title={application?.name ?? 'Application'}
      description="Review client configuration, manage redirect URIs, rotate confidential secrets, and copy standard OIDC integration details."
      framed={false}
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {application ? (
        <div className="consoleDetailStack">
          <Link className="consoleBackLink" to="/console/applications">
            <Undo2 data-icon="inline-start" />
            Back to applications
          </Link>
          <ObjectHeader
            badge={clientTypeLabel(application.clientType)}
            id={application.clientId}
            title={application.name}
          />
          <Tabs setValue={(value) => setSelectedTab(value as 'settings' | 'branding')} value={selectedTab}>
            <TabsList aria-label="Application detail sections">
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="branding">Branding</TabsTrigger>
            </TabsList>
            <TabsContent className="mt-4" value="settings">
              <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>General settings</CardTitle>
                    <CardDescription>Required display metadata and client classification.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="formStack"
                      key={`${application.id}-${application.updatedAt}`}
                      onSubmit={(event) => {
                        event.preventDefault()
                        const form = new FormData(event.currentTarget)
                        updateMutation.mutate(
                          parseForm(updateApplicationRequestSchema, {
                            name: form.get('name'),
                            description: nullableString(String(form.get('description') ?? '')),
                          }),
                        )
                      }}
                    >
                      <Field label="Application name">
                        <TextInput defaultValue={application.name} name="name" required />
                      </Field>
                      <Field label="Description">
                        <TextArea defaultValue={application.description ?? ''} name="description" rows={3} />
                      </Field>
                      <SettingRow label="App ID" value={application.clientId} />
                      <SettingRow label="Type" value={clientTypeLabel(application.clientType)} />
                      <SettingRow label="Status" value={application.disabled ? 'Disabled' : 'Enabled'} />
                      <StickyActionBar>
                        <Button disabled={updateMutation.isPending} type="submit">
                          <Save data-icon="inline-start" />
                          Save changes
                        </Button>
                        <Button disabled={updateMutation.isPending} type="reset" variant="secondary">
                          Discard
                        </Button>
                      </StickyActionBar>
                      <MutationError error={updateMutation.error} />
                    </form>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Redirects and origins</CardTitle>
                    <CardDescription>
                      Callbacks backed by the current API plus pending integration surfaces.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="formStack"
                      key={application.updatedAt}
                      onSubmit={(event) => {
                        event.preventDefault()
                        const form = new FormData(event.currentTarget)
                        redirectMutation.mutate(
                          parseForm(replaceRedirectUrisRequestSchema, {
                            redirectUris: String(form.get('redirectUris') ?? '')
                              .split('\n')
                              .filter(Boolean),
                          }),
                        )
                      }}
                    >
                      <Field label="Redirect URIs" help="One URI per line.">
                        <TextArea
                          defaultValue={application.redirectUris.join('\n')}
                          name="redirectUris"
                          required
                          rows={5}
                        />
                      </Field>
                      <Field label="Post sign-out redirect URIs" help="Pending API support.">
                        <TextArea disabled placeholder="No sign-out redirects configured" rows={3} />
                      </Field>
                      <Field label="CORS origins" help="Pending API support.">
                        <TextArea disabled placeholder="No CORS origins configured" rows={3} />
                      </Field>
                      <StickyActionBar>
                        <Button disabled={redirectMutation.isPending} type="submit">
                          Save redirect URIs
                        </Button>
                        <Button disabled={redirectMutation.isPending} type="reset" variant="secondary">
                          Discard
                        </Button>
                      </StickyActionBar>
                      <MutationError error={redirectMutation.error} />
                    </form>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Endpoints and credentials</CardTitle>
                    <CardDescription>Use these values with any standards-compliant OIDC SDK.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <SettingRow label="Auth method" value={application.tokenEndpointAuthMethod} />
                    <SettingRow label="PKCE" value={application.requirePkce ? 'Required' : 'Optional'} />
                    <SettingRow label="Issuer" value={application.oidc.issuer} />
                    <SettingRow
                      label="Discovery"
                      value={`${application.oidc.issuer}/.well-known/openid-configuration`}
                    />
                    <SettingRow label="Authorization endpoint" value={application.oidc.authorizationEndpoint} />
                    <SettingRow label="Token endpoint" value={application.oidc.tokenEndpoint} />
                    <SettingRow label="UserInfo endpoint" value={application.oidc.userInfoEndpoint} />
                    <SettingRow label="JWKS URI" value={application.oidc.jwksUri} />
                    <CopyButton label="Copy client config" value={clientConfig(application, rotatedSecret)} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Client secrets</CardTitle>
                    <CardDescription>
                      Raw secrets are only shown once immediately after creation or rotation.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {application.public ? (
                      <SettingRow label="Secret behavior" value="No client secret is issued for public clients." />
                    ) : (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Version</TableHead>
                              <TableHead>Prefix</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Created</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {secretsQuery.data?.secrets.map((secret) => (
                              <TableRow key={secret.id}>
                                <TableCell>{secret.version}</TableCell>
                                <TableCell>{secret.prefix ?? 'Hidden'}</TableCell>
                                <TableCell>{secret.status}</TableCell>
                                <TableCell>{formatDate(secret.createdAt)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <Button
                          disabled={rotateMutation.isPending}
                          onClick={() => rotateMutation.mutate()}
                          type="button"
                        >
                          Rotate client secret
                        </Button>
                        <MutationError error={secretsQuery.error ?? rotateMutation.error} />
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Advanced options</CardTitle>
                    <CardDescription>
                      Current grant data plus pending non-destructive configuration controls.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <SettingRow label="Grant types" value={application.allowedGrantTypes.join(', ')} />
                    <SettingRow label="Scopes" value={application.allowedScopes.join(' ')} />
                    <SettingRow
                      label="Refresh tokens"
                      value={application.allowedScopes.includes('offline_access') ? 'Allowed by scope' : 'Not enabled'}
                    />
                    <SettingRow label="Backchannel logout" value="Pending API support" />
                    <SettingRow label="Token exchange" value="Pending API support" />
                    <SettingRow label="Concurrent device limit" value="Pending API support" />
                    <Field label="Custom data JSON" help="Pending API support.">
                      <TextArea disabled placeholder="{}" rows={4} />
                    </Field>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Lifecycle</CardTitle>
                    <CardDescription>
                      Disable clients before deleting them when integrations are still active.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <SettingRow label="Reason" value={application.disabledReason ?? 'Not set'} />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            disabled: !application.disabled,
                            disabledReason: application.disabled ? null : 'Disabled from Console',
                          })
                        }
                        type="button"
                        variant="secondary"
                      >
                        {application.disabled ? 'Enable application' : 'Disable application'}
                      </Button>
                      <Button
                        disabled={deleteMutation.isPending}
                        onClick={() => setDeleteDialogOpen(true)}
                        type="button"
                        variant="danger"
                      >
                        <Trash2 data-icon="inline-start" />
                        Delete application
                      </Button>
                    </div>
                    <MutationError error={updateMutation.error ?? deleteMutation.error} />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent className="mt-4" value="branding">
              <Card>
                <CardHeader>
                  <CardTitle>Application branding</CardTitle>
                  <CardDescription>Logo and display values shown in application and consent surfaces.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <AssetUploadControl
                    accept="image/png,image/jpeg,image/webp"
                    label={`Upload logo for ${application.name}`}
                    onFile={(file) => logoMutation.mutate(file)}
                    previewUrl={application.iconUrl}
                  />
                  <SettingRow label="Display name" value={application.name} />
                  <SettingRow label="Homepage URL" value={application.homepageUrl ?? 'Not set'} />
                  <MutationError error={logoMutation.error} />
                  {logoMutation.errorMessage ? (
                    <p className="text-sm text-destructive">{logoMutation.errorMessage}</p>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
      <SecretDisclosureDialog
        clientId={application?.clientId ?? null}
        clientSecret={rotatedSecret}
        onClose={() => setRotatedSecret(null)}
        open={rotatedSecret !== null}
      />
      <DeleteApplicationDialog
        applicationName={application?.name ?? ''}
        error={deleteMutation.error}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        open={deleteDialogOpen}
        pending={deleteMutation.isPending}
      />
    </ResourcePage>
  )
}

function ApplicationsTableContent({
  applications,
  emptyDescription,
  emptyTitle,
  hasApplications,
  onLogoFile,
  onToggleDisabled,
}: {
  applications: ApplicationResponse[]
  emptyDescription: string
  emptyTitle: string
  hasApplications: boolean
  onLogoFile: (id: string, file: File) => void
  onToggleDisabled: (application: ApplicationResponse) => void
}) {
  if (!applications.length && hasApplications) {
    return <EmptyState description={emptyDescription} title={emptyTitle} />
  }

  if (!applications.length) return null

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Application name</TableHead>
          <TableHead>App ID</TableHead>
          <TableHead>Type</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {applications.map((application) => (
          <TableRow key={application.id}>
            <TableCell>
              <a className="font-medium hover:underline" href={`/console/applications/${application.id}`}>
                {application.name}
              </a>
              <div className="text-xs text-muted-foreground">{application.slug}</div>
              <div className="mt-2">
                <AssetUploadControl
                  accept="image/png,image/jpeg,image/webp"
                  label={`Upload logo for ${application.name}`}
                  onFile={(file) => onLogoFile(application.id, file)}
                  previewUrl={application.iconUrl}
                />
              </div>
            </TableCell>
            <TableCell>
              <code className="text-xs">{application.clientId}</code>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{clientTypeLabel(application.clientType)}</Badge>
                <StatusBadge active={!application.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{application.allowedGrantTypes.join(', ')}</div>
            </TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger aria-label={`Actions for ${application.name}`}>
                  <MoreHorizontal data-icon="inline-start" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => onToggleDisabled(application)}>
                      {application.disabled ? 'Enable' : 'Disable'}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function AdminOnboardingPage() {
  const queryClient = useQueryClient()
  const readinessQuery = useQuery({ queryKey: adminQueryKeys.readiness, queryFn: getAdminReadiness })
  const [form, setForm] = useState({
    name: 'Customer portal',
    slug: 'customer-portal',
    redirectUris: `${window.location.origin}/oidc/callback`,
  })
  const createMutation = useAdminMutation({
    mutationFn: createApplication,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications }),
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.readiness }),
      ]),
  })
  const application = createMutation.data

  return (
    <ResourcePage
      title="Console setup"
      description="Complete required setup gates, then review production recommendations without blocking the Console."
      error={readinessQuery.error ?? createMutation.error}
      framed={false}
      loading={readinessQuery.isLoading}
      onRetry={() => readinessQuery.refetch()}
    >
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Setup checklist</CardTitle>
                <CardDescription>
                  Required items unlock Console routes. Recommended items prepare production.
                </CardDescription>
              </div>
              <Badge variant={readinessQuery.data?.admin?.setupRequired ? 'outline' : 'secondary'}>
                {readinessQuery.data?.admin?.setupRequired ? 'Action needed' : 'Ready'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SetupChecklist items={readinessQuery.data?.required ?? []} title="Required" />
            <SetupChecklist items={readinessQuery.data?.recommended ?? []} title="Recommended" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>First OIDC application</CardTitle>
            <CardDescription>Use a localhost or review-environment callback while validating the flow.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="formStack"
              onSubmit={(event) => {
                event.preventDefault()
                createMutation.mutate(
                  parseForm(createApplicationRequestSchema, {
                    name: form.name,
                    slug: form.slug,
                    clientType: 'public_spa',
                    firstParty: true,
                    redirectUris: form.redirectUris.split('\n').filter(Boolean),
                  }),
                )
              }}
            >
              <Field label="Application name">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                  required
                  value={form.name}
                />
              </Field>
              <Field label="Slug">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, slug: event.target.value }))}
                  required
                  value={form.slug}
                />
              </Field>
              <Field label="Redirect URIs">
                <TextArea
                  onChange={(event) => setForm((value) => ({ ...value, redirectUris: event.target.value }))}
                  required
                  value={form.redirectUris}
                />
              </Field>
              <Button disabled={createMutation.isPending} type="submit">
                <Plus data-icon="inline-start" />
                Create OIDC client
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Client integration</CardTitle>
            <CardDescription>Use OIDC discovery with authorization code and PKCE.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <SettingRow
              label="Discovery"
              value={`${window.location.origin}/api/auth/.well-known/openid-configuration`}
            />
            <SettingRow label="Issuer" value={`${window.location.origin}/api/auth`} />
            <SettingRow label="Callback" value={form.redirectUris.split('\n')[0] ?? ''} />
            {application ? (
              <>
                <SettingRow label="Client ID" value={application.clientId} />
                <SettingRow label="Auth method" value={application.tokenEndpointAuthMethod} />
                <SettingRow label="Scopes" value={application.allowedScopes.join(' ')} />
              </>
            ) : null}
            <Button
              onClick={() =>
                navigator.clipboard.writeText(
                  JSON.stringify(
                    {
                      issuer: `${window.location.origin}/api/auth`,
                      discoveryUrl: `${window.location.origin}/api/auth/.well-known/openid-configuration`,
                      clientId: application?.clientId ?? '<create-client-first>',
                      redirectUri: form.redirectUris.split('\n')[0] ?? '',
                      scopes: 'openid profile email',
                    },
                    null,
                    2,
                  ),
                )
              }
              type="button"
              variant="secondary"
            >
              <Copy data-icon="inline-start" />
              Copy details
            </Button>
          </CardContent>
        </Card>
      </div>
    </ResourcePage>
  )
}

export function UsersPage() {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [banned, setBanned] = useState('')
  const [offset, setOffset] = useState(0)
  const query = useQuery({
    queryKey: [...adminQueryKeys.users, { search, role, banned, offset }],
    queryFn: () =>
      listUsers({
        ...(search ? { search } : {}),
        ...(role ? { role } : {}),
        ...(banned ? { banned: banned === 'true' } : {}),
        limit: 10,
        offset,
      }),
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const createMutation = useAdminMutation({
    mutationFn: createUser,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })

  return (
    <ResourcePage
      title="Users"
      description="Create users, inspect profile state, reset passwords, and adjust administrative flags."
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" />
          New user
        </Button>
      }
      auxiliary={
        <CreateUserDialog
          error={createMutation.errorMessage}
          onClose={() => setDialogOpen(false)}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          pending={createMutation.isPending}
        />
      }
      error={query.error}
      empty={query.data?.users.length === 0}
      emptyDescription={
        search ? 'No users match the current search.' : 'Create a user to verify sign-in and account-center behavior.'
      }
      emptyTitle={search ? 'No users found' : 'No users yet'}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      toolbar={
        <div className="grid gap-2 sm:grid-cols-[1fr_10rem_10rem]">
          <TextInput
            aria-label="Search users"
            onChange={(event) => {
              setSearch(event.target.value)
              setOffset(0)
            }}
            placeholder="Search users"
            value={search}
          />
          <SelectInput
            aria-label="Filter role"
            onChange={(event) => {
              setRole(event.target.value)
              setOffset(0)
            }}
            value={role}
          >
            <option value="">Any role</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </SelectInput>
          <SelectInput
            aria-label="Filter status"
            onChange={(event) => {
              setBanned(event.target.value)
              setOffset(0)
            }}
            value={banned}
          >
            <option value="">Any status</option>
            <option value="false">Active</option>
            <option value="true">Banned</option>
          </SelectInput>
        </div>
      }
    >
      <div className="grid gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data?.users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <a className="font-medium hover:underline" href={`/console/users/${user.id}`}>
                    {userDisplayName(user)}
                  </a>
                  <div className="text-xs text-muted-foreground">{user.id}</div>
                </TableCell>
                <TableCell>{formatRole(user.role)}</TableCell>
                <TableCell>
                  <div>{user.email ?? 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground">{user.emailVerified ? 'Verified' : 'Unverified'}</div>
                </TableCell>
                <TableCell>{formatDate(user.createdAt)}</TableCell>
                <TableCell>
                  <StatusBadge active={!user.banned} activeLabel="Active" inactiveLabel="Banned" />
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={`Actions for ${user.email ?? user.id}`}>
                      <MoreHorizontal data-icon="inline-start" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuGroup>
                        {user.email ? (
                          <DropdownMenuItem onClick={() => requestPasswordReset(user.email ?? '')}>
                            Send password reset
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          onClick={() =>
                            updateUser(user.id, { role: user.role === 'admin' ? 'user' : 'admin' }).then(() =>
                              queryClient.invalidateQueries({ queryKey: adminQueryKeys.users }),
                            )
                          }
                        >
                          Toggle admin role
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {query.data ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 text-sm text-muted-foreground">
            <span>
              Showing {query.data.pagination.offset + 1}-
              {Math.min(query.data.pagination.offset + query.data.pagination.limit, query.data.pagination.total)} of{' '}
              {query.data.pagination.total}
            </span>
            <div className="flex gap-2">
              <Button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - (query.data?.pagination.limit ?? 10)))}
                type="button"
                variant="secondary"
              >
                Previous
              </Button>
              <Button
                disabled={!query.data.pagination.hasMore || query.data.pagination.nextOffset === null}
                onClick={() => setOffset(query.data?.pagination.nextOffset ?? offset)}
                type="button"
                variant="secondary"
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </ResourcePage>
  )
}

export function UserDetailPage({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [banDialogOpen, setBanDialogOpen] = useState(false)
  const [revokeAllDialogOpen, setRevokeAllDialogOpen] = useState(false)
  const [sessionToRevoke, setSessionToRevoke] = useState<string | null>(null)
  const [passkeyToDelete, setPasskeyToDelete] = useState<string | null>(null)
  const userQuery = useQuery({ queryKey: [...adminQueryKeys.users, userId], queryFn: () => getUser(userId) })
  const sessionsQuery = useQuery({
    queryKey: [...adminQueryKeys.users, userId, 'sessions'],
    queryFn: () => listUserSessions(userId),
  })
  const linkedAccountsQuery = useQuery({
    queryKey: [...adminQueryKeys.users, userId, 'linked-accounts'],
    queryFn: () => listUserLinkedAccounts(userId),
  })
  const applicationsQuery = useQuery({
    queryKey: [...adminQueryKeys.users, userId, 'applications'],
    queryFn: () => listUserApplications(userId),
  })
  const securityQuery = useQuery({
    queryKey: [...adminQueryKeys.users, userId, 'security'],
    queryFn: () => getUserSecurity(userId),
  })
  const passkeysQuery = useQuery({
    queryKey: [...adminQueryKeys.users, userId, 'passkeys'],
    queryFn: () => listUserPasskeys(userId),
  })
  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof managementUpdateUserRequestSchema>) => updateUser(userId, input),
    onSuccess: async (response) => {
      queryClient.setQueryData([...adminQueryKeys.users, userId], response)
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })
  const resetMutation = useMutation({ mutationFn: () => requestUserPasswordReset(userId) })
  const banMutation = useMutation({
    mutationFn: (input: { reason?: string }) => banUser(userId, input),
    onSuccess: async () => {
      setBanDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.users, userId] })
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })
  const unbanMutation = useMutation({
    mutationFn: () => unbanUser(userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.users, userId] })
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteUser(userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users })
      await navigate({ to: '/console/users' })
    },
  })
  const revokeAllMutation = useMutation({
    mutationFn: () => revokeUserSessions(userId),
    onSuccess: async () => {
      setRevokeAllDialogOpen(false)
      await sessionsQuery.refetch()
    },
  })
  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId: string) => revokeUserSession(userId, sessionId),
    onSuccess: () => sessionsQuery.refetch(),
  })
  const deletePasskeyMutation = useMutation({
    mutationFn: (passkeyId: string) => deleteUserPasskey(userId, passkeyId),
    onSuccess: () => Promise.all([passkeysQuery.refetch(), securityQuery.refetch()]),
  })

  const user = userQuery.data?.user

  return (
    <ResourcePage
      title={user ? userDisplayName(user) : 'User'}
      description="Inspect profile, access state, linked accounts, MFA, passkeys, sessions, and account operations."
      framed={false}
      action={
        <Link className="uiButton uiButton-secondary" to="/console/users">
          Back to users
        </Link>
      }
      error={userQuery.error}
      loading={userQuery.isLoading}
      onRetry={() => userQuery.refetch()}
    >
      {user ? (
        <div className="grid gap-4 p-4 xl:grid-cols-[1fr_1fr]">
          <UserProfileCard
            error={updateMutation.error}
            pending={updateMutation.isPending}
            user={user}
            onSubmit={updateMutation.mutate}
          />
          <Card>
            <CardHeader>
              <CardTitle>Account operations</CardTitle>
              <CardDescription>Use confirmations for destructive or security-sensitive actions.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SettingRow label="Status" value={user.banned ? 'Banned' : 'Active'} />
              <SettingRow label="Ban reason" value={user.banReason ?? 'Not set'} />
              <SettingRow label="Ban expires" value={formatDate(user.banExpires ?? undefined)} />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={resetMutation.isPending}
                  onClick={() => resetMutation.mutate()}
                  type="button"
                  variant="secondary"
                >
                  Send password reset
                </Button>
                {user.banned ? (
                  <Button
                    disabled={unbanMutation.isPending}
                    onClick={() => unbanMutation.mutate()}
                    type="button"
                    variant="secondary"
                  >
                    Unban user
                  </Button>
                ) : (
                  <Button onClick={() => setBanDialogOpen(true)} type="button" variant="danger">
                    Ban user
                  </Button>
                )}
                <Button onClick={() => setDeleteDialogOpen(true)} type="button" variant="danger">
                  <Trash2 data-icon="inline-start" />
                  Delete user
                </Button>
              </div>
              <MutationError
                error={resetMutation.error ?? banMutation.error ?? unbanMutation.error ?? deleteMutation.error}
              />
              {resetMutation.isSuccess ? (
                <p className="text-sm text-muted-foreground">Password reset requested.</p>
              ) : null}
            </CardContent>
          </Card>

          <UserSecurityCard
            error={securityQuery.error ?? passkeysQuery.error ?? deletePasskeyMutation.error}
            passkeys={passkeysQuery.data?.passkeys ?? []}
            security={securityQuery.data?.security}
            onDeletePasskey={setPasskeyToDelete}
          />
          <UserSessionsCard
            error={sessionsQuery.error ?? revokeAllMutation.error ?? revokeSessionMutation.error}
            onRevokeAll={() => setRevokeAllDialogOpen(true)}
            onRevokeSession={setSessionToRevoke}
            pending={revokeAllMutation.isPending || revokeSessionMutation.isPending}
            sessions={sessionsQuery.data?.sessions ?? []}
          />
          <UserLinkedAccountsCard
            accounts={linkedAccountsQuery.data?.accounts ?? []}
            error={linkedAccountsQuery.error}
          />
          <UserApplicationsCard
            applications={applicationsQuery.data?.applications ?? []}
            error={applicationsQuery.error}
          />

          <BanUserDialog
            error={banMutation.error}
            onClose={() => setBanDialogOpen(false)}
            onConfirm={(reason) => banMutation.mutate(reason ? { reason } : {})}
            open={banDialogOpen}
            pending={banMutation.isPending}
            userName={userDisplayName(user)}
          />
          <DangerConfirmDialog
            actionLabel="Delete user"
            description={`Deleting ${userDisplayName(user)} removes the account and cannot be undone.`}
            error={deleteMutation.error}
            onClose={() => setDeleteDialogOpen(false)}
            onConfirm={() => deleteMutation.mutate()}
            open={deleteDialogOpen}
            pending={deleteMutation.isPending}
            title="Delete user"
          />
          <DangerConfirmDialog
            actionLabel="Revoke sessions"
            description={`Revoke every active session for ${userDisplayName(user)}.`}
            error={revokeAllMutation.error}
            onClose={() => setRevokeAllDialogOpen(false)}
            onConfirm={() => revokeAllMutation.mutate()}
            open={revokeAllDialogOpen}
            pending={revokeAllMutation.isPending}
            title="Revoke all sessions"
          />
          <DangerConfirmDialog
            actionLabel="Revoke session"
            description={`Revoke session ${sessionToRevoke ?? ''} for ${userDisplayName(user)}.`}
            error={revokeSessionMutation.error}
            onClose={() => setSessionToRevoke(null)}
            onConfirm={() => {
              if (sessionToRevoke) revokeSessionMutation.mutate(sessionToRevoke)
              setSessionToRevoke(null)
            }}
            open={sessionToRevoke !== null}
            pending={revokeSessionMutation.isPending}
            title="Revoke session"
          />
          <DangerConfirmDialog
            actionLabel="Delete passkey"
            description={`Delete passkey ${passkeyToDelete ?? ''} for ${userDisplayName(user)}.`}
            error={deletePasskeyMutation.error}
            onClose={() => setPasskeyToDelete(null)}
            onConfirm={() => {
              if (passkeyToDelete) deletePasskeyMutation.mutate(passkeyToDelete)
              setPasskeyToDelete(null)
            }}
            open={passkeyToDelete !== null}
            pending={deletePasskeyMutation.isPending}
            title="Delete passkey"
          />
        </div>
      ) : null}
    </ResourcePage>
  )
}

function UserProfileCard({
  error,
  onSubmit,
  pending,
  user,
}: {
  error: unknown
  onSubmit: (input: z.infer<typeof managementUpdateUserRequestSchema>) => void
  pending: boolean
  user: ManagementUserResponse
}) {
  const [form, setForm] = useState<FormState>({
    email: user.email ?? '',
    displayName: user.displayName ?? user.name ?? '',
    username: user.username ?? '',
    role: Array.isArray(user.role) ? '' : (user.role ?? 'user'),
    emailVerified: user.emailVerified ? 'true' : 'false',
  })
  const [validationError, setValidationError] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile and access</CardTitle>
        <CardDescription>Edit safe account fields and administrative access state.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="formStack"
          noValidate={true}
          onSubmit={(event) => {
            event.preventDefault()
            try {
              setValidationError(null)
              onSubmit(
                parseForm(managementUpdateUserRequestSchema, {
                  email: form.email,
                  displayName: form.displayName,
                  username: form.username || null,
                  ...(form.role ? { role: form.role } : {}),
                  emailVerified: form.emailVerified === 'true',
                }),
              )
            } catch (submitError) {
              setValidationError(submitError instanceof Error ? submitError.message : 'Invalid form input.')
            }
          }}
        >
          <Field label="Email">
            <TextInput
              onChange={(event) => setValue(setForm, 'email', event.target.value)}
              type="email"
              value={form.email}
            />
          </Field>
          <Field label="Display name">
            <TextInput
              onChange={(event) => setValue(setForm, 'displayName', event.target.value)}
              value={form.displayName}
            />
          </Field>
          <Field label="Username">
            <TextInput onChange={(event) => setValue(setForm, 'username', event.target.value)} value={form.username} />
          </Field>
          <Field label="Role">
            <SelectInput
              disabled={Array.isArray(user.role)}
              onChange={(event) => setValue(setForm, 'role', event.target.value)}
              value={form.role}
            >
              {Array.isArray(user.role) ? <option value="">Multiple roles: {user.role.join(', ')}</option> : null}
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </SelectInput>
          </Field>
          <Field label="Email verification">
            <SelectInput
              onChange={(event) => setValue(setForm, 'emailVerified', event.target.value)}
              value={form.emailVerified}
            >
              <option value="true">Verified</option>
              <option value="false">Unverified</option>
            </SelectInput>
          </Field>
          {validationError ? <MutationError error={validationError} /> : null}
          <MutationError error={error} />
          <Button disabled={pending} type="submit">
            {pending ? 'Saving...' : 'Save profile'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function UserSecurityCard({
  error,
  onDeletePasskey,
  passkeys,
  security,
}: {
  error: unknown
  onDeletePasskey: (passkeyId: string) => void
  passkeys: Array<{
    id: string
    name: string | null
    deviceType: string
    backedUp: boolean
    createdAt: string | Date | null
  }>
  security?: {
    mfa: { enabled: boolean; factors: Array<{ id: string; type: string; verified: boolean | null }> }
    passkeys: { enabled: boolean; count: number }
    policy: { mfa: { mode: string }; passkeys: { enabled: boolean; rpName: string } }
  }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>MFA and passkeys</CardTitle>
        <CardDescription>Overview only; no secret material is exposed.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label="MFA state" value={security?.mfa.enabled ? 'Enabled' : 'Disabled'} />
        <SettingRow label="MFA policy" value={security?.policy.mfa.mode ?? 'Unknown'} />
        <SettingRow label="Passkey policy" value={security?.policy.passkeys.enabled ? 'Enabled' : 'Disabled'} />
        <SettingRow label="Passkey count" value={String(security?.passkeys.count ?? passkeys.length)} />
        {security?.mfa.factors.length ? (
          <div className="grid gap-2">
            {security.mfa.factors.map((factor) => (
              <SummaryRow
                key={factor.id}
                meta={factor.verified ? 'Verified' : 'Unverified'}
                status={<Badge variant="secondary">{factor.type}</Badge>}
                title={factor.id}
              />
            ))}
          </div>
        ) : null}
        <div className="grid gap-2">
          {passkeys.length ? (
            passkeys.map((passkey) => (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                key={passkey.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{passkey.name ?? passkey.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {passkey.deviceType}; {passkey.backedUp ? 'backed up' : 'not backed up'};{' '}
                    {formatDate(passkey.createdAt ?? undefined)}
                  </p>
                </div>
                <Button onClick={() => onDeletePasskey(passkey.id)} type="button" variant="danger">
                  Delete
                </Button>
              </div>
            ))
          ) : (
            <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              No passkeys registered.
            </p>
          )}
        </div>
        <MutationError error={error} />
      </CardContent>
    </Card>
  )
}

function UserSessionsCard({
  error,
  onRevokeAll,
  onRevokeSession,
  pending,
  sessions,
}: {
  error: unknown
  onRevokeAll: () => void
  onRevokeSession: (sessionId: string) => void
  pending: boolean
  sessions: Array<{
    id: string
    expiresAt: string | Date
    createdAt: string | Date
    ipAddress: string | null
    userAgent: string | null
  }>
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Sessions</CardTitle>
            <CardDescription>Revoke one session or require every device to sign in again.</CardDescription>
          </div>
          <Button disabled={pending || sessions.length === 0} onClick={onRevokeAll} type="button" variant="danger">
            Revoke all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {sessions.length ? (
          sessions.map((session) => (
            <div
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              key={session.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{session.userAgent ?? session.id}</p>
                <p className="text-xs text-muted-foreground">
                  {session.ipAddress ?? 'Unknown IP'}; expires {formatDate(session.expiresAt)}
                </p>
              </div>
              <Button disabled={pending} onClick={() => onRevokeSession(session.id)} type="button" variant="danger">
                Revoke
              </Button>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            No active sessions.
          </p>
        )}
        <MutationError error={error} />
      </CardContent>
    </Card>
  )
}

function UserLinkedAccountsCard({
  accounts,
  error,
}: {
  accounts: Array<{ id: string; accountId: string; providerId: string; createdAt: string | Date }>
  error: unknown
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked accounts</CardTitle>
        <CardDescription>External identity accounts connected to this user.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {accounts.length ? (
          accounts.map((account) => (
            <SummaryRow
              key={account.id}
              meta={`${account.accountId}; linked ${formatDate(account.createdAt)}`}
              status={<Badge variant="secondary">{account.providerId}</Badge>}
              title={account.providerId}
            />
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            No linked accounts.
          </p>
        )}
        <MutationError error={error} />
      </CardContent>
    </Card>
  )
}

function UserApplicationsCard({
  applications,
  error,
}: {
  applications: Array<{
    id: string
    applicationName: string
    applicationSlug: string
    scopes: string[]
    grantedAt: string | Date
  }>
  error: unknown
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Authorized applications</CardTitle>
        <CardDescription>OIDC clients with active user consent.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {applications.length ? (
          applications.map((application) => (
            <SummaryRow
              key={application.id}
              meta={`${application.scopes.join(' ')}; granted ${formatDate(application.grantedAt)}`}
              status={<Badge variant="outline">{application.applicationSlug}</Badge>}
              title={application.applicationName}
            />
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            No authorized applications.
          </p>
        )}
        <MutationError error={error} />
      </CardContent>
    </Card>
  )
}

export function PasswordlessConnectorsPage() {
  const signInQuery = useQuery({ queryKey: adminQueryKeys.signIn, queryFn: getSignInSettings })
  const readinessQuery = useQuery({ queryKey: adminQueryKeys.readiness, queryFn: getAdminReadiness })
  const emailReady = readinessQuery.data?.recommended?.some(
    (item) => item.id === 'email_delivery' && item.status === 'complete',
  )

  return (
    <ResourcePage
      title="Passwordless connectors"
      description="Review email and SMS delivery connectors for passwordless hosted authentication."
      error={signInQuery.error ?? readinessQuery.error}
      framed={false}
      loading={signInQuery.isLoading || readinessQuery.isLoading}
      onRetry={() => {
        signInQuery.refetch()
        readinessQuery.refetch()
      }}
    >
      <div className="grid gap-4">
        <div className="inline-flex flex-wrap rounded-lg bg-muted p-1">
          <a
            className="inline-flex min-h-9 items-center justify-center rounded-md bg-background px-3 text-sm font-medium text-foreground shadow-sm"
            href="/console/connectors/passwordless"
          >
            Passwordless
          </a>
          <a
            className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground"
            href="/console/connectors/social"
          >
            Social
          </a>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Email connector</CardTitle>
                  <CardDescription>
                    Email delivery is limited to the configured runtime email service binding.
                  </CardDescription>
                </div>
                <StatusBadge
                  active={emailReady === true}
                  activeLabel="Configured"
                  inactiveLabel={emailReady === false ? 'Unconfigured' : 'Unknown'}
                />
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SettingRow
                label="Magic link"
                value={signInQuery.data?.signIn.magicLinkEnabled ? 'Enabled' : 'Disabled'}
              />
              <SettingRow
                label="Email code"
                value={signInQuery.data?.signIn.emailOtpEnabled ? 'Enabled' : 'Disabled'}
              />
              <SettingRow label="Runtime requirement" value="EMAIL binding and EMAIL_FROM sender must be present." />
              <Button disabled type="button" variant="secondary">
                Email setup unavailable locally
              </Button>
              <p className="text-sm leading-6 text-muted-foreground">
                Email delivery is configured through deployment bindings, so Console does not persist provider setup
                locally.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>SMS connector</CardTitle>
                  <CardDescription>
                    SMS delivery is visible for planning but has no backend connector yet.
                  </CardDescription>
                </div>
                <StatusBadge active={false} activeLabel="Configured" inactiveLabel="Unconfigured" />
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SettingRow label="SMS code" value="Unavailable" />
              <SettingRow label="Backend contract" value="Not available in local runtime" />
              <Button disabled type="button" variant="secondary">
                Setup SMS
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </ResourcePage>
  )
}

export function ConnectorsPage() {
  const query = useQuery({ queryKey: adminQueryKeys.connectors, queryFn: listConnectors })
  const templatesQuery = useQuery({
    queryKey: [...adminQueryKeys.connectors, 'templates'],
    queryFn: listConnectorTemplates,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ConnectorResponse | null>(null)
  const createMutation = useAdminMutation({
    mutationFn: createConnector,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.connectors })
    },
  })
  const detailQuery = useQuery({
    queryKey: [...adminQueryKeys.connectors, selectedConnectorId],
    queryFn: () => getConnector(selectedConnectorId ?? ''),
    enabled: selectedConnectorId !== null,
  })
  const readinessQuery = useQuery({
    queryKey: [...adminQueryKeys.connectors, selectedConnectorId, 'readiness'],
    queryFn: () => getConnectorReadiness(selectedConnectorId ?? ''),
    enabled: selectedConnectorId !== null,
  })
  const updateMutation = useAdminMutation({
    mutationFn: ({ id, input }: { id: string; input: z.infer<typeof updateManagementConnectorRequestSchema> }) =>
      updateConnector(id, input),
    onSuccess: (connector) => {
      queryClient.setQueryData([...adminQueryKeys.connectors, connector.id], connector)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.connectors }),
        queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.connectors, connector.id, 'readiness'] }),
      ])
    },
  })
  const deleteMutation = useAdminMutation({
    mutationFn: deleteConnector,
    onSuccess: () => {
      setDeleteTarget(null)
      setSelectedConnectorId(null)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.connectors })
    },
  })

  return (
    <ResourcePage
      title="Social connectors"
      description="Configure social and generic OAuth providers used by the hosted sign-in settings."
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" />
          Add social connector
        </Button>
      }
      auxiliary={
        <CreateConnectorDialog
          error={createMutation.errorMessage}
          onClose={() => setDialogOpen(false)}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          pending={createMutation.isPending}
          templates={templatesQuery.data?.templates ?? []}
        />
      }
      error={query.error}
      empty={query.data?.connectors.length === 0}
      emptyDescription="Add social or OAuth identity providers when your sign-in experience needs them."
      emptyTitle="No social connectors yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      toolbar={
        <div className="inline-flex flex-wrap rounded-lg bg-muted p-1">
          <a
            className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground"
            href="/console/connectors/passwordless"
          >
            Passwordless
          </a>
          <a
            className="inline-flex min-h-9 items-center justify-center rounded-md bg-background px-3 text-sm font-medium text-foreground shadow-sm"
            href="/console/connectors/social"
          >
            Social
          </a>
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Connector</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Scopes</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Readiness</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.connectors.map((connector) => (
            <TableRow key={connector.id}>
              <TableCell>
                <div className="font-medium">{connector.displayName}</div>
                <div className="text-xs text-muted-foreground">{connector.slug}</div>
              </TableCell>
              <TableCell>{connector.providerId}</TableCell>
              <TableCell>{connector.scopes.join(', ') || 'Default'}</TableCell>
              <TableCell>
                <StatusBadge active={connector.enabled} activeLabel="Enabled" inactiveLabel="Disabled" />
              </TableCell>
              <TableCell>{connector.clientSecretBinding ? 'Binding configured' : 'Needs binding'}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Switch
                    aria-label={`Toggle ${connector.displayName}`}
                    checked={connector.enabled}
                    onCheckedChange={(enabled) => updateMutation.mutate({ id: connector.id, input: { enabled } })}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={`Actions for ${connector.displayName}`}>
                      <MoreHorizontal data-icon="inline-start" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => setSelectedConnectorId(connector.id)}>
                          View details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteTarget(connector)}>
                          <Trash2 data-icon="inline-start" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConnectorDetailDialog
        key={detailQuery.data?.id ?? selectedConnectorId ?? 'connector-detail'}
        connector={detailQuery.data ?? null}
        error={
          updateMutation.errorMessage ??
          (detailQuery.error instanceof Error ? detailQuery.error.message : null) ??
          (readinessQuery.error instanceof Error ? readinessQuery.error.message : null)
        }
        onClose={() => setSelectedConnectorId(null)}
        onSubmit={(input) => {
          if (detailQuery.data) updateMutation.mutate({ id: detailQuery.data.id, input })
        }}
        open={selectedConnectorId !== null}
        pending={updateMutation.isPending || detailQuery.isLoading}
        readiness={readinessQuery.data ?? null}
      />
      <ConfirmDialog
        description={
          deleteTarget ? `Delete ${deleteTarget.displayName}. This removes it from hosted sign-in immediately.` : ''
        }
        error={deleteMutation.errorMessage}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
        open={deleteTarget !== null}
        pending={deleteMutation.isPending}
        title="Delete connector"
      />
    </ResourcePage>
  )
}

export function SignInSettingsPage() {
  const query = useQuery({ queryKey: adminQueryKeys.signIn, queryFn: getSignInSettings })
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    identifierFirst: false,
    applicationId: '',
    redirectUri: '',
    termsUri: '',
    privacyUri: '',
    supportEmail: '',
    productName: '',
    headline: '',
    description: '',
  })
  const [validationError, setValidationError] = useState<string | null>(null)
  const updateMutation = useAdminMutation({
    mutationFn: updateSignInSettings,
    onSuccess: () => {
      setValidationError(null)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.signIn })
    },
  })

  useEffect(() => {
    if (!query.data) return
    setForm({
      passwordEnabled: query.data.signIn.passwordEnabled,
      signupEnabled: query.data.signIn.signupEnabled,
      socialLoginEnabled: query.data.signIn.socialLoginEnabled,
      identifierFirst: query.data.signIn.identifierFirst,
      applicationId: query.data.defaults.applicationId ?? '',
      redirectUri: query.data.defaults.redirectUri ?? '',
      termsUri: query.data.links.termsUri ?? '',
      privacyUri: query.data.links.privacyUri ?? '',
      supportEmail: query.data.links.supportEmail ?? '',
      productName: query.data.copy.productName,
      headline: query.data.copy.headline,
      description: query.data.copy.description,
    })
  }, [query.data])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const payload = updateManagementSignInSettingsRequestSchema.safeParse(
      removeBlankValues({
        signIn: {
          passwordEnabled: form.passwordEnabled,
          signupEnabled: form.signupEnabled,
          socialLoginEnabled: form.socialLoginEnabled,
          identifierFirst: form.identifierFirst,
        },
        defaults: {
          applicationId: nullableString(form.applicationId),
          redirectUri: nullableString(form.redirectUri),
        },
        links: {
          termsUri: nullableString(form.termsUri),
          privacyUri: nullableString(form.privacyUri),
          supportEmail: nullableString(form.supportEmail),
        },
        copy: {
          productName: form.productName,
          headline: form.headline,
          description: form.description,
        },
      }),
    )
    if (!payload.success) {
      setValidationError(payload.error.issues[0]?.message ?? 'Invalid sign-in settings.')
      return
    }
    setValidationError(null)
    updateMutation.mutate(payload.data)
  }

  return (
    <SignInExperiencePage
      activeTab="sign-up-and-sign-in"
      description="Configure identifiers, authentication method visibility, recovery behavior, and hosted auth defaults."
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      title="Sign-up and sign-in"
    >
      {query.data ? (
        <form className="grid gap-4 xl:grid-cols-2" onSubmit={onSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Sign-up</CardTitle>
              <CardDescription>
                Control self-service registration and the identifiers collected by hosted auth.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SwitchRow
                checked={form.signupEnabled}
                label="Registration"
                onCheckedChange={(signupEnabled) => setForm((value) => ({ ...value, signupEnabled }))}
              />
              <SettingRow
                label="Sign-up identifiers"
                value={query.data.signIn.usernameEnabled ? 'Email and username' : 'Email'}
              />
              <SettingRow
                label="Sign-up password requirement"
                value={form.passwordEnabled ? 'Password required' : 'Unavailable'}
              />
              <UnavailableSetting
                label="Custom profile collection"
                value="Configure supported profile fields on the Collect user profile tab."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Sign-in methods</CardTitle>
              <CardDescription>Control which hosted sign-in options are visible at runtime.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SwitchRow
                checked={form.passwordEnabled}
                label="Password sign-in"
                onCheckedChange={(passwordEnabled) => setForm((value) => ({ ...value, passwordEnabled }))}
              />
              <SwitchRow
                checked={form.socialLoginEnabled}
                label="Social sign-in"
                onCheckedChange={(socialLoginEnabled) => setForm((value) => ({ ...value, socialLoginEnabled }))}
              />
              <SwitchRow
                checked={form.identifierFirst}
                label="Identifier-first flow"
                onCheckedChange={(identifierFirst) => setForm((value) => ({ ...value, identifierFirst }))}
              />
              <SettingRow
                label="Sign-in identifiers"
                value={query.data.signIn.usernameEnabled ? 'Email and username' : 'Email'}
              />
              <SettingRow
                label="Magic link"
                value={query.data.signIn.magicLinkEnabled ? 'Available from runtime' : 'Unavailable'}
              />
              <SettingRow
                label="Email OTP"
                value={query.data.signIn.emailOtpEnabled ? 'Available from runtime' : 'Unavailable'}
              />
              <SwitchRow checked={false} disabled label="Passkey sign-in" />
              <UnavailableSetting
                label="Social provider setup"
                value="Add enabled identity providers from Connectors before enabling social sign-in."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recovery and redirects</CardTitle>
              <CardDescription>Public defaults exposed through configz and hosted recovery flows.</CardDescription>
            </CardHeader>
            <CardContent className="formStack">
              <Field label="Default application ID">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, applicationId: event.target.value }))}
                  value={form.applicationId}
                />
              </Field>
              <Field label="Unknown-session redirect URL">
                <TextInput
                  aria-label="Default redirect URI"
                  onChange={(event) => setForm((value) => ({ ...value, redirectUri: event.target.value }))}
                  type="url"
                  value={form.redirectUri}
                />
              </Field>
              <SettingRow
                label="Forgot-password verification"
                value={query.data.signIn.emailOtpEnabled ? 'Email OTP available' : 'Email link'}
              />
              <UnavailableSetting
                label="Additional recovery methods"
                value="No additional verification methods are exposed by the current config model."
              />
              {validationError || updateMutation.errorMessage ? (
                <StatusBadge
                  active={false}
                  activeLabel=""
                  inactiveLabel={validationError ?? updateMutation.errorMessage ?? ''}
                />
              ) : null}
              <Button disabled={updateMutation.isPending} type="submit">
                <Save data-icon="inline-start" />
                Save sign-in settings
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Hosted copy source</CardTitle>
              <CardDescription>
                Content is also available on the Content tab and saves through the same management boundary.
              </CardDescription>
            </CardHeader>
            <CardContent className="formStack">
              <Field label="Product name">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, productName: event.target.value }))}
                  required
                  value={form.productName}
                />
              </Field>
              <Field label="Headline">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, headline: event.target.value }))}
                  required
                  value={form.headline}
                />
              </Field>
              <Field label="Description">
                <TextArea
                  onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))}
                  required
                  value={form.description}
                />
              </Field>
              <Field label="Terms URL">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, termsUri: event.target.value }))}
                  type="url"
                  value={form.termsUri}
                />
              </Field>
              <Field label="Privacy URL">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, privacyUri: event.target.value }))}
                  type="url"
                  value={form.privacyUri}
                />
              </Field>
              <Field label="Support email">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, supportEmail: event.target.value }))}
                  type="email"
                  value={form.supportEmail}
                />
              </Field>
            </CardContent>
          </Card>
        </form>
      ) : null}
    </SignInExperiencePage>
  )
}

export function MfaPage() {
  const query = useQuery({ queryKey: adminQueryKeys.security, queryFn: getSecurityPolicy })

  return (
    <ResourcePage
      title="Multi-factor auth"
      description="Review tenant MFA factors and deployment policy for hosted account protection."
      error={query.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {query.data ? (
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle>Factors</CardTitle>
                <CardDescription>Available second factors surfaced by account and deployment support.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <FactorStatusCard
                  detail={`RP ${query.data.policy.passkeys.rpName}; ${
                    query.data.policy.passkeys.origins.length
                  } allowed origin${query.data.policy.passkeys.origins.length === 1 ? '' : 's'}.`}
                  enabled={query.data.policy.passkeys.enabled}
                  title="Passkeys"
                />
                <FactorStatusCard
                  detail="Authenticator app enrollment is available from the account security flow."
                  enabled
                  title="Authenticator app"
                />
                <FactorStatusCard
                  detail="SMS code enrollment is not backed by a connector contract in this runtime."
                  enabled={false}
                  title="SMS code"
                />
                <FactorStatusCard
                  detail="Email OTP is delivered through the configured Cloudflare Email Service binding."
                  enabled
                  title="Email code"
                />
                <FactorStatusCard
                  detail="Backup code generation is available from the account MFA flow."
                  enabled
                  title="Backup codes"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Policy controls</CardTitle>
                <CardDescription>MFA enforcement is currently backed by deployment policy.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field label="Prompt policy">
                  <SelectInput aria-label="Prompt policy" disabled value={query.data.policy.mfa.mode}>
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                    <option disabled value="none">
                      No prompt
                    </option>
                  </SelectInput>
                </Field>
                <SettingRow label="Persisted mode" value={query.data.policy.mfa.mode} />
                <p className="text-sm leading-6 text-muted-foreground">
                  Save is disabled because MFA policy is loaded from the local deployment environment. Update the
                  deployment policy to persist changes.
                </p>
              </CardContent>
            </Card>
          </div>
          <StickyActionBar>
            <Button disabled type="button">
              <Save data-icon="inline-start" />
              Save changes
            </Button>
            <Button disabled type="button" variant="ghost">
              <Undo2 data-icon="inline-start" />
              Discard
            </Button>
          </StickyActionBar>
        </div>
      ) : null}
    </ResourcePage>
  )
}

export function SecurityPasswordPolicyPage() {
  return (
    <ResourcePage
      title="Security"
      description="Configure password-policy requirements when a persistence contract is available."
      framed={false}
    >
      <SecuritySectionTabs active="password-policy" />
      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Password policy</CardTitle>
            <CardDescription>
              Password controls are visible here and disabled until backed by policy storage.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Minimum length">
              <TextInput aria-label="Minimum length" disabled placeholder="Unavailable until policy storage exists" />
            </Field>
            <div className="grid gap-3">
              <SettingRow label="Required character types" value="Unavailable until policy storage exists" />
              <SettingRow label="Compromised-password rejection" value="Unavailable until policy storage exists" />
              <SettingRow label="Low-security phrase rejection" value="Unavailable until policy storage exists" />
              <SettingRow label="User-info rejection" value="Unavailable until policy storage exists" />
            </div>
            <Field label="Custom words">
              <TextArea aria-label="Custom words" disabled placeholder="Unavailable until policy storage exists" />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Persistence</CardTitle>
            <CardDescription>These controls are not written until a management contract exists.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SettingRow label="Current backend" value="Password hashing and reset flows" />
            <SettingRow label="Policy storage" value="Not available in local runtime" />
          </CardContent>
        </Card>
      </div>
    </ResourcePage>
  )
}

export function SecurityCaptchaPage() {
  return (
    <ResourcePage
      title="CAPTCHA"
      description="Review CAPTCHA provider setup for hosted sign-up, sign-in, and password recovery flows."
      framed={false}
    >
      <SecuritySectionTabs active="captcha" />
      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Provider setup</CardTitle>
            <CardDescription>CAPTCHA provider persistence is not available in this local runtime.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SwitchRow checked={false} disabled label="Enable CAPTCHA" />
            <Field label="Provider">
              <SelectInput aria-label="Provider" disabled value="turnstile">
                <option value="turnstile">Cloudflare Turnstile</option>
              </SelectInput>
            </Field>
            <Field label="Site key">
              <TextInput aria-label="Site key" disabled placeholder="Provider setup disabled locally" />
            </Field>
            <Button disabled type="button" variant="secondary">
              Setup provider
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Flow copy</CardTitle>
            <CardDescription>Copy shown when CAPTCHA is active.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SettingRow label="Sign-up" value="Complete the verification challenge before creating an account." />
            <SettingRow label="Sign-in" value="Complete the verification challenge before signing in." />
            <SettingRow label="Password recovery" value="Complete the verification challenge before recovery email." />
          </CardContent>
        </Card>
      </div>
    </ResourcePage>
  )
}

export function SecurityBlocklistPage() {
  return (
    <ResourcePage
      title="Blocklist"
      description="Review sign-up blocklist settings for email aliases, addresses, and domains."
      framed={false}
    >
      <SecuritySectionTabs active="blocklist" />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Email blocklist</CardTitle>
            <CardDescription>Blocklist persistence is not available in this local runtime.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SwitchRow checked={false} disabled label="Block email subaddressing" />
            <Field label="Custom email and domain blocklist" help="One email address or domain per line.">
              <TextArea
                aria-label="Custom email and domain blocklist"
                disabled
                placeholder={'blocked@example.com\nexample.org'}
              />
            </Field>
          </CardContent>
        </Card>
      </div>
    </ResourcePage>
  )
}

export function SecurityGeneralPage() {
  const query = useQuery({ queryKey: adminQueryKeys.security, queryFn: getSecurityPolicy })

  return (
    <ResourcePage
      title="General security"
      description="Review general protections tied to current deployment security policy."
      error={query.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <SecuritySectionTabs active="general" />
      {query.data ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <PolicyCard
            rows={[
              ['MFA enforcement', query.data.policy.mfa.mode],
              ['Passkeys', query.data.policy.passkeys.enabled ? 'Enabled' : 'Disabled'],
            ]}
            title="Protection"
          />
          <PolicyCard
            rows={[
              ['Session TTL', `${query.data.policy.sessions.expiresInSeconds}s`],
              ['Fresh age', `${query.data.policy.sessions.freshAgeSeconds}s`],
            ]}
            title="Session policy"
          />
          <PolicyCard
            rows={[
              ['Security headers', 'Managed by Worker middleware'],
              ['Cookie cache', `${query.data.policy.sessions.cookieCacheSeconds}s`],
            ]}
            title="Headers and cookies"
          />
        </div>
      ) : null}
    </ResourcePage>
  )
}

export function OrganizationsPage() {
  const query = useQuery({ queryKey: adminQueryKeys.organizations, queryFn: listOrganizations })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const createMutation = useAdminMutation({
    mutationFn: createOrganization,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.organizations })
    },
  })
  const logoMutation = useAdminMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => uploadOrganizationLogo(id, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.organizations }),
  })

  return (
    <ResourcePage
      title="Organizations"
      description="Manage tenant organizations. Teams are intentionally excluded from this console."
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" />
          New organization
        </Button>
      }
      auxiliary={
        <SimpleCreateDialog
          error={createMutation.errorMessage}
          fields={[
            ['slug', 'Slug'],
            ['name', 'Name'],
            ['displayName', 'Display name'],
          ]}
          onClose={() => setDialogOpen(false)}
          onSubmit={(form) => createMutation.mutate(parseForm(createOrganizationRequestSchema, form))}
          open={dialogOpen}
          pending={createMutation.isPending}
          title="Create organization"
        />
      }
      error={query.error}
      empty={query.data?.organizations.length === 0}
      emptyDescription="Create organizations when authorization needs tenant-owned groups."
      emptyTitle="No organizations yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Display name</TableHead>
            <TableHead>Logo</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.organizations.map((organization) => (
            <TableRow key={organization.id}>
              <TableCell>
                <div className="font-medium">{organization.name}</div>
                <div className="text-xs text-muted-foreground">{organization.slug}</div>
              </TableCell>
              <TableCell>{organization.displayName ?? 'Not set'}</TableCell>
              <TableCell>
                <AssetUploadControl
                  accept="image/png,image/jpeg,image/webp"
                  label={`Upload logo for ${organization.name}`}
                  onFile={(file) => logoMutation.mutate({ id: organization.id, file })}
                  previewUrl={organization.logo}
                />
              </TableCell>
              <TableCell>
                <StatusBadge active={!organization.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {logoMutation.errorMessage ? <p className="p-4 text-sm text-destructive">{logoMutation.errorMessage}</p> : null}
    </ResourcePage>
  )
}

export function RolesPage() {
  const query = useQuery({ queryKey: adminQueryKeys.roles, queryFn: listRoles })
  const resourcesQuery = useQuery({ queryKey: adminQueryKeys.apiResources, queryFn: listApiResources })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const createMutation = useAdminMutation({
    mutationFn: createRole,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles })
    },
  })

  return (
    <ResourcePage
      title="Roles"
      description="Define application, organization, resource, and global roles."
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" />
          New role
        </Button>
      }
      auxiliary={
        <CreateRoleDialog
          error={createMutation.errorMessage}
          onClose={() => setDialogOpen(false)}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          pending={createMutation.isPending}
          resources={resourcesQuery.data?.resources ?? []}
        />
      }
      error={query.error}
      empty={query.data?.roles.length === 0}
      emptyDescription="Create roles to model tenant, organization, application, or API permissions."
      emptyTitle="No roles yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>System</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.roles.map((role) => (
            <TableRow key={role.id}>
              <TableCell>
                <a className="font-medium hover:underline" href={`/console/roles/${role.id}`}>
                  {role.name}
                </a>
                <div className="text-xs text-muted-foreground">{role.key}</div>
              </TableCell>
              <TableCell>{role.resourceId ?? role.organizationId ?? role.applicationId ?? 'Global'}</TableCell>
              <TableCell>
                <StatusBadge active={role.system} activeLabel="System" inactiveLabel="Custom" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}

export function RoleDetailPage({ roleId }: { roleId: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [assignment, setAssignment] = useState({ type: 'user', subjectId: '', tokenClaims: '' })
  const [assignmentValidationError, setAssignmentValidationError] = useState<string | null>(null)
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([])
  const roleQuery = useQuery({ queryKey: [...adminQueryKeys.roles, roleId], queryFn: () => getRole(roleId) })
  const resourcesQuery = useQuery({ queryKey: adminQueryKeys.apiResources, queryFn: listApiResources })
  const rolePermissionsQuery = useQuery({
    queryKey: [...adminQueryKeys.roles, roleId, 'permissions'],
    queryFn: () => listRolePermissions(roleId),
  })
  const permissionsQuery = useQuery({
    queryKey: [...adminQueryKeys.apiResources, selectedResourceId, 'permissions'],
    queryFn: () => listApiPermissions(selectedResourceId),
    enabled: selectedResourceId.length > 0,
  })
  const role = roleQuery.data

  useEffect(() => {
    if (role?.resourceId && selectedResourceId !== role.resourceId) setSelectedResourceId(role.resourceId)
  }, [role?.resourceId, selectedResourceId])

  useEffect(() => {
    if (rolePermissionsQuery.data) {
      setSelectedPermissionIds(rolePermissionsQuery.data.permissions.map((permission) => permission.id))
    }
  }, [rolePermissionsQuery.data])

  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof updateRoleRequestSchema>) => updateRole(roleId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...adminQueryKeys.roles, roleId], updated)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteRole(roleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles })
      await navigate({ to: '/console/roles' })
    },
  })
  const permissionMutation = useMutation({
    mutationFn: (permissionIds: string[]) => replaceRolePermissions(roleId, permissionIds),
    onSuccess: () => rolePermissionsQuery.refetch(),
  })
  const assignmentMutation = useMutation({
    mutationFn: (input: z.infer<typeof assignRoleRequestSchema> & { type: string }) => {
      const payload = { roleId, subjectId: input.subjectId, tokenClaims: input.tokenClaims }
      if (input.type === 'application') return assignApplicationRole(payload)
      if (input.type === 'member') return assignMemberRole(payload)
      return assignUserRole(payload)
    },
  })

  const selectedPermissionIdSet = new Set(selectedPermissionIds)

  return (
    <ResourcePage
      title={role?.name ?? 'Role'}
      description="Manage role metadata, API permissions, and user, application, or organization member assignments."
      framed={false}
      action={
        <a className="uiButton uiButton-secondary" href="/console/roles">
          Back to roles
        </a>
      }
      error={roleQuery.error}
      loading={roleQuery.isLoading}
      onRetry={() => roleQuery.refetch()}
    >
      {role ? (
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Role settings</CardTitle>
              <CardDescription>
                Scope fields are immutable after creation; update display metadata here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AuthorizationForm
                buttonLabel="Save role"
                defaults={{
                  key: role.key,
                  name: role.name,
                  description: role.description ?? '',
                  tokenClaimName: role.tokenClaimName ?? '',
                  tokenClaimValue: role.tokenClaimValue ?? '',
                }}
                error={updateMutation.error}
                fields={[
                  ['key', 'Key'],
                  ['name', 'Name'],
                  ['description', 'Description'],
                  ['tokenClaimName', 'Token claim name'],
                  ['tokenClaimValue', 'Token claim value'],
                ]}
                onSubmit={(form) => updateMutation.mutate(parseForm(updateRoleRequestSchema, form))}
                pending={updateMutation.isPending}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusBadge active={role.system} activeLabel="System role" inactiveLabel="Custom role" />
                <Button
                  disabled={role.system || deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate()}
                  type="button"
                  variant="danger"
                >
                  <Trash2 data-icon="inline-start" />
                  Delete role
                </Button>
              </div>
              <MutationError error={deleteMutation.error} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Permission assignment</CardTitle>
              <CardDescription>
                Select permissions from one API resource and replace the role permission set.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field label="API resource">
                <SelectInput onChange={(event) => setSelectedResourceId(event.target.value)} value={selectedResourceId}>
                  <option value="">Select resource</option>
                  {resourcesQuery.data?.resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <div className="grid gap-2">
                {permissionsQuery.data?.permissions.map((permission) => (
                  <label
                    className="flex items-start gap-2 rounded-md border border-border p-3 text-sm"
                    key={permission.id}
                  >
                    <input
                      checked={selectedPermissionIdSet.has(permission.id)}
                      disabled={permissionMutation.isPending}
                      onChange={(event) => {
                        const next = new Set(selectedPermissionIds)
                        if (event.target.checked) next.add(permission.id)
                        else next.delete(permission.id)
                        setSelectedPermissionIds([...next])
                      }}
                      type="checkbox"
                    />
                    <span>
                      <span className="font-medium">{permission.key}</span>
                      <span className="block text-muted-foreground">{permission.description ?? 'No description'}</span>
                    </span>
                  </label>
                ))}
              </div>
              <Button
                disabled={permissionMutation.isPending || selectedResourceId.length === 0}
                onClick={() => permissionMutation.mutate(selectedPermissionIds)}
                type="button"
              >
                <Save data-icon="inline-start" />
                Save permissions
              </Button>
              <MutationError error={permissionMutation.error} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assignments</CardTitle>
              <CardDescription>
                Assign this role to a user, an application, or an organization member record.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="formStack"
                onSubmit={(event) => {
                  event.preventDefault()
                  try {
                    setAssignmentValidationError(null)
                    assignmentMutation.mutate({
                      type: assignment.type,
                      roleId,
                      subjectId: assignment.subjectId,
                      tokenClaims: parseTokenClaims(assignment.tokenClaims),
                    })
                  } catch (submitError) {
                    setAssignmentValidationError(
                      submitError instanceof Error ? submitError.message : 'Invalid token claims JSON.',
                    )
                  }
                }}
              >
                <Field label="Subject type">
                  <SelectInput
                    onChange={(event) => setAssignment((value) => ({ ...value, type: event.target.value }))}
                    value={assignment.type}
                  >
                    <option value="user">User</option>
                    <option value="application">Application</option>
                    <option value="member">Organization member</option>
                  </SelectInput>
                </Field>
                <Field label="Subject ID">
                  <TextInput
                    onChange={(event) => setAssignment((value) => ({ ...value, subjectId: event.target.value }))}
                    required
                    value={assignment.subjectId}
                  />
                </Field>
                <Field label="Token claims JSON">
                  <TextArea
                    onChange={(event) => setAssignment((value) => ({ ...value, tokenClaims: event.target.value }))}
                    placeholder='{"tier":"gold"}'
                    value={assignment.tokenClaims}
                  />
                </Field>
                <Button disabled={assignmentMutation.isPending} type="submit">
                  <Save data-icon="inline-start" />
                  Assign role
                </Button>
                {assignmentMutation.isSuccess ? (
                  <p className="text-sm text-muted-foreground">Assignment saved.</p>
                ) : null}
                {assignmentValidationError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {assignmentValidationError}
                  </div>
                ) : null}
                <MutationError error={assignmentMutation.error} />
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </ResourcePage>
  )
}

export function ApiResourcesPage() {
  const query = useQuery({ queryKey: adminQueryKeys.apiResources, queryFn: listApiResources })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const createMutation = useAdminMutation({
    mutationFn: createApiResource,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.apiResources })
    },
  })

  return (
    <ResourcePage
      title="API resources"
      description="Register protected APIs, audiences, scopes, and permission surfaces."
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" />
          New resource
        </Button>
      }
      auxiliary={
        <SimpleCreateDialog
          error={createMutation.errorMessage}
          fields={[
            ['identifier', 'Identifier'],
            ['name', 'Name'],
            ['audience', 'Audience'],
            ['description', 'Description'],
          ]}
          onClose={() => setDialogOpen(false)}
          onSubmit={(form) => createMutation.mutate(parseForm(createApiResourceRequestSchema, form))}
          open={dialogOpen}
          pending={createMutation.isPending}
          title="Create API resource"
        />
      }
      error={query.error}
      empty={query.data?.resources.length === 0}
      emptyDescription="Register APIs before issuing access tokens for protected resources."
      emptyTitle="No API resources yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Resource</TableHead>
            <TableHead>Audience</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.resources.map((resource) => (
            <TableRow key={resource.id}>
              <TableCell>
                <a className="font-medium hover:underline" href={`/console/api-resources/${resource.id}`}>
                  {resource.name}
                </a>
                <div className="text-xs text-muted-foreground">{resource.identifier}</div>
              </TableCell>
              <TableCell>{resource.audience}</TableCell>
              <TableCell>
                <StatusBadge active={resource.enabled} activeLabel="Enabled" inactiveLabel="Disabled" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}

export function ApiResourceDetailPage({ resourceId }: { resourceId: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const resourceQuery = useQuery({
    queryKey: [...adminQueryKeys.apiResources, resourceId],
    queryFn: () => getApiResource(resourceId),
  })
  const scopesQuery = useQuery({
    queryKey: [...adminQueryKeys.apiResources, resourceId, 'scopes'],
    queryFn: () => listApiScopes(resourceId),
  })
  const permissionsQuery = useQuery({
    queryKey: [...adminQueryKeys.apiResources, resourceId, 'permissions'],
    queryFn: () => listApiPermissions(resourceId),
  })
  const resource = resourceQuery.data
  const refreshChildren = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.apiResources, resourceId, 'scopes'] }),
      queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.apiResources, resourceId, 'permissions'] }),
    ])
  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof updateApiResourceRequestSchema>) => updateApiResource(resourceId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...adminQueryKeys.apiResources, resourceId], updated)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.apiResources })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteApiResource(resourceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.apiResources })
      await navigate({ to: '/console/api-resources' })
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
      queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.apiResources, resourceId, 'permissions'] }),
  })
  const updatePermissionMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: z.infer<typeof updateApiPermissionRequestSchema> }) =>
      updateApiPermission(resourceId, id, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.apiResources, resourceId, 'permissions'] }),
  })
  const deletePermissionMutation = useMutation({
    mutationFn: (id: string) => deleteApiPermission(resourceId, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.apiResources, resourceId, 'permissions'] }),
  })

  return (
    <ResourcePage
      title={resource?.name ?? 'API resource'}
      description="Manage the protected API audience, OAuth scopes, and permission keys used by RBAC roles."
      framed={false}
      action={
        <a className="uiButton uiButton-secondary" href="/console/api-resources">
          Back to API resources
        </a>
      }
      error={resourceQuery.error}
      loading={resourceQuery.isLoading}
      onRetry={() => resourceQuery.refetch()}
    >
      {resource ? (
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Resource settings</CardTitle>
              <CardDescription>
                Audience is emitted into authorization claims for matching OAuth resource requests.
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
                  onClick={() => updateMutation.mutate({ enabled: !resource.enabled })}
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
                  <Trash2 data-icon="inline-start" />
                  Delete resource
                </Button>
              </div>
              <MutationError error={deleteMutation.error} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scopes</CardTitle>
              <CardDescription>
                Scopes become OAuth scope strings and can also drive token claim inclusion.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <AuthorizationForm
                buttonLabel="Create scope"
                defaults={{ value: '', description: '', tokenClaimName: '' }}
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
                empty="No scopes yet."
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
                    updateScopeMutation.mutate({ id: scope.id, input: parseForm(updateApiScopeRequestSchema, form) }),
                }))}
              />
              <MutationError error={updateScopeMutation.error ?? deleteScopeMutation.error} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>
                Permissions are assigned to roles and emitted through authorization claims.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <AuthorizationForm
                buttonLabel="Create permission"
                defaults={{ key: '', description: '', tokenClaimValue: '', scopeId: '' }}
                error={createPermissionMutation.error}
                fields={[
                  ['key', 'Key'],
                  ['description', 'Description'],
                  ['scopeId', 'Scope ID'],
                  ['tokenClaimValue', 'Token claim value'],
                ]}
                onSubmit={(form) => createPermissionMutation.mutate(parseForm(createApiPermissionRequestSchema, form))}
                pending={createPermissionMutation.isPending}
              />
              <AuthorizationRows
                empty="No permissions yet."
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
        </div>
      ) : null}
    </ResourcePage>
  )
}

export function BrandingPage() {
  const query = useQuery({ queryKey: adminQueryKeys.branding, queryFn: getBrandingSettings })
  const queryClient = useQueryClient()
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [form, setForm] = useState({
    logoUrl: '',
    faviconUrl: '',
    primaryColor: '#b42318',
    backgroundColor: '#f7f3ee',
    customCss: '',
    productName: '',
    headline: '',
    description: '',
  })
  const [validationError, setValidationError] = useState<string | null>(null)
  const updateMutation = useAdminMutation({
    mutationFn: updateBrandingSettings,
    onSuccess: () => {
      setValidationError(null)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.branding })
    },
  })
  const logoMutation = useAdminMutation({
    mutationFn: uploadBrandingLogo,
    onSuccess: (response) => {
      setForm((value) => ({ ...value, logoUrl: response.asset.publicUrl }))
      return Promise.resolve()
    },
  })
  const faviconMutation = useAdminMutation({
    mutationFn: uploadBrandingFavicon,
    onSuccess: (response) => {
      setForm((value) => ({ ...value, faviconUrl: response.asset.publicUrl }))
      return Promise.resolve()
    },
  })

  useEffect(() => {
    if (!query.data) return
    setForm({
      logoUrl: query.data.branding.logoUrl ?? '',
      faviconUrl: query.data.branding.faviconUrl ?? '',
      primaryColor: query.data.branding.primaryColor ?? '#b42318',
      backgroundColor: query.data.branding.backgroundColor ?? '#f7f3ee',
      customCss: query.data.branding.customCss ?? '',
      productName: query.data.copy.productName,
      headline: query.data.copy.headline,
      description: query.data.copy.description,
    })
  }, [query.data])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const payload = updateManagementBrandingSettingsRequestSchema.safeParse(
      removeBlankValues({
        branding: {
          logoUrl: nullableString(form.logoUrl),
          faviconUrl: nullableString(form.faviconUrl),
          primaryColor: nullableString(form.primaryColor),
          backgroundColor: nullableString(form.backgroundColor),
          customCss: nullableString(form.customCss),
        },
        copy: {
          productName: form.productName,
          headline: form.headline,
          description: form.description,
        },
      }),
    )
    if (!payload.success) {
      setValidationError(payload.error.issues[0]?.message ?? 'Invalid branding settings.')
      return
    }
    setValidationError(null)
    updateMutation.mutate(payload.data)
  }

  const previewStyle = {
    '--brand-primary': form.primaryColor,
    '--brand-background': form.backgroundColor,
    ...customCssProperties(form.customCss),
  } as CSSProperties

  return (
    <SignInExperiencePage
      activeTab="branding"
      title="Branding"
      description="Configure hosted sign-in and Account Center brand assets, colors, and constrained theme variables."
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {query.data ? (
        <form className="grid gap-4 xl:grid-cols-2" onSubmit={onSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Brand settings</CardTitle>
              <CardDescription>
                External asset URLs must use HTTPS. Custom CSS accepts --auth-* declarations only.
              </CardDescription>
            </CardHeader>
            <CardContent className="formStack">
              <Field label="Product name">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, productName: event.target.value }))}
                  required
                  value={form.productName}
                />
              </Field>
              <Field label="Logo URL">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, logoUrl: event.target.value }))}
                  type="url"
                  value={form.logoUrl}
                />
              </Field>
              <AssetUploadControl
                accept="image/png,image/jpeg,image/webp"
                label="Upload branding logo"
                onFile={(file) => logoMutation.mutate(file)}
                previewUrl={form.logoUrl || null}
              />
              <Field label="Favicon URL">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, faviconUrl: event.target.value }))}
                  type="url"
                  value={form.faviconUrl}
                />
              </Field>
              <AssetUploadControl
                accept="image/png,image/webp,image/x-icon,image/vnd.microsoft.icon"
                label="Upload favicon"
                onFile={(file) => faviconMutation.mutate(file)}
                previewUrl={form.faviconUrl || null}
              />
              <Field label="Primary color">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, primaryColor: event.target.value }))}
                  type="color"
                  value={form.primaryColor}
                />
              </Field>
              <Field label="Background color">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, backgroundColor: event.target.value }))}
                  type="color"
                  value={form.backgroundColor}
                />
              </Field>
              <SwitchRow checked={false} disabled label="Dark mode" />
              <Field label="Custom CSS">
                <TextArea
                  onChange={(event) => setForm((value) => ({ ...value, customCss: event.target.value }))}
                  placeholder="--auth-panel-radius: 8px;"
                  value={form.customCss}
                />
              </Field>
              {validationError ||
              updateMutation.errorMessage ||
              logoMutation.errorMessage ||
              faviconMutation.errorMessage ? (
                <div className="text-sm text-destructive">
                  {validationError ??
                    updateMutation.errorMessage ??
                    logoMutation.errorMessage ??
                    faviconMutation.errorMessage}
                </div>
              ) : null}
              <Button disabled={updateMutation.isPending} type="submit">
                <Save data-icon="inline-start" />
                Save branding
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Hosted sign-in preview</CardTitle>
                  <CardDescription>
                    Preview uses the same public config consumed by hosted auth surfaces.
                  </CardDescription>
                </div>
                <Tabs setValue={(value) => setPreviewMode(value as 'desktop' | 'mobile')} value={previewMode}>
                  <TabsList aria-label="Preview viewport">
                    <TabsTrigger value="desktop">Desktop</TabsTrigger>
                    <TabsTrigger value="mobile">Mobile</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent>
              <div
                className={cn('brandingPreview', previewMode === 'mobile' && 'mx-auto max-w-80')}
                style={previewStyle}
              >
                <div className="brand">
                  {form.logoUrl ? (
                    <img className="brandLogo" src={form.logoUrl} alt="" width="36" height="36" />
                  ) : (
                    <span className="brandMark">{form.productName.slice(0, 1).toUpperCase()}</span>
                  )}
                  <span>{form.productName}</span>
                </div>
                <div>
                  <p className="eyebrow">Hosted sign-in</p>
                  <h2>{form.headline}</h2>
                  <p>{form.description}</p>
                </div>
                <Button type="button">
                  <Eye data-icon="inline-start" />
                  Live preview
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}
    </SignInExperiencePage>
  )
}

export function CollectUserProfilePage() {
  return (
    <SignInExperiencePage
      activeTab="collect-user-profile"
      description="Review custom profile field collection for hosted sign-up and account completion."
      title="Collect user profile"
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Custom profile fields</CardTitle>
            <CardDescription>
              Backend support for configurable profile fields is not available in this build.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              action={
                <Button disabled type="button" variant="secondary">
                  <Plus data-icon="inline-start" />
                  Add field
                </Button>
              }
              description="Field label, field type, and user data key controls will become available after a management contract exists for profile field persistence."
              title="No custom fields"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Supported profile data</CardTitle>
            <CardDescription>Current hosted auth collects the built-in user profile fields.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SettingRow label="Email" value="Built in" />
            <SettingRow label="Name" value="Built in" />
            <SettingRow label="Username" value="Available when username sign-in is enabled" />
            <SettingRow label="Avatar" value="Managed from user profile surfaces" />
          </CardContent>
        </Card>
      </div>
    </SignInExperiencePage>
  )
}

export function AccountCenterSettingsPage() {
  return (
    <SignInExperiencePage
      activeTab="account-center"
      description="Configure the self-service account center exposure and review available account management surfaces."
      title="Account Center"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account center</CardTitle>
            <CardDescription>
              The account API and prebuilt account UI are enabled by the current deployment routes.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SettingRow label="Account API" value="/api/account" />
            <SettingRow label="Prebuilt UI" value="/account" />
            <SettingRow label="Profile route" value="/account/profile" />
            <SettingRow label="Security route" value="/account/security" />
            <SettingRow label="Sessions route" value="/account/sessions" />
            <Button onClick={() => window.open('/account', '_blank', 'noopener')} type="button" variant="secondary">
              <ExternalLink data-icon="inline-start" />
              Open account center
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Account field permissions</CardTitle>
            <CardDescription>
              Permissions reflect the account API surfaces currently available to users.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SettingRow label="Profile" value="User editable" />
            <SettingRow label="Email" value="Managed by auth flows" />
            <SettingRow label="Password" value="Managed by recovery flows" />
            <SettingRow label="Social accounts" value="Linked account view" />
            <SettingRow label="MFA" value="Security view" />
            <SettingRow label="Sessions" value="User revocable" />
            <SettingRow label="Apps" value="Authorized apps view" />
          </CardContent>
        </Card>
      </div>
    </SignInExperiencePage>
  )
}

export function ContentSettingsPage() {
  const query = useQuery({ queryKey: adminQueryKeys.signIn, queryFn: getSignInSettings })
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    productName: '',
    headline: '',
    description: '',
    termsUri: '',
    privacyUri: '',
    supportEmail: '',
  })
  const [validationError, setValidationError] = useState<string | null>(null)
  const updateMutation = useAdminMutation({
    mutationFn: updateSignInSettings,
    onSuccess: () => {
      setValidationError(null)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.signIn })
    },
  })

  useEffect(() => {
    if (!query.data) return
    setForm({
      productName: query.data.copy.productName,
      headline: query.data.copy.headline,
      description: query.data.copy.description,
      termsUri: query.data.links.termsUri ?? '',
      privacyUri: query.data.links.privacyUri ?? '',
      supportEmail: query.data.links.supportEmail ?? '',
    })
  }, [query.data])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const payload = updateManagementSignInSettingsRequestSchema.safeParse({
      links: {
        termsUri: nullableString(form.termsUri),
        privacyUri: nullableString(form.privacyUri),
        supportEmail: nullableString(form.supportEmail),
      },
      copy: {
        productName: form.productName,
        headline: form.headline,
        description: form.description,
      },
    })
    if (!payload.success) {
      setValidationError(payload.error.issues[0]!.message)
      return
    }
    setValidationError(null)
    updateMutation.mutate(payload.data)
  }

  return (
    <SignInExperiencePage
      activeTab="content"
      description="Manage hosted authentication language, page messages, and legal links."
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      title="Content"
    >
      {query.data ? (
        <form className="grid gap-4 xl:grid-cols-2" onSubmit={onSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Language and messages</CardTitle>
              <CardDescription>These strings are exposed through public hosted auth config.</CardDescription>
            </CardHeader>
            <CardContent className="formStack">
              <Field label="Language">
                <SelectInput disabled value="en">
                  <option value="en">English</option>
                </SelectInput>
              </Field>
              <Field label="Product name">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, productName: event.target.value }))}
                  required
                  value={form.productName}
                />
              </Field>
              <Field label="Sign-in message">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, headline: event.target.value }))}
                  required
                  value={form.headline}
                />
              </Field>
              <Field label="Sign-up message">
                <TextArea
                  onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))}
                  required
                  value={form.description}
                />
              </Field>
              <UnavailableSetting
                label="Password message"
                value="No separate password message field is exposed by configz."
              />
              <UnavailableSetting
                label="Account message"
                value="No separate account message field is exposed by configz."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Links</CardTitle>
              <CardDescription>
                Public legal and support links must use safe values accepted by management validation.
              </CardDescription>
            </CardHeader>
            <CardContent className="formStack">
              <Field label="Terms URL">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, termsUri: event.target.value }))}
                  type="url"
                  value={form.termsUri}
                />
              </Field>
              <Field label="Privacy URL">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, privacyUri: event.target.value }))}
                  type="url"
                  value={form.privacyUri}
                />
              </Field>
              <Field label="Support email">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, supportEmail: event.target.value }))}
                  type="email"
                  value={form.supportEmail}
                />
              </Field>
              {validationError || updateMutation.errorMessage ? (
                <StatusBadge
                  active={false}
                  activeLabel=""
                  inactiveLabel={validationError ?? updateMutation.errorMessage ?? ''}
                />
              ) : null}
              <Button disabled={updateMutation.isPending} type="submit">
                <Save data-icon="inline-start" />
                Save content
              </Button>
            </CardContent>
          </Card>
        </form>
      ) : null}
    </SignInExperiencePage>
  )
}

export function DeploymentSettingsPage() {
  const query = useQuery({ queryKey: adminQueryKeys.security, queryFn: getSecurityPolicy })
  const [keyTab, setKeyTab] = useState('private')

  return (
    <ResourcePage
      title="OIDC configs"
      description="Review issuer metadata, session TTL, and signing-key runtime state for this tenant."
      error={query.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {query.data ? (
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Runtime endpoints</CardTitle>
                <CardDescription>Static Console settings tied to the current deployment.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <SettingRow label="Platform" value="Cloudflare Workers" />
                <SettingRow label="Database" value="D1" />
                <SettingRow label="Auth issuer" value="/api/auth" />
                <SettingRow label="Discovery" value="/api/auth/.well-known/openid-configuration" />
                <SettingRow label="JWKS URI" value="/api/auth/jwks" />
                <SettingRow label="Management API" value="/api/management" />
              </CardContent>
            </Card>
            <PolicyCard
              rows={[
                ['Session TTL', `${query.data.policy.sessions.expiresInSeconds}s`],
                ['Update age', `${query.data.policy.sessions.updateAgeSeconds}s`],
                ['Fresh age', `${query.data.policy.sessions.freshAgeSeconds}s`],
                ['Cookie cache', `${query.data.policy.sessions.cookieCacheSeconds}s`],
              ]}
              title="Session TTL"
            />
          </div>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Signing keys</CardTitle>
                  <CardDescription>Deployment-managed OIDC signing material exposed through JWKS.</CardDescription>
                </div>
                <Button disabled type="button" variant="secondary">
                  <RefreshCw data-icon="inline-start" />
                  Rotate key
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Use</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rotation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Current deployment key</TableCell>
                    <TableCell>OIDC JWT signing</TableCell>
                    <TableCell>
                      <StatusBadge active activeLabel="Active" inactiveLabel="Inactive" />
                    </TableCell>
                    <TableCell>Rotation endpoint is not supported in this runtime.</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Tabs className="flex flex-col gap-4" setValue={setKeyTab} value={keyTab}>
                <TabsList>
                  <TabsTrigger value="private">Private key</TabsTrigger>
                  <TabsTrigger value="cookie">Cookie key</TabsTrigger>
                </TabsList>
                <TabsContent value="private">
                  <PolicyCard
                    rows={[
                      ['Storage', 'AUTH_SECRET deployment binding'],
                      ['Exposure', 'Private key material is never shown in Console.'],
                    ]}
                    title="Private key"
                  />
                </TabsContent>
                <TabsContent value="cookie">
                  <PolicyCard
                    rows={[
                      ['Storage', 'AUTH_SECRET deployment binding'],
                      ['Cookie cache', `${query.data.policy.sessions.cookieCacheSeconds}s`],
                    ]}
                    title="Cookie key"
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </ResourcePage>
  )
}

export function ConsolePlaceholderPage({
  description,
  rows,
  title,
}: {
  description: string
  rows: Array<[string, string]>
  title: string
}) {
  return (
    <ResourcePage title={title} description={description} framed={false}>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {rows.map(([label, value]) => (
            <SettingRow key={label} label={label} value={value} />
          ))}
        </CardContent>
      </Card>
    </ResourcePage>
  )
}

type SignInExperienceTab = {
  href: string
  label: string
  value: string
}

const signInExperienceTabs: SignInExperienceTab[] = [
  { value: 'branding', label: 'Branding', href: '/console/sign-in-experience/branding' },
  {
    value: 'sign-up-and-sign-in',
    label: 'Sign-up and sign-in',
    href: '/console/sign-in-experience/sign-up-and-sign-in',
  },
  {
    value: 'collect-user-profile',
    label: 'Collect user profile',
    href: '/console/sign-in-experience/collect-user-profile',
  },
  { value: 'account-center', label: 'Account Center', href: '/console/sign-in-experience/account-center' },
  { value: 'content', label: 'Content', href: '/console/sign-in-experience/content' },
]

function SignInExperiencePage({
  activeTab,
  children,
  description,
  error,
  loading,
  onRetry,
  title,
}: {
  activeTab: string
  children: ReactNode
  description: string
  error?: Error | null
  loading?: boolean
  onRetry?: () => void
  title: string
}) {
  const navigate = useNavigate()

  return (
    <ResourcePage
      description={description}
      error={error}
      framed={false}
      loading={loading}
      onRetry={onRetry}
      title={title}
      toolbar={
        <Tabs
          setValue={(value) => {
            const tab = signInExperienceTabs.find((item) => item.value === value)!
            void navigate({ to: tab.href })
          }}
          value={activeTab}
        >
          <TabsList
            aria-label="Sign-in and account settings"
            className="flex w-full flex-wrap sm:inline-flex sm:w-auto"
          >
            {signInExperienceTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      {children}
    </ResourcePage>
  )
}

function AuthorizationForm({
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
  const [form, setForm] = useState(defaults)
  const [validationError, setValidationError] = useState<string | null>(null)

  return (
    <form
      className="formStack"
      onSubmit={(event) => {
        event.preventDefault()
        try {
          setValidationError(null)
          onSubmit(form)
        } catch (submitError) {
          setValidationError(submitError instanceof Error ? submitError.message : 'Invalid form input.')
        }
      }}
    >
      {fields.map(([name, label]) => (
        <Field key={name} label={label}>
          <TextInput
            onChange={(event) => setValue(setForm, name, event.target.value)}
            required={!optionalAuthorizationFieldNames.has(name) && !name.endsWith('Id')}
            value={form[name] ?? ''}
          />
        </Field>
      ))}
      <Button disabled={pending} type="submit">
        <Save data-icon="inline-start" />
        {buttonLabel}
      </Button>
      {validationError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {validationError}
        </div>
      ) : null}
      <MutationError error={error} />
    </form>
  )
}

function AuthorizationRows({
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
                Edit
              </Button>
              <Button onClick={row.onDelete} type="button" variant="danger">
                <Trash2 data-icon="inline-start" />
                Delete
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

function AssetUploadControl({
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
  return (
    <div className="assetUploadRow">
      {previewUrl ? (
        <img alt="" className="assetPreview" src={previewUrl} width="64" height="64" />
      ) : (
        <div className="assetPreview text-muted-foreground">
          <ImageUp size={18} />
        </div>
      )}
      <Field label={label}>
        <TextInput
          accept={accept}
          aria-label={label}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) onFile(file)
            event.currentTarget.value = ''
          }}
          type="file"
        />
      </Field>
    </div>
  )
}

function ResourcePage({
  action,
  auxiliary,
  children,
  description,
  empty,
  emptyDescription,
  emptyTitle,
  error,
  framed = true,
  loading,
  onRetry,
  title,
  toolbar,
}: {
  action?: ReactNode
  auxiliary?: ReactNode
  children: ReactNode
  description: string
  empty?: boolean
  emptyDescription?: string
  emptyTitle?: string
  error?: Error | null
  framed?: boolean
  loading?: boolean
  onRetry?: () => void
  title: string
  toolbar?: ReactNode
}) {
  return (
    <>
      <PageHeader
        action={empty ? undefined : action}
        breadcrumb={['Console', title]}
        description={description}
        eyebrow="Console"
        title={title}
      />
      {toolbar ? <div>{toolbar}</div> : null}
      {loading ? <LoadingState label={`Loading ${title.toLowerCase()}`} /> : null}
      {error ? <ErrorState error={error} onRetry={onRetry} /> : null}
      {!loading && !error && empty ? (
        <EmptyState
          action={action}
          description={emptyDescription ?? `Create a ${title.toLowerCase()} item to populate this page.`}
          title={emptyTitle ?? `No ${title.toLowerCase()} yet`}
        />
      ) : null}
      {!loading && !error && !empty && framed ? (
        <Card>
          <CardContent className="p-0">{children}</CardContent>
        </Card>
      ) : null}
      {!loading && !error && !empty && !framed ? children : null}
      {auxiliary}
    </>
  )
}

function ObjectHeader({ badge, id, title }: { badge: string; id: string; title: string }) {
  return (
    <div className="objectHeader">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{badge}</Badge>
          <code className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{id}</code>
        </div>
        <p className="text-xl font-semibold leading-tight tracking-normal">{title}</p>
      </div>
    </div>
  )
}

function StickyActionBar({ children }: { children: ReactNode }) {
  return <div className="stickyActionBar">{children}</div>
}

function PageHeader({
  action,
  breadcrumb,
  description,
  eyebrow,
  title,
}: {
  action?: ReactNode
  breadcrumb?: string[]
  description: string
  eyebrow: string
  title: string
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb ? (
          <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((crumb, index) => (
              <span className="inline-flex items-center gap-1" key={crumb}>
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                <span>{crumb}</span>
              </span>
            ))}
          </div>
        ) : null}
        <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">{eyebrow}</p>
        <h1 className="text-2xl font-semibold leading-tight tracking-normal">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

function MetricCard({
  detail,
  label,
  pending,
  value,
}: {
  detail: string
  label: string
  pending?: boolean
  value: number | string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          {pending ? <Badge variant="outline">Pending</Badge> : null}
        </div>
        <CardTitle className="text-2xl">{value}</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardHeader>
    </Card>
  )
}

function SetupItem({ complete, label, value }: { complete: boolean; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-3">
      <CheckCircle2
        aria-hidden="true"
        className={cn('mt-0.5 size-4', complete ? 'text-primary' : 'text-muted-foreground')}
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-sm text-muted-foreground">{value}</p>
      </div>
    </div>
  )
}

function SetupChecklist({ items, title }: { items: ManagementReadinessItem[]; title: string }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-3">
        {items.map((item) => {
          const complete = item.status === 'complete'
          return (
            <div
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
              key={item.id}
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {complete ? (
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                ) : (
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <a className="uiButton uiButton-ghost" href={item.href}>
                {item.action}
              </a>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function DashboardListCard({
  children,
  description,
  empty,
  title,
}: {
  children: ReactNode
  description: string
  empty: string
  title: string
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {hasRows ? (
          children
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  )
}

function SecuritySectionTabs({ active }: { active: 'password-policy' | 'captcha' | 'blocklist' | 'general' }) {
  const tabs = [
    ['password-policy', 'Password policy', '/console/security/password-policy'],
    ['captcha', 'CAPTCHA', '/console/security/captcha'],
    ['blocklist', 'Blocklist', '/console/security/blocklist'],
    ['general', 'General', '/console/security/general'],
  ] as const

  return (
    <div className="inline-flex flex-wrap rounded-lg bg-muted p-1">
      {tabs.map(([value, label, to]) => (
        <a
          className={cn(
            'inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground',
            active === value && 'bg-background text-foreground shadow-sm',
          )}
          href={to}
          key={value}
        >
          {label}
        </a>
      ))}
    </div>
  )
}

function FactorStatusCard({ detail, enabled, title }: { detail: string; enabled: boolean; title: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        <StatusBadge active={enabled} activeLabel="Available" inactiveLabel="Unavailable" />
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  )
}

function SummaryRow({ meta, status, title }: { meta: string; status: ReactNode; title: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      {status}
    </div>
  )
}

function HealthRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-3">
      <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="truncate text-sm text-muted-foreground">{value}</p>
      </div>
    </div>
  )
}

function PolicyCard({ rows, title }: { rows: Array<[string, string]>; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map(([label, value]) => (
          <SettingRow key={label} label={label} value={value} />
        ))}
      </CardContent>
    </Card>
  )
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm text-muted-foreground sm:max-w-[70%] sm:text-right">{value}</span>
    </div>
  )
}

function CopyButton({ label, value }: { label: string; value: string }) {
  return (
    <Button onClick={() => navigator.clipboard.writeText(value)} type="button" variant="secondary">
      <Copy data-icon="inline-start" />
      {label}
    </Button>
  )
}

function SecretDisclosureDialog({
  clientId,
  clientSecret,
  onClose,
  open,
}: {
  clientId: string | null
  clientSecret: string | null
  onClose: () => void
  open: boolean
}) {
  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy client secret</DialogTitle>
          <DialogDescription>
            This secret is shown once. Store it in your application secret manager before closing this dialog.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 p-4">
          <SettingRow label="Client ID" value={clientId ?? ''} />
          <SettingRow label="Client secret" value={clientSecret ?? ''} />
          <CopyButton
            label="Copy secret"
            value={JSON.stringify({ clientId, clientSecret, tokenEndpointAuthMethod: 'client_secret_basic' }, null, 2)}
          />
        </div>
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button" variant="secondary">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteApplicationDialog({
  applicationName,
  error,
  onClose,
  onConfirm,
  open,
  pending,
}: {
  applicationName: string
  error: unknown
  onClose: () => void
  onConfirm: () => void
  open: boolean
  pending: boolean
}) {
  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete application</DialogTitle>
          <DialogDescription>
            Deleting {applicationName} removes the OIDC client and stops existing integrations from authenticating.
          </DialogDescription>
        </DialogHeader>
        <div className="p-4">
          <MutationError error={error} />
        </div>
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm} type="button" variant="danger">
            Delete application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BanUserDialog({
  error,
  onClose,
  onConfirm,
  open,
  pending,
  userName,
}: {
  error: unknown
  onClose: () => void
  onConfirm: (reason: string) => void
  open: boolean
  pending: boolean
  userName: string
}) {
  const [reason, setReason] = useState('')

  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban user</DialogTitle>
          <DialogDescription>Banning {userName} blocks sign-in until an admin unbans the account.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-4">
          <Field label="Reason">
            <TextArea onChange={(event) => setReason(event.target.value)} value={reason} />
          </Field>
          <MutationError error={error} />
        </div>
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onConfirm(reason)} type="button" variant="danger">
            Ban user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DangerConfirmDialog({
  actionLabel,
  description,
  error,
  onClose,
  onConfirm,
  open,
  pending,
  title,
}: {
  actionLabel: string
  description: string
  error: unknown
  onClose: () => void
  onConfirm: () => void
  open: boolean
  pending: boolean
  title: string
}) {
  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="p-4">
          <MutationError error={error} />
        </div>
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm} type="button" variant="danger">
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MutationError({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {error instanceof Error ? error.message : 'Request failed.'}
    </div>
  )
}

function SwitchRow({
  checked,
  disabled = false,
  label,
  onCheckedChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <span className="text-sm font-medium">{label}</span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={disabled ? undefined : onCheckedChange}
      />
    </div>
  )
}

function UnavailableSetting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed border-border bg-muted/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Badge variant="outline">Unavailable</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{value}</p>
    </div>
  )
}

function clientConfig(application: ApplicationResponse, clientSecret: string | null) {
  return JSON.stringify(
    {
      issuer: application.oidc.issuer,
      discoveryUrl: `${application.oidc.issuer}/.well-known/openid-configuration`,
      clientId: application.clientId,
      redirectUris: application.redirectUris,
      scopes: application.allowedScopes.join(' '),
      tokenEndpointAuthMethod: application.tokenEndpointAuthMethod,
      ...(clientSecret ? { clientSecret } : {}),
    },
    null,
    2,
  )
}

function clientTypeLabel(value: ApplicationResponse['clientType']) {
  if (value === 'public_spa') return 'Public SPA'
  if (value === 'public_native') return 'Public native'
  return 'Confidential web'
}

function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean
  activeLabel: string
  inactiveLabel: string
}) {
  return <Badge variant={active ? 'secondary' : 'outline'}>{active ? activeLabel : inactiveLabel}</Badge>
}

function EmptyState({ action, description, title }: { action?: ReactNode; description: string; title: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground">
            <ListChecks aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </CardContent>
    </Card>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <RefreshCw className="spin" data-icon="inline-start" />
        {label}
      </CardContent>
    </Card>
  )
}

function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle data-icon="inline-start" />
          {error.message}
        </div>
        {onRetry ? (
          <Button onClick={onRetry} variant="secondary">
            Retry
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CreateApplicationDialog({
  error,
  onClose,
  onSubmit,
  open,
  pending,
}: {
  error: string | null
  onClose: () => void
  onSubmit: (input: z.infer<typeof createApplicationRequestSchema>) => void
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
            onSubmit(
              parseForm(createApplicationRequestSchema, {
                ...form,
                clientType: form.clientType || 'public_spa',
                firstParty: true,
                redirectUris: form.redirectUris?.split('\n').filter(Boolean) ?? [],
              }),
            )
          } catch (submitError) {
            setValidationError(submitError instanceof Error ? submitError.message : 'Invalid form input.')
          }
        }}
        pending={pending}
        title="Create application"
      >
        <Field label="Name">
          <TextInput onChange={(event) => setValue(setForm, 'name', event.target.value)} required />
        </Field>
        <Field label="Slug">
          <TextInput
            onChange={(event) => setValue(setForm, 'slug', event.target.value)}
            placeholder="customer-portal"
          />
        </Field>
        <Field label="Client type">
          <SelectInput
            onChange={(event) => setValue(setForm, 'clientType', event.target.value)}
            defaultValue="public_spa"
          >
            <option value="public_spa">Public SPA</option>
            <option value="public_native">Public native</option>
            <option value="confidential_web">Confidential web</option>
          </SelectInput>
        </Field>
        <Field label="Redirect URIs" help="One URI per line.">
          <TextArea onChange={(event) => setValue(setForm, 'redirectUris', event.target.value)} required />
        </Field>
      </FormDialog>
    </Dialog>
  )
}

function CreateUserDialog({
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
        error={validationError ?? error}
        onClose={onClose}
        onSubmit={(event) => {
          event.preventDefault()
          try {
            setValidationError(null)
            onSubmit(parseForm(managementCreateUserRequestSchema, form))
          } catch (submitError) {
            setValidationError(submitError instanceof Error ? submitError.message : 'Invalid form input.')
          }
        }}
        pending={pending}
        title="Create user"
      >
        <Field label="Email">
          <TextInput onChange={(event) => setValue(setForm, 'email', event.target.value)} required type="email" />
        </Field>
        <Field label="Display name">
          <TextInput onChange={(event) => setValue(setForm, 'displayName', event.target.value)} required />
        </Field>
        <Field label="Username">
          <TextInput onChange={(event) => setValue(setForm, 'username', event.target.value)} />
        </Field>
        <Field label="Initial password">
          <TextInput onChange={(event) => setValue(setForm, 'password', event.target.value)} type="password" />
        </Field>
      </FormDialog>
    </Dialog>
  )
}

function CreateConnectorDialog({
  error,
  onClose,
  onSubmit,
  open,
  pending,
  templates,
}: {
  error: string | null
  onClose: () => void
  onSubmit: (input: z.infer<typeof createManagementConnectorRequestSchema>) => void
  open: boolean
  pending: boolean
  templates: ConnectorTemplate[]
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)
  const selectedTemplate = templates.find((template) => template.providerId === form.template)
  return (
    <Dialog open={open}>
      <FormDialog
        error={validationError ?? error}
        onClose={onClose}
        onSubmit={(event) => {
          event.preventDefault()
          try {
            setValidationError(null)
            onSubmit(
              parseForm(createManagementConnectorRequestSchema, {
                ...form,
                enabled: form.enabled === 'false' ? false : undefined,
                providerType: selectedTemplate?.providerType ?? form.providerType ?? 'social',
                providerId: selectedTemplate?.providerId ?? form.providerId,
                displayName: form.displayName || selectedTemplate?.displayName,
                scopes: form.scopes?.split(/\s+/).filter(Boolean),
                providerMetadata: parseMetadata(form.providerMetadata),
              }),
            )
          } catch (submitError) {
            setValidationError(submitError instanceof Error ? submitError.message : 'Invalid form input.')
          }
        }}
        pending={pending}
        title="Create connector"
      >
        <Field label="Template">
          <SelectInput
            onChange={(event) => {
              const template = templates.find((item) => item.providerId === event.target.value)
              setForm((current) => ({
                ...current,
                template: event.target.value,
                providerType: template?.providerType ?? 'social',
                providerId: template?.providerId ?? '',
                displayName: template?.displayName ?? '',
                scopes: template?.defaultScopes.join(' ') ?? '',
              }))
            }}
            value={form.template ?? ''}
          >
            <option value="">Custom provider</option>
            {templates.map((template) => (
              <option key={`${template.providerType}:${template.providerId}`} value={template.providerId}>
                {template.displayName}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Display name">
          <TextInput
            onChange={(event) => setValue(setForm, 'displayName', event.target.value)}
            required
            value={form.displayName ?? ''}
          />
        </Field>
        <Field label="Provider ID">
          <TextInput
            onChange={(event) => setValue(setForm, 'providerId', event.target.value)}
            required
            value={form.providerId ?? ''}
          />
        </Field>
        <Field label="Provider type">
          <SelectInput
            onChange={(event) => setValue(setForm, 'providerType', event.target.value)}
            value={form.providerType ?? 'social'}
          >
            <option value="social">Social</option>
            <option value="generic_oauth">Generic OAuth</option>
          </SelectInput>
        </Field>
        <Field label="Status">
          <SelectInput
            onChange={(event) => setValue(setForm, 'enabled', event.target.value)}
            value={form.enabled ?? 'true'}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled draft</option>
          </SelectInput>
        </Field>
        <Field label="Client ID">
          <TextInput onChange={(event) => setValue(setForm, 'clientId', event.target.value)} />
        </Field>
        <Field label="Client secret binding">
          <TextInput onChange={(event) => setValue(setForm, 'clientSecretBinding', event.target.value)} />
        </Field>
        <Field label="Issuer">
          <TextInput onChange={(event) => setValue(setForm, 'issuer', event.target.value)} />
        </Field>
        <Field label="Authorization endpoint">
          <TextInput onChange={(event) => setValue(setForm, 'authorizationEndpoint', event.target.value)} />
        </Field>
        <Field label="Token endpoint">
          <TextInput onChange={(event) => setValue(setForm, 'tokenEndpoint', event.target.value)} />
        </Field>
        <Field label="User info endpoint">
          <TextInput onChange={(event) => setValue(setForm, 'userInfoEndpoint', event.target.value)} />
        </Field>
        <Field label="JWKS endpoint">
          <TextInput onChange={(event) => setValue(setForm, 'jwksEndpoint', event.target.value)} />
        </Field>
        <Field label="Scopes">
          <TextInput
            onChange={(event) => setValue(setForm, 'scopes', event.target.value)}
            placeholder="openid profile email"
            value={form.scopes ?? ''}
          />
        </Field>
        <Field label="Provider metadata JSON">
          <TextArea onChange={(event) => setValue(setForm, 'providerMetadata', event.target.value)} />
        </Field>
      </FormDialog>
    </Dialog>
  )
}

function CreateRoleDialog({
  error,
  onClose,
  onSubmit,
  open,
  pending,
  resources,
}: {
  error: string | null
  onClose: () => void
  onSubmit: (input: z.infer<typeof createRoleRequestSchema>) => void
  open: boolean
  pending: boolean
  resources: Array<{ id: string; name: string }>
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
            onSubmit(parseForm(createRoleRequestSchema, form))
          } catch (submitError) {
            setValidationError(submitError instanceof Error ? submitError.message : 'Invalid form input.')
          }
        }}
        pending={pending}
        title="Create role"
      >
        <Field label="Key">
          <TextInput onChange={(event) => setValue(setForm, 'key', event.target.value)} required />
        </Field>
        <Field label="Name">
          <TextInput onChange={(event) => setValue(setForm, 'name', event.target.value)} required />
        </Field>
        <Field label="Description">
          <TextInput onChange={(event) => setValue(setForm, 'description', event.target.value)} />
        </Field>
        <Field label="API resource">
          <SelectInput onChange={(event) => setValue(setForm, 'resourceId', event.target.value)} defaultValue="">
            <option value="">Global role</option>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </FormDialog>
    </Dialog>
  )
}

function ConnectorDetailDialog({
  connector,
  error,
  onClose,
  onSubmit,
  open,
  pending,
  readiness,
}: {
  connector: ConnectorResponse | null
  error: string | null
  onClose: () => void
  onSubmit: (input: z.infer<typeof updateManagementConnectorRequestSchema>) => void
  open: boolean
  pending: boolean
  readiness: { ready: boolean; checks: Array<{ key: string; label: string; ok: boolean; message: string }> } | null
}) {
  const [form, setForm] = useState<FormState>(() => connectorToForm(connector))
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    setForm(connectorToForm(connector))
    setValidationError(null)
  }, [connector])

  if (!connector) {
    return (
      <Dialog open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connector details</DialogTitle>
            <DialogDescription>Loading connector configuration.</DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</div>
          ) : null}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{connector.displayName}</DialogTitle>
          <DialogDescription>
            {connector.providerId} {connector.providerType === 'generic_oauth' ? 'generic OAuth' : 'social'} connector
            configuration.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-4">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Configuration readiness</span>
              <Badge variant={readiness?.ready ? 'secondary' : 'outline'}>
                {readiness?.ready ? 'Ready' : 'Needs attention'}
              </Badge>
            </div>
            <div className="grid gap-2">
              {readiness?.checks.map((check) => (
                <div className="flex items-start gap-2 text-sm" key={check.key}>
                  {check.ok ? (
                    <CheckCircle2 aria-hidden="true" size={16} />
                  ) : (
                    <AlertCircle aria-hidden="true" size={16} />
                  )}
                  <div>
                    <div>{check.label}</div>
                    <div className="text-xs text-muted-foreground">{check.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              try {
                setValidationError(null)
                onSubmit(
                  parseForm(updateManagementConnectorRequestSchema, {
                    ...connectorUpdateForm(form),
                    enabled: form.enabled === 'true',
                    scopes: form.scopes?.split(/\s+/).filter(Boolean),
                    providerMetadata: parseMetadata(form.providerMetadata),
                  }),
                )
              } catch (submitError) {
                setValidationError(submitError instanceof Error ? submitError.message : 'Invalid form input.')
              }
            }}
          >
            {(validationError ?? error) ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {validationError ?? error}
              </div>
            ) : null}
            <Field label="Display name">
              <TextInput
                onChange={(event) => setValue(setForm, 'displayName', event.target.value)}
                value={form.displayName ?? ''}
              />
            </Field>
            <Field label="Slug">
              <TextInput onChange={(event) => setValue(setForm, 'slug', event.target.value)} value={form.slug ?? ''} />
            </Field>
            <Field label="Status">
              <SelectInput
                onChange={(event) => setValue(setForm, 'enabled', event.target.value)}
                value={form.enabled ?? 'true'}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </SelectInput>
            </Field>
            <Field label="Client ID">
              <TextInput
                onChange={(event) => setValue(setForm, 'clientId', event.target.value)}
                value={form.clientId ?? ''}
              />
            </Field>
            <Field label="Client secret binding">
              <TextInput
                onChange={(event) => setValue(setForm, 'clientSecretBinding', event.target.value)}
                value={form.clientSecretBinding ?? ''}
              />
            </Field>
            <Field label="Issuer">
              <TextInput
                onChange={(event) => setValue(setForm, 'issuer', event.target.value)}
                value={form.issuer ?? ''}
              />
            </Field>
            <Field label="Authorization endpoint">
              <TextInput
                onChange={(event) => setValue(setForm, 'authorizationEndpoint', event.target.value)}
                value={form.authorizationEndpoint ?? ''}
              />
            </Field>
            <Field label="Token endpoint">
              <TextInput
                onChange={(event) => setValue(setForm, 'tokenEndpoint', event.target.value)}
                value={form.tokenEndpoint ?? ''}
              />
            </Field>
            <Field label="User info endpoint">
              <TextInput
                onChange={(event) => setValue(setForm, 'userInfoEndpoint', event.target.value)}
                value={form.userInfoEndpoint ?? ''}
              />
            </Field>
            <Field label="JWKS endpoint">
              <TextInput
                onChange={(event) => setValue(setForm, 'jwksEndpoint', event.target.value)}
                value={form.jwksEndpoint ?? ''}
              />
            </Field>
            <Field label="Scopes">
              <TextInput
                onChange={(event) => setValue(setForm, 'scopes', event.target.value)}
                value={form.scopes ?? ''}
              />
            </Field>
            <Field label="Provider metadata JSON">
              <TextArea
                onChange={(event) => setValue(setForm, 'providerMetadata', event.target.value)}
                value={form.providerMetadata ?? ''}
              />
            </Field>
            <DialogFooter className="m-0 -mx-4 -mb-4">
              <Button onClick={onClose} type="button" variant="secondary">
                Close
              </Button>
              <Button disabled={pending} type="submit">
                {pending ? 'Saving...' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDialog({
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
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</div>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm} type="button" variant="danger">
            {pending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SimpleCreateDialog({
  error,
  fields,
  onClose,
  onSubmit,
  open,
  pending,
  title,
}: {
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
            setValidationError(submitError instanceof Error ? submitError.message : 'Invalid form input.')
          }
        }}
        pending={pending}
        title={title}
      >
        {fields.map(([name, label]) => (
          <Field key={name} label={label}>
            <TextInput
              onChange={(event) => setValue(setForm, name, event.target.value)}
              required={name !== 'description'}
            />
          </Field>
        ))}
      </FormDialog>
    </Dialog>
  )
}

function FormDialog({
  children,
  error,
  onClose,
  onSubmit,
  pending,
  title,
}: {
  children: ReactNode
  error: string | null
  onClose: () => void
  onSubmit: (event: FormEvent) => void
  pending: boolean
  title: string
}) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Required fields are validated before the management API request is sent.</DialogDescription>
      </DialogHeader>
      <form className="grid gap-4 p-4" onSubmit={onSubmit}>
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {children}
        <DialogFooter className="m-0 -mx-4 -mb-4">
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={pending} type="submit">
            {pending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function parseForm<T extends z.ZodType>(schema: T, form: unknown): z.infer<T> {
  const result = schema.safeParse(removeBlankValues(form))
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? 'Invalid form input.')
  return result.data
}

function parseMetadata(value: string | undefined) {
  if (!value?.trim()) return undefined
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Provider metadata must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function connectorUpdateForm(form: FormState) {
  return {
    ...form,
    clientId: nullableFormValue(form.clientId),
    clientSecretBinding: nullableFormValue(form.clientSecretBinding),
    issuer: nullableFormValue(form.issuer),
    authorizationEndpoint: nullableFormValue(form.authorizationEndpoint),
    tokenEndpoint: nullableFormValue(form.tokenEndpoint),
    userInfoEndpoint: nullableFormValue(form.userInfoEndpoint),
    jwksEndpoint: nullableFormValue(form.jwksEndpoint),
  }
}

function nullableFormValue(value: string | undefined) {
  return value === '' ? null : value
}

function connectorToForm(connector: ConnectorResponse | null): FormState {
  if (!connector) return emptyForm
  return {
    slug: connector.slug,
    displayName: connector.displayName,
    enabled: String(connector.enabled),
    clientId: connector.clientId ?? '',
    clientSecretBinding: connector.clientSecretBinding ?? '',
    issuer: connector.issuer ?? '',
    authorizationEndpoint: connector.authorizationEndpoint ?? '',
    tokenEndpoint: connector.tokenEndpoint ?? '',
    userInfoEndpoint: connector.userInfoEndpoint ?? '',
    jwksEndpoint: connector.jwksEndpoint ?? '',
    scopes: connector.scopes.join(' '),
    providerMetadata: JSON.stringify(connector.providerMetadata, null, 2),
  }
}

function removeBlankValues(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ''))
}

function nullableString(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseTokenClaims(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = JSON.parse(trimmed) as unknown
  return tokenClaimsObjectSchema.parse(parsed)
}

function customCssProperties(css: string): CSSProperties {
  const result = hostedCustomCssSchema.safeParse(css)
  if (!result.success) return {}

  return Object.fromEntries(
    result.data
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(':')
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()]
      }),
  ) as CSSProperties
}

function setValue(setForm: (next: (form: FormState) => FormState) => void, key: string, value: string) {
  setForm((form) => ({ ...form, [key]: value }))
}

function useAdminMutation<TInput, TOutput>({
  mutationFn,
  onSuccess,
}: {
  mutationFn: (input: TInput) => Promise<TOutput>
  onSuccess: (output: TOutput) => Promise<unknown>
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn,
    onMutate: () => setErrorMessage(null),
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : 'Request failed.'),
    onSuccess,
  })

  return {
    data: mutation.data,
    error: mutation.error,
    errorMessage,
    isPending: mutation.isPending,
    mutate: (input: TInput) => mutation.mutate(input),
  }
}

function formatDate(value: string | Date | undefined) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleDateString()
}

function formatRole(role: ManagementUserResponse['role']) {
  if (Array.isArray(role)) return role.join(', ')
  return role ?? 'user'
}

function userDisplayName(user: ManagementUserResponse) {
  return user.displayName ?? user.name ?? user.email ?? user.id
}
