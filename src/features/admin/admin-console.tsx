import type {
  AgentProtocolAgent,
  AgentProtocolApprovalRequest,
  AgentProtocolCapabilityGrant,
  AgentProtocolHost,
} from '@shared/api/agents'
import {
  type ApplicationOidcClaims,
  type ApplicationResponse,
  createApplicationRequestSchema,
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
  updateOrganizationRequestSchema,
  updateRoleRequestSchema,
} from '@shared/api/authorization'
import { hostedCustomCssSchema } from '@shared/api/configz'
import type { ConnectorResponse, ConnectorTemplate } from '@shared/api/connectors'
import {
  createManagementConnectorRequestSchema,
  type ListManagementConnectorsResponse,
  type ManagementReadinessItem,
  type ManagementSignInSettingsResponse,
  type ManagementUserResponse,
  managementCreateUserRequestSchema,
  managementUpdateUserRequestSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementConnectorRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
import type { SecurityPolicy } from '@shared/api/security'
import {
  createWebhookEndpointRequestSchema,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookRequest,
  webhookEvents,
} from '@shared/api/webhooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertCircle,
  AppWindow,
  Bot,
  CalendarDays,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  Globe2,
  ImageUp,
  KeyRound,
  LifeBuoy,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Server,
  Smartphone,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  type CSSProperties,
  createElement,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useId,
  useState,
} from 'react'
import type { z } from 'zod'
import { AuthCardFrame } from '@/components/layout/auth-layout'
import { ProviderIcon } from '@/components/provider-icon'
import { Badge } from '@/components/ui/badge'
import { Button, LinkButton } from '@/components/ui/button'
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
import { EmptyState } from '@/components/ui/empty-state'
import { Field, SelectInput, TextArea, TextInput } from '@/components/ui/field'
import { PageHeader } from '@/components/ui/page-header'
import { SettingRow } from '@/components/ui/setting-row'
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableEmptyRow, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SignInCardBody, SignInMethodButtons, SignUpCardBody, SignUpForm } from '@/features/auth/auth-pages'
import {
  type AdminDashboard,
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
  createWebhookEndpoint,
  deleteApiPermission,
  deleteApiResource,
  deleteApiScope,
  deleteApplication,
  deleteConnector,
  deleteRole,
  deleteUser,
  deleteUserPasskey,
  deleteWebhookEndpoint,
  getAccountCenterSettings,
  getAdminDashboard,
  getAdminReadiness,
  getAgentInventory,
  getApiResource,
  getApplication,
  getBrandingSettings,
  getConnector,
  getOrganization,
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
  listWebhookEndpoints,
  listWebhookRequests,
  replaceRolePermissions,
  requestPasswordReset,
  requestUserPasswordReset,
  retryWebhookRequest,
  revokeAgent,
  revokeAgentCapabilityGrant,
  revokeAgentHost,
  revokeUserSession,
  revokeUserSessions,
  rotateApplicationClientSecret,
  rotateWebhookEndpointSecret,
  unbanUser,
  updateAccountCenterSettings,
  updateApiPermission,
  updateApiResource,
  updateApiScope,
  updateApplication,
  updateBrandingSettings,
  updateConnector,
  updateOrganization,
  updateRole,
  updateSecurityPolicy,
  updateSignInSettings,
  updateUser,
  updateWebhookEndpoint,
  uploadApplicationLogo,
  uploadBrandingFavicon,
  uploadBrandingLogo,
  uploadOrganizationLogo,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ConsoleActionBar, ConsoleDetailStack, ConsoleToolbar } from './console-primitives'

