import {
  type ApplicationResponse,
  createApplicationRequestSchema,
  replaceRedirectUrisRequestSchema,
  type updateApplicationRequestSchema,
} from '@shared/api/applications'
import {
  createApiResourceRequestSchema,
  createOrganizationRequestSchema,
  createRoleRequestSchema,
} from '@shared/api/authorization'
import { hostedCustomCssSchema } from '@shared/api/configz'
import type { ConnectorResponse, ConnectorTemplate } from '@shared/api/connectors'
import {
  createManagementConnectorRequestSchema,
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
  banUser,
  createApiResource,
  createApplication,
  createConnector,
  createOrganization,
  createRole,
  createUser,
  deleteApplication,
  deleteConnector,
  deleteUser,
  deleteUserPasskey,
  getAdminDashboard,
  getApplication,
  getBrandingSettings,
  getConnector,
  getConnectorReadiness,
  getSecurityPolicy,
  getSignInSettings,
  getUser,
  getUserSecurity,
  listApiResources,
  listApplicationClientSecrets,
  listApplications,
  listConnectors,
  listConnectorTemplates,
  listOrganizations,
  listRoles,
  listUserApplications,
  listUserLinkedAccounts,
  listUserPasskeys,
  listUserSessions,
  listUsers,
  replaceApplicationRedirectUris,
  requestPasswordReset,
  requestUserPasswordReset,
  revokeUserSession,
  revokeUserSessions,
  rotateApplicationClientSecret,
  unbanUser,
  updateApplication,
  updateBrandingSettings,
  updateConnector,
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

export function AdminDashboardPage() {
  const query = useQuery({ queryKey: adminQueryKeys.dashboard, queryFn: getAdminDashboard })

  if (query.isLoading) return <LoadingState label="Loading admin dashboard" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />

  const dashboard = query.data
  if (!dashboard) return null

  return (
    <>
      <PageHeader
        breadcrumb={['Overview']}
        eyebrow="Dashboard"
        title="Tenant health"
        description="Track setup readiness, identity activity, security posture, and standards-based integration metadata."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          detail="OIDC clients ready for authorization code flows."
          label="Applications"
          value={dashboard.applications.pagination.total}
        />
        <MetricCard
          detail="Tenant identities available to hosted auth."
          label="Users"
          value={dashboard.users.pagination.total}
        />
        <MetricCard
          detail="Organizations represented in authorization policy."
          label="Organizations"
          value={dashboard.organizations.pagination.total}
        />
        <MetricCard
          detail="Role definitions across tenant resources."
          label="Roles"
          value={dashboard.roles.pagination.total}
        />
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
      empty={query.data?.applications.length === 0}
      emptyDescription="Create your first OIDC client to connect an application to hosted authentication."
      emptyTitle="No applications yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {query.data?.applications.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Logo</TableHead>
              <TableHead>Grants</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.applications.map((application) => (
              <TableRow key={application.id}>
                <TableCell>
                  <a className="font-medium hover:underline" href={`/admin/applications/${application.id}`}>
                    {application.name}
                  </a>
                  <div className="text-xs text-muted-foreground">{application.slug}</div>
                </TableCell>
                <TableCell>
                  <div>{application.clientId}</div>
                  <div className="text-xs text-muted-foreground">{application.clientType}</div>
                </TableCell>
                <TableCell>
                  <AssetUploadControl
                    accept="image/png,image/jpeg,image/webp"
                    label={`Upload logo for ${application.name}`}
                    onFile={(file) => logoMutation.mutate({ id: application.id, file })}
                    previewUrl={application.iconUrl}
                  />
                </TableCell>
                <TableCell>{application.allowedGrantTypes.join(', ')}</TableCell>
                <TableCell>{application.allowedScopes.join(' ')}</TableCell>
                <TableCell>
                  <StatusBadge active={!application.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={`Actions for ${application.name}`}>
                      <MoreHorizontal data-icon="inline-start" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() =>
                            updateApplication(application.id, { disabled: !application.disabled }).then(() =>
                              queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications }),
                            )
                          }
                        >
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
      ) : null}
      {logoMutation.errorMessage ? <p className="p-4 text-sm text-destructive">{logoMutation.errorMessage}</p> : null}
    </ResourcePage>
  )
}

