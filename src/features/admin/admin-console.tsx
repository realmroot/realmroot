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
import { createManagementConnectorRequestSchema, managementCreateUserRequestSchema } from '@shared/api/management'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  ImageUp,
  ListChecks,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
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
  createApiResource,
  createApplication,
  createConnector,
  createOrganization,
  createRole,
  createUser,
  deleteApplication,
  getAdminDashboard,
  getApplication,
  getSecurityPolicy,
  getSignInSettings,
  listApiResources,
  listApplicationClientSecrets,
  listApplications,
  listConnectors,
  listOrganizations,
  listRoles,
  listUsers,
  replaceApplicationRedirectUris,
  requestPasswordReset,
  rotateApplicationClientSecret,
  updateApplication,
  updateConnector,
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
  const query = useQuery({
    queryKey: [...adminQueryKeys.users, search],
    queryFn: () => listUsers(search ? { search } : {}),
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
        <TextInput
          aria-label="Search users"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search users"
          value={search}
        />
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                <div className="font-medium">{user.name ?? user.email ?? user.id}</div>
                <div className="text-xs text-muted-foreground">{user.email ?? user.id}</div>
              </TableCell>
              <TableCell>{Array.isArray(user.role) ? user.role.join(', ') : (user.role ?? 'user')}</TableCell>
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
    </ResourcePage>
  )
}

export function ConnectorsPage() {
  const query = useQuery({ queryKey: adminQueryKeys.connectors, queryFn: listConnectors })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const createMutation = useAdminMutation({
    mutationFn: createConnector,
    onSuccess: () => {
      setDialogOpen(false)
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
              <TableCell className="text-right">
                <Switch
                  aria-label={`Toggle ${connector.displayName}`}
                  checked={connector.enabled}
                  onCheckedChange={(enabled) =>
                    updateConnector(connector.id, { enabled }).then(() =>
                      queryClient.invalidateQueries({ queryKey: adminQueryKeys.connectors }),
                    )
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}

export function SignInSettingsPage() {
  const query = useQuery({ queryKey: adminQueryKeys.signIn, queryFn: getSignInSettings })

  return (
    <ResourcePage
      title="Sign-in experience"
      description="Review enabled identifiers, authentication methods, and hosted auth links."
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {query.data ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Authentication methods</CardTitle>
              <CardDescription>These settings are served by the management API.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {Object.entries(query.data.signIn).map(([key, value]) => (
                <SettingRow key={key} label={humanize(key)} value={value ? 'Enabled' : 'Disabled'} />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Defaults and links</CardTitle>
              <CardDescription>Hosted auth destinations and support references.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <SettingRow label="Default application" value={query.data.defaults.applicationId ?? 'Not set'} />
              <SettingRow label="Default redirect URI" value={query.data.defaults.redirectUri ?? 'Not set'} />
              <SettingRow label="Terms" value={query.data.links.termsUri ?? 'Not set'} />
              <SettingRow label="Privacy" value={query.data.links.privacyUri ?? 'Not set'} />
              <SettingRow label="Support email" value={query.data.links.supportEmail ?? 'Not set'} />
            </CardContent>
          </Card>
        </div>
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
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null)
  const logoMutation = useAdminMutation({
    mutationFn: uploadBrandingLogo,
    onSuccess: (response) => {
      setLogoPreview(response.asset.publicUrl)
      return Promise.resolve()
    },
  })
  const faviconMutation = useAdminMutation({
    mutationFn: uploadBrandingFavicon,
    onSuccess: (response) => {
      setFaviconPreview(response.asset.publicUrl)
      return Promise.resolve()
    },
  })

  return (
    <ResourcePage title="Branding" description="Hosted sign-in branding preview and deployment-owned theme settings.">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Brand preview</CardTitle>
            <CardDescription>Upload deployment-owned logos and favicons for hosted pages.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SettingRow label="Product name" value="FlareAuth" />
            <SettingRow label="Primary color" value="var(--brand-primary)" />
            <SettingRow label="Custom CSS" value="Configured through configz service" />
            <AssetUploadControl
              accept="image/png,image/jpeg,image/webp"
              label="Upload branding logo"
              onFile={(file) => logoMutation.mutate(file)}
              previewUrl={logoPreview}
            />
            <AssetUploadControl
              accept="image/png,image/webp,image/x-icon,image/vnd.microsoft.icon"
              label="Upload favicon"
              onFile={(file) => faviconMutation.mutate(file)}
              previewUrl={faviconPreview}
            />
            {logoMutation.errorMessage ? <p className="text-sm text-destructive">{logoMutation.errorMessage}</p> : null}
            {faviconMutation.errorMessage ? (
              <p className="text-sm text-destructive">{faviconMutation.errorMessage}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
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

function MutationError({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {error instanceof Error ? error.message : 'Request failed.'}
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
}: {
  error: string | null
  onClose: () => void
  onSubmit: (input: z.infer<typeof createManagementConnectorRequestSchema>) => void
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
              parseForm(createManagementConnectorRequestSchema, {
                ...form,
                providerType: form.providerType || 'social',
                scopes: form.scopes?.split(/\s+/).filter(Boolean),
              }),
            )
          } catch (submitError) {
            setValidationError(submitError instanceof Error ? submitError.message : 'Invalid form input.')
          }
        }}
        pending={pending}
        title="Create connector"
      >
        <Field label="Display name">
          <TextInput onChange={(event) => setValue(setForm, 'displayName', event.target.value)} required />
        </Field>
        <Field label="Provider ID">
          <TextInput onChange={(event) => setValue(setForm, 'providerId', event.target.value)} required />
        </Field>
        <Field label="Provider type">
          <SelectInput
            onChange={(event) => setValue(setForm, 'providerType', event.target.value)}
            defaultValue="social"
          >
            <option value="social">Social</option>
            <option value="generic_oauth">Generic OAuth</option>
          </SelectInput>
        </Field>
        <Field label="Client ID">
          <TextInput onChange={(event) => setValue(setForm, 'clientId', event.target.value)} required />
        </Field>
        <Field label="Client secret binding">
          <TextInput onChange={(event) => setValue(setForm, 'clientSecretBinding', event.target.value)} required />
        </Field>
        <Field label="Issuer">
          <TextInput onChange={(event) => setValue(setForm, 'issuer', event.target.value)} />
        </Field>
        <Field label="Scopes">
          <TextInput
            onChange={(event) => setValue(setForm, 'scopes', event.target.value)}
            placeholder="openid profile email"
          />
        </Field>
      </FormDialog>
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

function removeBlankValues(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ''))
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

function humanize(value: string) {
  return value.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`)
}