type FormState = Record<string, string>
const emptyForm: FormState = {}
const emptyConnectorsResponse: ListManagementConnectorsResponse = {
  connectors: [],
  pagination: {
    limit: 50,
    offset: 0,
    total: 0,
    nextOffset: null,
  },
}
const tokenClaimsObjectSchema = tokenClaimsSchema.optional()
const optionalAuthorizationFieldNames = new Set([
  'description',
  'disabledReason',
  'displayName',
  'tokenClaimName',
  'tokenClaimValue',
  'tokenClaimsNamespace',
])
type DetailTab = {
  value: string
  label: string
}
type ApplicationDetailSection = 'settings' | 'branding'
type UserDetailSection = 'profile' | 'security' | 'sessions' | 'linked-accounts' | 'applications' | 'operations'
type OrganizationDetailSection = 'settings' | 'authorization'
type RoleDetailSection = 'settings' | 'permissions' | 'assignments'
type ApiResourceDetailSection = 'settings' | 'scopes' | 'permissions'
type OrganizationTemplateSection = 'organization-roles' | 'organization-permissions'
type WebhooksSection = 'endpoints' | 'requests'
type SignInPreviewSurface = 'desktop' | 'mobile'
type SignInMode = 'password' | 'otp'
type HostedAuthPreviewFlow = 'sign-in' | 'email' | 'sign-up'
type HostedAuthPreviewState = {
  backgroundColor?: string
  customCss?: string
  description: string
  emailOtpEnabled?: boolean
  headline: string
  identifierFirst?: boolean
  logoUrl?: string
  passwordEnabled?: boolean
  primaryColor?: string
  privacyUri?: string
  productName: string
  passkeysEnabled?: boolean
  phoneEnabled?: boolean
  oneTapEnabled?: boolean
  signupEnabled?: boolean
  socialLoginEnabled?: boolean
  socialProviders?: Array<{
    displayName: string
    icon: string
    providerId: string
    slug: string
  }>
  supportEmail?: string
  termsUri?: string
  usernameEnabled?: boolean
  web3WalletEnabled?: boolean
}
type SmsProviderId = ManagementSignInSettingsResponse['builtInProviders']['phone']['smsProvider']
const smsProviderOptions: Array<{
  value: SmsProviderId
  label: string
}> = [
  {
    value: 'twilio',
    label: 'Twilio',
  },
  {
    value: 'vonage',
    label: 'Vonage',
  },
  {
    value: 'messagebird',
    label: 'MessageBird',
  },
]
const applicationTypeOptions = [
  {
    value: 'public_spa',
    title: 'Single-page app',
    description: 'Browser client using authorization code with PKCE and no client secret.',
    icon: AppWindow,
  },
  {
    value: 'confidential_web',
    title: 'Traditional web app',
    description: 'Server-rendered or backend app that can hold a confidential client secret.',
    icon: Globe2,
  },
  {
    value: 'public_native',
    title: 'Native app',
    description: 'Mobile or desktop client using app redirects and PKCE protection.',
    icon: Smartphone,
  },
] as const
export function AdminDashboardPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.dashboard,
    queryFn: getAdminDashboard,
  })
  if (query.isLoading) return <LoadingState label={tt('Loading Console dashboard')} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const dashboard = query.data
  if (!dashboard) return null
  return (
    <>
      <PageHeader
        title={tt('Dashboard')}
        description={tt('Get an overview about your identity service performance.')}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          detail={tt('Tenant identities available to hosted auth.')}
          label={tt('Total users')}
          value={dashboard.users.pagination.total}
        />
        <MetricCard
          detail={tt('Users created in the last 24 hours.')}
          label={tt('New users today')}
          pending
          value="--"
        />
        <MetricCard
          detail={tt('Users created in the past seven days.')}
          label={tt('New users past 7 days')}
          pending
          value="--"
        />
      </div>
      <DashboardChartPanel dashboard={dashboard} />
    </>
  )
}
export function AgentsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: adminQueryKeys.agents,
    queryFn: getAgentInventory,
  })
  const revokeMutation = useMutation({
    mutationFn: (input: { kind: 'agent' | 'host' | 'grant'; id: string }) => {
      if (input.kind === 'agent') return revokeAgent(input.id)
      if (input.kind === 'host') return revokeAgentHost(input.id)
      return revokeAgentCapabilityGrant(input.id)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.agents }),
  })

  return (
    <ResourcePage
      description={tt('Inventory AgentAuth hosts, agents, approval requests, and capability grants.')}
      error={query.error ?? revokeMutation.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      title={tt('Delegated agents')}
    >
      {query.data ? (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard
              detail={tt('Registered AgentAuth hosts.')}
              label={tt('Hosts')}
              value={query.data.hosts.pagination.total}
            />
            <MetricCard
              detail={tt('Delegated agents linked to users.')}
              label={tt('Agents')}
              value={query.data.agents.pagination.total}
            />
            <MetricCard
              detail={tt('Approved capability grants.')}
              label={tt('Grants')}
              value={query.data.capabilityGrants.pagination.total}
            />
            <MetricCard
              detail={tt('Device authorization approval requests.')}
              label={tt('Approvals')}
              value={query.data.approvalRequests.pagination.total}
            />
          </div>
          <AgentInventoryTable
            agents={query.data.agents.items}
            grants={query.data.capabilityGrants.items}
            pending={revokeMutation.isPending}
            revoke={(kind, id) => revokeMutation.mutate({ kind, id })}
          />
          <AgentHostTable
            hosts={query.data.hosts.items}
            pending={revokeMutation.isPending}
            revoke={(id) => revokeMutation.mutate({ kind: 'host', id })}
          />
          <AgentApprovalRequestTable requests={query.data.approvalRequests.items} />
        </div>
      ) : null}
    </ResourcePage>
  )
}
function AgentInventoryTable({
  agents,
  grants,
  pending,
  revoke,
}: {
  agents: AgentProtocolAgent[]
  grants: AgentProtocolCapabilityGrant[]
  pending: boolean
  revoke: (kind: 'agent' | 'grant', id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Agents')}</CardTitle>
        <CardDescription>{tt('Delegated identities and active capability grants.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Agent')}</TableHead>
              <TableHead>{tt('User')}</TableHead>
              <TableHead>{tt('Capabilities')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead>{tt('Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.length ? (
              agents.map((agent) => {
                const agentGrants = grants.filter((grant) => grant.agentId === agent.id)
                return (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{agent.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{agent.id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{agent.userId ?? tt('Unlinked')}</TableCell>
                    <TableCell>
                      <div className="grid gap-2">
                        {agentGrants.length ? (
                          agentGrants.map((grant) => (
                            <div className="flex flex-wrap items-center gap-2" key={grant.id}>
                              <code className="rounded bg-muted px-2 py-1 text-xs">{grant.capability}</code>
                              <Button
                                disabled={pending}
                                onClick={() => revoke('grant', grant.id)}
                                type="button"
                                variant="ghost"
                              >
                                <Trash2 data-icon="inline-start" /> {tt('Revoke')}
                              </Button>
                            </div>
                          ))
                        ) : (
                          <span className="text-muted-foreground">{tt('No grants')}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>{agent.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        disabled={pending}
                        onClick={() => revoke('agent', agent.id)}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 data-icon="inline-start" /> {tt('Revoke')}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableEmptyRow
                colSpan={5}
                title={tt('No delegated agents.')}
                description={tt('Approved delegated agents will appear here.')}
              />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
function AgentHostTable({
  hosts,
  pending,
  revoke,
}: {
  hosts: AgentProtocolHost[]
  pending: boolean
  revoke: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Hosts')}</CardTitle>
        <CardDescription>{tt('Registered AgentAuth host records.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Host')}</TableHead>
              <TableHead>{tt('User')}</TableHead>
              <TableHead>{tt('Capabilities')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead>{tt('Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hosts.length ? (
              hosts.map((host) => (
                <TableRow key={host.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <Server className="size-4 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{host.name ?? host.id}</p>
                        <p className="truncate text-xs text-muted-foreground">{host.id}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{host.userId ?? tt('Unlinked')}</TableCell>
                  <TableCell className="max-w-sm truncate">{host.defaultCapabilities ?? tt('None')}</TableCell>
                  <TableCell>
                    <Badge variant={host.status === 'active' ? 'secondary' : 'outline'}>{host.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button disabled={pending} onClick={() => revoke(host.id)} type="button" variant="ghost">
                      <Trash2 data-icon="inline-start" /> {tt('Revoke')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={5}
                title={tt('No agent hosts.')}
                description={tt('Registered AgentAuth hosts will appear here.')}
              />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
function AgentApprovalRequestTable({ requests }: { requests: AgentProtocolApprovalRequest[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Approval requests')}</CardTitle>
        <CardDescription>{tt('Device authorization requests and their approval state.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Request')}</TableHead>
              <TableHead>{tt('Agent')}</TableHead>
              <TableHead>{tt('Host')}</TableHead>
              <TableHead>{tt('Capabilities')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.length ? (
              requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{request.method}</p>
                      <p className="truncate text-xs text-muted-foreground">{request.id}</p>
                    </div>
                  </TableCell>
                  <TableCell>{request.agentId ?? tt('Unlinked')}</TableCell>
                  <TableCell>{request.hostId ?? tt('Unlinked')}</TableCell>
                  <TableCell className="max-w-sm truncate">{request.capabilities ?? tt('None')}</TableCell>
                  <TableCell>
                    <Badge variant={request.status === 'approved' ? 'secondary' : 'outline'}>{request.status}</Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={5}
                title={tt('No approval requests.')}
                description={tt('Device authorization requests will appear here.')}
              />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
export function ApplicationsPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.applications,
    queryFn: listApplications,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedTab, setSelectedTab] = useState<'my-apps' | 'third-party'>('my-apps')
  const [search, setSearch] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createApplication,
    onSuccess: () => {
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.applications,
        }),
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.readiness,
        }),
      ])
    },
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
      title={tt('Applications')}
      description={tt('Manage OIDC clients, redirect URIs, grant types, and client security posture.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New application')}{' '}
        </Button>
      }
      auxiliary={
        <CreateApplicationDialog
          createdApplication={createMutation.data ?? null}
          error={createMutation.errorMessage}
          onClose={() => {
            setDialogOpen(false)
            createMutation.reset()
          }}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          pending={createMutation.isPending}
        />
      }
      error={query.error}
      empty={applications.length === 0}
      emptyDescription="Create your first OIDC client to connect an application to hosted authentication."
      emptyTitle="No applications yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <Tabs setValue={(value) => setSelectedTab(value as 'my-apps' | 'third-party')} value={selectedTab}>
        <ListToolbar>
          <TabsList aria-label={tt('Application lists')}>
            <TabsTrigger value="my-apps">{tt('My apps')}</TabsTrigger>
            <TabsTrigger value="third-party">{tt('Third-party apps')}</TabsTrigger>
          </TabsList>
          <TextInput
            aria-label={tt('Search applications')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search applications')}
            value={search}
          />
        </ListToolbar>
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
            onToggleDisabled={(application) =>
              updateApplication(application.id, {
                disabled: !application.disabled,
              }).then(() =>
                queryClient.invalidateQueries({
                  queryKey: adminQueryKeys.applications,
                }),
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
            onToggleDisabled={(application) =>
              updateApplication(application.id, {
                disabled: !application.disabled,
              }).then(() =>
                queryClient.invalidateQueries({
                  queryKey: adminQueryKeys.applications,
                }),
              )
            }
          />
        </TabsContent>
      </Tabs>
    </ResourcePage>
  )
}
export function ApplicationDetailPage({
  applicationId,
  section = 'settings',
}: {
  applicationId: string
  section?: ApplicationDetailSection
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState<ApplicationDetailSection>(section)
  const [redirectFormError, setRedirectFormError] = useState<string | null>(null)
  const [customDataFormError, setCustomDataFormError] = useState<string | null>(null)
  useEffect(() => setSelectedTab(section), [section])
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
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.applications,
      })
    },
  })
  const rotateMutation = useMutation({
    mutationFn: () => rotateApplicationClientSecret(applicationId),
    onSuccess: (result) => {
      setRotatedSecret(result.clientSecret)
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...adminQueryKeys.applications, applicationId],
        }),
        queryClient.invalidateQueries({
          queryKey: [...adminQueryKeys.applications, applicationId, 'client-secrets'],
        }),
      ])
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteApplication(applicationId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.applications,
        }),
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.readiness,
        }),
      ])
      await navigate({
        to: '/console/applications',
      })
    },
  })
  const logoMutation = useAdminMutation({
    mutationFn: (file: File) => uploadApplicationLogo(applicationId, file),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...adminQueryKeys.applications, applicationId],
        }),
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.applications,
        }),
      ]),
  })
  const application = query.data
  const redirectUris = listValue(application?.redirectUris, '\n')
  const postLogoutRedirectUris = listValue(application?.postLogoutRedirectUris, '\n')
  const corsOrigins = listValue(application?.corsOrigins, '\n')
  return (
    <ResourcePage
      title={application?.name ?? tt('Application')}
      description={tt(
        'Review client configuration, manage redirect URIs, rotate confidential secrets, and copy standard OIDC integration details.',
      )}
      framed={false}
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {application ? (
        <ConsoleDetailStack>
          <a className="consoleBackLink" href="/console/applications">
            <Undo2 data-icon="inline-start" /> {tt('Back to applications')}{' '}
          </a>
          <ObjectHeader
            badge={clientTypeLabel(application.clientType)}
            id={application.clientId}
            title={application.name}
          />
          <Tabs
            setValue={(value) => {
              const next = value as ApplicationDetailSection
              setSelectedTab(next)
              navigateConsoleTab(navigate, `/console/applications/${applicationId}/${next}`)
            }}
            value={selectedTab}
          >
            <TabsList aria-label={tt('Application detail sections')}>
              <TabsTrigger value="settings">{tt('Settings')}</TabsTrigger>
              <TabsTrigger value="branding">{tt('Branding')}</TabsTrigger>
            </TabsList>
            <TabsContent className="mt-4" value="settings">
              <div className="applicationSettingsStack">
                <Card className="applicationSettingsPanel">
                  <CardHeader>
                    <CardTitle>{tt('General settings')}</CardTitle>
                    <CardDescription>{tt('Required display metadata and client classification.')}</CardDescription>
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
                      <Field label={tt('Application name')}>
                        <TextInput defaultValue={application.name} name="name" required />
                      </Field>
                      <Field label={tt('Description')}>
                        <TextArea defaultValue={application.description ?? ''} name="description" rows={3} />
                      </Field>
                      <SettingRow label={tt('App ID')} value={application.clientId} />
                      <SettingRow label={tt('Type')} value={clientTypeLabel(application.clientType)} />
                      <SettingRow label={tt('Status')} value={application.disabled ? 'Disabled' : 'Enabled'} />
                      <ConsoleActionBar>
                        <Button disabled={updateMutation.isPending} type="submit">
                          <Save data-icon="inline-start" /> {tt('Save changes')}{' '}
                        </Button>
                        <Button disabled={updateMutation.isPending} type="reset" variant="secondary">
                          {' '}
                          {tt('Discard')}{' '}
                        </Button>
                      </ConsoleActionBar>
                      <MutationError error={updateMutation.error} />
                    </form>
                  </CardContent>
                </Card>

                <Card className="applicationSettingsPanel">
                  <CardHeader>
                    <CardTitle>{tt('Redirects and origins')}</CardTitle>
                    <CardDescription>{tt('Callbacks and browser origins accepted by this client.')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="formStack"
                      id="application-redirect-uris-form"
                      key={`redirects-${application.id}-${application.updatedAt}`}
                      onSubmit={(event) => {
                        event.preventDefault()
                        try {
                          setRedirectFormError(null)
                          const form = new FormData(event.currentTarget)
                          updateMutation.mutate(
                            parseForm(updateApplicationRequestSchema, {
                              redirectUris: parseLineList(form.get('redirectUris') as string),
                              postLogoutRedirectUris: parseLineList(form.get('postLogoutRedirectUris') as string),
                              corsOrigins: parseLineList(form.get('corsOrigins') as string),
                            }),
                          )
                        } catch (submitError) {
                          setRedirectFormError((submitError as Error).message)
                        }
                      }}
                    >
                      <Field label={tt('Redirect URIs')} help={tt('One URI per line.')}>
                        <TextArea defaultValue={redirectUris} name="redirectUris" required rows={5} />
                      </Field>
                      <Field label={tt('Post sign-out redirect URIs')} help={tt('One URI per line.')}>
                        <TextArea
                          defaultValue={postLogoutRedirectUris}
                          name="postLogoutRedirectUris"
                          placeholder="https://app.example.com/signed-out"
                          rows={3}
                        />
                      </Field>
                      <Field
                        label={tt('CORS origins')}
                        help={tt('One origin per line. Include scheme, host, and optional port.')}
                      >
                        <TextArea
                          defaultValue={corsOrigins}
                          name="corsOrigins"
                          placeholder="https://app.example.com"
                          rows={3}
                        />
                      </Field>
                      <ConsoleActionBar>
                        <Button disabled={updateMutation.isPending} type="submit">
                          {' '}
                          {tt('Save redirects and origins')}{' '}
                        </Button>
                        <Button disabled={updateMutation.isPending} type="reset" variant="secondary">
                          {' '}
                          {tt('Discard')}{' '}
                        </Button>
                      </ConsoleActionBar>
                      {redirectFormError ? <p className="text-sm text-destructive">{redirectFormError}</p> : null}
                      <MutationError error={updateMutation.error} />
                    </form>
                  </CardContent>
                </Card>

                <Card className="applicationSettingsPanel">
                  <CardHeader>
                    <CardTitle>{tt('Endpoints and credentials')}</CardTitle>
                    <CardDescription>{tt('Use these values with any standards-compliant OIDC SDK.')}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <SettingRow label={tt('Auth method')} value={application.tokenEndpointAuthMethod} />
                    <SettingRow label={tt('PKCE')} value={application.requirePkce ? 'Required' : 'Optional'} />
                    <SettingRow label={tt('Issuer')} value={application.oidc.issuer} />
                    <SettingRow
                      label={tt('Discovery')}
                      value={`${application.oidc.issuer}/.well-known/openid-configuration`}
                    />
                    <SettingRow label={tt('Authorization endpoint')} value={application.oidc.authorizationEndpoint} />
                    <SettingRow label={tt('Token endpoint')} value={application.oidc.tokenEndpoint} />
                    <SettingRow label={tt('UserInfo endpoint')} value={application.oidc.userInfoEndpoint} />
                    <SettingRow label={tt('JWKS URI')} value={application.oidc.jwksUri} />
                    <CopyButton label={tt('Copy client config')} value={clientConfig(application, rotatedSecret)} />
                  </CardContent>
                </Card>

                <ApplicationOidcClaimsForm
                  claims={application.oidcClaims}
                  error={updateMutation.error}
                  onSave={(oidcClaims) => updateMutation.mutate({ oidcClaims })}
                  pending={updateMutation.isPending}
                />

                <Card className="applicationSettingsPanel">
                  <CardHeader>
                    <CardTitle>{tt('Client secrets')}</CardTitle>
                    <CardDescription>
                      {' '}
                      {tt('Raw secrets are only shown once immediately after creation or rotation.')}{' '}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {application.public ? (
                      <SettingRow
                        label={tt('Secret behavior')}
                        value="No client secret is issued for public clients."
                      />
                    ) : (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tt('Version')}</TableHead>
                              <TableHead>{tt('Prefix')}</TableHead>
                              <TableHead>{tt('Status')}</TableHead>
                              <TableHead>{tt('Created')}</TableHead>
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
                          {' '}
                          {tt('Rotate client secret')}{' '}
                        </Button>
                        <MutationError error={secretsQuery.error ?? rotateMutation.error} />
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="applicationSettingsPanel">
                  <CardHeader>
                    <CardTitle>{tt('Advanced options')}</CardTitle>
                    <CardDescription>
                      {tt('Grant, scope, and custom metadata included with this client.')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="formStack">
                    <SettingRow label={tt('Grant types')} value={application.allowedGrantTypes.join(', ')} />
                    <SettingRow label={tt('Scopes')} value={application.allowedScopes.join(' ')} />
                    <SettingRow
                      label={tt('Refresh tokens')}
                      value={application.allowedScopes.includes('offline_access') ? 'Allowed by scope' : 'Not enabled'}
                    />
                    <form
                      className="formStack"
                      key={`custom-data-${application.id}-${application.updatedAt}`}
                      onSubmit={(event) => {
                        event.preventDefault()
                        try {
                          setCustomDataFormError(null)
                          const form = new FormData(event.currentTarget)
                          updateMutation.mutate(
                            parseForm(updateApplicationRequestSchema, {
                              customData: parseCustomData(form.get('customData') as string),
                            }),
                          )
                        } catch (submitError) {
                          setCustomDataFormError((submitError as Error).message)
                        }
                      }}
                    >
                      <Field label={tt('Custom data JSON')} help={tt('JSON object stored with this application.')}>
                        <TextArea
                          defaultValue={JSON.stringify(application.customData, null, 2)}
                          name="customData"
                          rows={5}
                        />
                      </Field>
                      <ConsoleActionBar>
                        <Button disabled={updateMutation.isPending} type="submit">
                          {' '}
                          {tt('Save custom data')}{' '}
                        </Button>
                        <Button disabled={updateMutation.isPending} type="reset" variant="secondary">
                          {' '}
                          {tt('Discard')}{' '}
                        </Button>
                      </ConsoleActionBar>
                      {customDataFormError ? <p className="text-sm text-destructive">{customDataFormError}</p> : null}
                      <MutationError error={updateMutation.error} />
                    </form>
                  </CardContent>
                </Card>

                <Card className="applicationSettingsPanel">
                  <CardHeader>
                    <CardTitle>{tt('Lifecycle')}</CardTitle>
                    <CardDescription>
                      {' '}
                      {tt('Disable clients before deleting them when integrations are still active.')}{' '}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <SettingRow label={tt('Reason')} value={application.disabledReason ?? 'Not set'} />
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
                        <Trash2 data-icon="inline-start" /> {tt('Delete application')}{' '}
                      </Button>
                    </div>
                    <MutationError error={updateMutation.error ?? deleteMutation.error} />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent className="mt-4" value="branding">
              <Card className="applicationSettingsPanel">
                <CardHeader>
                  <CardTitle>{tt('Application branding')}</CardTitle>
                  <CardDescription>
                    {tt('Logo and display values shown in application and consent surfaces.')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <AssetUploadControl
                    accept="image/png,image/jpeg,image/webp"
                    label={`Upload logo for ${application.name}`}
                    onFile={(file) => logoMutation.mutate(file)}
                    previewUrl={application.iconUrl}
                  />
                  <SettingRow label={tt('Display name')} value={application.name} />
                  <SettingRow label={tt('Homepage URL')} value={application.homepageUrl ?? 'Not set'} />
                  <MutationError error={logoMutation.error} />
                  {logoMutation.errorMessage ? (
                    <p className="text-sm text-destructive">{logoMutation.errorMessage}</p>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </ConsoleDetailStack>
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
type OidcClaimDestination = keyof ApplicationOidcClaims
type OidcClaimKey = keyof ApplicationOidcClaims[OidcClaimDestination]

const oidcClaimDestinations: Array<{ key: OidcClaimDestination; label: string }> = [
  { key: 'accessToken', label: 'Access token' },
  { key: 'idToken', label: 'ID token' },
  { key: 'userInfo', label: 'UserInfo' },
]

const oidcClaimControls: Array<{ key: OidcClaimKey; label: string }> = [
  { key: 'organizationId', label: 'organization ID' },
  { key: 'organizationName', label: 'organization name' },
  { key: 'authorization', label: 'authorization claim' },
  { key: 'roles', label: 'roles' },
  { key: 'permissions', label: 'permissions' },
  { key: 'scopes', label: 'OAuth scopes' },
]

function ApplicationOidcClaimsForm({
  claims,
  error,
  onSave,
  pending,
}: {
  claims: ApplicationOidcClaims
  error: unknown
  onSave: (claims: ApplicationOidcClaims) => void
  pending: boolean
}) {
  const [form, setForm] = useState<ApplicationOidcClaims>(claims)
  useEffect(() => setForm(claims), [claims])

  return (
    <Card className="applicationSettingsPanel">
      <CardHeader>
        <CardTitle>{tt('OIDC claims')}</CardTitle>
        <CardDescription>
          {tt('Choose which organization and authorization claims are emitted to each token destination.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="formStack"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(form)
          }}
        >
          <div className="oidcClaimsGrid">
            {oidcClaimDestinations.map((destination) => (
              <div className="oidcClaimsColumn" key={destination.key}>
                <h3 className="text-xs font-semibold uppercase leading-5 text-muted-foreground">
                  {tt(destination.label)}
                </h3>
                <div className="grid gap-2">
                  {oidcClaimControls.map((control) => (
                    <SwitchRow
                      checked={form[destination.key][control.key] === true}
                      disabled={pending}
                      key={`${destination.key}-${control.key}`}
                      label={tt(`${destination.label} ${control.label}`)}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          [destination.key]: {
                            ...current[destination.key],
                            [control.key]: checked,
                          },
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <ConsoleActionBar>
            <Button disabled={pending} type="submit">
              <Save data-icon="inline-start" /> {tt('Save OIDC claims')}{' '}
            </Button>
            <Button disabled={pending} onClick={() => setForm(claims)} type="reset" variant="secondary">
              {' '}
              {tt('Discard')}{' '}
            </Button>
          </ConsoleActionBar>
          <MutationError error={error} />
        </form>
      </CardContent>
    </Card>
  )
}
function ApplicationsTableContent({
  applications,
  emptyDescription,
  emptyTitle,
  hasApplications,
  onToggleDisabled,
}: {
  applications: ApplicationResponse[]
  emptyDescription: string
  emptyTitle: string
  hasApplications: boolean
  onToggleDisabled: (application: ApplicationResponse) => void
}) {
  if (!applications.length && hasApplications) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Application name')}</TableHead>
            <TableHead>{tt('Ownership')}</TableHead>
            <TableHead>{tt('Client ID')}</TableHead>
            <TableHead>{tt('Type')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmptyRow colSpan={6} description={emptyDescription} title={emptyTitle} />
        </TableBody>
      </Table>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tt('Application name')}</TableHead>
          <TableHead>{tt('Ownership')}</TableHead>
          <TableHead>{tt('Client ID')}</TableHead>
          <TableHead>{tt('Type')}</TableHead>
          <TableHead>{tt('Status')}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {applications.length ? (
          applications.map((application) => (
            <TableRow key={application.id}>
              <TableCell>
                <a className="font-medium hover:underline" href={`/console/applications/${application.id}`}>
                  {application.name}
                </a>
                <div className="text-xs text-muted-foreground">{application.slug}</div>
              </TableCell>
              <TableCell>{application.firstParty ? 'My app' : 'Third-party'}</TableCell>
              <TableCell>
                <code className="text-xs">{application.clientId}</code>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{clientTypeLabel(application.clientType)}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{application.allowedGrantTypes.join(', ')}</div>
              </TableCell>
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
                      <DropdownMenuItem onClick={() => onToggleDisabled(application)}>
                        {application.disabled ? 'Enable' : 'Disable'}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableEmptyRow
            colSpan={6}
            description={
              hasApplications
                ? emptyDescription
                : tt('Create your first OIDC client to connect an application to hosted authentication.')
            }
            title={hasApplications ? emptyTitle : tt('No applications yet')}
          />
        )}
      </TableBody>
    </Table>
  )
}
export function AdminOnboardingPage() {
  const queryClient = useQueryClient()
  const readinessQuery = useQuery({
    queryKey: adminQueryKeys.readiness,
    queryFn: getAdminReadiness,
  })
  const [form, setForm] = useState({
    name: 'Customer portal',
    slug: 'customer-portal',
    clientType: 'public_spa',
    redirectUris: `${window.location.origin}/oidc/callback`,
  })
  const createMutation = useAdminMutation({
    mutationFn: createApplication,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.applications,
        }),
        queryClient.invalidateQueries({
          queryKey: adminQueryKeys.readiness,
        }),
      ]),
  })
  const application = createMutation.data
  return (
    <ResourcePage
      title={tt('Console setup')}
      description={tt(
        'Complete required setup gates, then review production recommendations without blocking the Console.',
      )}
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
                <CardTitle>{tt('Setup checklist')}</CardTitle>
                <CardDescription>
                  {' '}
                  {tt('Required items unlock Console routes. Recommended items prepare production.')}{' '}
                </CardDescription>
              </div>
              <Badge variant={readinessQuery.data?.admin?.setupRequired ? 'outline' : 'secondary'}>
                {readinessQuery.data?.admin?.setupRequired ? 'Action needed' : 'Ready'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SetupChecklist items={readinessQuery.data?.required ?? []} title={tt('Required')} />
            <SetupChecklist items={readinessQuery.data?.recommended ?? []} title={tt('Recommended')} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{tt('First OIDC application')}</CardTitle>
            <CardDescription>
              {tt('Use a localhost or review-environment callback while validating the flow.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="formStack applicationCreateForm"
              onSubmit={(event) => {
                event.preventDefault()
                createMutation.mutate(
                  parseForm(createApplicationRequestSchema, {
                    name: form.name,
                    slug: form.slug,
                    clientType: form.clientType,
                    firstParty: true,
                    redirectUris: form.redirectUris.split('\n').filter(Boolean),
                  }),
                )
              }}
            >
              <ApplicationTypeCards
                onChange={(clientType) =>
                  setForm((value) => ({
                    ...value,
                    clientType,
                  }))
                }
                value={form.clientType}
              />
              <Field label={tt('Application name')}>
                <TextInput
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      name: event.target.value,
                    }))
                  }
                  required
                  value={form.name}
                />
              </Field>
              <Field label={tt('Slug')}>
                <TextInput
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      slug: event.target.value,
                    }))
                  }
                  required
                  value={form.slug}
                />
              </Field>
              <Field label={tt('Redirect URIs')}>
                <TextArea
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      redirectUris: event.target.value,
                    }))
                  }
                  required
                  value={form.redirectUris}
                />
              </Field>
              <Button disabled={createMutation.isPending} type="submit">
                <Plus data-icon="inline-start" /> {tt('Create OIDC client')}{' '}
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{tt('Client integration')}</CardTitle>
            <CardDescription>{tt('Use OIDC discovery with authorization code and PKCE.')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <SettingRow
              label={tt('Discovery')}
              value={`${window.location.origin}/api/auth/.well-known/openid-configuration`}
            />
            <SettingRow label={tt('Issuer')} value={`${window.location.origin}/api/auth`} />
            <SettingRow label={tt('Callback')} value={form.redirectUris.split('\n')[0] ?? ''} />
            {application ? (
              <>
                <SettingRow label={tt('Client ID')} value={application.clientId} />
                <SettingRow label={tt('Auth method')} value={application.tokenEndpointAuthMethod} />
                <SettingRow label={tt('Scopes')} value={application.allowedScopes.join(' ')} />
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
              <Copy data-icon="inline-start" /> {tt('Copy details')}{' '}
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
    queryKey: [
      ...adminQueryKeys.users,
      {
        search,
        role,
        banned,
        offset,
      },
    ],
    queryFn: () =>
      listUsers({
        ...(search
          ? {
              search,
            }
          : {}),
        ...(role
          ? {
              role,
            }
          : {}),
        ...(banned
          ? {
              banned: banned === 'true',
            }
          : {}),
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
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.users,
      })
    },
  })
  return (
    <ResourcePage
      title={tt('Users')}
      description={tt('Create users, inspect profile state, reset passwords, and adjust administrative flags.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New user')}{' '}
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
        <ListToolbar>
          <TextInput
            aria-label={tt('Search users')}
            onChange={(event) => {
              setSearch(event.target.value)
              setOffset(0)
            }}
            placeholder={tt('Search users')}
            value={search}
          />
          <SelectInput
            aria-label={tt('Filter role')}
            onChange={(event) => {
              setRole(event.target.value)
              setOffset(0)
            }}
            value={role}
          >
            <option value="">{tt('Any role')}</option>
            <option value="admin">{tt('Admin')}</option>
            <option value="user">{tt('User')}</option>
          </SelectInput>
          <SelectInput
            aria-label={tt('Filter status')}
            onChange={(event) => {
              setBanned(event.target.value)
              setOffset(0)
            }}
            value={banned}
          >
            <option value="">{tt('Any status')}</option>
            <option value="false">{tt('Active')}</option>
            <option value="true">{tt('Banned')}</option>
          </SelectInput>
        </ListToolbar>
      }
    >
      <div className="grid gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('User')}</TableHead>
              <TableHead>{tt('Role')}</TableHead>
              <TableHead>{tt('Email')}</TableHead>
              <TableHead>{tt('Created')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data?.users.length ? (
              query.data.users.map((user) => (
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
                    <div className="text-xs text-muted-foreground">
                      {user.emailVerified ? 'Verified' : 'Unverified'}
                    </div>
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
                              {' '}
                              {tt('Send password reset')}{' '}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            onClick={() =>
                              updateUser(user.id, {
                                role: user.role === 'admin' ? 'user' : 'admin',
                              }).then(() =>
                                queryClient.invalidateQueries({
                                  queryKey: adminQueryKeys.users,
                                }),
                              )
                            }
                          >
                            {' '}
                            {tt('Toggle admin role')}{' '}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={6}
                description={
                  search
                    ? tt('No users match the current search.')
                    : tt('Create a user to verify sign-in and account-center behavior.')
                }
                title={search ? tt('No users found') : tt('No users yet')}
              />
            )}
          </TableBody>
        </Table>
        {query.data && query.data.users.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 text-sm text-muted-foreground">
            <span>
              {' '}
              {tt('Showing')} {query.data.pagination.offset + 1}-
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
                {' '}
                {tt('Previous')}{' '}
              </Button>
              <Button
                disabled={!query.data.pagination.hasMore || query.data.pagination.nextOffset === null}
                onClick={() => setOffset(query.data?.pagination.nextOffset ?? offset)}
                type="button"
                variant="secondary"
              >
                {' '}
                {tt('Next')}{' '}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </ResourcePage>
  )
}
export function UserDetailPage({ userId, section = 'profile' }: { userId: string; section?: UserDetailSection }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedTab, setSelectedTab] = useState<UserDetailSection>(section)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [banDialogOpen, setBanDialogOpen] = useState(false)
  const [revokeAllDialogOpen, setRevokeAllDialogOpen] = useState(false)
  const [sessionToRevoke, setSessionToRevoke] = useState<string | null>(null)
  const [passkeyToDelete, setPasskeyToDelete] = useState<string | null>(null)
  const userQuery = useQuery({
    queryKey: [...adminQueryKeys.users, userId],
    queryFn: () => getUser(userId),
  })
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
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.users,
      })
    },
  })
  const resetMutation = useMutation({
    mutationFn: () => requestUserPasswordReset(userId),
  })
  const banMutation = useMutation({
    mutationFn: (input: { reason?: string }) => banUser(userId, input),
    onSuccess: async () => {
      setBanDialogOpen(false)
      await queryClient.invalidateQueries({
        queryKey: [...adminQueryKeys.users, userId],
      })
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.users,
      })
    },
  })
  const unbanMutation = useMutation({
    mutationFn: () => unbanUser(userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [...adminQueryKeys.users, userId],
      })
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.users,
      })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteUser(userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.users,
      })
      await navigate({
        to: '/console/users',
      })
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
  useEffect(() => setSelectedTab(section), [section])
  const user = userQuery.data?.user
  return (
    <ResourcePage
      title={user ? userDisplayName(user) : tt('User')}
      description={tt(
        'Inspect profile, access state, linked accounts, MFA, passkeys, sessions, and account operations.',
      )}
      framed={false}
      error={userQuery.error}
      loading={userQuery.isLoading}
      onRetry={() => userQuery.refetch()}
    >
      {user ? (
        <div className="consoleDetailStack">
          <a className="consoleBackLink" href="/console/users">
            <Undo2 data-icon="inline-start" /> {tt('Back to users')}{' '}
          </a>
          <ObjectHeader
            badge={user.banned ? 'Banned' : 'Active'}
            id={user.email ?? user.id}
            title={userDisplayName(user)}
          />
          <DetailTabs
            label={tt('User detail sections')}
            onChange={(value) => {
              const next = value as UserDetailSection
              setSelectedTab(next)
              navigateConsoleTab(navigate, `/console/users/${userId}/${next}`)
            }}
            tabs={userDetailTabs()}
            value={selectedTab}
          />
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            {selectedTab === 'profile' ? (
              <UserProfileCard
                error={updateMutation.error}
                pending={updateMutation.isPending}
                user={user}
                onSubmit={updateMutation.mutate}
              />
            ) : null}
            {selectedTab === 'operations' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Account operations')}</CardTitle>
                  <CardDescription>
                    {tt('Use confirmations for destructive or security-sensitive actions.')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <SettingRow label={tt('Status')} value={user.banned ? 'Banned' : 'Active'} />
                  <SettingRow label={tt('Ban reason')} value={user.banReason ?? 'Not set'} />
                  <SettingRow label={tt('Ban expires')} value={formatDate(user.banExpires ?? undefined)} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={resetMutation.isPending}
                      onClick={() => resetMutation.mutate()}
                      type="button"
                      variant="secondary"
                    >
                      {' '}
                      {tt('Send password reset')}{' '}
                    </Button>
                    {user.banned ? (
                      <Button
                        disabled={unbanMutation.isPending}
                        onClick={() => unbanMutation.mutate()}
                        type="button"
                        variant="secondary"
                      >
                        {' '}
                        {tt('Unban user')}{' '}
                      </Button>
                    ) : (
                      <Button onClick={() => setBanDialogOpen(true)} type="button" variant="danger">
                        {' '}
                        {tt('Ban user')}{' '}
                      </Button>
                    )}
                    <Button onClick={() => setDeleteDialogOpen(true)} type="button" variant="danger">
                      <Trash2 data-icon="inline-start" /> {tt('Delete user')}{' '}
                    </Button>
                  </div>
                  <MutationError
                    error={resetMutation.error ?? banMutation.error ?? unbanMutation.error ?? deleteMutation.error}
                  />
                  {resetMutation.isSuccess ? (
                    <p className="text-sm text-muted-foreground">{tt('Password reset requested.')}</p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            {selectedTab === 'security' ? (
              <UserSecurityCard
                error={securityQuery.error ?? passkeysQuery.error ?? deletePasskeyMutation.error}
                passkeys={passkeysQuery.data?.passkeys ?? []}
                security={securityQuery.data?.security}
                onDeletePasskey={setPasskeyToDelete}
              />
            ) : null}
            {selectedTab === 'sessions' ? (
              <UserSessionsCard
                error={sessionsQuery.error ?? revokeAllMutation.error ?? revokeSessionMutation.error}
                onRevokeAll={() => setRevokeAllDialogOpen(true)}
                onRevokeSession={setSessionToRevoke}
                pending={revokeAllMutation.isPending || revokeSessionMutation.isPending}
                sessions={sessionsQuery.data?.sessions ?? []}
              />
            ) : null}
            {selectedTab === 'linked-accounts' ? (
              <UserLinkedAccountsCard
                accounts={linkedAccountsQuery.data?.accounts ?? []}
                error={linkedAccountsQuery.error}
              />
            ) : null}
            {selectedTab === 'applications' ? (
              <UserApplicationsCard
                applications={applicationsQuery.data?.applications ?? []}
                error={applicationsQuery.error}
              />
            ) : null}
            <UserIdentitySummaryCard
              applicationsCount={applicationsQuery.data?.applications.length ?? 0}
              linkedAccountsCount={linkedAccountsQuery.data?.accounts.length ?? 0}
              sessionsCount={sessionsQuery.data?.sessions.length ?? 0}
              user={user}
            />
          </div>
          <BanUserDialog
            error={banMutation.error}
            onClose={() => setBanDialogOpen(false)}
            onConfirm={(reason) =>
              banMutation.mutate(
                reason
                  ? {
                      reason,
                    }
                  : {},
              )
            }
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
            title={tt('Delete user')}
          />
          <DangerConfirmDialog
            actionLabel="Revoke sessions"
            description={`Revoke every active session for ${userDisplayName(user)}.`}
            error={revokeAllMutation.error}
            onClose={() => setRevokeAllDialogOpen(false)}
            onConfirm={() => revokeAllMutation.mutate()}
            open={revokeAllDialogOpen}
            pending={revokeAllMutation.isPending}
            title={tt('Revoke all sessions')}
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
            title={tt('Revoke session')}
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
            title={tt('Delete passkey')}
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
        <CardTitle>{tt('Profile and access')}</CardTitle>
        <CardDescription>{tt('Edit safe account fields and administrative access state.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="formStack"
          noValidate={true}
          onSubmit={(event) => {
            event.preventDefault()
            const submittedForm = new FormData(event.currentTarget)
            const submittedRole = String(submittedForm.get('role') ?? '')
            try {
              setValidationError(null)
              onSubmit(
                parseForm(managementUpdateUserRequestSchema, {
                  email: submittedForm.get('email'),
                  displayName: submittedForm.get('displayName'),
                  username: nullableString(submittedForm.get('username') as string),
                  ...(submittedRole
                    ? {
                        role: submittedRole,
                      }
                    : {}),
                  emailVerified: submittedForm.get('emailVerified') === 'true',
                }),
              )
            } catch (submitError) {
              setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
            }
          }}
        >
          <Field label={tt('Email')}>
            <TextInput defaultValue={form.email} name="email" type="email" />
          </Field>
          <Field label={tt('Display name')}>
            <TextInput defaultValue={form.displayName} name="displayName" />
          </Field>
          <Field label={tt('Username')}>
            <TextInput defaultValue={form.username} name="username" />
          </Field>
          <Field label={tt('Role')}>
            <SelectInput
              disabled={Array.isArray(user.role)}
              name="role"
              onChange={(event) => setValue(setForm, 'role', event.target.value)}
              value={form.role}
            >
              {Array.isArray(user.role) ? (
                <option value="">
                  {tt('Multiple roles:')} {user.role.join(', ')}
                </option>
              ) : null}
              <option value="user">{tt('User')}</option>
              <option value="admin">{tt('Admin')}</option>
            </SelectInput>
          </Field>
          <Field label={tt('Email verification')}>
            <SelectInput
              name="emailVerified"
              onChange={(event) => setValue(setForm, 'emailVerified', event.target.value)}
              value={form.emailVerified}
            >
              <option value="true">{tt('Verified')}</option>
              <option value="false">{tt('Unverified')}</option>
            </SelectInput>
          </Field>
          {validationError ? <MutationError error={validationError} /> : null}
          <MutationError error={error} />
          <Button disabled={pending} type="submit">
            {pending ? tt('Saving...') : tt('Save profile')}
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
    mfa: {
      enabled: boolean
      factors: Array<{
        id: string
        type: string
        verified: boolean | null
      }>
    }
    passkeys: {
      enabled: boolean
      count: number
    }
    policy: {
      mfa: {
        mode: string
      }
      passkeys: {
        enabled: boolean
        rpName: string
      }
    }
  }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('MFA and passkeys')}</CardTitle>
        <CardDescription>{tt('Overview only; no secret material is exposed.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('MFA state')} value={security?.mfa.enabled ? 'Enabled' : 'Disabled'} />
        <SettingRow label={tt('MFA policy')} value={security?.policy.mfa.mode ?? 'Unknown'} />
        <SettingRow label={tt('Passkey policy')} value={security?.policy.passkeys.enabled ? 'Enabled' : 'Disabled'} />
        <SettingRow label={tt('Passkey count')} value={String(security?.passkeys.count ?? passkeys.length)} />
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
                  {' '}
                  {tt('Delete')}{' '}
                </Button>
              </div>
            ))
          ) : (
            <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              {' '}
              {tt('No passkeys registered.')}{' '}
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
            <CardTitle>{tt('Sessions')}</CardTitle>
            <CardDescription>{tt('Revoke one session or require every device to sign in again.')}</CardDescription>
          </div>
          <Button disabled={pending || sessions.length === 0} onClick={onRevokeAll} type="button" variant="danger">
            {' '}
            {tt('Revoke all')}{' '}
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
                  {session.ipAddress ?? 'Unknown IP'}
                  {tt('; expires')} {formatDate(session.expiresAt)}
                </p>
              </div>
              <Button disabled={pending} onClick={() => onRevokeSession(session.id)} type="button" variant="danger">
                {' '}
                {tt('Revoke')}{' '}
              </Button>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {' '}
            {tt('No active sessions.')}{' '}
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
  accounts: Array<{
    id: string
    accountId: string
    providerId: string
    createdAt: string | Date
  }>
  error: unknown
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Linked accounts')}</CardTitle>
        <CardDescription>{tt('External identity accounts connected to this user.')}</CardDescription>
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
            {' '}
            {tt('No linked accounts.')}{' '}
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
        <CardTitle>{tt('Authorized applications')}</CardTitle>
        <CardDescription>{tt('OIDC clients with active user consent.')}</CardDescription>
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
            {' '}
            {tt('No authorized applications.')}{' '}
          </p>
        )}
        <MutationError error={error} />
      </CardContent>
    </Card>
  )
}
function UserIdentitySummaryCard({
  applicationsCount,
  linkedAccountsCount,
  sessionsCount,
  user,
}: {
  applicationsCount: number
  linkedAccountsCount: number
  sessionsCount: number
  user: ManagementUserResponse
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Identity summary')}</CardTitle>
        <CardDescription>{tt('Read-only context for the selected user tab.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('User ID')} value={user.id} />
        <SettingRow label={tt('Email')} value={user.email ?? 'Not set'} />
        <SettingRow label={tt('Role')} value={formatRole(user.role)} />
        <SettingRow label={tt('Account status')} value={user.banned ? 'Banned' : 'Active'} />
        <SettingRow label={tt('Sessions')} value={String(sessionsCount)} />
        <SettingRow label={tt('Linked accounts')} value={String(linkedAccountsCount)} />
        <SettingRow label={tt('Authorized apps')} value={String(applicationsCount)} />
      </CardContent>
    </Card>
  )
}
export function ConnectorsPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.connectors,
    queryFn: listConnectors,
  })
  const templatesQuery = useQuery({
    queryKey: [...adminQueryKeys.connectors, 'templates'],
    queryFn: listConnectorTemplates,
  })
  const signInQuery = useQuery({
    queryKey: adminQueryKeys.signIn,
    queryFn: getSignInSettings,
  })
  const securityQuery = useQuery({
    queryKey: adminQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const queryClient = useQueryClient()
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ConnectorResponse | null>(null)
  const createMutation = useAdminMutation({
    mutationFn: createConnector,
    onSuccess: () => {
      setSelectedProviderKey(null)
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.connectors,
      })
    },
  })
  const connectors = query.data?.connectors ?? []
  const templates = templatesQuery.data?.templates ?? []
  const providerRows = connectorProviderRows(templates, connectors, signInQuery.data, securityQuery.data?.policy)
  const selectedProvider = providerRows.find((provider) => provider.key === selectedProviderKey) ?? null
  const selectedConnectorId = selectedProvider?.connector?.id ?? null
  const detailQuery = useQuery({
    queryKey: [...adminQueryKeys.connectors, selectedConnectorId],
    queryFn: () => getConnector(selectedConnectorId ?? ''),
    enabled: selectedConnectorId !== null,
  })
  const updateMutation = useAdminMutation({
    mutationFn: ({ id, input }: { id: string; input: z.infer<typeof updateManagementConnectorRequestSchema> }) =>
      updateConnector(id, input),
    onSuccess: (connector) => {
      setSelectedProviderKey(null)
      queryClient.setQueryData([...adminQueryKeys.connectors, connector.id], connector)
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.connectors,
      })
    },
  })
  const deleteMutation = useAdminMutation({
    mutationFn: deleteConnector,
    onSuccess: () => {
      setDeleteTarget(null)
      setSelectedProviderKey(null)
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.connectors,
      })
    },
  })
  const updateBuiltInSignInMutation = useAdminMutation({
    mutationFn: updateSignInSettings,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.signIn,
      }),
  })
  const updateBuiltInSecurityMutation = useAdminMutation({
    mutationFn: updateSecurityPolicy,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.security,
      }),
  })
  return (
    <ResourcePage
      title={tt('Connectors')}
      description={tt('Configure built-in and social identity providers used by the hosted sign-in experience.')}
      error={query.error ?? templatesQuery.error ?? signInQuery.error ?? securityQuery.error}
      loading={query.isLoading || templatesQuery.isLoading || signInQuery.isLoading || securityQuery.isLoading}
      onRetry={() => {
        void query.refetch()
        void templatesQuery.refetch()
        void signInQuery.refetch()
        void securityQuery.refetch()
      }}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Provider')}</TableHead>
            <TableHead>{tt('Type')}</TableHead>
            <TableHead>{tt('Configuration')}</TableHead>
            <TableHead>{tt('Provider')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {providerRows.map((provider) => (
            <TableRow
              className="cursor-pointer"
              key={provider.key}
              onClick={() => setSelectedProviderKey(provider.key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setSelectedProviderKey(provider.key)
              }}
              role="button"
              tabIndex={0}
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  <ProviderIcon provider={provider} />
                  <div className="min-w-0">
                    <div className="font-medium">{provider.displayName}</div>
                    <div className="text-xs text-muted-foreground">{provider.description}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>{provider.typeLabel}</TableCell>
              <TableCell>{provider.configurationLabel}</TableCell>
              <TableCell>{provider.providerId}</TableCell>
              <TableCell>
                <StatusBadge active={provider.enabled} activeLabel="Enabled" inactiveLabel="Not enabled" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConnectorProviderDrawer
        connector={detailQuery.data ?? selectedProvider?.connector ?? null}
        createError={createMutation.errorMessage}
        createPending={createMutation.isPending}
        detailError={
          updateMutation.errorMessage ?? (detailQuery.error instanceof Error ? detailQuery.error.message : null)
        }
        loading={detailQuery.isLoading}
        onClose={() => setSelectedProviderKey(null)}
        onCreate={(input) => createMutation.mutate(input)}
        onDelete={(connector) => {
          setSelectedProviderKey(null)
          setDeleteTarget(connector)
        }}
        onUpdate={(connector, input) =>
          updateMutation.mutate({
            id: connector.id,
            input,
          })
        }
        onUpdateBuiltInPasskey={(enabled) =>
          updateBuiltInSecurityMutation.mutate({
            policy: {
              passkeys: {
                enabled,
              },
            },
          })
        }
        onUpdateBuiltInSignIn={(input) => updateBuiltInSignInMutation.mutate(input)}
        open={selectedProvider !== null}
        provider={selectedProvider}
        builtInProviders={signInQuery.data?.builtInProviders ?? null}
        security={securityQuery.data?.policy ?? null}
        updateBuiltInError={updateBuiltInSignInMutation.errorMessage ?? updateBuiltInSecurityMutation.errorMessage}
        updateBuiltInPending={updateBuiltInSignInMutation.isPending || updateBuiltInSecurityMutation.isPending}
        updatePending={updateMutation.isPending}
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
        title={tt('Delete connector')}
      />
    </ResourcePage>
  )
}
type ConnectorProviderRow = {
  key: string
  displayName: string
  description: string
  icon: string
  providerId: string
  providerType: 'builtin' | 'social'
  typeLabel: string
  configurationLabel: string
  enabled: boolean
  connector: ConnectorResponse | null
  template: ConnectorTemplate | null
}
function connectorProviderRows(
  templates: ConnectorTemplate[],
  connectors: ConnectorResponse[],
  signInSettings: ManagementSignInSettingsResponse | undefined,
  security: SecurityPolicy | undefined,
): ConnectorProviderRow[] {
  const connectorsByProvider = new Map(connectors.map((connector) => [connector.providerId, connector]))
  const builtIn = signInSettings?.builtInProviders
  const socialRows = templates
    .filter((template) => template.providerType === 'social')
    .map((template) => {
      const connector = connectorsByProvider.get(template.providerId) ?? null
      return {
        key: `social:${template.providerId}`,
        displayName: template.displayName,
        description: 'Social sign-in provider',
        icon: template.icon,
        providerId: template.providerId,
        providerType: 'social' as const,
        typeLabel: 'Social',
        configurationLabel: connector?.clientSecretConfigured ? 'Credentials configured' : 'Credentials required',
        enabled: connector?.enabled ?? false,
        connector,
        template,
      }
    })
  return [
    {
      key: 'builtin:email',
      displayName: 'Email',
      description: 'Email sign-in provider',
      icon: 'email',
      providerId: 'email',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: builtIn?.email.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(builtIn?.email.enabled),
      connector: null,
      template: null,
    },
    {
      key: 'builtin:phone',
      displayName: 'Phone (SMS)',
      description: 'SMS sign-in provider',
      icon: 'phone',
      providerId: 'phone',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: builtIn?.phone.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(builtIn?.phone.enabled),
      connector: null,
      template: null,
    },
    {
      key: 'builtin:web3-wallet',
      displayName: 'Web3 wallet',
      description: 'Wallet-based sign-in provider',
      icon: 'wallet',
      providerId: 'web3-wallet',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: builtIn?.web3Wallet.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(builtIn?.web3Wallet.enabled),
      connector: null,
      template: null,
    },
    {
      key: 'builtin:passkey',
      displayName: 'Passkey',
      description: 'Passkey authentication provider',
      icon: 'passkey',
      providerId: 'passkey',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: security?.passkeys.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(security?.passkeys.enabled),
      connector: null,
      template: null,
    },
    {
      key: 'builtin:onetap',
      displayName: 'OneTap',
      description: 'One-tap sign-in provider',
      icon: 'onetap',
      providerId: 'onetap',
      providerType: 'builtin',
      typeLabel: 'Built-in',
      configurationLabel: builtIn?.oneTap.enabled ? 'Runtime enabled' : 'Runtime disabled',
      enabled: Boolean(builtIn?.oneTap.enabled),
      connector: null,
      template: null,
    },
    ...socialRows,
  ]
}
function ConnectorProviderDrawer({
  builtInProviders,
  connector,
  createError,
  createPending,
  detailError,
  loading,
  onClose,
  onCreate,
  onDelete,
  onUpdate,
  onUpdateBuiltInPasskey,
  onUpdateBuiltInSignIn,
  open,
  provider,
  security,
  updateBuiltInError,
  updateBuiltInPending,
  updatePending,
}: {
  builtInProviders: ManagementSignInSettingsResponse['builtInProviders'] | null
  connector: ConnectorResponse | null
  createError: string | null
  createPending: boolean
  detailError: string | null
  loading: boolean
  onClose: () => void
  onCreate: (input: z.infer<typeof createManagementConnectorRequestSchema>) => void
  onDelete: (connector: ConnectorResponse) => void
  onUpdate: (connector: ConnectorResponse, input: z.infer<typeof updateManagementConnectorRequestSchema>) => void
  onUpdateBuiltInPasskey: (enabled: boolean) => void
  onUpdateBuiltInSignIn: (input: z.infer<typeof updateManagementSignInSettingsRequestSchema>) => void
  open: boolean
  provider: ConnectorProviderRow | null
  security: SecurityPolicy | null
  updateBuiltInError: string | null
  updateBuiltInPending: boolean
  updatePending: boolean
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)
  const activeConnector = connector ?? provider?.connector ?? null
  const isExisting = activeConnector !== null
  const pending = createPending || updatePending || loading
  const error = validationError ?? detailError ?? createError
  useEffect(() => {
    setValidationError(null)
    if (!provider) {
      setForm(emptyForm)
      return
    }
    if (activeConnector) {
      setForm(connectorToForm(activeConnector))
      return
    }
    setForm({
      enabled: 'false',
      clientId: '',
      clientSecret: '',
      scopes: provider.template?.defaultScopes.join(' ') ?? '',
      providerMetadata: '',
    })
  }, [provider, activeConnector])
  if (!provider) return null
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <SheetContent
        aria-describedby={undefined}
        aria-label={provider.displayName}
        className="w-full overflow-hidden data-[side=right]:sm:w-1/2 data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-3">
            <ProviderIcon className="providerIcon providerIconLarge" provider={provider} />
            {provider.displayName}
          </SheetTitle>
        </SheetHeader>
        {provider.providerType === 'builtin' ? (
          <BuiltinProviderPanel
            error={updateBuiltInError}
            onUpdatePasskey={onUpdateBuiltInPasskey}
            onUpdateSignIn={onUpdateBuiltInSignIn}
            pending={updateBuiltInPending}
            provider={provider}
            builtInProviders={builtInProviders}
            security={security}
          />
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              try {
                setValidationError(null)
                const scopes = form.scopes?.split(/\s+/).filter(Boolean)
                const providerMetadata = parseConnectorMetadata(form)
                if (isExisting) {
                  onUpdate(
                    activeConnector,
                    parseForm(updateManagementConnectorRequestSchema, {
                      ...connectorUpdateForm(form),
                      enabled: form.enabled === 'true',
                      scopes,
                      providerMetadata,
                    }),
                  )
                  return
                }
                onCreate(
                  parseForm(createManagementConnectorRequestSchema, {
                    ...form,
                    slug: provider.providerId,
                    enabled: form.enabled === 'true',
                    providerType: 'social',
                    providerId: provider.providerId,
                    displayName: provider.displayName,
                    scopes,
                    providerMetadata,
                  }),
                )
              } catch (submitError) {
                setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
              }
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-8">
              <div className="grid gap-5">
                {error ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{tt('Enabled')}</p>
                    <p className="text-xs text-muted-foreground">{tt('Show this provider on hosted sign-in.')}</p>
                  </div>
                  <Switch
                    aria-label={tt('Enabled')}
                    checked={form.enabled === 'true'}
                    onCheckedChange={(enabled) => setValue(setForm, 'enabled', String(enabled))}
                    type="button"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{tt('Allow users without an email')}</p>
                    <p className="text-xs text-muted-foreground">
                      {' '}
                      {tt(
                        'Allow this provider to enter the registration path. If it returns no email for a new user, the hosted flow shows an account-binding error.',
                      )}{' '}
                    </p>
                  </div>
                  <Switch
                    aria-label={tt('Allow users without an email')}
                    checked={form['metadata.allowUsersWithoutEmail'] === 'true'}
                    onCheckedChange={(allowUsersWithoutEmail) =>
                      setValue(setForm, 'metadata.allowUsersWithoutEmail', String(allowUsersWithoutEmail))
                    }
                    type="button"
                  />
                </div>
                <ConnectorDynamicFields
                  form={form}
                  isExisting={isExisting}
                  setForm={setForm}
                  template={provider.template}
                />
                <CallbackUrlField value={connectorCallbackUrl(provider.providerId)} />
              </div>
            </div>
            <SheetFooter className="border-t border-border sm:flex-row sm:justify-end">
              {isExisting ? (
                <Button onClick={() => onDelete(activeConnector)} type="button" variant="secondary">
                  <Trash2 data-icon="inline-start" /> {tt('Delete')}{' '}
                </Button>
              ) : null}
              <SheetClose asChild>
                <Button type="button" variant="secondary">
                  {' '}
                  {tt('Close')}{' '}
                </Button>
              </SheetClose>
              <Button disabled={pending} type="submit">
                {pending ? tt('Saving...') : tt('Save')}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
function BuiltinProviderForm({
  children,
  error,
  hasChanges,
  onSubmit,
  pending,
}: {
  children: ReactNode
  error: string | null
  hasChanges: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pending: boolean
}) {
  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      <div className="min-h-0 flex-1 overflow-y-auto px-8">
        <div className="grid gap-4">
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
          {children}
        </div>
      </div>
      <SheetFooter className="border-t border-border sm:flex-row sm:justify-end">
        <SheetClose asChild>
          <Button type="button" variant="secondary">
            {' '}
            {tt('Close')}{' '}
          </Button>
        </SheetClose>
        <Button disabled={!hasChanges || pending} type="submit">
          {pending ? tt('Saving...') : tt('Save')}
        </Button>
      </SheetFooter>
    </form>
  )
}
function BuiltinProviderPanel({
  builtInProviders,
  error,
  onUpdatePasskey,
  onUpdateSignIn,
  pending,
  provider,
  security,
}: {
  builtInProviders: ManagementSignInSettingsResponse['builtInProviders'] | null
  error: string | null
  onUpdatePasskey: (enabled: boolean) => void
  onUpdateSignIn: (input: z.infer<typeof updateManagementSignInSettingsRequestSchema>) => void
  pending: boolean
  provider: ConnectorProviderRow
  security: SecurityPolicy | null
}) {
  const [emailForm, setEmailForm] = useState(defaultEmailProviderSettings())
  const [passkeyEnabled, setPasskeyEnabled] = useState(false)
  const [passkeyAllowSignUp, setPasskeyAllowSignUp] = useState(true)
  const [phoneForm, setPhoneForm] = useState(defaultPhoneProviderSettings())
  const [web3Form, setWeb3Form] = useState(defaultWeb3ProviderSettings())
  const [oneTapForm, setOneTapForm] = useState(defaultOneTapProviderSettings())
  useEffect(() => {
    setPasskeyEnabled(security?.passkeys.enabled ?? false)
  }, [security])
  useEffect(() => {
    setEmailForm({
      ...defaultEmailProviderSettings(),
      ...(builtInProviders?.email ?? {}),
    })
    setPhoneForm({
      ...defaultPhoneProviderSettings(),
      ...(builtInProviders?.phone ?? {}),
    })
    setWeb3Form({
      ...defaultWeb3ProviderSettings(),
      ...(builtInProviders?.web3Wallet ?? {}),
    })
    setPasskeyAllowSignUp(builtInProviders?.passkey.allowSignUp ?? true)
    setOneTapForm({
      ...defaultOneTapProviderSettings(),
      ...(builtInProviders?.oneTap ?? {}),
    })
  }, [builtInProviders])
  if (provider.providerId === 'email') {
    const loaded = {
      ...defaultEmailProviderSettings(),
      ...(builtInProviders?.email ?? {}),
    }
    const hasChanges = !shallowEqual(emailForm, loaded)
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={hasChanges}
        onSubmit={(event) => {
          event.preventDefault()
          onUpdateSignIn({
            builtInProviders: {
              email: emailForm,
            },
          })
        }}
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={emailForm.enabled}
          description={tt('Allow users to receive a one-time sign-in code by email.')}
          label={tt('Enabled')}
          onCheckedChange={(enabled) =>
            setEmailForm((current) => ({
              ...current,
              enabled,
            }))
          }
        />
        <Field label={tt('OTP length')}>
          <TextInput
            onChange={(event) =>
              setEmailForm((current) => ({
                ...current,
                otpLength: Number(event.target.value),
              }))
            }
            type="number"
            value={String(emailForm.otpLength)}
          />
        </Field>
        <Field label={tt('Code expiry seconds')}>
          <TextInput
            onChange={(event) =>
              setEmailForm((current) => ({
                ...current,
                expiresInSeconds: Number(event.target.value),
              }))
            }
            type="number"
            value={String(emailForm.expiresInSeconds)}
          />
        </Field>
      </BuiltinProviderForm>
    )
  }
  if (provider.providerId === 'passkey') {
    const loadedAllowSignUp = builtInProviders?.passkey.allowSignUp ?? true
    const hasPasskeyEnabledChanges = passkeyEnabled !== Boolean(security?.passkeys.enabled)
    const hasChanges = hasPasskeyEnabledChanges || passkeyAllowSignUp !== loadedAllowSignUp
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={hasChanges}
        onSubmit={(event) => {
          event.preventDefault()
          if (hasPasskeyEnabledChanges) onUpdatePasskey(passkeyEnabled)
          if (passkeyAllowSignUp !== loadedAllowSignUp) {
            onUpdateSignIn({
              builtInProviders: {
                passkey: {
                  allowSignUp: passkeyAllowSignUp,
                },
              },
            })
          }
        }}
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={passkeyEnabled}
          description={`Use WebAuthn passkeys for this tenant (${security?.passkeys.rpName ?? 'tenant'}).`}
          label={tt('Enabled')}
          onCheckedChange={setPasskeyEnabled}
        />
        <BuiltInProviderSwitch
          checked={passkeyAllowSignUp}
          description={tt(
            'Allow passkeys to participate in the registration path. If a new user has no account information, they will be asked to sign in with another method first and then bind a passkey.',
          )}
          label={tt('Allow for sign-up')}
          onCheckedChange={setPasskeyAllowSignUp}
        />
        <SettingRow label={tt('Relying party')} value={security?.passkeys.rpName ?? 'Not loaded'} />
      </BuiltinProviderForm>
    )
  }
  if (provider.providerId === 'phone') {
    const loaded = {
      ...defaultPhoneProviderSettings(),
      ...(builtInProviders?.phone ?? {}),
    }
    const hasChanges = !shallowEqual(phoneForm, loaded)
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={hasChanges}
        onSubmit={(event) => {
          event.preventDefault()
          onUpdateSignIn({
            builtInProviders: {
              phone: phoneForm,
            },
          })
        }}
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={phoneForm.enabled}
          description={tt('Show phone number sign-in and verification flows.')}
          label={tt('Enabled')}
          onCheckedChange={(enabled) =>
            setPhoneForm((current) => ({
              ...current,
              enabled,
            }))
          }
        />
        <Field label={tt('SMS provider')}>
          <SelectInput
            onChange={(event) =>
              setPhoneForm((current) => ({
                ...current,
                smsProvider: event.target.value as SmsProviderId,
              }))
            }
            value={phoneForm.smsProvider}
          >
            {smsProviderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        {phoneForm.smsProvider === 'twilio' ? (
          <>
            <Field label={tt('Twilio Account SID')}>
              <TextInput
                onChange={(event) =>
                  setPhoneForm((current) => ({
                    ...current,
                    twilioAccountSid: event.target.value,
                  }))
                }
                value={phoneForm.twilioAccountSid}
              />
            </Field>
            <Field label={tt('Twilio Auth Token')}>
              <TextInput
                onChange={(event) =>
                  setPhoneForm((current) => ({
                    ...current,
                    twilioAuthToken: event.target.value,
                  }))
                }
                type="password"
                value={phoneForm.twilioAuthToken}
              />
            </Field>
            <Field label={tt('From number')}>
              <TextInput
                onChange={(event) =>
                  setPhoneForm((current) => ({
                    ...current,
                    twilioFromNumber: event.target.value,
                  }))
                }
                placeholder="+15551234567"
                value={phoneForm.twilioFromNumber}
              />
            </Field>
          </>
        ) : null}
        {phoneForm.smsProvider === 'vonage' ? (
          <>
            <Field label={tt('Vonage API key')}>
              <TextInput
                onChange={(event) =>
                  setPhoneForm((current) => ({
                    ...current,
                    vonageApiKey: event.target.value,
                  }))
                }
                value={phoneForm.vonageApiKey}
              />
            </Field>
            <Field label={tt('Vonage API secret')}>
              <TextInput
                onChange={(event) =>
                  setPhoneForm((current) => ({
                    ...current,
                    vonageApiSecret: event.target.value,
                  }))
                }
                type="password"
                value={phoneForm.vonageApiSecret}
              />
            </Field>
            <Field label={tt('From name or number')}>
              <TextInput
                onChange={(event) =>
                  setPhoneForm((current) => ({
                    ...current,
                    vonageFrom: event.target.value,
                  }))
                }
                value={phoneForm.vonageFrom}
              />
            </Field>
          </>
        ) : null}
        {phoneForm.smsProvider === 'messagebird' ? (
          <>
            <Field label={tt('MessageBird access key')}>
              <TextInput
                onChange={(event) =>
                  setPhoneForm((current) => ({
                    ...current,
                    messageBirdAccessKey: event.target.value,
                  }))
                }
                type="password"
                value={phoneForm.messageBirdAccessKey}
              />
            </Field>
            <Field label={tt('Originator')}>
              <TextInput
                onChange={(event) =>
                  setPhoneForm((current) => ({
                    ...current,
                    messageBirdOriginator: event.target.value,
                  }))
                }
                value={phoneForm.messageBirdOriginator}
              />
            </Field>
          </>
        ) : null}
        <Field label={tt('OTP length')}>
          <TextInput
            onChange={(event) =>
              setPhoneForm((current) => ({
                ...current,
                otpLength: Number(event.target.value),
              }))
            }
            type="number"
            value={String(phoneForm.otpLength)}
          />
        </Field>
        <Field label={tt('Code expiry seconds')}>
          <TextInput
            onChange={(event) =>
              setPhoneForm((current) => ({
                ...current,
                expiresInSeconds: Number(event.target.value),
              }))
            }
            type="number"
            value={String(phoneForm.expiresInSeconds)}
          />
        </Field>
        <BuiltInProviderSwitch
          checked={phoneForm.requireVerification}
          description={tt('Require phone verification before phone sign-in.')}
          label={tt('Require verification')}
          onCheckedChange={(requireVerification) =>
            setPhoneForm((current) => ({
              ...current,
              requireVerification,
            }))
          }
        />
      </BuiltinProviderForm>
    )
  }
  if (provider.providerId === 'web3-wallet') {
    const loaded = {
      ...defaultWeb3ProviderSettings(),
      ...(builtInProviders?.web3Wallet ?? {}),
    }
    const hasChanges = !shallowEqual(web3Form, loaded)
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={hasChanges}
        onSubmit={(event) => {
          event.preventDefault()
          onUpdateSignIn({
            builtInProviders: {
              web3Wallet: web3Form,
            },
          })
        }}
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={web3Form.enabled}
          description={tt('Enable Sign In With Ethereum wallet authentication.')}
          label={tt('Enabled')}
          onCheckedChange={(enabled) =>
            setWeb3Form((current) => ({
              ...current,
              enabled,
            }))
          }
        />
        <Field label={tt('Enabled chains')}>
          <div className="grid gap-3">
            {web3ChainOptions.map((chain) => (
              <div
                className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2"
                key={chain.id}
              >
                <span className="text-sm font-medium">{chain.label}</span>
                <Switch
                  aria-label={chain.label}
                  checked={web3Form.chains.includes(chain.id)}
                  onCheckedChange={(checked) =>
                    setWeb3Form((current) => ({
                      ...current,
                      chains: checked
                        ? Array.from(new Set([...current.chains, chain.id]))
                        : current.chains.filter((id) => id !== chain.id),
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </Field>
        <BuiltInProviderSwitch
          checked={web3Form.allowSignUp}
          description={tt(
            'Allow wallets to participate in the registration path. If a new user has no account information, they will be asked to sign in with another method first and then bind a wallet.',
          )}
          label={tt('Allow for sign-up')}
          onCheckedChange={(allowSignUp) =>
            setWeb3Form((current) => ({
              ...current,
              allowSignUp,
            }))
          }
        />
        <BuiltInProviderSwitch
          checked={web3Form.ensLookupEnabled}
          description={tt('Use ENS lookup for wallet display names and avatars when available.')}
          label={tt('ENS lookup')}
          onCheckedChange={(ensLookupEnabled) =>
            setWeb3Form((current) => ({
              ...current,
              ensLookupEnabled,
            }))
          }
        />
      </BuiltinProviderForm>
    )
  }
  if (provider.providerId === 'onetap') {
    const loaded = {
      ...defaultOneTapProviderSettings(),
      ...(builtInProviders?.oneTap ?? {}),
    }
    const hasChanges = !shallowEqual(oneTapForm, loaded)
    return (
      <BuiltinProviderForm
        error={error}
        hasChanges={hasChanges}
        onSubmit={(event) => {
          event.preventDefault()
          onUpdateSignIn({
            builtInProviders: {
              oneTap: oneTapForm,
            },
          })
        }}
        pending={pending}
      >
        <BuiltInProviderSwitch
          checked={oneTapForm.enabled}
          description={tt('Enable Google One Tap on hosted sign-in.')}
          label={tt('Enabled')}
          onCheckedChange={(enabled) =>
            setOneTapForm((current) => ({
              ...current,
              enabled,
            }))
          }
        />
        <Field label={tt('Client ID')}>
          <TextInput
            onChange={(event) =>
              setOneTapForm((current) => ({
                ...current,
                clientId: event.target.value,
              }))
            }
            value={oneTapForm.clientId}
          />
        </Field>
        <Field label={tt('UX mode')}>
          <SelectInput
            onChange={(event) =>
              setOneTapForm((current) => ({
                ...current,
                uxMode: event.target.value as never,
              }))
            }
            value={oneTapForm.uxMode}
          >
            <option value="popup">{tt('Popup')}</option>
            <option value="redirect">{tt('Redirect')}</option>
          </SelectInput>
        </Field>
        <Field label={tt('Context')}>
          <SelectInput
            onChange={(event) =>
              setOneTapForm((current) => ({
                ...current,
                context: event.target.value as never,
              }))
            }
            value={oneTapForm.context}
          >
            <option value="signin">{tt('Sign in')}</option>
            <option value="signup">{tt('Sign up')}</option>
            <option value="use">{tt('Use')}</option>
          </SelectInput>
        </Field>
        <BuiltInProviderSwitch
          checked={oneTapForm.autoSelect}
          description={tt('Automatically select the Google account when possible.')}
          label={tt('Auto select')}
          onCheckedChange={(autoSelect) =>
            setOneTapForm((current) => ({
              ...current,
              autoSelect,
            }))
          }
        />
        <BuiltInProviderSwitch
          checked={oneTapForm.cancelOnTapOutside}
          description={tt('Allow the prompt to close when users tap outside it.')}
          label={tt('Cancel on outside tap')}
          onCheckedChange={(cancelOnTapOutside) =>
            setOneTapForm((current) => ({
              ...current,
              cancelOnTapOutside,
            }))
          }
        />
        <Field label={tt('Prompt base delay')}>
          <TextInput
            onChange={(event) =>
              setOneTapForm((current) => ({
                ...current,
                promptBaseDelayMs: Number(event.target.value),
              }))
            }
            type="number"
            value={String(oneTapForm.promptBaseDelayMs)}
          />
        </Field>
        <Field label={tt('Prompt max attempts')}>
          <TextInput
            onChange={(event) =>
              setOneTapForm((current) => ({
                ...current,
                promptMaxAttempts: Number(event.target.value),
              }))
            }
            type="number"
            value={String(oneTapForm.promptMaxAttempts)}
          />
        </Field>
      </BuiltinProviderForm>
    )
  }
  const runtimeTitle = builtinProviderRuntimeTitle(provider.providerId)
  const runtimeDescription = builtinProviderRuntimeDescription(provider.providerId)
  return (
    <div className="grid gap-3">
      <p className="text-sm font-semibold">{runtimeTitle}</p>
      <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        {runtimeDescription}
      </p>
    </div>
  )
}
function BuiltInProviderSwitch({
  checked,
  description,
  label,
  onCheckedChange,
}: {
  checked: boolean
  description: string
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
const web3ChainOptions = [
  {
    id: 1,
    label: 'Ethereum Mainnet',
  },
  {
    id: 137,
    label: 'Polygon',
  },
  {
    id: 8453,
    label: 'Base',
  },
  {
    id: 42161,
    label: 'Arbitrum One',
  },
  {
    id: 10,
    label: 'Optimism',
  },
]
function defaultPhoneProviderSettings(): ManagementSignInSettingsResponse['builtInProviders']['phone'] {
  return {
    enabled: false,
    smsProvider: 'twilio',
    otpLength: 6,
    expiresInSeconds: 300,
    signUpOnVerification: false,
    requireVerification: true,
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioFromNumber: '',
    vonageApiKey: '',
    vonageApiSecret: '',
    vonageFrom: '',
    messageBirdAccessKey: '',
    messageBirdOriginator: '',
  }
}
function defaultEmailProviderSettings(): ManagementSignInSettingsResponse['builtInProviders']['email'] {
  return {
    enabled: true,
    otpLength: 6,
    expiresInSeconds: 300,
  }
}
function defaultWeb3ProviderSettings(): ManagementSignInSettingsResponse['builtInProviders']['web3Wallet'] {
  return {
    enabled: false,
    chains: [1],
    domain: '',
    emailDomainName: '',
    allowSignUp: true,
    ensLookupEnabled: false,
  }
}
function defaultOneTapProviderSettings(): ManagementSignInSettingsResponse['builtInProviders']['oneTap'] {
  return {
    enabled: false,
    clientId: '',
    autoSelect: false,
    cancelOnTapOutside: true,
    uxMode: 'popup',
    context: 'signin',
    promptBaseDelayMs: 1000,
    promptMaxAttempts: 5,
    disableSignUp: false,
  }
}
function builtinProviderRuntimeTitle(providerId: string) {
  if (providerId === 'phone') return 'SMS runtime'
  if (providerId === 'web3-wallet') return 'Web3 wallet runtime'
  if (providerId === 'passkey') return 'Passkey runtime'
  if (providerId === 'onetap') return 'OneTap runtime'
  return 'Provider runtime'
}
function builtinProviderRuntimeDescription(providerId: string) {
  if (providerId === 'phone') return 'SMS provider is not configured in this runtime.'
  if (providerId === 'web3-wallet') return 'Wallet sign-in is not configured in this runtime.'
  if (providerId === 'passkey') return 'Passkey sign-in is managed by Multi-Factor Auth and is not enabled here.'
  if (providerId === 'onetap') return 'OneTap sign-in is not configured in this runtime.'
  return 'This provider is not configured in this runtime.'
}
function CallbackUrlField({ value }: { value: string }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{tt('Callback URL')}</label>
      <div className="flex gap-2">
        <TextInput className="font-mono" id={id} readOnly value={value} />
        <Button onClick={() => navigator.clipboard.writeText(value)} type="button" variant="secondary">
          <Copy data-icon="inline-start" /> {tt('Copy')}{' '}
        </Button>
      </div>
    </div>
  )
}
function ConnectorDynamicFields({
  form,
  isExisting,
  setForm,
  template,
}: {
  form: FormState
  isExisting: boolean
  setForm: (value: SetStateAction<FormState>) => void
  template: ConnectorTemplate | null
}) {
  const fields = connectorTemplateFields(template)
  if (!fields.length) return null
  return (
    <div className="grid gap-4">
      {fields.map((field) => {
        const value = form[field.formKey] ?? ''
        return (
          <Field
            help={
              field.key === tt('clientSecret') && isExisting
                ? tt('Leave blank to keep the current secret.')
                : field.required
                  ? tt('Required by this Better Auth provider.')
                  : tt('Optional provider parameter.')
            }
            key={field.formKey}
            label={field.label}
          >
            <TextInput
              onChange={(event) => setValue(setForm, field.formKey, event.target.value)}
              required={field.required && !(field.key === 'clientSecret' && isExisting)}
              type={field.secret ? 'password' : 'text'}
              value={value}
            />
          </Field>
        )
      })}
    </div>
  )
}
type ConnectorTemplateField = {
  formKey: string
  key: string
  label: string
  required: boolean
  secret: boolean
}
function connectorTemplateFields(template: ConnectorTemplate | null): ConnectorTemplateField[] {
  if (!template) return []
  const fields = new Map<string, ConnectorTemplateField>()
  for (const field of template.requiredFields) addConnectorTemplateField(fields, field, true)
  for (const field of template.optionalFields) addConnectorTemplateField(fields, field, false)
  return Array.from(fields.values())
}
function addConnectorTemplateField(fields: Map<string, ConnectorTemplateField>, field: string, required: boolean) {
  if (!isConnectorProductField(field)) return
  const metadataPrefix = 'providerMetadata.'
  const key = field.startsWith(metadataPrefix) ? field.slice(metadataPrefix.length) : field
  const formKey = field.startsWith(metadataPrefix) ? `metadata.${key}` : key
  const existing = fields.get(formKey)
  fields.set(formKey, {
    formKey,
    key,
    label: connectorFieldLabel(key),
    required: existing?.required || required,
    secret: key.toLowerCase().includes('secret'),
  })
}
const connectorProductFields = new Set([
  'clientId',
  'clientSecret',
  'providerMetadata.domain',
  'providerMetadata.region',
  'providerMetadata.userPoolId',
])
function isConnectorProductField(field: string) {
  return connectorProductFields.has(field)
}
function connectorCallbackUrl(providerId: string) {
  return `${window.location.origin}/api/auth/callback/${providerId}`
}
export function SignInSettingsPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.signIn,
    queryFn: getSignInSettings,
  })
  const brandingQuery = useQuery({
    queryKey: adminQueryKeys.branding,
    queryFn: getBrandingSettings,
  })
  const securityQuery = useQuery({
    queryKey: adminQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const connectorsQuery = useConnectorPreviewProviders()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    passkeyLoginEnabled: false,
    passwordlessEnabled: false,
    phoneLoginEnabled: false,
    signupEnabled: true,
    socialLoginEnabled: true,
    web3WalletLoginEnabled: false,
  })
  const [minLength, setMinLength] = useState(8)
  const [requiredCharacterTypes, setRequiredCharacterTypes] = useState(1)
  const [customWords, setCustomWords] = useState('')
  const [rejectUserInfo, setRejectUserInfo] = useState(true)
  const [rejectSequential, setRejectSequential] = useState(true)
  const [rejectCustomWords, setRejectCustomWords] = useState(false)
  const updateMutation = useAdminMutation({
    mutationFn: updateSignInSettings,
    onSuccess: () => {
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.signIn,
      })
    },
  })
  const securityMutation = useMutation({
    mutationFn: () =>
      updateSecurityPolicy({
        policy: {
          passkeys: {
            enabled: form.passkeyLoginEnabled,
          },
          password: {
            minLength,
            requiredCharacterTypes,
            customWords: lines(customWords),
            rejectUserInfo,
            rejectSequential,
            rejectCustomWords,
          },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.security,
      })
    },
  })
  useEffect(() => {
    if (!query.data?.signIn || !query.data.builtInProviders) return
    setForm({
      passkeyLoginEnabled: securityQuery.data?.policy?.passkeys?.enabled ?? false,
      passwordlessEnabled: !query.data.signIn.passwordEnabled,
      phoneLoginEnabled: query.data.builtInProviders.phone.enabled,
      signupEnabled: query.data.signIn.signupEnabled,
      socialLoginEnabled: query.data.signIn.socialLoginEnabled,
      web3WalletLoginEnabled: query.data.builtInProviders.web3Wallet.enabled,
    })
  }, [query.data, securityQuery.data])
  useEffect(() => {
    if (!securityQuery.data?.policy?.password) return
    const policy = securityQuery.data.policy.password
    setMinLength(policy.minLength)
    setRequiredCharacterTypes(policy.requiredCharacterTypes)
    setCustomWords(policy.customWords.join('\n'))
    setRejectUserInfo(policy.rejectUserInfo)
    setRejectSequential(policy.rejectSequential)
    setRejectCustomWords(policy.rejectCustomWords)
  }, [securityQuery.data])
  const loadedForm =
    query.data?.signIn && query.data.builtInProviders
      ? {
          passkeyLoginEnabled: securityQuery.data?.policy?.passkeys?.enabled ?? false,
          passwordlessEnabled: !query.data.signIn.passwordEnabled,
          phoneLoginEnabled: query.data.builtInProviders.phone.enabled,
          signupEnabled: query.data.signIn.signupEnabled,
          socialLoginEnabled: query.data.signIn.socialLoginEnabled,
          web3WalletLoginEnabled: query.data.builtInProviders.web3Wallet.enabled,
        }
      : null
  const hasChanges = loadedForm ? !shallowEqual(form, loadedForm) : false
  const signInHasChanges = loadedForm
    ? !shallowEqual(
        {
          passwordlessEnabled: form.passwordlessEnabled,
          phoneLoginEnabled: form.phoneLoginEnabled,
          signupEnabled: form.signupEnabled,
          socialLoginEnabled: form.socialLoginEnabled,
          web3WalletLoginEnabled: form.web3WalletLoginEnabled,
        },
        {
          passwordlessEnabled: loadedForm.passwordlessEnabled,
          phoneLoginEnabled: loadedForm.phoneLoginEnabled,
          signupEnabled: loadedForm.signupEnabled,
          socialLoginEnabled: loadedForm.socialLoginEnabled,
          web3WalletLoginEnabled: loadedForm.web3WalletLoginEnabled,
        },
      )
    : false
  const passkeyHasChanges = loadedForm ? form.passkeyLoginEnabled !== loadedForm.passkeyLoginEnabled : false
  const loadedPasswordPolicy = securityQuery.data?.policy?.password
    ? {
        minLength: securityQuery.data.policy.password.minLength,
        requiredCharacterTypes: securityQuery.data.policy.password.requiredCharacterTypes,
        customWords: securityQuery.data.policy.password.customWords.join('\n'),
        rejectUserInfo: securityQuery.data.policy.password.rejectUserInfo,
        rejectSequential: securityQuery.data.policy.password.rejectSequential,
        rejectCustomWords: securityQuery.data.policy.password.rejectCustomWords,
      }
    : null
  const passwordPolicyHasChanges = loadedPasswordPolicy
    ? !shallowEqual(
        {
          minLength,
          requiredCharacterTypes,
          customWords,
          rejectUserInfo,
          rejectSequential,
          rejectCustomWords,
        },
        loadedPasswordPolicy,
      )
    : false
  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (signInHasChanges && query.data) {
      const payload = updateManagementSignInSettingsRequestSchema.parse({
        builtInProviders: {
          phone: {
            ...query.data.builtInProviders.phone,
            enabled: form.phoneLoginEnabled,
          },
          web3Wallet: {
            ...query.data.builtInProviders.web3Wallet,
            enabled: form.web3WalletLoginEnabled,
          },
        },
        signIn: {
          passwordEnabled: !form.passwordlessEnabled,
          signupEnabled: form.signupEnabled,
          socialLoginEnabled: form.socialLoginEnabled,
        },
      })
      updateMutation.mutate(payload)
    }
    if (passwordPolicyHasChanges || passkeyHasChanges) securityMutation.mutate()
  }
  const preview: HostedAuthPreviewState = {
    productName: query.data?.copy?.productName ?? '',
    headline: query.data?.copy?.headline ?? '',
    description: query.data?.copy?.description ?? '',
    logoUrl: brandingQuery.data?.branding?.logoUrl ?? undefined,
    primaryColor: brandingQuery.data?.branding?.primaryColor ?? undefined,
    backgroundColor: brandingQuery.data?.branding?.backgroundColor ?? undefined,
    customCss: brandingQuery.data?.branding?.customCss ?? undefined,
    passwordEnabled: !form.passwordlessEnabled,
    passkeysEnabled: form.passkeyLoginEnabled,
    phoneEnabled: form.phoneLoginEnabled,
    signupEnabled: form.signupEnabled,
    socialLoginEnabled: form.socialLoginEnabled,
    socialProviders: connectorsQuery.providers,
    oneTapEnabled: query.data?.builtInProviders?.oneTap?.enabled,
    web3WalletEnabled: form.web3WalletLoginEnabled,
    identifierFirst: false,
    usernameEnabled: query.data?.signIn?.usernameEnabled,
    emailOtpEnabled: query.data?.signIn?.emailOtpEnabled,
    termsUri: query.data?.links?.termsUri ?? '',
    privacyUri: query.data?.links?.privacyUri ?? '',
    supportEmail: query.data?.links?.supportEmail ?? '',
  }
  return (
    <SignInExperiencePage
      activeTab="sign-up-and-sign-in"
      description={tt('Configure self-service registration and hosted sign-in method visibility.')}
      error={query.error ?? brandingQuery.error ?? securityQuery.error ?? connectorsQuery.error}
      loading={query.isLoading || brandingQuery.isLoading || securityQuery.isLoading}
      onRetry={() => {
        void query.refetch()
        void brandingQuery.refetch()
        void securityQuery.refetch()
        void connectorsQuery.refetch()
      }}
      title={tt('Sign-up and sign-in')}
    >
      {query.data && securityQuery.data ? (
        <form onSubmit={onSubmit}>
          <SignInExperienceEditorLayout
            preview={<HostedAuthPreview preview={preview} />}
            settings={
              <SettingsSections>
                <SettingsSection
                  title={tt('Sign-up')}
                  description={tt('Control whether new users can create accounts.')}
                >
                  <div className="grid gap-3">
                    <SwitchRow
                      checked={form.signupEnabled}
                      label={tt('Allow sign up')}
                      onCheckedChange={(signupEnabled) =>
                        setForm((value) => ({
                          ...value,
                          signupEnabled,
                        }))
                      }
                    />
                  </div>
                </SettingsSection>
                <SettingsSection
                  title={tt('Sign-in')}
                  description={tt('Control which non-password sign-in methods are available.')}
                >
                  <div className="grid gap-3">
                    <SwitchRow
                      checked={form.socialLoginEnabled}
                      label={tt('Social login')}
                      onCheckedChange={(socialLoginEnabled) =>
                        setForm((value) => ({
                          ...value,
                          socialLoginEnabled,
                        }))
                      }
                    />
                    <SwitchRow
                      checked={form.phoneLoginEnabled}
                      label={tt('Phone login')}
                      onCheckedChange={(phoneLoginEnabled) =>
                        setForm((value) => ({
                          ...value,
                          phoneLoginEnabled,
                        }))
                      }
                    />
                    <SwitchRow
                      checked={form.passkeyLoginEnabled}
                      label={tt('Passkey login')}
                      onCheckedChange={(passkeyLoginEnabled) =>
                        setForm((value) => ({
                          ...value,
                          passkeyLoginEnabled,
                        }))
                      }
                    />
                    <SwitchRow
                      checked={form.web3WalletLoginEnabled}
                      label={tt('Web3 wallet login')}
                      onCheckedChange={(web3WalletLoginEnabled) =>
                        setForm((value) => ({
                          ...value,
                          web3WalletLoginEnabled,
                        }))
                      }
                    />
                  </div>
                </SettingsSection>
                <SettingsSection
                  title={tt('Passwordless')}
                  description={tt(
                    'Turn off password-based hosted auth. Password requirements stay visible but only apply when passwords are used.',
                  )}
                >
                  <div className="grid gap-4">
                    <Field label={tt('Passwordless')}>
                      <div className="flex min-h-10 items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
                        <span className="text-sm text-muted-foreground">
                          {form.passwordlessEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                        <Switch
                          aria-label={tt('Passwordless')}
                          checked={form.passwordlessEnabled}
                          onCheckedChange={(passwordlessEnabled) =>
                            setForm((value) => ({
                              ...value,
                              passwordlessEnabled,
                            }))
                          }
                        />
                      </div>
                    </Field>
                    <Field label={tt('Minimum length')}>
                      <TextInput
                        aria-label={tt('Minimum length')}
                        disabled={form.passwordlessEnabled}
                        min={8}
                        max={128}
                        onChange={(event) => setMinLength(Number(event.target.value))}
                        type="number"
                        value={String(minLength)}
                      />
                    </Field>
                    <Field label={tt('Required character types')}>
                      <SelectInput
                        aria-label={tt('Required character types')}
                        disabled={form.passwordlessEnabled}
                        onChange={(event) => setRequiredCharacterTypes(Number(event.target.value))}
                        value={String(requiredCharacterTypes)}
                      >
                        <option value="1">{tt('1 required character type')}</option>
                        <option value="2">{tt('2 required character types')}</option>
                        <option value="3">{tt('3 required character types')}</option>
                        <option value="4">{tt('4 required character types')}</option>
                      </SelectInput>
                    </Field>
                    <SwitchRow
                      checked={rejectSequential}
                      disabled={form.passwordlessEnabled}
                      label={tt('Reject repetitive or sequential characters')}
                      onCheckedChange={setRejectSequential}
                    />
                    <SwitchRow
                      checked={rejectUserInfo}
                      disabled={form.passwordlessEnabled}
                      label={tt('Reject user information')}
                      onCheckedChange={setRejectUserInfo}
                    />
                    <SwitchRow
                      checked={rejectCustomWords}
                      disabled={form.passwordlessEnabled}
                      label={tt('Reject custom words')}
                      onCheckedChange={setRejectCustomWords}
                    />
                    {rejectCustomWords && !form.passwordlessEnabled ? (
                      <Field label={tt('Custom words')}>
                        <TextArea
                          aria-label={tt('Custom words')}
                          onChange={(event) => setCustomWords(event.target.value)}
                          placeholder={tt('company\nproduct')}
                          value={customWords}
                        />
                      </Field>
                    ) : null}
                  </div>
                </SettingsSection>
                <ChangesSection
                  description={tt('Save updates through the management boundary or restore the loaded values.')}
                  error={
                    updateMutation.errorMessage || securityMutation.error ? (
                      <div className="text-sm text-destructive">
                        {updateMutation.errorMessage ??
                          (securityMutation.error instanceof Error
                            ? tt(securityMutation.error.message)
                            : tt('Request failed.'))}
                      </div>
                    ) : null
                  }
                  onDiscard={() => {
                    if (loadedForm) setForm(loadedForm)
                    if (loadedPasswordPolicy) {
                      setMinLength(loadedPasswordPolicy.minLength)
                      setRequiredCharacterTypes(loadedPasswordPolicy.requiredCharacterTypes)
                      setCustomWords(loadedPasswordPolicy.customWords)
                      setRejectUserInfo(loadedPasswordPolicy.rejectUserInfo)
                      setRejectSequential(loadedPasswordPolicy.rejectSequential)
                      setRejectCustomWords(loadedPasswordPolicy.rejectCustomWords)
                    }
                  }}
                  pending={updateMutation.isPending || securityMutation.isPending}
                  saveLabel="Save sign-in settings"
                  visible={hasChanges || passwordPolicyHasChanges}
                />
              </SettingsSections>
            }
          />
        </form>
      ) : null}
    </SignInExperiencePage>
  )
}
export function MfaPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'optional' | 'required'>('optional')
  const [passkeysEnabled, setPasskeysEnabled] = useState(true)
  const [authenticatorAppEnabled, setAuthenticatorAppEnabled] = useState(true)
  const [emailOtpEnabled, setEmailOtpEnabled] = useState(false)
  const [backupCodesEnabled, setBackupCodesEnabled] = useState(true)
  const updateMutation = useMutation({
    mutationFn: () =>
      updateSecurityPolicy({
        policy: {
          mfa: {
            mode,
            authenticatorAppEnabled,
            emailOtpEnabled,
            backupCodesEnabled,
          },
          passkeys: {
            enabled: passkeysEnabled,
          },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.security,
      })
    },
  })
  useEffect(() => {
    if (!query.data) return
    setMode(query.data.policy.mfa.mode)
    setPasskeysEnabled(query.data.policy.passkeys.enabled)
    setAuthenticatorAppEnabled(query.data.policy.mfa.authenticatorAppEnabled ?? true)
    setEmailOtpEnabled(query.data.policy.mfa.emailOtpEnabled ?? false)
    setBackupCodesEnabled(query.data.policy.mfa.backupCodesEnabled ?? true)
  }, [query.data])
  const loadedPolicy = query.data
    ? {
        mode: query.data.policy.mfa.mode,
        passkeysEnabled: query.data.policy.passkeys.enabled,
        authenticatorAppEnabled: query.data.policy.mfa.authenticatorAppEnabled ?? true,
        emailOtpEnabled: query.data.policy.mfa.emailOtpEnabled ?? false,
        backupCodesEnabled: query.data.policy.mfa.backupCodesEnabled ?? true,
      }
    : null
  const hasChanges = loadedPolicy
    ? !shallowEqual(
        {
          mode,
          passkeysEnabled,
          authenticatorAppEnabled,
          emailOtpEnabled,
          backupCodesEnabled,
        },
        loadedPolicy,
      )
    : false
  return (
    <ResourcePage
      title={tt('Multi-factor authentication')}
      description={tt('Review tenant MFA factors and deployment policy for hosted account protection.')}
      error={query.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {query.data ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            updateMutation.mutate()
          }}
        >
          <SettingsSections>
            <SettingsSection
              title={tt('Factors')}
              description={tt('Available second factors surfaced by account and deployment support.')}
            >
              <div className="grid gap-3">
                <MfaFactorSwitch
                  checked={passkeysEnabled}
                  description={`Use WebAuthn passkeys for this tenant (${query.data.policy.passkeys.rpName}).`}
                  icon={<KeyRound size={18} />}
                  label={tt('Passkeys')}
                  onCheckedChange={setPasskeysEnabled}
                />
                <MfaFactorSwitch
                  checked={authenticatorAppEnabled}
                  description={tt('Allow users to enroll an authenticator app and verify time-based codes.')}
                  icon={<Smartphone size={18} />}
                  label={tt('Authenticator app')}
                  onCheckedChange={setAuthenticatorAppEnabled}
                />
                <MfaFactorSwitch
                  checked={emailOtpEnabled}
                  description={tt(
                    'Allow email verification codes as a second factor when email delivery is configured.',
                  )}
                  icon={<Mail size={18} />}
                  label={tt('Email verification code')}
                  onCheckedChange={setEmailOtpEnabled}
                />
                <MfaFactorSwitch
                  checked={backupCodesEnabled}
                  description={tt('Allow recovery backup codes generated during authenticator enrollment.')}
                  icon={<LifeBuoy size={18} />}
                  label={tt('Backup codes')}
                  onCheckedChange={setBackupCodesEnabled}
                />
              </div>
            </SettingsSection>
            <SettingsSection
              title={tt('Policy controls')}
              description={tt('Prompt policy is persisted for hosted account access.')}
            >
              <div className="grid gap-4">
                <Field label={tt('Prompt policy')}>
                  <SelectInput
                    aria-label={tt('Prompt policy')}
                    onChange={(event) => setMode(event.target.value as 'optional' | 'required')}
                    value={mode}
                  >
                    <option value="required">{tt('Required')}</option>
                    <option value="optional">{tt('Optional')}</option>
                  </SelectInput>
                </Field>
                <SettingRow label={tt('Persisted mode')} value={query.data.policy.mfa.mode} />
              </div>
            </SettingsSection>
            <ChangesSection
              description={tt('Save or reset tenant MFA policy changes.')}
              error={<MutationError error={updateMutation.error} />}
              onDiscard={() => {
                if (!loadedPolicy) return
                setMode(loadedPolicy.mode)
                setPasskeysEnabled(loadedPolicy.passkeysEnabled)
                setAuthenticatorAppEnabled(loadedPolicy.authenticatorAppEnabled)
                setEmailOtpEnabled(loadedPolicy.emailOtpEnabled)
                setBackupCodesEnabled(loadedPolicy.backupCodesEnabled)
              }}
              pending={updateMutation.isPending}
              saveLabel="Save changes"
              visible={hasChanges}
            />
          </SettingsSections>
        </form>
      ) : null}
    </ResourcePage>
  )
}
function MfaFactorSwitch({
  checked,
  description,
  icon,
  label,
  onCheckedChange,
}: {
  checked: boolean
  description: string
  icon: ReactNode
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-3">
      <div
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted text-primary"
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-5">{label}</div>
        <p className="m-0 text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
export function SecurityPasswordPolicyPage() {
  return <SignInSettingsPage />
}
export function SecurityCaptchaPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(false)
  const [siteKey, setSiteKey] = useState('')
  const [secretBinding, setSecretBinding] = useState('')
  const updateMutation = useMutation({
    mutationFn: () =>
      updateSecurityPolicy({
        policy: {
          captcha: {
            enabled,
            provider: 'turnstile',
            siteKey,
            secretBinding,
          },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.security,
      })
    },
  })
  useEffect(() => {
    if (!query.data) return
    setEnabled(query.data.policy.captcha.enabled)
    setSiteKey(query.data.policy.captcha.siteKey)
    setSecretBinding(query.data.policy.captcha.secretBinding)
  }, [query.data])
  const loadedPolicy = query.data
    ? {
        enabled: query.data.policy.captcha.enabled,
        siteKey: query.data.policy.captcha.siteKey,
        secretBinding: query.data.policy.captcha.secretBinding,
      }
    : null
  const hasChanges = loadedPolicy
    ? !shallowEqual(
        {
          enabled,
          siteKey,
          secretBinding,
        },
        loadedPolicy,
      )
    : false
  return (
    <ResourcePage
      title={tt('CAPTCHA')}
      description={tt('Review CAPTCHA provider setup for hosted sign-up, sign-in, and password recovery flows.')}
      error={query.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <SecuritySectionTabs active="captcha" />
      {query.data ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            updateMutation.mutate()
          }}
        >
          <SettingsSections>
            <SettingsSection
              title={tt('Provider setup')}
              description={tt('Configure Turnstile verification for hosted flows.')}
            >
              <div className="grid gap-4">
                <SwitchRow checked={enabled} label={tt('Enable CAPTCHA')} onCheckedChange={setEnabled} />
                <Field label={tt('Provider')}>
                  <SelectInput aria-label={tt('Provider')} onChange={() => undefined} value="turnstile">
                    <option value="turnstile">{tt('Turnstile')}</option>
                  </SelectInput>
                </Field>
                <Field label={tt('Site key')}>
                  <TextInput
                    aria-label={tt('Site key')}
                    onChange={(event) => setSiteKey(event.target.value)}
                    value={siteKey}
                  />
                </Field>
                <Field label={tt('Client secret')}>
                  <TextInput
                    aria-label={tt('Client secret')}
                    onChange={(event) => setSecretBinding(event.target.value)}
                    placeholder={tt('TURNSTILE_SECRET')}
                    value={secretBinding}
                  />
                </Field>
              </div>
            </SettingsSection>
            <ChangesSection
              description={tt('Save or reset CAPTCHA policy changes.')}
              error={<MutationError error={updateMutation.error} />}
              onDiscard={() => {
                if (!loadedPolicy) return
                setEnabled(loadedPolicy.enabled)
                setSiteKey(loadedPolicy.siteKey)
                setSecretBinding(loadedPolicy.secretBinding)
              }}
              pending={updateMutation.isPending}
              saveLabel="Save changes"
              visible={hasChanges}
            />
          </SettingsSections>
        </form>
      ) : null}
    </ResourcePage>
  )
}
export function SecurityBlocklistPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const queryClient = useQueryClient()
  const [blockSubaddressing, setBlockSubaddressing] = useState(false)
  const [entries, setEntries] = useState('')
  const updateMutation = useMutation({
    mutationFn: () =>
      updateSecurityPolicy({
        policy: {
          blocklist: {
            blockSubaddressing,
            entries: lines(entries),
          },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.security,
      })
    },
  })
  useEffect(() => {
    if (!query.data) return
    setBlockSubaddressing(query.data.policy.blocklist.blockSubaddressing)
    setEntries(query.data.policy.blocklist.entries.join('\n'))
  }, [query.data])
  const loadedPolicy = query.data
    ? {
        blockSubaddressing: query.data.policy.blocklist.blockSubaddressing,
        entries: query.data.policy.blocklist.entries.join('\n'),
      }
    : null
  const hasChanges = loadedPolicy
    ? !shallowEqual(
        {
          blockSubaddressing,
          entries,
        },
        loadedPolicy,
      )
    : false
  return (
    <ResourcePage
      title={tt('Blocklist')}
      description={tt('Review sign-up blocklist settings for email aliases, addresses, and domains.')}
      error={query.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <SecuritySectionTabs active="blocklist" />
      {query.data ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            updateMutation.mutate()
          }}
        >
          <SettingsSections>
            <SettingsSection title={tt('Email blocklist')} description={tt('Persist blocked email and domain rules.')}>
              <div className="grid gap-4">
                <SwitchRow
                  checked={blockSubaddressing}
                  label={tt('Block email subaddressing')}
                  onCheckedChange={setBlockSubaddressing}
                />
                <Field
                  label={tt('Custom email and domain blocklist')}
                  help={tt('One email address or domain per line.')}
                >
                  <TextArea
                    aria-label={tt('Custom email and domain blocklist')}
                    onChange={(event) => setEntries(event.target.value)}
                    placeholder={tt('blocked@example.com\nexample.org')}
                    value={entries}
                  />
                </Field>
              </div>
            </SettingsSection>
            <ChangesSection
              description={tt('Save or reset blocklist changes.')}
              error={<MutationError error={updateMutation.error} />}
              onDiscard={() => {
                if (!loadedPolicy) return
                setBlockSubaddressing(loadedPolicy.blockSubaddressing)
                setEntries(loadedPolicy.entries)
              }}
              pending={updateMutation.isPending}
              saveLabel="Save changes"
              visible={hasChanges}
            />
          </SettingsSections>
        </form>
      ) : null}
    </ResourcePage>
  )
}
export function SecurityGeneralPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  return (
    <ResourcePage
      title={tt('General security')}
      description={tt('Review general protections tied to current deployment security policy.')}
      error={query.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <SecuritySectionTabs active="general" />
      {query.data ? (
        <SettingsSections>
          <SettingsSection
            title={tt('Protection')}
            description={tt('Tenant sign-in protections from persisted policy.')}
          >
            <div className="grid gap-3">
              <SettingRow label={tt('MFA enforcement')} value={query.data.policy.mfa.mode} />
              <SettingRow label={tt('Passkeys')} value={query.data.policy.passkeys.enabled ? 'Enabled' : 'Disabled'} />
              <SettingRow
                label={tt('CAPTCHA')}
                value={query.data.policy.captcha.enabled ? 'Enabled for hosted flows' : 'Disabled'}
              />
              <SettingRow
                label={tt('Email blocklist entries')}
                value={String(query.data.policy.blocklist.entries.length)}
              />
              <SettingRow label={tt('Password minimum')} value={`${query.data.policy.password.minLength} characters`} />
            </div>
          </SettingsSection>
          <SettingsSection
            title={tt('Session policy')}
            description={tt('Session lifetime values currently active in runtime.')}
          >
            <div className="grid gap-3">
              <SettingRow label={tt('Session TTL')} value={`${query.data.policy.sessions.expiresInSeconds}s`} />
              <SettingRow label={tt('Fresh age')} value={`${query.data.policy.sessions.freshAgeSeconds}s`} />
            </div>
          </SettingsSection>
          <SettingsSection
            title={tt('Headers and cookies')}
            description={tt('Runtime-managed browser protection settings.')}
          >
            <div className="grid gap-3">
              <SettingRow label={tt('Security headers')} value="Managed by Worker middleware" />
              <SettingRow label={tt('Cookie cache')} value={`${query.data.policy.sessions.cookieCacheSeconds}s`} />
            </div>
          </SettingsSection>
        </SettingsSections>
      ) : null}
    </ResourcePage>
  )
}
export function OrganizationsPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.organizations,
    queryFn: listOrganizations,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createOrganization,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations,
      })
    },
  })
  const logoMutation = useAdminMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => uploadOrganizationLogo(id, file),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations,
      }),
  })
  const organizations = query.data?.organizations ?? []
  const visibleOrganizations = organizations.filter((organization) =>
    [organization.name, organization.slug, organization.displayName ?? ''].some((value) =>
      value.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  )
  return (
    <ResourcePage
      title={tt('Organizations')}
      description={tt('Manage tenant organizations. Teams are intentionally excluded from this console.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New organization')}{' '}
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
          title={tt('Create organization')}
        />
      }
      error={query.error}
      empty={organizations.length === 0}
      emptyDescription="Create organizations when authorization needs tenant-owned groups."
      emptyTitle="No organizations yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      toolbar={
        <ListToolbar>
          <TextInput
            aria-label={tt('Search organizations')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search organizations')}
            value={search}
          />
        </ListToolbar>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Organization')}</TableHead>
            <TableHead>{tt('Display name')}</TableHead>
            <TableHead>{tt('Logo')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleOrganizations.length ? (
            visibleOrganizations.map((organization) => (
              <TableRow key={organization.id}>
                <TableCell>
                  <a className="font-medium hover:underline" href={`/console/organizations/${organization.id}`}>
                    {organization.name}
                  </a>
                  <div className="text-xs text-muted-foreground">{organization.slug}</div>
                </TableCell>
                <TableCell>{organization.displayName ?? 'Not set'}</TableCell>
                <TableCell>
                  <AssetUploadControl
                    accept="image/png,image/jpeg,image/webp"
                    label={`Upload logo for ${organization.name}`}
                    onFile={(file) =>
                      logoMutation.mutate({
                        id: organization.id,
                        file,
                      })
                    }
                    previewUrl={organization.logo}
                  />
                </TableCell>
                <TableCell>
                  <StatusBadge active={!organization.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={4}
              description={
                search
                  ? tt('No organizations match the current search.')
                  : tt('Create organizations when authorization needs tenant-owned groups.')
              }
              title={search ? tt('No organizations found') : tt('No organizations yet')}
            />
          )}
        </TableBody>
      </Table>
      {logoMutation.errorMessage ? <p className="p-4 text-sm text-destructive">{logoMutation.errorMessage}</p> : null}
    </ResourcePage>
  )
}
export function OrganizationDetailPage({
  organizationId,
  section = 'settings',
}: {
  organizationId: string
  section?: OrganizationDetailSection
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedTab, setSelectedTab] = useState<OrganizationDetailSection>(section)
  const query = useQuery({
    queryKey: [...adminQueryKeys.organizations, organizationId],
    queryFn: () => getOrganization(organizationId),
  })
  const organization = query.data
  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof updateOrganizationRequestSchema>) => updateOrganization(organizationId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...adminQueryKeys.organizations, organizationId], updated)
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.organizations,
      })
    },
  })
  useEffect(() => setSelectedTab(section), [section])
  return (
    <ResourcePage
      title={organization?.name ?? tt('Organization')}
      description={tt('Review and update the organization record exposed by the existing authorization model.')}
      framed={false}
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {organization ? (
        <div className="consoleDetailStack">
          <a className="consoleBackLink" href="/console/organizations">
            <Undo2 data-icon="inline-start" /> {tt('Back to organizations')}{' '}
          </a>
          <ObjectHeader
            badge={organization.disabled ? 'Disabled' : 'Enabled'}
            id={organization.slug}
            title={organization.name}
          />
          <DetailTabs
            label={tt('Organization detail sections')}
            onChange={(value) => {
              const next = value as OrganizationDetailSection
              setSelectedTab(next)
              navigateConsoleTab(navigate, `/console/organizations/${organizationId}/${next}`)
            }}
            tabs={organizationDetailTabs()}
            value={selectedTab}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            {selectedTab === 'settings' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('General')}</CardTitle>
                  <CardDescription>
                    {' '}
                    {tt('Team collaboration and invitation management are outside this console surface.')}{' '}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AuthorizationForm
                    buttonLabel="Save organization"
                    defaults={{
                      slug: organization.slug,
                      name: organization.name,
                      displayName: organization.displayName ?? '',
                      disabledReason: organization.disabledReason ?? '',
                    }}
                    error={updateMutation.error}
                    fields={[
                      ['slug', 'Slug'],
                      ['name', 'Name'],
                      ['displayName', 'Display name'],
                      ['disabledReason', 'Disabled reason'],
                    ]}
                    onSubmit={(form) =>
                      updateMutation.mutate(
                        parseForm(updateOrganizationRequestSchema, {
                          ...form,
                          displayName: nullableString(form.displayName ?? ''),
                          disabledReason: nullableString(form.disabledReason ?? ''),
                        }),
                      )
                    }
                    pending={updateMutation.isPending}
                  />
                  <div className="mt-4">
                    <StatusBadge active={!organization.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
                  </div>
                </CardContent>
              </Card>
            ) : null}
            {selectedTab === 'authorization' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Authorization model')}</CardTitle>
                  <CardDescription>
                    {tt('Only persisted organization identity fields are editable here.')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <SettingRow label={tt('Organization ID')} value={organization.id} />
                  <SettingRow
                    label={tt('Role assignment scope')}
                    value="Use organization-scoped roles from Console roles."
                  />
                  <SettingRow label={tt('Members and invitations')} value="Not exposed in this product surface." />
                  <SettingRow label={tt('Created')} value={formatDate(organization.createdAt)} />
                  <SettingRow label={tt('Updated')} value={formatDate(organization.updatedAt)} />
                </CardContent>
              </Card>
            ) : null}
            <OrganizationSummaryCard organization={organization} />
          </div>
        </div>
      ) : null}
    </ResourcePage>
  )
}
function OrganizationSummaryCard({
  organization,
}: {
  organization: {
    id: string
    slug: string
    name: string
    displayName: string | null
    disabled: boolean
    disabledReason: string | null
    createdAt: string | Date
    updatedAt: string | Date
  }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Organization summary')}</CardTitle>
        <CardDescription>{tt('Read-only organization identity and lifecycle fields.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('Organization ID')} value={organization.id} />
        <SettingRow label={tt('Slug')} value={organization.slug} />
        <SettingRow label={tt('Display name')} value={organization.displayName ?? organization.name} />
        <SettingRow label={tt('Status')} value={organization.disabled ? 'Disabled' : 'Enabled'} />
        <SettingRow label={tt('Disabled reason')} value={organization.disabledReason ?? 'Not set'} />
        <SettingRow label={tt('Created')} value={formatDate(organization.createdAt)} />
        <SettingRow label={tt('Updated')} value={formatDate(organization.updatedAt)} />
      </CardContent>
    </Card>
  )
}
export function RolesPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.roles,
    queryFn: listRoles,
  })
  const resourcesQuery = useQuery({
    queryKey: adminQueryKeys.apiResources,
    queryFn: listApiResources,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createRole,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.roles,
      })
    },
  })
  const roles = query.data?.roles ?? []
  const visibleRoles = roles.filter((role) => {
    const matchesSearch =
      search.trim().length === 0 ||
      [role.name, role.key, role.description ?? ''].some((value) =>
        value.toLowerCase().includes(search.trim().toLowerCase()),
      )
    const roleScope = role.resourceId
      ? 'resource'
      : role.organizationId
        ? 'organization'
        : role.applicationId
          ? 'application'
          : 'global'
    return matchesSearch && (scope.length === 0 || roleScope === scope)
  })
  return (
    <ResourcePage
      title={tt('Roles')}
      description={tt('Define application, organization, resource, and global roles.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New role')}{' '}
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
      empty={roles.length === 0}
      emptyDescription="Create roles to model tenant, organization, application, or API permissions."
      emptyTitle="No roles yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      toolbar={
        <ListToolbar>
          <TextInput
            aria-label={tt('Search roles')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search roles')}
            value={search}
          />
          <SelectInput
            aria-label={tt('Filter role scope')}
            onChange={(event) => setScope(event.target.value)}
            value={scope}
          >
            <option value="">{tt('Any scope')}</option>
            <option value="global">{tt('Global')}</option>
            <option value="application">{tt('Application')}</option>
            <option value="organization">{tt('Organization')}</option>
            <option value="resource">{tt('API resource')}</option>
          </SelectInput>
        </ListToolbar>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Role')}</TableHead>
            <TableHead>{tt('Scope')}</TableHead>
            <TableHead>{tt('System')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRoles.length ? (
            visibleRoles.map((role) => (
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
            ))
          ) : (
            <TableEmptyRow
              colSpan={3}
              description={
                search || scope
                  ? tt('No roles match the current search or scope filter.')
                  : tt('Create roles to model tenant, organization, application, or API permissions.')
              }
              title={search || scope ? tt('No roles found') : tt('No roles yet')}
            />
          )}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}
export function RoleDetailPage({ roleId, section = 'settings' }: { roleId: string; section?: RoleDetailSection }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedTab, setSelectedTab] = useState<RoleDetailSection>(section)
  const [assignment, setAssignment] = useState({
    type: 'user',
    subjectId: '',
    tokenClaims: '',
  })
  const [assignmentValidationError, setAssignmentValidationError] = useState<string | null>(null)
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([])
  const roleQuery = useQuery({
    queryKey: [...adminQueryKeys.roles, roleId],
    queryFn: () => getRole(roleId),
  })
  const resourcesQuery = useQuery({
    queryKey: adminQueryKeys.apiResources,
    queryFn: listApiResources,
  })
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
  useEffect(() => setSelectedTab(section), [section])
  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof updateRoleRequestSchema>) => updateRole(roleId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...adminQueryKeys.roles, roleId], updated)
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.roles,
      })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteRole(roleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.roles,
      })
      await navigate({
        to: '/console/roles',
      })
    },
  })
  const permissionMutation = useMutation({
    mutationFn: (permissionIds: string[]) => replaceRolePermissions(roleId, permissionIds),
    onSuccess: () => rolePermissionsQuery.refetch(),
  })
  const assignmentMutation = useMutation({
    mutationFn: (
      input: z.infer<typeof assignRoleRequestSchema> & {
        type: string
      },
    ) => {
      const payload = {
        roleId,
        subjectId: input.subjectId,
        tokenClaims: input.tokenClaims,
      }
      if (input.type === 'application') return assignApplicationRole(payload)
      if (input.type === 'member') return assignMemberRole(payload)
      return assignUserRole(payload)
    },
  })
  const selectedPermissionIdSet = new Set(selectedPermissionIds)
  return (
    <ResourcePage
      title={role?.name ?? tt('Role')}
      description={tt(
        'Manage role metadata, API permissions, and user, application, or organization member assignments.',
      )}
      framed={false}
      error={roleQuery.error}
      loading={roleQuery.isLoading}
      onRetry={() => roleQuery.refetch()}
    >
      {role ? (
        <div className="consoleDetailStack">
          <a className="consoleBackLink" href="/console/roles">
            <Undo2 data-icon="inline-start" /> {tt('Back to roles')}{' '}
          </a>
          <ObjectHeader badge={role.system ? 'System role' : 'Custom role'} id={role.key} title={role.name} />
          <DetailTabs
            label={tt('Role detail sections')}
            onChange={(value) => {
              const next = value as RoleDetailSection
              setSelectedTab(next)
              navigateConsoleTab(navigate, `/console/roles/${roleId}/${next}`)
            }}
            tabs={roleDetailTabs()}
            value={selectedTab}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            {selectedTab === 'settings' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Role settings')}</CardTitle>
                  <CardDescription>
                    {' '}
                    {tt('Scope fields are immutable after creation; update display metadata here.')}{' '}
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
                      <Trash2 data-icon="inline-start" /> {tt('Delete role')}{' '}
                    </Button>
                  </div>
                  <MutationError error={deleteMutation.error} />
                </CardContent>
              </Card>
            ) : null}

            {selectedTab === 'permissions' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Permission assignment')}</CardTitle>
                  <CardDescription>
                    {' '}
                    {tt('Select permissions from one API resource and replace the role permission set.')}{' '}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <Field label={tt('API resource')}>
                    <SelectInput
                      onChange={(event) => setSelectedResourceId(event.target.value)}
                      value={selectedResourceId}
                    >
                      <option value="">{tt('Select resource')}</option>
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
                          <span className="block text-muted-foreground">
                            {permission.description ?? 'No description'}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <Button
                    disabled={permissionMutation.isPending || selectedResourceId.length === 0}
                    onClick={() => permissionMutation.mutate(selectedPermissionIds)}
                    type="button"
                  >
                    <Save data-icon="inline-start" /> {tt('Save permissions')}{' '}
                  </Button>
                  <MutationError error={permissionMutation.error} />
                </CardContent>
              </Card>
            ) : null}

            {selectedTab === 'assignments' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Assignments')}</CardTitle>
                  <CardDescription>
                    {' '}
                    {tt('Assign this role to a user, an application, or an organization member record.')}{' '}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="formStack"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const submittedForm = new FormData(event.currentTarget)
                      try {
                        setAssignmentValidationError(null)
                        assignmentMutation.mutate({
                          type: submittedForm.get('type') as string,
                          roleId,
                          subjectId: submittedForm.get('subjectId') as string,
                          tokenClaims: parseTokenClaims(submittedForm.get('tokenClaims') as string),
                        })
                      } catch (submitError) {
                        setAssignmentValidationError((submitError as Error).message)
                      }
                    }}
                  >
                    <Field label={tt('Subject type')}>
                      <SelectInput
                        name="type"
                        onChange={(event) =>
                          setAssignment((value) => ({
                            ...value,
                            type: event.target.value,
                          }))
                        }
                        value={assignment.type}
                      >
                        <option value="user">{tt('User')}</option>
                        <option value="application">{tt('Application')}</option>
                        <option value="member">{tt('Organization member')}</option>
                      </SelectInput>
                    </Field>
                    <Field label={tt('Subject ID')}>
                      <TextInput defaultValue={assignment.subjectId} name="subjectId" required />
                    </Field>
                    <Field label={tt('Token claims JSON')}>
                      <TextArea
                        defaultValue={assignment.tokenClaims}
                        name="tokenClaims"
                        placeholder={tt('{"tier":"gold"}')}
                      />
                    </Field>
                    <Button disabled={assignmentMutation.isPending} type="submit">
                      <Save data-icon="inline-start" /> {tt('Assign role')}{' '}
                    </Button>
                    {assignmentMutation.isSuccess ? (
                      <p className="text-sm text-muted-foreground">{tt('Assignment saved.')}</p>
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
            ) : null}
            <RoleSummaryCard permissionCount={rolePermissionsQuery.data?.permissions.length ?? 0} role={role} />
          </div>
        </div>
      ) : null}
    </ResourcePage>
  )
}
function RoleSummaryCard({
  permissionCount,
  role,
}: {
  permissionCount: number
  role: {
    id: string
    key: string
    name: string
    system: boolean
    applicationId: string | null
    organizationId: string | null
    resourceId: string | null
    tokenClaimName: string | null
    tokenClaimValue: string | null
  }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Role summary')}</CardTitle>
        <CardDescription>{tt('Read-only role scope and token claim context.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('Role ID')} value={role.id} />
        <SettingRow label={tt('Key')} value={role.key} />
        <SettingRow label={tt('Type')} value={role.system ? 'System role' : 'Custom role'} />
        <SettingRow label={tt('Scope')} value={roleScopeLabel(role)} />
        <SettingRow label={tt('Permissions')} value={String(permissionCount)} />
        <SettingRow label={tt('Token claim')} value={role.tokenClaimName ?? 'Not set'} />
        <SettingRow label={tt('Token value')} value={role.tokenClaimValue ?? 'Not set'} />
      </CardContent>
    </Card>
  )
}
function roleScopeLabel(role: {
  applicationId: string | null
  organizationId: string | null
  resourceId: string | null
}) {
  if (role.resourceId) return `API resource ${role.resourceId}`
  if (role.organizationId) return `Organization ${role.organizationId}`
  if (role.applicationId) return `Application ${role.applicationId}`
  return 'Tenant'
}
export function ApiResourcesPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.apiResources,
    queryFn: listApiResources,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createApiResource,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.apiResources,
      })
    },
  })
  const resources = query.data?.resources ?? []
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
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New resource')}{' '}
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
          title={tt('Create API resource')}
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
                  <StatusBadge active={resource.enabled} activeLabel="Enabled" inactiveLabel="Disabled" />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={3}
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
      queryClient.invalidateQueries({
        queryKey: [...adminQueryKeys.apiResources, resourceId, 'scopes'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...adminQueryKeys.apiResources, resourceId, 'permissions'],
      }),
    ])
  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof updateApiResourceRequestSchema>) => updateApiResource(resourceId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...adminQueryKeys.apiResources, resourceId], updated)
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.apiResources,
      })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteApiResource(resourceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.apiResources,
      })
      await navigate({
        to: '/console/api-resources',
      })
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
        queryKey: [...adminQueryKeys.apiResources, resourceId, 'permissions'],
      }),
  })
  const updatePermissionMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: z.infer<typeof updateApiPermissionRequestSchema> }) =>
      updateApiPermission(resourceId, id, input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...adminQueryKeys.apiResources, resourceId, 'permissions'],
      }),
  })
  const deletePermissionMutation = useMutation({
    mutationFn: (id: string) => deleteApiPermission(resourceId, id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [...adminQueryKeys.apiResources, resourceId, 'permissions'],
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
function ApiResourceSummaryCard({
  permissionsCount,
  resource,
  scopesCount,
}: {
  permissionsCount: number
  resource: {
    id: string
    identifier: string
    audience: string
    enabled: boolean
    tokenClaimsNamespace: string | null
    createdAt: string | Date
    updatedAt: string | Date
  }
  scopesCount: number
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Resource summary')}</CardTitle>
        <CardDescription>{tt('Read-only API authorization context.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('Resource ID')} value={resource.id} />
        <SettingRow label={tt('Identifier')} value={resource.identifier} />
        <SettingRow label={tt('Audience')} value={resource.audience} />
        <SettingRow label={tt('Status')} value={resource.enabled ? 'Enabled' : 'Disabled'} />
        <SettingRow label={tt('Scopes')} value={String(scopesCount)} />
        <SettingRow label={tt('Permissions')} value={String(permissionsCount)} />
        <SettingRow label={tt('Claims namespace')} value={resource.tokenClaimsNamespace ?? 'Default'} />
        <SettingRow label={tt('Updated')} value={formatDate(resource.updatedAt)} />
      </CardContent>
    </Card>
  )
}
export function BrandingPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.branding,
    queryFn: getBrandingSettings,
  })
  const signInQuery = useQuery({
    queryKey: adminQueryKeys.signIn,
    queryFn: getSignInSettings,
  })
  const securityQuery = useQuery({
    queryKey: adminQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const connectorsQuery = useConnectorPreviewProviders()
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
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.branding,
      })
    },
  })
  const logoMutation = useAdminMutation({
    mutationFn: uploadBrandingLogo,
    onSuccess: (response) => {
      setForm((value) => ({
        ...value,
        logoUrl: response.asset.publicUrl,
      }))
      return Promise.resolve()
    },
  })
  const faviconMutation = useAdminMutation({
    mutationFn: uploadBrandingFavicon,
    onSuccess: (response) => {
      setForm((value) => ({
        ...value,
        faviconUrl: response.asset.publicUrl,
      }))
      return Promise.resolve()
    },
  })
  useEffect(() => {
    if (!query.data?.copy) return
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
  const loadedForm = query.data?.copy
    ? {
        logoUrl: query.data.branding.logoUrl ?? '',
        faviconUrl: query.data.branding.faviconUrl ?? '',
        primaryColor: query.data.branding.primaryColor ?? '#b42318',
        backgroundColor: query.data.branding.backgroundColor ?? '#f7f3ee',
        customCss: query.data.branding.customCss ?? '',
        productName: query.data.copy.productName,
        headline: query.data.copy.headline,
        description: query.data.copy.description,
      }
    : null
  const hasChanges = loadedForm ? !shallowEqual(form, loadedForm) : false
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
  const preview: HostedAuthPreviewState = {
    productName: form.productName,
    headline: form.headline,
    description: form.description,
    logoUrl: form.logoUrl,
    primaryColor: form.primaryColor,
    backgroundColor: form.backgroundColor,
    customCss: form.customCss,
    passwordEnabled: signInQuery.data?.signIn?.passwordEnabled,
    signupEnabled: signInQuery.data?.signIn?.signupEnabled,
    socialLoginEnabled: signInQuery.data?.signIn?.socialLoginEnabled,
    socialProviders: connectorsQuery.providers,
    passkeysEnabled: securityQuery.data?.policy?.passkeys?.enabled,
    oneTapEnabled: signInQuery.data?.builtInProviders?.oneTap?.enabled,
    phoneEnabled: signInQuery.data?.builtInProviders?.phone?.enabled,
    web3WalletEnabled: signInQuery.data?.builtInProviders?.web3Wallet?.enabled,
    identifierFirst: signInQuery.data?.signIn?.identifierFirst,
    usernameEnabled: signInQuery.data?.signIn?.usernameEnabled,
    emailOtpEnabled: signInQuery.data?.signIn?.emailOtpEnabled,
  }
  return (
    <SignInExperiencePage
      activeTab="branding"
      title={tt('Branding')}
      description={tt(
        'Configure hosted sign-in and Account Center brand assets, colors, and constrained theme variables.',
      )}
      error={query.error ?? signInQuery.error ?? securityQuery.error ?? connectorsQuery.error}
      loading={query.isLoading || signInQuery.isLoading || securityQuery.isLoading}
      onRetry={() => {
        void query.refetch()
        void signInQuery.refetch()
        void securityQuery.refetch()
        void connectorsQuery.refetch()
      }}
    >
      {query.data ? (
        <form onSubmit={onSubmit}>
          <SignInExperienceEditorLayout
            preview={<HostedAuthPreview preview={preview} />}
            settings={
              <SettingsSections>
                <SettingsSection
                  title={tt('Brand settings')}
                  description={tt('External asset URLs must use HTTPS. Custom CSS accepts --auth-* declarations only.')}
                >
                  <div className="formStack">
                    <Field label={tt('Product name')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            productName: event.target.value,
                          }))
                        }
                        required
                        value={form.productName}
                      />
                    </Field>
                    <Field label={tt('Logo URL')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            logoUrl: event.target.value,
                          }))
                        }
                        type="url"
                        value={form.logoUrl}
                      />
                    </Field>
                    <AssetUploadControl
                      accept="image/png,image/jpeg,image/webp"
                      label={tt('Upload branding logo')}
                      onFile={(file) => logoMutation.mutate(file)}
                      previewUrl={form.logoUrl || null}
                    />
                    <Field label={tt('Favicon URL')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            faviconUrl: event.target.value,
                          }))
                        }
                        type="url"
                        value={form.faviconUrl}
                      />
                    </Field>
                    <AssetUploadControl
                      accept="image/png,image/webp,image/x-icon,image/vnd.microsoft.icon"
                      label={tt('Upload favicon')}
                      onFile={(file) => faviconMutation.mutate(file)}
                      previewUrl={form.faviconUrl || null}
                    />
                    <Field label={tt('Primary color')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            primaryColor: event.target.value,
                          }))
                        }
                        type="color"
                        value={form.primaryColor}
                      />
                    </Field>
                    <Field label={tt('Background color')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            backgroundColor: event.target.value,
                          }))
                        }
                        type="color"
                        value={form.backgroundColor}
                      />
                    </Field>
                    <Field label={tt('Custom CSS')}>
                      <TextArea
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            customCss: event.target.value,
                          }))
                        }
                        placeholder={tt('--auth-panel-radius: 8px;')}
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
                  </div>
                </SettingsSection>
                <ChangesSection
                  description={tt('Save brand updates or restore the loaded values.')}
                  onDiscard={() => {
                    if (loadedForm) setForm(loadedForm)
                    setValidationError(null)
                  }}
                  pending={updateMutation.isPending}
                  saveLabel="Save branding"
                  visible={hasChanges}
                />
              </SettingsSections>
            }
          />
        </form>
      ) : null}
    </SignInExperiencePage>
  )
}
export function CollectUserProfilePage() {
  return (
    <SignInExperiencePage
      activeTab="collect-user-profile"
      description={tt('Custom profile field collection is outside the v1 hosted auth surface.')}
      title={tt('Collect user profile')}
    >
      <SettingsSections>
        <SettingsSection
          title={tt('Supported profile data')}
          description={tt('Current hosted auth collects the built-in user profile fields.')}
        >
          <div className="grid gap-3">
            <SettingRow label={tt('Email')} value="Built in" />
            <SettingRow label={tt('Name')} value="Built in" />
            <SettingRow label={tt('Username')} value="Available when username sign-in is enabled" />
            <SettingRow label={tt('Avatar')} value="Managed from user profile surfaces" />
          </div>
        </SettingsSection>
      </SettingsSections>
    </SignInExperiencePage>
  )
}
export function AccountCenterSettingsPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.accountCenter,
    queryFn: getAccountCenterSettings,
  })
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    profileEditingEnabled: true,
    displayNameEditable: true,
    usernameEditable: true,
    avatarEditable: true,
    emailChangeEnabled: true,
    passwordChangeEnabled: true,
    connectedAccountsEnabled: true,
    sessionsViewEnabled: true,
    dangerZoneEnabled: false,
  })
  const updateMutation = useAdminMutation({
    mutationFn: updateAccountCenterSettings,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.accountCenter,
      }),
  })
  useEffect(() => {
    if (query.data) setForm(query.data.accountCenter)
  }, [query.data])
  const loadedForm = query.data?.accountCenter ?? null
  const hasChanges = loadedForm ? !shallowEqual(form, loadedForm) : false
  function onSubmit(event: FormEvent) {
    event.preventDefault()
    updateMutation.mutate({
      accountCenter: form,
    })
  }
  return (
    <SignInExperiencePage
      action={
        <Button onClick={() => window.open('/profile', '_blank', 'noopener')} type="button" variant="secondary">
          <ExternalLink data-icon="inline-start" /> {tt('Open account center')}{' '}
        </Button>
      }
      activeTab="account-center"
      description={tt(
        'Configure the self-service account center exposure and review available account management surfaces.',
      )}
      error={query.error}
      loading={query.isLoading}
      onRetry={() => void query.refetch()}
      title={tt('Account Center')}
    >
      {query.data ? (
        <form onSubmit={onSubmit}>
          <SettingsSections>
            <SettingsSection
              title={tt('Visible sections')}
              description={tt('Choose which account center sections are visible to signed-in users.')}
            >
              <div className="grid gap-3">
                <SwitchRow
                  checked={form.profileEditingEnabled}
                  label={tt('Profile section')}
                  onCheckedChange={(profileEditingEnabled) =>
                    setForm((value) => ({
                      ...value,
                      profileEditingEnabled,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.passwordChangeEnabled}
                  label={tt('Password section')}
                  onCheckedChange={(passwordChangeEnabled) =>
                    setForm((value) => ({
                      ...value,
                      passwordChangeEnabled,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.connectedAccountsEnabled}
                  label={tt('Connected accounts and apps')}
                  onCheckedChange={(connectedAccountsEnabled) =>
                    setForm((value) => ({
                      ...value,
                      connectedAccountsEnabled,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.sessionsViewEnabled}
                  label={tt('Sessions section')}
                  onCheckedChange={(sessionsViewEnabled) =>
                    setForm((value) => ({
                      ...value,
                      sessionsViewEnabled,
                    }))
                  }
                />
              </div>
            </SettingsSection>
            <SettingsSection
              title={tt('Profile field permissions')}
              description={tt('Control which built-in profile fields users can edit from /profile.')}
            >
              <div className="grid gap-3">
                <SwitchRow
                  checked={form.displayNameEditable}
                  label={tt('Display name')}
                  onCheckedChange={(displayNameEditable) =>
                    setForm((value) => ({
                      ...value,
                      displayNameEditable,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.usernameEditable}
                  label={tt('Username')}
                  onCheckedChange={(usernameEditable) =>
                    setForm((value) => ({
                      ...value,
                      usernameEditable,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.avatarEditable}
                  label={tt('Avatar')}
                  onCheckedChange={(avatarEditable) =>
                    setForm((value) => ({
                      ...value,
                      avatarEditable,
                    }))
                  }
                />
                <SwitchRow
                  checked={form.emailChangeEnabled}
                  label={tt('Email changes')}
                  onCheckedChange={(emailChangeEnabled) =>
                    setForm((value) => ({
                      ...value,
                      emailChangeEnabled,
                    }))
                  }
                />
              </div>
            </SettingsSection>
            <ChangesSection
              description={tt('Save account center visibility and field permissions.')}
              error={
                updateMutation.errorMessage ? (
                  <div className="text-sm text-destructive">{updateMutation.errorMessage}</div>
                ) : null
              }
              onDiscard={() => {
                if (loadedForm) setForm(loadedForm)
              }}
              pending={updateMutation.isPending}
              saveLabel="Save account center"
              visible={hasChanges}
            />
          </SettingsSections>
        </form>
      ) : null}
    </SignInExperiencePage>
  )
}
export function ContentSettingsPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.signIn,
    queryFn: getSignInSettings,
  })
  const brandingQuery = useQuery({
    queryKey: adminQueryKeys.branding,
    queryFn: getBrandingSettings,
  })
  const securityQuery = useQuery({
    queryKey: adminQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const connectorsQuery = useConnectorPreviewProviders()
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
      return queryClient.invalidateQueries({
        queryKey: adminQueryKeys.signIn,
      })
    },
  })
  useEffect(() => {
    if (!query.data?.copy) return
    setForm({
      productName: query.data.copy.productName,
      headline: query.data.copy.headline,
      description: query.data.copy.description,
      termsUri: query.data.links?.termsUri ?? '',
      privacyUri: query.data.links?.privacyUri ?? '',
      supportEmail: query.data.links?.supportEmail ?? '',
    })
  }, [query.data])
  const loadedForm = query.data?.copy
    ? {
        productName: query.data.copy.productName,
        headline: query.data.copy.headline,
        description: query.data.copy.description,
        termsUri: query.data.links?.termsUri ?? '',
        privacyUri: query.data.links?.privacyUri ?? '',
        supportEmail: query.data.links?.supportEmail ?? '',
      }
    : null
  const hasChanges = loadedForm ? !shallowEqual(form, loadedForm) : false
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
  const preview: HostedAuthPreviewState = {
    productName: form.productName,
    headline: form.headline,
    description: form.description,
    logoUrl: brandingQuery.data?.branding?.logoUrl ?? undefined,
    primaryColor: brandingQuery.data?.branding?.primaryColor ?? undefined,
    backgroundColor: brandingQuery.data?.branding?.backgroundColor ?? undefined,
    customCss: brandingQuery.data?.branding?.customCss ?? undefined,
    passwordEnabled: query.data?.signIn?.passwordEnabled,
    signupEnabled: query.data?.signIn?.signupEnabled,
    socialLoginEnabled: query.data?.signIn?.socialLoginEnabled,
    socialProviders: connectorsQuery.providers,
    passkeysEnabled: securityQuery.data?.policy?.passkeys?.enabled,
    oneTapEnabled: query.data?.builtInProviders?.oneTap?.enabled,
    phoneEnabled: query.data?.builtInProviders?.phone?.enabled,
    web3WalletEnabled: query.data?.builtInProviders?.web3Wallet?.enabled,
    identifierFirst: query.data?.signIn?.identifierFirst,
    usernameEnabled: query.data?.signIn?.usernameEnabled,
    emailOtpEnabled: query.data?.signIn?.emailOtpEnabled,
    termsUri: form.termsUri,
    privacyUri: form.privacyUri,
    supportEmail: form.supportEmail,
  }
  return (
    <SignInExperiencePage
      activeTab="content"
      description={tt('Manage hosted authentication language, page messages, and legal links.')}
      error={query.error ?? brandingQuery.error ?? securityQuery.error ?? connectorsQuery.error}
      loading={query.isLoading || brandingQuery.isLoading || securityQuery.isLoading}
      onRetry={() => {
        void query.refetch()
        void brandingQuery.refetch()
        void securityQuery.refetch()
        void connectorsQuery.refetch()
      }}
      title={tt('Content')}
    >
      {query.data ? (
        <form onSubmit={onSubmit}>
          <SignInExperienceEditorLayout
            preview={<HostedAuthPreview preview={preview} />}
            settings={
              <SettingsSections>
                <SettingsSection
                  title={tt('Hosted messages')}
                  description={tt('These strings are exposed through public hosted auth config.')}
                >
                  <div className="formStack">
                    <Field label={tt('Product name')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            productName: event.target.value,
                          }))
                        }
                        required
                        value={form.productName}
                      />
                    </Field>
                    <Field label={tt('Sign-in message')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            headline: event.target.value,
                          }))
                        }
                        required
                        value={form.headline}
                      />
                    </Field>
                    <Field label={tt('Sign-up message')}>
                      <TextArea
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            description: event.target.value,
                          }))
                        }
                        required
                        value={form.description}
                      />
                    </Field>
                  </div>
                </SettingsSection>
                <SettingsSection
                  title={tt('Links')}
                  description={tt(
                    'Public legal and support links must use safe values accepted by management validation.',
                  )}
                >
                  <div className="formStack">
                    <Field label={tt('Terms URL')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            termsUri: event.target.value,
                          }))
                        }
                        type="url"
                        value={form.termsUri}
                      />
                    </Field>
                    <Field label={tt('Privacy URL')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            privacyUri: event.target.value,
                          }))
                        }
                        type="url"
                        value={form.privacyUri}
                      />
                    </Field>
                    <Field label={tt('Support email')}>
                      <TextInput
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            supportEmail: event.target.value,
                          }))
                        }
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
                  </div>
                </SettingsSection>
                <ChangesSection
                  description={tt('Save hosted copy updates or restore the loaded values.')}
                  onDiscard={() => {
                    if (loadedForm) setForm(loadedForm)
                    setValidationError(null)
                  }}
                  pending={updateMutation.isPending}
                  saveLabel="Save content"
                  visible={hasChanges}
                />
              </SettingsSections>
            }
          />
        </form>
      ) : null}
    </SignInExperiencePage>
  )
}
export function DeploymentSettingsPage() {
  const query = useQuery({
    queryKey: adminQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const [keyTab, setKeyTab] = useState('private')
  return (
    <ResourcePage
      title={tt('Settings')}
      description={tt('Review issuer metadata, session TTL, and signing-key runtime state for this tenant.')}
      error={query.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <RoutedSettingsTabs
        active="oidc-configs"
        ariaLabel="Tenant settings"
        tabs={[['oidc-configs', 'OIDC configs', '/console/tenant-settings/oidc-configs']]}
      />
      {query.data ? (
        <SettingsSections>
          <SettingsSection
            title={tt('Runtime endpoints')}
            description={tt('Static Console settings tied to the current deployment.')}
          >
            <div className="grid gap-3">
              <SettingRow label={tt('Platform')} value="Cloudflare Workers" />
              <SettingRow label={tt('Database')} value="D1" />
              <SettingRow label={tt('Auth issuer')} value="/api/auth" />
              <SettingRow label={tt('Discovery')} value="/api/auth/.well-known/openid-configuration" />
              <SettingRow label={tt('JWKS URI')} value="/api/auth/jwks" />
              <SettingRow label={tt('Management API')} value="/api/management" />
            </div>
          </SettingsSection>
          <SettingsSection
            title={tt('Session TTL')}
            description={tt('Runtime session lifetime and cookie-cache values.')}
          >
            <div className="grid gap-3">
              <SettingRow label={tt('Session TTL')} value={`${query.data.policy.sessions.expiresInSeconds}s`} />
              <SettingRow label={tt('Update age')} value={`${query.data.policy.sessions.updateAgeSeconds}s`} />
              <SettingRow label={tt('Fresh age')} value={`${query.data.policy.sessions.freshAgeSeconds}s`} />
              <SettingRow label={tt('Cookie cache')} value={`${query.data.policy.sessions.cookieCacheSeconds}s`} />
            </div>
          </SettingsSection>
          <SettingsSection
            title={tt('Signing keys')}
            description={tt('Deployment-managed OIDC signing material exposed through JWKS.')}
          >
            <div className="grid gap-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tt('Key')}</TableHead>
                    <TableHead>{tt('Use')}</TableHead>
                    <TableHead>{tt('Status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>{tt('Current deployment key')}</TableCell>
                    <TableCell>{tt('OIDC JWT signing')}</TableCell>
                    <TableCell>
                      <StatusBadge active activeLabel="Active" inactiveLabel="Inactive" />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Tabs className="flex flex-col gap-4" setValue={setKeyTab} value={keyTab}>
                <TabsList>
                  <TabsTrigger value="private">{tt('Private key')}</TabsTrigger>
                  <TabsTrigger value="cookie">{tt('Cookie key')}</TabsTrigger>
                </TabsList>
                <TabsContent value="private">
                  <PolicyCard
                    framed={false}
                    rows={[
                      ['Storage', 'AUTH_SECRET deployment binding'],
                      ['Exposure', 'Private key material is never shown in Console.'],
                    ]}
                    title={tt('Private key')}
                  />
                </TabsContent>
                <TabsContent value="cookie">
                  <PolicyCard
                    framed={false}
                    rows={[
                      ['Storage', 'AUTH_SECRET deployment binding'],
                      ['Cookie cache', `${query.data.policy.sessions.cookieCacheSeconds}s`],
                    ]}
                    title={tt('Cookie key')}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </SettingsSection>
        </SettingsSections>
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
      <SettingsSections>
        <SettingsSection title={title} description={description}>
          <div className="grid gap-3">
            {rows.map(([label, value]) => (
              <SettingRow key={label} label={label} value={value} />
            ))}
          </div>
        </SettingsSection>
      </SettingsSections>
    </ResourcePage>
  )
}
export function OrganizationTemplatePage({
  section = 'organization-roles',
}: {
  section?: OrganizationTemplateSection
}) {
  const [tab, setTab] = useState<OrganizationTemplateSection>(section)
  const [roleSearch, setRoleSearch] = useState('')
  const rolesQuery = useQuery({
    queryKey: adminQueryKeys.roles,
    queryFn: listRoles,
  })
  const organizationRoles = rolesQuery.data?.roles.filter(
    (role) =>
      (role.organizationId || (!role.applicationId && !role.resourceId)) &&
      [role.name, role.key, role.description ?? ''].some((value) =>
        value.toLowerCase().includes(roleSearch.trim().toLowerCase()),
      ),
  )
  useEffect(() => setTab(section), [section])
  return (
    <ResourcePage
      title={tt('Organization template')}
      description={tt(
        'Configure authorization templates used by organizations. Team management is not part of this surface.',
      )}
      framed={false}
      error={rolesQuery.error}
      loading={rolesQuery.isLoading}
      onRetry={() => rolesQuery.refetch()}
    >
      <div className="grid gap-4">
        <RoutedSettingsTabs
          active={tab}
          ariaLabel="Organization template sections"
          onSelect={(value) => setTab(value)}
          tabs={[
            ['organization-roles', 'Organization roles', '/console/organization-template/organization-roles'],
            [
              'organization-permissions',
              'Organization permissions',
              '/console/organization-template/organization-permissions',
            ],
          ]}
        />
        <SettingsSections>
          {tab === 'organization-roles' ? (
            <SettingsSection
              title={tt('Organization roles')}
              description={tt('Create and search organization role definitions through the roles API.')}
            >
              <div className="grid gap-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <TextInput
                    aria-label={tt('Search organization roles')}
                    onChange={(event) => setRoleSearch(event.target.value)}
                    placeholder={tt('Search roles')}
                    value={roleSearch}
                  />
                  <a className="uiButton uiButton-primary" href="/console/roles">
                    <Plus data-icon="inline-start" /> {tt('Create role')}{' '}
                  </a>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tt('Role')}</TableHead>
                      <TableHead>{tt('Scope')}</TableHead>
                      <TableHead>{tt('Token claim')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {organizationRoles?.map((role) => (
                      <TableRow key={role.id}>
                        <TableCell>
                          <a className="font-medium hover:underline" href={`/console/roles/${role.id}`}>
                            {role.name}
                          </a>
                          <div className="text-xs text-muted-foreground">{role.key}</div>
                        </TableCell>
                        <TableCell>{role.organizationId ? 'Organization' : 'Global template'}</TableCell>
                        <TableCell>{role.tokenClaimName ?? 'Default authorization claims'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SettingsSection>
          ) : null}
          {tab === 'organization-permissions' ? (
            <SettingsSection
              title={tt('Organization permissions')}
              description={tt('Permissions are managed on API resources and attached to organization roles.')}
            >
              <EmptyState
                action={
                  <a className="uiButton uiButton-secondary" href="/console/api-resources">
                    {' '}
                    {tt('API resources')}{' '}
                  </a>
                }
                description={tt(
                  'Create resource permissions, then attach them to organization-scoped roles from the role detail page.',
                )}
                framed={false}
                title={tt('Permission templates use API resources')}
              />
            </SettingsSection>
          ) : null}
        </SettingsSections>
      </div>
    </ResourcePage>
  )
}
export function CustomizeJwtPage() {
  return (
    <ResourcePage
      title={tt('Custom JWT')}
      description={tt('Review token claim controls backed by the current authorization model.')}
      framed={false}
    >
      <SettingsSections>
        <TokenCustomizationCard
          title={tt('Access token')}
          rows={[
            ['Audience', 'API resource audience is emitted for matching protected APIs.'],
            ['Roles and permissions', 'Configured through role assignments and API resource permissions.'],
            ['Custom claims', 'Use role assignment token claims and API resource claim namespaces.'],
          ]}
        />
        <TokenCustomizationCard
          title={tt('Machine-to-machine token')}
          rows={[
            ['Application roles', 'Application role assignments are supported.'],
            ['Custom claims', 'Use assignment token claims for trusted application subjects.'],
          ]}
        />
        <TokenCustomizationCard
          title={tt('ID token')}
          rows={[
            ['Profile claims', 'Built-in auth profile claims are issued by the auth provider.'],
            ['Scope toggles', 'API scopes can opt into ID token inclusion where configured.'],
          ]}
        />
      </SettingsSections>
    </ResourcePage>
  )
}
export function WebhooksPage({ section = 'endpoints' }: { section?: WebhooksSection }) {
  const [selectedTab, setSelectedTab] = useState<WebhooksSection>(section)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<WebhookEvent[]>(['user.created'])
  const [secretDisclosure, setSecretDisclosure] = useState<string | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<WebhookRequest | null>(null)
  const endpointsQuery = useQuery({
    queryKey: [...adminQueryKeys.webhookEndpoints, search, status],
    queryFn: () =>
      listWebhookEndpoints({
        search: search || undefined,
        status: status === 'enabled' || status === 'disabled' ? status : undefined,
      }),
  })
  const requestsQuery = useQuery({
    queryKey: [...adminQueryKeys.webhookRequests, search, status],
    queryFn: () =>
      listWebhookRequests({
        search: search || undefined,
        status: status === 'pending' || status === 'delivered' || status === 'failed' ? status : undefined,
      }),
  })
  const queryClient = useQueryClient()
  const createMutation = useAdminMutation({
    mutationFn: createWebhookEndpoint,
    onSuccess: async (response) => {
      setEndpointUrl('')
      setSelectedEvents(['user.created'])
      setSecretDisclosure(response.signingSecret)
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.webhookEndpoints,
      })
    },
  })
  const updateMutation = useAdminMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: {
        enabled?: boolean
      }
    }) => updateWebhookEndpoint(id, input),
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.webhookEndpoints,
      }),
  })
  const deleteMutation = useAdminMutation({
    mutationFn: deleteWebhookEndpoint,
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.webhookEndpoints,
      }),
  })
  const rotateMutation = useAdminMutation({
    mutationFn: rotateWebhookEndpointSecret,
    onSuccess: async (response) => {
      setSecretDisclosure(response.signingSecret)
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.webhookEndpoints,
      })
    },
  })
  const retryMutation = useAdminMutation({
    mutationFn: retryWebhookRequest,
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: adminQueryKeys.webhookRequests,
      }),
  })
  useEffect(() => setSelectedTab(section), [section])
  function toggleEvent(event: WebhookEvent, checked: boolean) {
    setSelectedEvents((events) => (checked ? [...events, event] : events.filter((value) => value !== event)))
  }
  function createEndpoint(event: FormEvent) {
    event.preventDefault()
    const parsed = createWebhookEndpointRequestSchema.safeParse({
      url: endpointUrl,
      events: selectedEvents,
      enabled: true,
    })
    if (!parsed.success) return
    createMutation.mutate(parsed.data)
  }
  return (
    <ResourcePage
      title={tt('Webhooks')}
      description={tt('Configure signed event endpoints and inspect persisted delivery requests.')}
      framed={false}
      action={
        selectedTab === 'endpoints' ? (
          <Button form="webhook-create-form" type="submit">
            <Plus data-icon="inline-start" /> {tt('Create endpoint')}{' '}
          </Button>
        ) : (
          <a className="uiButton uiButton-primary" href="/console/webhooks/endpoints">
            <Plus data-icon="inline-start" /> {tt('Create endpoint')}{' '}
          </a>
        )
      }
      toolbar={
        <RoutedSettingsTabs
          active={selectedTab}
          ariaLabel="Webhook sections"
          onSelect={(value) => setSelectedTab(value)}
          tabs={[
            ['endpoints', 'Endpoints', '/console/webhooks/endpoints'],
            ['requests', 'Requests', '/console/webhooks/requests'],
          ]}
        />
      }
    >
      <div className="consoleDetailStack">
        <ListToolbar>
          <TextInput
            aria-label={tt('Search webhooks')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search endpoints or events')}
            value={search}
          />
          <SelectInput
            aria-label={tt('Filter webhook status')}
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">{tt('Any status')}</option>
            {selectedTab === 'endpoints' ? (
              <>
                <option value="enabled">{tt('Enabled')}</option>
                <option value="disabled">{tt('Disabled')}</option>
              </>
            ) : (
              <>
                <option value="pending">{tt('Pending')}</option>
                <option value="delivered">{tt('Delivered')}</option>
                <option value="failed">{tt('Failed')}</option>
              </>
            )}
          </SelectInput>
        </ListToolbar>
        {selectedTab === 'endpoints' ? (
          <SettingsSections>
            <SettingsSection
              title={tt('Create endpoint')}
              description={tt('Create a signed HTTPS endpoint for selected events.')}
            >
              <form className="formStack" id="webhook-create-form" onSubmit={createEndpoint}>
                <Field label={tt('Endpoint URL')}>
                  <TextInput
                    onChange={(event) => setEndpointUrl(event.target.value)}
                    placeholder="https://example.com/webhooks/auth"
                    required
                    type="url"
                    value={endpointUrl}
                  />
                </Field>
                <div className="grid gap-2 sm:grid-cols-2">
                  {webhookEvents.map((event) => (
                    <SwitchRow
                      checked={selectedEvents.includes(event)}
                      key={event}
                      label={event}
                      onCheckedChange={(checked) => toggleEvent(event, checked)}
                    />
                  ))}
                </div>
                {createMutation.errorMessage ? (
                  <StatusBadge active={false} activeLabel="" inactiveLabel={createMutation.errorMessage} />
                ) : null}
                <Button
                  disabled={createMutation.isPending || selectedEvents.length === 0}
                  type="submit"
                  variant="secondary"
                >
                  <Plus data-icon="inline-start" /> {tt('Create endpoint')}{' '}
                </Button>
              </form>
            </SettingsSection>
            <SettingsSection
              title={tt('Endpoints')}
              description={tt('Manage enabled state, signing secret rotation, and endpoint deletion.')}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tt('Endpoint')}</TableHead>
                    <TableHead>{tt('Events')}</TableHead>
                    <TableHead>{tt('Status')}</TableHead>
                    <TableHead>{tt('Secret')}</TableHead>
                    <TableHead>{tt('Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpointsQuery.data?.endpoints?.map((endpoint) => (
                    <WebhookEndpointRow
                      endpoint={endpoint}
                      key={endpoint.id}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onRotate={(id) => rotateMutation.mutate(id)}
                      onToggle={(id, enabled) =>
                        updateMutation.mutate({
                          id,
                          input: {
                            enabled,
                          },
                        })
                      }
                    />
                  ))}
                  {endpointsQuery.data?.endpoints?.length === 0 ? (
                    <TableEmptyRow
                      colSpan={5}
                      description={tt('Create an HTTPS endpoint to receive signed events.')}
                      title={tt('No webhook endpoints')}
                    />
                  ) : null}
                </TableBody>
              </Table>
            </SettingsSection>
          </SettingsSections>
        ) : null}
        {selectedTab === 'requests' ? (
          <SettingsSections>
            <SettingsSection
              title={tt('Recent requests')}
              description={tt('Inspect persisted delivery attempts and retry failed requests.')}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tt('Request')}</TableHead>
                    <TableHead>{tt('Endpoint')}</TableHead>
                    <TableHead>{tt('Status')}</TableHead>
                    <TableHead>{tt('Created')}</TableHead>
                    <TableHead>{tt('Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requestsQuery.data?.requests?.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>
                        <button
                          className="font-medium hover:underline"
                          onClick={() => setSelectedRequest(request)}
                          type="button"
                        >
                          {request.event}
                        </button>
                        <div className="text-xs text-muted-foreground">{request.id}</div>
                      </TableCell>
                      <TableCell>{request.endpointUrl}</TableCell>
                      <TableCell>
                        <StatusBadge
                          active={request.status === 'delivered'}
                          activeLabel="Delivered"
                          inactiveLabel={request.status === 'pending' ? 'Pending' : 'Failed'}
                        />
                      </TableCell>
                      <TableCell>{formatDate(request.createdAt)}</TableCell>
                      <TableCell>
                        <Button
                          disabled={request.status === 'delivered' || retryMutation.isPending}
                          onClick={() => retryMutation.mutate(request.id)}
                          type="button"
                          variant="secondary"
                        >
                          <RefreshCw data-icon="inline-start" /> {tt('Retry')}{' '}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {requestsQuery.data?.requests?.length === 0 ? (
                    <TableEmptyRow
                      colSpan={5}
                      description={tt('Signed delivery attempts are recorded here when webhook events are dispatched.')}
                      title={tt('No webhook requests')}
                    />
                  ) : null}
                </TableBody>
              </Table>
            </SettingsSection>
          </SettingsSections>
        ) : null}
      </div>
      <WebhookSecretDisclosureDialog secret={secretDisclosure} onClose={() => setSecretDisclosure(null)} />
      <WebhookRequestDialog request={selectedRequest} onClose={() => setSelectedRequest(null)} />
    </ResourcePage>
  )
}
function WebhookEndpointRow({
  endpoint,
  onDelete,
  onRotate,
  onToggle,
}: {
  endpoint: WebhookEndpoint
  onDelete: (id: string) => void
  onRotate: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{endpoint.url}</div>
        <div className="text-xs text-muted-foreground">{endpoint.id}</div>
      </TableCell>
      <TableCell>{endpoint.events.join(', ')}</TableCell>
      <TableCell>
        <SwitchRow
          checked={endpoint.enabled}
          label={endpoint.enabled ? tt('Enabled') : tt('Disabled')}
          onCheckedChange={(checked) => onToggle(endpoint.id, checked)}
        />
      </TableCell>
      <TableCell>{endpoint.secretPrefix}...</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onRotate(endpoint.id)} type="button" variant="secondary">
            <RefreshCw data-icon="inline-start" /> {tt('Rotate secret')}{' '}
          </Button>
          <Button onClick={() => onDelete(endpoint.id)} type="button" variant="danger">
            <Trash2 data-icon="inline-start" /> {tt('Delete')}{' '}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
function WebhookSecretDisclosureDialog({ onClose, secret }: { onClose: () => void; secret: string | null }) {
  return (
    <Dialog open={Boolean(secret)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tt('Signing secret')}</DialogTitle>
          <DialogDescription>{tt('Copy this secret now. It is shown only once.')}</DialogDescription>
        </DialogHeader>
        {secret ? (
          <div className="grid gap-3 p-4">
            <code className="break-all rounded-md border border-border bg-muted p-3 text-sm">{secret}</code>
            <Button onClick={() => navigator.clipboard.writeText(secret)} type="button" variant="secondary">
              <Copy data-icon="inline-start" /> {tt('Copy secret')}{' '}
            </Button>
          </div>
        ) : null}
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button">
            {' '}
            {tt('Done')}{' '}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
function WebhookRequestDialog({ onClose, request }: { onClose: () => void; request: WebhookRequest | null }) {
  return (
    <Dialog open={Boolean(request)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tt('Webhook request')}</DialogTitle>
          <DialogDescription>{request?.id}</DialogDescription>
        </DialogHeader>
        {request ? (
          <div className="grid gap-3 p-4">
            <SettingRow label={tt('Endpoint')} value={request.endpointUrl} />
            <SettingRow label={tt('Event')} value={request.event} />
            <SettingRow label={tt('Status')} value={request.status} />
            <SettingRow label={tt('Attempts')} value={String(request.attemptCount)} />
            <SettingRow label={tt('HTTP status')} value={request.httpStatus ? String(request.httpStatus) : 'Pending'} />
            {request.error ? <SettingRow label={tt('Error')} value={request.error} /> : null}
            {request.requestBody ? <PayloadBlock label={tt('Request body')} value={request.requestBody} /> : null}
            {request.responseBody ? <PayloadBlock label={tt('Response body')} value={request.responseBody} /> : null}
          </div>
        ) : null}
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button">
            {' '}
            {tt('Close')}{' '}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
function PayloadBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">{value}</pre>
    </div>
  )
}
function TokenCustomizationCard({ rows, title }: { rows: Array<[string, string]>; title: string }) {
  return (
    <SettingsSection title={title} description={tt('Claim controls reflect the persisted authorization contract.')}>
      <div className="grid gap-3">
        {rows.map(([label, value]) => (
          <SettingRow key={label} label={label} value={value} />
        ))}
      </div>
    </SettingsSection>
  )
}
type SignInExperienceTab = {
  href: string
  label: string
  value: string
}
const signInExperienceTabs: SignInExperienceTab[] = [
  {
    value: 'branding',
    label: 'Branding',
    href: '/console/sign-in-experience/branding',
  },
  {
    value: 'sign-up-and-sign-in',
    label: 'Sign-up and sign-in',
    href: '/console/sign-in-experience/sign-up-and-sign-in',
  },
  {
    value: 'account-center',
    label: 'Account Center',
    href: '/console/sign-in-experience/account-center',
  },
  {
    value: 'content',
    label: 'Content',
    href: '/console/sign-in-experience/content',
  },
]
function SignInExperiencePage({
  activeTab,
  action,
  children,
  description,
  error,
  loading,
  onRetry,
  title,
}: {
  activeTab: string
  action?: ReactNode
  children: ReactNode
  description: string
  error?: Error | null
  loading?: boolean
  onRetry?: () => void
  title: string
}) {
  return (
    <ResourcePage
      action={action}
      description={description}
      error={error}
      framed={false}
      loading={loading}
      onRetry={onRetry}
      title={title}
      toolbar={
        <RoutedSettingsTabs
          active={activeTab}
          ariaLabel="Sign-in and account settings"
          tabs={signInExperienceTabs.map((tab) => [tab.value, tab.label, tab.href] as const)}
        />
      }
    >
      {children}
    </ResourcePage>
  )
}
function SignInExperienceEditorLayout({ preview, settings }: { preview: ReactNode; settings: ReactNode }) {
  return (
    <div className="signInExperienceLayout">
      <div className="signInExperienceSettings">{settings}</div>
      <aside className="signInExperiencePreviewPanel" aria-label={tt('Hosted authentication preview')}>
        {preview}
      </aside>
    </div>
  )
}
function HostedAuthPreview({ preview }: { preview: HostedAuthPreviewState }) {
  const [surface, setSurface] = useState<SignInPreviewSurface>('desktop')
  const [flow, setFlow] = useState<HostedAuthPreviewFlow>('sign-in')
  const [signupForm, setSignupForm] = useState({
    email: '',
    name: '',
    password: '',
    username: '',
  })
  const previewStyle = {
    '--brand-primary': preview.primaryColor ?? '#b42318',
    '--brand-background': preview.backgroundColor ?? '#f7f3ee',
    ...customCssProperties(preview.customCss ?? ''),
  } as CSSProperties
  const productName = preview.productName || 'FlareAuth'
  const primaryMode = hostedAuthMode(preview)
  const previewMode = flow === 'email' ? 'otp' : primaryMode
  const socialProviders = preview.socialProviders ?? []
  const effectiveFlow =
    flow === 'sign-up' && !passwordSignupEnabled(preview)
      ? 'sign-in'
      : flow === 'email' && !preview.emailOtpEnabled
        ? 'sign-in'
        : flow
  const legalLinks = [
    preview.termsUri ? ['Terms', preview.termsUri] : null,
    preview.privacyUri ? ['Privacy', preview.privacyUri] : null,
    preview.supportEmail ? ['Support', `mailto:${preview.supportEmail}`] : null,
  ].filter((link): link is [string, string] => link !== null)
  const previewTitle =
    effectiveFlow === 'sign-up' ? tt('Create account') : localizedHostedCopy(preview.headline, 'Sign in to FlareAuth')
  return (
    <div className="hostedPreviewShell">
      <div className="hostedPreviewHeader">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">{tt('Live preview')}</p>
          <h2>{tt('Hosted sign-in')}</h2>
        </div>
        <Tabs setValue={(value) => setSurface(value as SignInPreviewSurface)} value={surface}>
          <TabsList aria-label={tt('Preview viewport')}>
            <TabsTrigger value="desktop">{tt('Desktop')}</TabsTrigger>
            <TabsTrigger value="mobile">{tt('Mobile')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div
        className={cn('brandingPreview hostedAuthPreview', surface === 'mobile' && 'hostedAuthPreview-mobile')}
        style={previewStyle}
      >
        <AuthCardFrame
          ariaLabel={`${productName} hosted sign-in preview`}
          brand={
            <div className="brand brandLink">
              <PreviewBrandMark logoUrl={preview.logoUrl} productName={productName} />
              <span>{productName}</span>
            </div>
          }
          className="hostedAuthPanel"
          description={localizedHostedCopy(preview.description, 'Use your account to continue securely.')}
          eyebrow="Hosted sign-in"
          headingLevel={2}
          legalLinks={legalLinks}
          productName={productName}
          title={previewTitle}
          titleId="hosted-preview-title"
        >
          {effectiveFlow === 'sign-up' ? (
            <SignUpCardBody
              created={false}
              form={
                <SignUpForm
                  email={signupForm.email}
                  name={signupForm.name}
                  onEmailChange={(email) =>
                    setSignupForm((current) => ({
                      ...current,
                      email,
                    }))
                  }
                  onNameChange={(name) =>
                    setSignupForm((current) => ({
                      ...current,
                      name,
                    }))
                  }
                  onPasswordChange={(password) =>
                    setSignupForm((current) => ({
                      ...current,
                      password,
                    }))
                  }
                  onSubmit={(event) => event.preventDefault()}
                  onUsernameChange={(username) =>
                    setSignupForm((current) => ({
                      ...current,
                      username,
                    }))
                  }
                  password={signupForm.password}
                  username={signupForm.username}
                  usernameEnabled={preview.usernameEnabled}
                />
              }
              signInAction={
                <button className="authSignupLink" onClick={() => setFlow('sign-in')} type="button">
                  {' '}
                  {tt('Already have an account?')}{' '}
                </button>
              }
              socialButtons={
                preview.socialLoginEnabled && socialProviders.length > 0 ? (
                  <SignInMethodButtons
                    callback={undefined}
                    emailEnabled={false}
                    onEmailClick={() => undefined}
                    oneTapEnabled={false}
                    onProviderClick={() => undefined}
                    passkeyEnabled={false}
                    phoneEnabled={false}
                    phoneVisible={false}
                    providers={socialProviders}
                    walletEnabled={false}
                  />
                ) : null
              }
            />
          ) : (
            <SignInCardBody
              footer={null}
              methodButtons={
                preview.emailOtpEnabled ||
                preview.phoneEnabled ||
                preview.passkeysEnabled ||
                preview.oneTapEnabled ||
                preview.web3WalletEnabled ||
                (preview.socialLoginEnabled && socialProviders.length > 0) ? (
                  <SignInMethodButtons
                    callback={undefined}
                    emailEnabled={Boolean(preview.emailOtpEnabled)}
                    onEmailClick={() => setFlow('email')}
                    onOneTapClick={() => undefined}
                    onPasskeyClick={() => undefined}
                    onPhoneClick={() => undefined}
                    onProviderClick={() => undefined}
                    onWalletClick={() => undefined}
                    oneTapEnabled={Boolean(preview.oneTapEnabled)}
                    passkeyEnabled={Boolean(preview.passkeysEnabled)}
                    phoneEnabled={Boolean(preview.phoneEnabled)}
                    phoneVisible={Boolean(preview.phoneEnabled)}
                    providers={preview.socialLoginEnabled ? socialProviders : []}
                    walletEnabled={Boolean(preview.web3WalletEnabled)}
                  />
                ) : null
              }
              showDivider={Boolean(
                previewMode &&
                  (preview.emailOtpEnabled ||
                    preview.phoneEnabled ||
                    preview.passkeysEnabled ||
                    preview.oneTapEnabled ||
                    preview.web3WalletEnabled ||
                    (preview.socialLoginEnabled && socialProviders.length > 0)),
              )}
            >
              <div className="formStack">
                <label className="field">
                  {effectiveFlow === 'email' || !preview.usernameEnabled ? tt('Email') : tt('Email or username')}
                  <input className="textInput" readOnly type={effectiveFlow === 'email' ? 'email' : 'text'} value="" />
                </label>
                {previewMode === 'password' && !preview.identifierFirst ? (
                  <label className="field">
                    {' '}
                    {tt('Password')} <input className="textInput" readOnly type="password" value="" />
                  </label>
                ) : null}
                <button className="uiButton uiButton-primary w-full" type="button">
                  <KeyRound data-icon="inline-start" size={16} />
                  {preview.identifierFirst && effectiveFlow === 'sign-in'
                    ? 'Continue'
                    : previewSignInAction(previewMode)}
                </button>
                {effectiveFlow === 'email' ? (
                  <button className="authBackAction" onClick={() => setFlow('sign-in')} type="button">
                    {' '}
                    {tt('Back to sign in')}{' '}
                  </button>
                ) : null}
                {effectiveFlow === 'sign-in' && passwordSignupEnabled(preview) ? (
                  <p className="authSignupPrompt">
                    {tt('No account yet?')}{' '}
                    <button className="authSignupLink" onClick={() => setFlow('sign-up')} type="button">
                      {tt('Create account')}
                    </button>
                  </p>
                ) : null}
              </div>
            </SignInCardBody>
          )}
        </AuthCardFrame>
      </div>
      <Button onClick={() => window.open('/sign-in', '_blank', 'noopener')} type="button" variant="secondary">
        <Eye data-icon="inline-start" /> {tt('Open hosted sign-in')}{' '}
      </Button>
    </div>
  )
}
function PreviewBrandMark({ logoUrl, productName }: { logoUrl?: string | null; productName: string }) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  const brandInitial = productName.trim().slice(0, 1).toUpperCase() || 'F'
  const showLogo = Boolean(logoUrl && failedLogoUrl !== logoUrl)
  if (showLogo && logoUrl) {
    return (
      <img
        className="brandLogo"
        src={logoUrl}
        alt=""
        width="36"
        height="36"
        onError={() => setFailedLogoUrl(logoUrl)}
      />
    )
  }
  return <span className="brandMark">{brandInitial}</span>
}
function localizedHostedCopy(value: string | undefined, defaultValue: string) {
  return !value || value === defaultValue ? tt(defaultValue) : value
}
export function hostedAuthMode(preview: HostedAuthPreviewState): SignInMode | null {
  if (preview.passwordEnabled !== false) return 'password'
  if (preview.emailOtpEnabled) return 'otp'
  return null
}
export function passwordSignupEnabled(preview: HostedAuthPreviewState) {
  return preview.signupEnabled && preview.passwordEnabled !== false
}
export function previewSignInAction(mode: SignInMode | null) {
  if (mode === 'otp') return tt('Send code')
  return tt('Sign in')
}
function SettingsSections({ children }: { children: ReactNode }) {
  return <div className="grid gap-4">{children}</div>
}
function SettingsSection({
  children,
  description,
  title,
}: {
  children: ReactNode
  description: string
  title: string
}) {
  return (
    <section className="grid gap-4 rounded-2xl border border-border bg-background p-5 md:grid-cols-[18rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-xs font-semibold uppercase leading-5 tracking-[0.12em] text-muted-foreground">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
function ChangesSection({
  description,
  error,
  extraAction,
  onDiscard,
  pending,
  saveLabel,
  visible,
}: {
  description: string
  error?: ReactNode
  extraAction?: ReactNode
  onDiscard: () => void
  pending: boolean
  saveLabel: string
  visible: boolean
}) {
  if (!visible) return null
  return (
    <section aria-label={tt('Unsaved changes')} className="changesSheet">
      <div className="min-w-0">
        <h2 className="text-xs font-semibold uppercase leading-5 tracking-[0.12em] text-muted-foreground">
          {tt('Changes')}
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="changesSheetControls">
        {error}
        <div className="changesSheetActions">
          {extraAction}
          <Button onClick={onDiscard} type="button" variant="ghost">
            <Undo2 data-icon="inline-start" /> {tt('Discard')}{' '}
          </Button>
          <Button disabled={pending} type="submit">
            <Save data-icon="inline-start" />
            {saveLabel}
          </Button>
        </div>
      </div>
    </section>
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
  const [validationError, setValidationError] = useState<string | null>(null)
  return (
    <form
      className="formStack"
      onSubmit={(event) => {
        event.preventDefault()
        const submittedForm = new FormData(event.currentTarget)
        try {
          setValidationError(null)
          onSubmit(Object.fromEntries(fields.map(([name]) => [name, String(submittedForm.get(name) ?? '')])))
        } catch (submitError) {
          setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
        }
      }}
    >
      {fields.map(([name, label]) => (
        <Field key={name} label={label}>
          <TextInput
            defaultValue={defaults[name] ?? ''}
            name={name}
            required={!optionalAuthorizationFieldNames.has(name) && !name.endsWith('Id')}
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
                {' '}
                {tt('Edit')}{' '}
              </Button>
              <Button onClick={row.onDelete} type="button" variant="danger">
                <Trash2 data-icon="inline-start" /> {tt('Delete')}{' '}
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
  const inputId = useId()
  return (
    <div className="assetUploadRow">
      <AssetUploadPreview previewUrl={previewUrl} />
      <div className="assetUploadField">
        <span className="assetUploadLabel">{label}</span>
        <label className="assetUploadButton" htmlFor={inputId}>
          <ImageUp data-icon="inline-start" size={16} /> {tt('Choose file')}{' '}
        </label>
        <input
          accept={accept}
          aria-label={label}
          className="assetUploadInput"
          id={inputId}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) onFile(file)
            event.currentTarget.value = ''
          }}
          type="file"
        />
      </div>
    </div>
  )
}
function AssetUploadPreview({ previewUrl }: { previewUrl: string | null }) {
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null)
  const showPreview = Boolean(previewUrl && failedPreviewUrl !== previewUrl)
  if (showPreview && previewUrl) {
    return (
      <img
        alt=""
        className="assetPreview"
        src={previewUrl}
        width="64"
        height="64"
        onError={() => setFailedPreviewUrl(previewUrl)}
      />
    )
  }
  return (
    <div className="assetPreview text-muted-foreground">
      <ImageUp size={18} />
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
      <PageHeader action={action} description={description} title={title} />
      {toolbar ? <div>{toolbar}</div> : null}
      {loading ? <LoadingState label={`Loading ${title.toLowerCase()}`} /> : null}
      {error ? <ErrorState error={error} onRetry={onRetry} /> : null}
      {!loading && !error && empty && !framed ? (
        <EmptyState
          description={emptyDescription ?? `Create a ${title.toLowerCase()} item to populate this page.`}
          title={emptyTitle ?? `No ${title.toLowerCase()} yet`}
        />
      ) : null}
      {!loading && !error && framed ? (
        <Card className="consoleResourceFrame">
          <CardContent className="p-0">{children}</CardContent>
        </Card>
      ) : null}
      {!loading && !error && !empty && !framed ? children : null}
      {auxiliary}
    </>
  )
}
function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <ConsoleToolbar className="consoleListToolbar rounded-lg border border-border bg-background">
      <div className="grid w-full gap-2 sm:w-auto sm:grid-flow-col sm:auto-cols-max">{children}</div>
    </ConsoleToolbar>
  )
}
function ObjectHeader({ badge, id, title }: { badge: string; id: string; title: string }) {
  return (
    <div className="objectHeader">
      <div className="objectAvatar" aria-hidden="true">
        {title.slice(0, 1).toUpperCase()}
      </div>
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
function DetailTabs({
  label,
  onChange,
  tabs,
  value,
}: {
  label: string
  onChange: (value: string) => void
  tabs: DetailTab[]
  value: string
}) {
  return (
    <Tabs setValue={onChange} value={value}>
      <TabsList aria-label={label} className="flex w-full flex-wrap sm:inline-flex sm:w-auto">
        {tabs.map((tab) =>
          createElement(
            TabsTrigger,
            {
              key: tab.value,
              value: tab.value,
            },
            tab.label,
          ),
        )}
      </TabsList>
    </Tabs>
  )
}
export function navigateConsoleTab(navigate: ReturnType<typeof useNavigate>, href: string) {
  if (window.location.pathname.startsWith('/console/'))
    void navigate({
      to: href,
    })
}
export function userDetailTabs(): DetailTab[] {
  return [
    {
      value: 'profile',
      label: 'Profile',
    },
    {
      value: 'security',
      label: 'Security',
    },
    {
      value: 'sessions',
      label: 'Sessions',
    },
    {
      value: 'linked-accounts',
      label: 'Linked accounts',
    },
    {
      value: 'applications',
      label: 'Applications',
    },
    {
      value: 'operations',
      label: 'Operations',
    },
  ]
}
export function organizationDetailTabs(): DetailTab[] {
  return [
    {
      value: 'settings',
      label: 'Settings',
    },
    {
      value: 'authorization',
      label: 'Authorization',
    },
  ]
}
export function roleDetailTabs(): DetailTab[] {
  return [
    {
      value: 'settings',
      label: 'Settings',
    },
    {
      value: 'permissions',
      label: 'Permissions',
    },
    {
      value: 'assignments',
      label: 'Assignments',
    },
  ]
}
export function apiResourceDetailTabs(): DetailTab[] {
  return [
    {
      value: 'settings',
      label: 'Settings',
    },
    {
      value: 'scopes',
      label: 'Scopes',
    },
    {
      value: 'permissions',
      label: 'Permissions',
    },
  ]
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
    <Card className="consoleMetricCard">
      <CardHeader className="p-5">
        <div className="flex items-center justify-between gap-2">
          <CardDescription className="font-semibold text-foreground">{label}</CardDescription>
          {pending ? <Badge variant="outline">{tt('Pending')}</Badge> : null}
        </div>
        <CardTitle className="pt-5 text-2xl leading-none">{value}</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardHeader>
    </Card>
  )
}
function DashboardChartPanel({ dashboard }: { dashboard: AdminDashboard }) {
  void dashboard
  return (
    <Card className="consoleChartPanel">
      <CardHeader className="flex-row items-start justify-between gap-3 p-5">
        <div>
          <CardTitle>{tt('Daily active users')}</CardTitle>
          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-2xl font-semibold leading-none">--</span>
            <span className="text-sm font-medium text-muted-foreground">{tt('Pending activity data')}</span>
          </div>
        </div>
        <Button type="button" variant="secondary">
          {formatDashboardDate(new Date())}
          <CalendarDays data-icon="inline-end" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-6 p-5 pt-0">
        <div aria-label={tt('Daily active users trend')} className="consoleChartCanvas" role="img">
          <div className="consoleChartAxis" />
          <div className="consoleChartAxis" />
          <div className="consoleChartAxis" />
          <div className="consoleChartAxis" />
          <div className="consoleChartLine" />
          <div className="consoleChartLabels" aria-hidden="true">
            {dashboardChartLabels(new Date()).map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <DashboardActivityCard label={tt('Weekly active users')} />
          <DashboardActivityCard label={tt('Monthly active users')} />
        </div>
      </CardContent>
    </Card>
  )
}
function DashboardActivityCard({ label }: { label: string }) {
  return (
    <div className="consoleActivityCard">
      <p className="text-sm font-semibold">{label}</p>
      <div className="mt-8 flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold leading-none">--</span>
        <span className="text-sm font-medium text-muted-foreground">{tt('Pending')}</span>
      </div>
    </div>
  )
}
export function formatDashboardDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
export function dashboardChartLabels(date: Date) {
  return Array.from(
    {
      length: 8,
    },
    (_, index) => {
      const labelDate = new Date(date)
      labelDate.setDate(date.getDate() - (7 - index) * 4)
      const month = String(labelDate.getMonth() + 1).padStart(2, '0')
      const day = String(labelDate.getDate()).padStart(2, '0')
      return `${month}-${day}`
    },
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
function SecuritySectionTabs({ active }: { active: 'captcha' | 'blocklist' | 'general' }) {
  return (
    <RoutedSettingsTabs
      active={active}
      ariaLabel="Security settings"
      tabs={[
        ['captcha', 'CAPTCHA', '/console/security/captcha'],
        ['blocklist', 'Blocklist', '/console/security/blocklist'],
        ['general', 'General', '/console/security/general'],
      ]}
    />
  )
}
function lines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
function RoutedSettingsTabs<TValue extends string>({
  active,
  ariaLabel,
  onSelect,
  tabs,
}: {
  active: TValue
  ariaLabel: string
  onSelect?: (value: TValue) => void
  tabs: ReadonlyArray<readonly [TValue, string, string]>
}) {
  const navigate = useNavigate()
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap gap-6 border-b border-border">
      {tabs.map(([value, label, to]) => (
        <a
          aria-current={active === value ? 'page' : undefined}
          className={cn(
            'relative -mb-px inline-flex min-h-10 items-center justify-center border-b-2 border-transparent px-1 text-sm font-medium text-muted-foreground',
            active === value && 'border-primary text-primary',
          )}
          href={to}
          key={value}
          onClick={(event) => {
            if (event.defaultPrevented || event.button !== 0) return
            if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
            event.preventDefault()
            onSelect?.(value)
            navigateConsoleTab(navigate, to)
          }}
        >
          {label}
        </a>
      ))}
    </nav>
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
function PolicyCard({
  framed = true,
  rows,
  title,
}: {
  framed?: boolean
  rows: Array<[string, string]>
  title: string
}) {
  const content = (
    <>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map(([label, value]) => (
          <SettingRow key={label} label={label} value={value} />
        ))}
      </CardContent>
    </>
  )
  if (!framed) return <div>{content}</div>
  return <Card>{content}</Card>
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
          <DialogTitle>{tt('Copy client secret')}</DialogTitle>
          <DialogDescription>
            {' '}
            {tt(
              'This secret is shown once. Store it in your application secret manager before closing this dialog.',
            )}{' '}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 p-4">
          <SettingRow label={tt('Client ID')} value={clientId ?? ''} />
          <SettingRow label={tt('Client secret')} value={clientSecret ?? ''} />
          <CopyButton
            label={tt('Copy secret')}
            value={JSON.stringify(
              {
                clientId,
                clientSecret,
                tokenEndpointAuthMethod: 'client_secret_basic',
              },
              null,
              2,
            )}
          />
        </div>
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button" variant="secondary">
            {' '}
            {tt('Close')}{' '}
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
          <DialogTitle>{tt('Delete application')}</DialogTitle>
          <DialogDescription>
            {' '}
            {tt('Deleting')} {applicationName}{' '}
            {tt('removes the OIDC client and stops existing integrations from authenticating.')}{' '}
          </DialogDescription>
        </DialogHeader>
        <div className="p-4">
          <MutationError error={error} />
        </div>
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button" variant="secondary">
            {' '}
            {tt('Cancel')}{' '}
          </Button>
          <Button disabled={pending} onClick={onConfirm} type="button" variant="danger">
            {' '}
            {tt('Delete application')}{' '}
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
          <DialogTitle>{tt('Ban user')}</DialogTitle>
          <DialogDescription>
            {tt('Banning')} {userName} {tt('blocks sign-in until an admin unbans the account.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 p-4">
          <Field label={tt('Reason')}>
            <TextArea onChange={(event) => setReason(event.target.value)} value={reason} />
          </Field>
          <MutationError error={error} />
        </div>
        <DialogFooter className="m-0">
          <Button onClick={onClose} type="button" variant="secondary">
            {' '}
            {tt('Cancel')}{' '}
          </Button>
          <Button disabled={pending} onClick={() => onConfirm(reason)} type="button" variant="danger">
            {' '}
            {tt('Ban user')}{' '}
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
            {' '}
            {tt('Cancel')}{' '}
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
      {error instanceof Error ? tt(error.message) : tt('Request failed.')}
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
export function clientConfig(application: ApplicationResponse, clientSecret: string | null) {
  return JSON.stringify(
    {
      issuer: application.oidc.issuer,
      discoveryUrl: `${application.oidc.issuer}/.well-known/openid-configuration`,
      clientId: application.clientId,
      redirectUris: listItems(application.redirectUris),
      postLogoutRedirectUris: listItems(application.postLogoutRedirectUris),
      corsOrigins: listItems(application.corsOrigins),
      scopes: application.allowedScopes.join(' '),
      tokenEndpointAuthMethod: application.tokenEndpointAuthMethod,
      customData: application.customData,
      ...(clientSecret
        ? {
            clientSecret,
          }
        : {}),
    },
    null,
    2,
  )
}
export function listItems(value: readonly string[] | undefined) {
  return Array.isArray(value) ? [...value] : []
}
export function listValue(value: readonly string[] | undefined, separator: string) {
  return listItems(value).join(separator)
}
export function clientTypeLabel(value: ApplicationResponse['clientType']) {
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
function useConnectorPreviewProviders() {
  const query = useQuery({
    queryKey: adminQueryKeys.connectors,
    queryFn: listConnectors,
    initialData: emptyConnectorsResponse,
  })
  const connectors = Array.isArray(query.data?.connectors) ? query.data.connectors : []
  return {
    ...query,
    providers: connectors
      .filter((connector) => connector.enabled)
      .map((connector) => ({
        displayName: connector.displayName,
        icon: connector.providerType === 'social' ? connector.providerId : 'oauth',
        providerId: connector.providerId,
        slug: connector.slug,
      })),
  }
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
            {' '}
            {tt('Retry')}{' '}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
function CreateApplicationDialog({
  createdApplication,
  error,
  onClose,
  onSubmit,
  open,
  pending,
}: {
  createdApplication:
    | (ApplicationResponse & {
        clientSecret?: string
      })
    | null
  error: string | null
  onClose: () => void
  onSubmit: (input: z.infer<typeof createApplicationRequestSchema>) => void
  open: boolean
  pending: boolean
}) {
  const [form, setForm] = useState<FormState>({
    clientType: 'public_spa',
    redirectUris: '',
  })
  const [validationError, setValidationError] = useState<string | null>(null)
  return (
    <Dialog open={open}>
      {createdApplication ? (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt('Application created')}</DialogTitle>
            <DialogDescription>
              {' '}
              {tt('Copy the generated credentials, then open the settings page to finish setup.')}{' '}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 p-4 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <CheckCircle2 data-icon="inline-start" />
              {createdApplication.name}
            </div>
            <SettingRow label={tt('Client ID')} value={createdApplication.clientId} />
            {createdApplication.clientSecret ? (
              <SettingRow label={tt('Client secret')} value={createdApplication.clientSecret} />
            ) : (
              <SettingRow label={tt('Client secret')} value="No secret for public clients" />
            )}
            <SettingRow label={tt('Redirect URIs')} value={listValue(createdApplication.redirectUris, ', ')} />
            <SettingRow label={tt('Next step')} value="Review redirects, origins, and client metadata." />
          </div>
          <DialogFooter className="m-0">
            <LinkButton href={`/console/applications/${createdApplication.id}/settings`} variant="secondary">
              {' '}
              {tt('Open settings')}{' '}
            </LinkButton>
            <Button onClick={onClose} type="button">
              {' '}
              {tt('Close')}{' '}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : (
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
                  firstParty: true,
                  redirectUris: form.redirectUris.split('\n').filter(Boolean),
                }),
              )
            } catch (submitError) {
              setValidationError((submitError as Error).message)
            }
          }}
          pending={pending}
          title={tt('Create application')}
        >
          <Field label={tt('Name')}>
            <TextInput onChange={(event) => setValue(setForm, 'name', event.target.value)} required />
          </Field>
          <Field label={tt('Slug')}>
            <TextInput
              onChange={(event) => setValue(setForm, 'slug', event.target.value)}
              placeholder="customer-portal"
            />
          </Field>
          <ApplicationTypeCards
            onChange={(clientType) => setValue(setForm, 'clientType', clientType)}
            value={form.clientType}
          />
          <Field label={tt('Redirect URIs')} help={tt('One URI per line.')}>
            <TextArea onChange={(event) => setValue(setForm, 'redirectUris', event.target.value)} required />
          </Field>
        </FormDialog>
      )}
    </Dialog>
  )
}
function ApplicationTypeCards({ onChange, value }: { onChange: (clientType: string) => void; value: string }) {
  const selected = value
  return (
    <fieldset className="applicationTypeGrid">
      <legend>{tt('Application type')}</legend>
      {applicationTypeOptions.map((option) => (
        <button
          aria-pressed={selected === option.value}
          className={cn('applicationTypeCard', selected === option.value && 'selected')}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          <span className="applicationTypeIcon" aria-hidden="true">
            <option.icon size={18} />
          </span>
          <span>
            <strong>{option.title}</strong>
            <small>{option.description}</small>
          </span>
        </button>
      ))}
    </fieldset>
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
            setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
          }
        }}
        pending={pending}
        title={tt('Create user')}
      >
        <Field label={tt('Email')}>
          <TextInput onChange={(event) => setValue(setForm, 'email', event.target.value)} required type="email" />
        </Field>
        <Field label={tt('Display name')}>
          <TextInput onChange={(event) => setValue(setForm, 'displayName', event.target.value)} required />
        </Field>
        <Field label={tt('Username')}>
          <TextInput autoComplete="username" onChange={(event) => setValue(setForm, 'username', event.target.value)} />
        </Field>
        <Field label={tt('Initial password')}>
          <TextInput
            autoComplete="new-password"
            onChange={(event) => setValue(setForm, 'password', event.target.value)}
            type="password"
          />
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
  resources: Array<{
    id: string
    name: string
  }>
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
            setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
          }
        }}
        pending={pending}
        title={tt('Create role')}
      >
        <Field label={tt('Key')}>
          <TextInput onChange={(event) => setValue(setForm, 'key', event.target.value)} required />
        </Field>
        <Field label={tt('Name')}>
          <TextInput onChange={(event) => setValue(setForm, 'name', event.target.value)} required />
        </Field>
        <Field label={tt('Description')}>
          <TextInput onChange={(event) => setValue(setForm, 'description', event.target.value)} />
        </Field>
        <Field label={tt('API resource')}>
          <SelectInput onChange={(event) => setValue(setForm, 'resourceId', event.target.value)} defaultValue="">
            <option value="">{tt('Global role')}</option>
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
            {' '}
            {tt('Cancel')}{' '}
          </Button>
          <Button disabled={pending} onClick={onConfirm} type="button" variant="danger">
            {pending ? tt('Deleting...') : tt('Delete')}
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
            setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
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
        <DialogDescription>
          {tt('Required fields are validated before the management API request is sent.')}
        </DialogDescription>
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
            {' '}
            {tt('Cancel')}{' '}
          </Button>
          <Button disabled={pending} type="submit">
            {pending ? tt('Saving...') : tt('Save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
function parseForm<T extends z.ZodType>(schema: T, form: unknown): z.infer<T> {
  const result = schema.safeParse(removeBlankValues(form))
  if (!result.success) throw new Error(tt(result.error.issues[0]?.message ?? 'Invalid form input.'))
  return result.data
}
export function parseMetadata(value: string | undefined) {
  if (!value?.trim()) return undefined
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(tt('Provider metadata must be a JSON object.'))
  }
  return parsed as Record<string, unknown>
}
export function parseConnectorMetadata(form: FormState) {
  const metadata = parseMetadata(form.providerMetadata) ?? {}
  for (const [key, value] of Object.entries(form)) {
    if (!key.startsWith('metadata.') || value === '') continue
    const metadataKey = key.replace('metadata.', '')
    metadata[metadataKey] = metadataKey === 'allowUsersWithoutEmail' ? value === 'true' : value
  }
  return Object.keys(metadata).length ? metadata : undefined
}
export function connectorFieldLabel(field: string) {
  return field
    .replace(/URI/g, 'Uri')
    .replace(/ID/g, 'Id')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bUri\b/g, 'URI')
    .replace(/\bId\b/g, 'ID')
}
export function connectorUpdateForm(form: FormState) {
  const input = {
    ...form,
    clientId: nullableFormValue(form.clientId),
    issuer: nullableFormValue(form.issuer),
    authorizationEndpoint: nullableFormValue(form.authorizationEndpoint),
    tokenEndpoint: nullableFormValue(form.tokenEndpoint),
    userInfoEndpoint: nullableFormValue(form.userInfoEndpoint),
    jwksEndpoint: nullableFormValue(form.jwksEndpoint),
  }
  if (form.clientSecret?.trim()) {
    return {
      ...input,
      clientSecret: form.clientSecret.trim(),
    }
  }
  return input
}
export function nullableFormValue(value: string | undefined) {
  return value === '' ? null : value
}
export function connectorToForm(connector: ConnectorResponse | null): FormState {
  if (!connector) return emptyForm
  return {
    slug: connector.slug,
    displayName: connector.displayName,
    enabled: String(connector.enabled),
    clientId: connector.clientId ?? '',
    clientSecret: '',
    issuer: connector.issuer ?? '',
    authorizationEndpoint: connector.authorizationEndpoint ?? '',
    tokenEndpoint: connector.tokenEndpoint ?? '',
    userInfoEndpoint: connector.userInfoEndpoint ?? '',
    jwksEndpoint: connector.jwksEndpoint ?? '',
    scopes: connector.scopes.join(' '),
    providerMetadata: JSON.stringify(connector.providerMetadata, null, 2),
    ...Object.fromEntries(
      Object.entries(connector.providerMetadata).flatMap(([key, value]) =>
        typeof value === 'string' || typeof value === 'boolean' ? [[`metadata.${key}`, String(value)]] : [],
      ),
    ),
  }
}
export function removeBlankValues(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ''))
}
export function shallowEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leftEntries = Object.entries(left)
  if (leftEntries.length !== Object.keys(right).length) return false
  return leftEntries.every(([key, value]) => Object.is(value, right[key]))
}
export function nullableString(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
export function parseTokenClaims(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = JSON.parse(trimmed) as unknown
  return tokenClaimsObjectSchema.parse(parsed)
}
export function parseLineList(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
export function parseCustomData(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(tt('Custom data JSON must be an object.'))
  }
  return parsed as Record<string, unknown>
}
export function customCssProperties(css: string): CSSProperties {
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
  setForm((form) => ({
    ...form,
    [key]: value,
  }))
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
    onError: (error) => setErrorMessage(error instanceof Error ? tt(error.message) : tt('Request failed.')),
    onSuccess,
  })
  return {
    data: mutation.data,
    error: mutation.error,
    errorMessage,
    isPending: mutation.isPending,
    mutate: (input: TInput) => mutation.mutate(input),
    reset: () => {
      setErrorMessage(null)
      mutation.reset()
    },
  }
}
export function formatDate(value: string | Date | undefined) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleDateString()
}
export function formatRole(role: ManagementUserResponse['role']) {
  if (Array.isArray(role)) return role.join(', ')
  return role ?? 'user'
}
export function userDisplayName(user: ManagementUserResponse) {
  return user.displayName ?? user.name ?? user.email ?? user.id
}