export function ApplicationDetailPage({ applicationId }: { applicationId: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null)
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
      await navigate({ to: '/admin/applications' })
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
      action={
        <Link className="uiButton uiButton-secondary" to="/admin/applications">
          Back to applications
        </Link>
      }
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {application ? (
        <div className="grid gap-4 p-4 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Client configuration</CardTitle>
              <CardDescription>Use these values with any standards-compliant OIDC SDK.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SettingRow label="Client ID" value={application.clientId} />
              <SettingRow label="Client type" value={clientTypeLabel(application.clientType)} />
              <SettingRow label="Auth method" value={application.tokenEndpointAuthMethod} />
              <SettingRow label="PKCE" value={application.requirePkce ? 'Required' : 'Optional'} />
              <SettingRow label="Discovery" value={`${application.oidc.issuer}/.well-known/openid-configuration`} />
              <SettingRow label="Issuer" value={application.oidc.issuer} />
              <CopyButton label="Copy client config" value={clientConfig(application, rotatedSecret)} />
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
              <SettingRow label="Status" value={application.disabled ? 'Disabled' : 'Enabled'} />
              <SettingRow label="Reason" value={application.disabledReason ?? 'Not set'} />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={updateMutation.isPending}
                  onClick={() =>
                    updateMutation.mutate({
                      disabled: !application.disabled,
                      disabledReason: application.disabled ? null : 'Disabled from admin console',
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

          <Card>
            <CardHeader>
              <CardTitle>Logo</CardTitle>
              <CardDescription>Image shown in application and consent surfaces.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <AssetUploadControl
                accept="image/png,image/jpeg,image/webp"
                label={`Upload logo for ${application.name}`}
                onFile={(file) => logoMutation.mutate(file)}
                previewUrl={application.iconUrl}
              />
              <MutationError error={logoMutation.error} />
              {logoMutation.errorMessage ? (
                <p className="text-sm text-destructive">{logoMutation.errorMessage}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Redirect URIs</CardTitle>
              <CardDescription>Authorization code callbacks registered for this client.</CardDescription>
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
                  <TextArea defaultValue={application.redirectUris.join('\n')} name="redirectUris" required rows={5} />
                </Field>
                <Button disabled={redirectMutation.isPending} type="submit">
                  Save redirect URIs
                </Button>
                <MutationError error={redirectMutation.error} />
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Grants and scopes</CardTitle>
              <CardDescription>Allowed OAuth grants and OIDC scopes exposed to client SDKs.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SettingRow label="Grant types" value={application.allowedGrantTypes.join(', ')} />
              <SettingRow label="Scopes" value={application.allowedScopes.join(' ')} />
              <SettingRow label="Authorization endpoint" value={application.oidc.authorizationEndpoint} />
              <SettingRow label="Token endpoint" value={application.oidc.tokenEndpoint} />
              <SettingRow label="UserInfo endpoint" value={application.oidc.userInfoEndpoint} />
              <SettingRow label="JWKS URI" value={application.oidc.jwksUri} />
            </CardContent>
          </Card>

          {application.public ? (
            <Card>
              <CardHeader>
                <CardTitle>Client secrets</CardTitle>
                <CardDescription>Public clients use PKCE and do not have a client secret.</CardDescription>
              </CardHeader>
              <CardContent>
                <SettingRow label="Secret behavior" value="No client secret is issued for public clients." />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Client secrets</CardTitle>
                <CardDescription>
                  Raw secrets are only shown once immediately after creation or rotation.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
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
                <Button disabled={rotateMutation.isPending} onClick={() => rotateMutation.mutate()} type="button">
                  Rotate client secret
                </Button>
                <MutationError error={secretsQuery.error ?? rotateMutation.error} />
              </CardContent>
            </Card>
          )}
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

export function AdminOnboardingPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: 'Demo application',
    slug: 'demo-application',
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
      title="Admin onboarding"
      description="Create the first OIDC client, review auth readiness, and copy the standards-based integration details."
      error={createMutation.error}
      loading={false}
    >
      <div className="resourceGrid">
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
        <Card>
          <CardHeader>
            <CardTitle>Client integration</CardTitle>
            <CardDescription>Use OIDC discovery with authorization code and PKCE.</CardDescription>
          </CardHeader>
          <CardContent>
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
                  <a className="font-medium hover:underline" href={`/admin/users/${user.id}`}>
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
      await navigate({ to: '/admin/users' })
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
        <Link className="uiButton uiButton-secondary" to="/admin/users">
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
      title="Connectors"
      description="Configure social and generic OAuth providers used by the hosted sign-in settings."
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" />
          New connector
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
      emptyTitle="No connectors yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
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
    <ResourcePage
      title="Sign-in experience"
      description="Configure identifiers, authentication method visibility, defaults, legal links, and hosted auth copy."
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {query.data ? (
        <form className="grid gap-4 xl:grid-cols-2" onSubmit={onSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Authentication methods</CardTitle>
              <CardDescription>Control which hosted sign-in options are visible at runtime.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SwitchRow
                checked={form.passwordEnabled}
                label="Password sign-in"
                onCheckedChange={(passwordEnabled) => setForm((value) => ({ ...value, passwordEnabled }))}
              />
              <SwitchRow
                checked={form.signupEnabled}
                label="Self-service sign-up"
                onCheckedChange={(signupEnabled) => setForm((value) => ({ ...value, signupEnabled }))}
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
                label="Magic link"
                value={query.data.signIn.magicLinkEnabled ? 'Available from runtime' : 'Unavailable'}
              />
              <SettingRow
                label="Email OTP"
                value={query.data.signIn.emailOtpEnabled ? 'Available from runtime' : 'Unavailable'}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Defaults and links</CardTitle>
              <CardDescription>Safe public links and copy exposed through configz.</CardDescription>
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
              <Field label="Default application ID">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, applicationId: event.target.value }))}
                  value={form.applicationId}
                />
              </Field>
              <Field label="Default redirect URI">
                <TextInput
                  onChange={(event) => setForm((value) => ({ ...value, redirectUri: event.target.value }))}
                  type="url"
                  value={form.redirectUri}
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
        </form>
      ) : null}
    </ResourcePage>
  )
}

export function SecurityPage() {
  const query = useQuery({ queryKey: adminQueryKeys.security, queryFn: getSecurityPolicy })
  const [tab, setTab] = useState('mfa')

  return (
    <ResourcePage
      title="Security"
      description="Review MFA, passkey, and session policy surfaced by the admin API."
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {query.data ? (
        <Tabs className="flex flex-col gap-4" setValue={setTab} value={tab}>
          <TabsList>
            <TabsTrigger value="mfa">MFA</TabsTrigger>
            <TabsTrigger value="passkeys">Passkeys</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>
          <TabsContent value="mfa">
            <PolicyCard rows={[['Mode', query.data.policy.mfa.mode]]} title="Multi-factor authentication" />
          </TabsContent>
          <TabsContent value="passkeys">
            <PolicyCard
              rows={[
                ['Enabled', query.data.policy.passkeys.enabled ? 'Yes' : 'No'],
                ['RP ID', query.data.policy.passkeys.rpId],
                ['RP name', query.data.policy.passkeys.rpName],
                ['Origins', query.data.policy.passkeys.origins.join(', ')],
              ]}
              title="Passkeys"
            />
          </TabsContent>
          <TabsContent value="sessions">
            <PolicyCard
              rows={[
                ['Expires in', `${query.data.policy.sessions.expiresInSeconds}s`],
                ['Update age', `${query.data.policy.sessions.updateAgeSeconds}s`],
                ['Fresh age', `${query.data.policy.sessions.freshAgeSeconds}s`],
                ['Cookie cache', `${query.data.policy.sessions.cookieCacheSeconds}s`],
              ]}
              title="Session policy"
            />
          </TabsContent>
        </Tabs>
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
        <SimpleCreateDialog
          error={createMutation.errorMessage}
          fields={[
            ['key', 'Key'],
            ['name', 'Name'],
            ['description', 'Description'],
          ]}
          onClose={() => setDialogOpen(false)}
          onSubmit={(form) => createMutation.mutate(parseForm(createRoleRequestSchema, form))}
          open={dialogOpen}
          pending={createMutation.isPending}
          title="Create role"
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
                <div className="font-medium">{role.name}</div>
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
                <div className="font-medium">{resource.name}</div>
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

export function BrandingPage() {
  const query = useQuery({ queryKey: adminQueryKeys.branding, queryFn: getBrandingSettings })
  const queryClient = useQueryClient()
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
    <ResourcePage
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
              <CardTitle>Brand preview</CardTitle>
              <CardDescription>Preview uses the same public config consumed by hosted auth surfaces.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="brandingPreview" style={previewStyle}>
                <div className="brand">
                  {form.logoUrl ? (
                    <img className="brandLogo" src={form.logoUrl} alt="" />
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
                  Preview action
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}
    </ResourcePage>
  )
}

export function DeploymentSettingsPage() {
  return (
    <ResourcePage
      title="Deployment"
      description="Operational settings and public metadata for this Cloudflare deployment."
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Runtime</CardTitle>
            <CardDescription>Static console settings tied to the current deployment.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SettingRow label="Platform" value="Cloudflare Workers" />
            <SettingRow label="Database" value="D1" />
            <SettingRow label="Auth issuer" value="/api/auth" />
            <SettingRow label="Management API" value="/api/management" />
          </CardContent>
        </Card>
      </div>
    </ResourcePage>
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
        <img alt="" className="assetPreview" src={previewUrl} />
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
        eyebrow="Admin"
        title={title}
      />
      {toolbar ? <div className="max-w-sm">{toolbar}</div> : null}
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

function MetricCard({ detail, label, value }: { detail: string; label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
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
  label,
  onCheckedChange,
}: {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <span className="text-sm font-medium">{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
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
