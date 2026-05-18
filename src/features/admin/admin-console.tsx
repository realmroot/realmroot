import { createApplicationRequestSchema } from '@shared/api/applications'
import {
  createApiResourceRequestSchema,
  createOrganizationRequestSchema,
  createRoleRequestSchema,
} from '@shared/api/authorization'
import { createManagementConnectorRequestSchema, managementCreateUserRequestSchema } from '@shared/api/management'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, MoreHorizontal, Plus, RefreshCw } from 'lucide-react'
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
  getAdminDashboard,
  getSecurityPolicy,
  getSignInSettings,
  listApiResources,
  listApplications,
  listConnectors,
  listOrganizations,
  listRoles,
  listUsers,
  requestPasswordReset,
  updateApplication,
  updateConnector,
  updateUser,
} from '@/lib/api/management'

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
        eyebrow="Overview"
        title="Tenant health"
        description="Operational counts and configuration states across identity, access, and experience modules."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Applications" value={dashboard.applications.pagination.total} />
        <MetricCard label="Users" value={dashboard.users.pagination.total} />
        <MetricCard label="Organizations" value={dashboard.organizations.pagination.total} />
        <MetricCard label="Roles" value={dashboard.roles.pagination.total} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent applications</CardTitle>
            <CardDescription>OIDC clients and their current operational state.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Client type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.applications.applications.slice(0, 5).map((application) => (
                  <TableRow key={application.id}>
                    <TableCell>
                      <div className="font-medium">{application.name}</div>
                      <div className="text-xs text-muted-foreground">{application.clientId}</div>
                    </TableCell>
                    <TableCell>{application.clientType}</TableCell>
                    <TableCell>
                      <StatusBadge active={!application.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Security posture</CardTitle>
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
      </div>
    </>
  )
}

export function ApplicationsPage() {
  const query = useQuery({ queryKey: adminQueryKeys.applications, queryFn: listApplications })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const createMutation = useAdminMutation({
    mutationFn: createApplication,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: adminQueryKeys.applications })
    },
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
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Grants</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data?.applications.map((application) => (
            <TableRow key={application.id}>
              <TableCell>
                <div className="font-medium">{application.name}</div>
                <div className="text-xs text-muted-foreground">{application.slug}</div>
              </TableCell>
              <TableCell>
                <div>{application.clientId}</div>
                <div className="text-xs text-muted-foreground">{application.clientType}</div>
              </TableCell>
              <TableCell>{application.allowedGrantTypes.join(', ')}</TableCell>
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
      <CreateApplicationDialog
        error={createMutation.errorMessage}
        onClose={() => setDialogOpen(false)}
        onSubmit={createMutation.mutate}
        open={dialogOpen}
        pending={createMutation.isPending}
      />
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
      error={query.error}
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
      <CreateUserDialog
        error={createMutation.errorMessage}
        onClose={() => setDialogOpen(false)}
        onSubmit={createMutation.mutate}
        open={dialogOpen}
        pending={createMutation.isPending}
      />
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
      description="Configure social and generic OAuth providers used by the hosted sign-in experience."
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" />
          New connector
        </Button>
      }
      error={query.error}
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
      <CreateConnectorDialog
        error={createMutation.errorMessage}
        onClose={() => setDialogOpen(false)}
        onSubmit={createMutation.mutate}
        open={dialogOpen}
        pending={createMutation.isPending}
      />
    </ResourcePage>
  )
}

export function SignInExperiencePage() {
  const query = useQuery({ queryKey: adminQueryKeys.signIn, queryFn: getSignInSettings })

  return (
    <ResourcePage
      title="Sign-in experience"
      description="Review enabled identifiers, authentication methods, and hosted experience links."
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
              <CardDescription>Hosted experience destinations and support references.</CardDescription>
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
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Display name</TableHead>
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
                <StatusBadge active={!organization.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      error={query.error}
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
      error={query.error}
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
    </ResourcePage>
  )
}

export function BrandingPage() {
  return (
    <ResourcePage title="Branding" description="Hosted sign-in branding preview and deployment-owned theme settings.">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Brand preview</CardTitle>
            <CardDescription>Visual controls are deployment settings in this version.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <SettingRow label="Product name" value="FlareAuth" />
            <SettingRow label="Primary color" value="var(--brand-primary)" />
            <SettingRow label="Custom CSS" value="Configured through experience service" />
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

function ResourcePage({
  action,
  children,
  description,
  error,
  loading,
  onRetry,
  title,
  toolbar,
}: {
  action?: ReactNode
  children: ReactNode
  description: string
  error?: Error | null
  loading?: boolean
  onRetry?: () => void
  title: string
  toolbar?: ReactNode
}) {
  return (
    <>
      <PageHeader action={action} description={description} eyebrow="Admin" title={title} />
      {toolbar ? <div className="max-w-sm">{toolbar}</div> : null}
      {loading ? <LoadingState label={`Loading ${title.toLowerCase()}`} /> : null}
      {error ? <ErrorState error={error} onRetry={onRetry} /> : null}
      {!loading && !error ? (
        <Card>
          <CardContent className="p-0">{children}</CardContent>
        </Card>
      ) : null}
    </>
  )
}

function PageHeader({
  action,
  description,
  eyebrow,
  title,
}: {
  action?: ReactNode
  description: string
  eyebrow: string
  title: string
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">{eyebrow}</p>
        <h1 className="text-2xl font-semibold leading-tight tracking-normal">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
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
    <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
      <span className="text-sm font-medium">{label}</span>
      <span className="max-w-[70%] text-right text-sm text-muted-foreground">{value}</span>
    </div>
  )
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
  onSuccess: () => Promise<unknown>
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn,
    onMutate: () => setErrorMessage(null),
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : 'Request failed.'),
    onSuccess,
  })

  return {
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
