import type {
  AccessRequestApproval,
  AccountConnection,
  Agent,
  ConnectableApiResourcesResponse,
  DecideAccessRequest,
} from '@shared/api/agent-api'
import type { OrganizationAccessLevel } from '@shared/organization-access'
import { Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Field, SelectInput, TextInput } from '@/components/product-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  acceptAccountOrganizationInvitation,
  cancelAccountOrganizationInvitation,
  createAccountOrganization,
  decideAccountAgentResourceRequest,
  deleteAccountOrganization,
  inviteAccountOrganizationMember,
  leaveAccountOrganization,
  rejectAccountOrganizationInvitation,
  removeAccountOrganizationMember,
  retireAgent,
  revokeAccountConnection,
  revokeApplicationConsent,
  setActiveAccountOrganization,
  updateAccountOrganization,
  updateAccountOrganizationMemberRole,
} from '@/lib/api/account'
import { toLocalDateTimeValue } from '@/lib/date-time'
import { tt } from '@/lib/i18n'
import {
  AccountObjectSection,
  AccountPageHeader,
  AccountRow,
  AccountRows,
  AccountTabContent,
  AccountTabs,
} from './account-page'
import { AccountSurface } from './account-surface'
import { DestructiveConfirmationDialog, useDestructiveConfirmation } from './primitives'
import {
  accountQueryKeys,
  useAccountAccessRequests,
  useAccountAgents,
  useAccountConnections,
  useAccountMutation,
  useAccountOrganization,
  useAccountOrganizationAgentAccessGrants,
  useAccountOrganizationAgents,
  useAccountOrganizationInvitations,
  useAccountOrganizationRoleAssignments,
  useAccountOrganizations,
  useAccountSecurity,
  useAccountSessions,
  useConsentedApplications,
  useExternalApiResources,
} from './queries'
import type { ConsentedApplication } from './types'
import { formatDate, formatSessionDevice } from './utils'

export function AccountOverviewPage() {
  const agentsQuery = useAccountAgents()
  const organizationsQuery = useAccountOrganizations()
  const requestsQuery = useAccountAccessRequests()
  const invitationsQuery = useAccountOrganizationInvitations()
  const securityQuery = useAccountSecurity()
  const sessionsQuery = useAccountSessions(true)
  const mutate = useAccountMutation()
  const [request, setRequest] = useState<AccessRequestApproval | null>(null)
  const agents = agentsQuery.data?.items ?? []
  const organizations = organizationsQuery.data ?? []
  const requests = requestsQuery.data?.items ?? []
  const invitations = (invitationsQuery.data ?? []).filter((invitation) => invitation.status === 'pending')
  const security = securityQuery.data?.security
  const sessions = sessionsQuery.data?.sessions ?? []
  const securityStrong = Boolean(security?.mfa.enabled || security?.passkeys.count)
  return (
    <AccountSurface section="overview">
      {(profile) => (
        <>
          <AccountPageHeader
            description={tt('Review your identity, security, and delegated authority in this realm.')}
            title={tt('{{greeting}}, {{name}}.', {
              greeting: accountGreeting(),
              name: profile.displayName.split(' ')[0],
            })}
          />
          <div className="accountMetricGrid">
            <AccountMetric
              detail={
                securityStrong
                  ? tt('At least one additional sign-in factor is enrolled.')
                  : tt('Add MFA or a passkey to strengthen sign-in.')
              }
              label={tt('Security')}
              value={securityQuery.isLoading ? '—' : securityStrong ? tt('Strong') : tt('Basic')}
            />
            <AccountMetric
              detail={tt('{{count}} total Agent identities', { count: agents.length })}
              label={tt('Active Agents')}
              value={agentsQuery.isLoading ? '—' : String(agents.filter((agent) => agent.status === 'active').length)}
            />
            <AccountMetric
              detail={tt('Shared identity and authorization spaces you belong to.')}
              label={tt('Organizations')}
              value={organizationsQuery.isLoading ? '—' : String(organizations.length)}
            />
          </div>
          <div className="accountOverviewFlow">
            <AccountObjectSection description={tt('')} title={tt('Needs your attention')}>
              <AccountRows>
                {requests.map((item) => (
                  <AccountRow
                    action={<Button onClick={() => setRequest(item)}>{tt('Review request')}</Button>}
                    description={tt('{{resource}} · {{scopes}}', {
                      resource: item.resource.name,
                      scopes: item.scopes.join(' '),
                    })}
                    key={item.id}
                    label={item.agent.name}
                    value={
                      <Badge
                        className="bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                        variant="secondary"
                      >
                        {tt('Approval required')}
                      </Badge>
                    }
                  />
                ))}
                {invitations.map((invitation) => (
                  <AccountRow
                    action={
                      <Button asChild variant="outline">
                        <Link to="/account/organizations">{tt('Review invitation')}</Link>
                      </Button>
                    }
                    description={tt('Organization invitation expires {{date}}', {
                      date: formatDate(invitation.expiresAt),
                    })}
                    key={invitation.id}
                    label={invitation.organizationName}
                    value={
                      <Badge variant="outline">
                        {organizationAccessLevelLabel(invitation.role as OrganizationAccessLevel)}
                      </Badge>
                    }
                  />
                ))}
                {!requestsQuery.isLoading && !invitationsQuery.isLoading && !requests.length && !invitations.length ? (
                  <AccountRow
                    description={tt('There are no pending Agent access decisions or Organization invitations.')}
                    label={tt("You're all caught up")}
                    value={tt('No action needed')}
                  />
                ) : null}
              </AccountRows>
            </AccountObjectSection>
            <AccountObjectSection description={tt('')} title={tt('Recent sessions')}>
              <AccountRows>
                {sessions.slice(0, 3).map((session) => (
                  <AccountRow
                    description={session.ipAddress ?? tt('No IP address recorded')}
                    key={session.id}
                    label={formatSessionDevice(session.userAgent)}
                    value={
                      session.current ? tt('Current') : tt('Expires {{date}}', { date: formatDate(session.expiresAt) })
                    }
                  />
                ))}
                {!sessionsQuery.isLoading && !sessions.length ? (
                  <AccountRow label={tt('No active sessions')} value="—" />
                ) : null}
              </AccountRows>
            </AccountObjectSection>
          </div>
          <AgentRequestDialog
            onClose={() => setRequest(null)}
            onDecision={async (item, input) => {
              let failed = false
              await mutate(
                input.decision === 'approve' ? 'Request approved.' : 'Request denied.',
                () => decideAccountAgentResourceRequest(item.id, input),
                {
                  invalidate: [accountQueryKeys.accessRequests],
                  onError: () => {
                    failed = true
                  },
                },
              )
              if (!failed) setRequest(null)
            }}
            request={request}
          />
        </>
      )}
    </AccountSurface>
  )
}

function accountGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return tt('Good morning')
  if (hour < 18) return tt('Good afternoon')
  return tt('Good evening')
}

function AccountMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <article className="accountMetric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

export function AccountApplicationsPage() {
  const applicationsQuery = useConsentedApplications(true)
  const resourcesQuery = useExternalApiResources()
  const connectionsQuery = useAccountConnections()
  const mutate = useAccountMutation()
  const [selected, setSelected] = useState<ConsentedApplication | null>(null)
  const [tab, setTab] = useState('authorized')
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  const applications = applicationsQuery.data?.applications ?? []
  return (
    <AccountSurface section="applications">
      {() => (
        <>
          <AccountPageHeader
            description={tt('Review applications you have authorized to act with your identity.')}
            title={tt('Applications')}
          />
          <AccountTabs
            onValueChange={setTab}
            tabs={[
              { value: 'authorized', label: tt('Authorized apps') },
              { value: 'resources', label: tt('Resource accounts') },
            ]}
            value={tab}
          >
            <AccountTabContent value="authorized">
              {applicationsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">{tt('Loading authorized applications…')}</p>
              ) : null}
              {applicationsQuery.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {applicationsQuery.error instanceof Error
                    ? applicationsQuery.error.message
                    : tt('Unable to load authorized applications.')}
                </p>
              ) : null}
              {!applicationsQuery.isLoading && !applicationsQuery.error ? (
                <AccountRows>
                  {applications.map((application) => (
                    <AccountRow
                      action={
                        <Button onClick={() => setSelected(application)} variant="outline">
                          {tt('Review')}
                        </Button>
                      }
                      description={tt('Authorized {{date}}', { date: formatDate(application.grantedAt) })}
                      key={application.id}
                      label={application.applicationName}
                      value={<code>{application.scopes.join(' ')}</code>}
                    />
                  ))}
                  {!applications.length ? (
                    <p className="accountEmptyState">{tt('No applications are authorized for this account.')}</p>
                  ) : null}
                </AccountRows>
              ) : null}
            </AccountTabContent>
            <AccountTabContent value="resources">
              <ResourceAccountConnections
                connections={connectionsQuery.data?.items ?? []}
                error={connectionsQuery.error ?? resourcesQuery.error}
                loading={connectionsQuery.isLoading || resourcesQuery.isLoading}
                onDisconnect={(connection) => {
                  setConfirmation({
                    title: tt('Disconnect resource account'),
                    description: tt('Active Agent grants and token leases for this account will be revoked.'),
                    actionLabel: tt('Disconnect'),
                    onConfirm: () =>
                      mutate('Resource account disconnected.', () => revokeAccountConnection(connection.id), {
                        invalidate: [accountQueryKeys.accountConnections],
                      }),
                  })
                }}
                resources={resourcesQuery.data?.items ?? []}
              />
            </AccountTabContent>
          </AccountTabs>
          <ApplicationReviewDialog
            application={selected}
            onClose={() => setSelected(null)}
            onRevoke={(application) => {
              setConfirmation({
                title: tt('Revoke access to {{application}}?', { application: application.applicationName }),
                description: tt(
                  'This application will lose access to your identity immediately. You may be asked to authorize it again the next time you use it.',
                ),
                actionLabel: tt('Revoke access'),
                onConfirm: async () => {
                  let failed = false
                  await mutate('Application access revoked.', () => revokeApplicationConsent(application.id), {
                    invalidate: [accountQueryKeys.applications],
                    onError: () => {
                      failed = true
                    },
                  })
                  if (!failed) setSelected(null)
                },
              })
            }}
          />
          <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
        </>
      )}
    </AccountSurface>
  )
}

function ResourceAccountConnections({
  connections,
  error,
  loading,
  onDisconnect,
  resources,
}: {
  connections: AccountConnection[]
  error: Error | null
  loading: boolean
  onDisconnect: (connection: AccountConnection) => void
  resources: ConnectableApiResourcesResponse['items']
}) {
  const activeConnections = connections.filter((connection) => connection.status === 'active')
  return (
    <AccountObjectSection
      description={tt('Accounts used to authorize direct Agent access to external APIs.')}
      title={tt('Connected resource accounts')}
    >
      {loading ? <p className="text-sm text-muted-foreground">{tt('Loading connected resource accounts…')}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
      {!loading && !error ? (
        <AccountRows>
          {activeConnections.map((connection) => {
            const resource = resources.find((candidate) => candidate.id === connection.apiResourceId)
            return (
              <AccountRow
                action={
                  <Button onClick={() => onDisconnect(connection)} variant="outline">
                    {tt('Disconnect')}
                  </Button>
                }
                description={connection.displayName ?? connection.subjectHint ?? tt('Unknown owner')}
                key={connection.id}
                label={resource?.name ?? tt('API resource')}
                value={<code>{connection.scopes.join(' ')}</code>}
              />
            )
          })}
          {!activeConnections.length ? (
            <p className="accountEmptyState">{tt('No connected resource accounts.')}</p>
          ) : null}
        </AccountRows>
      ) : null}
    </AccountObjectSection>
  )
}

function ApplicationReviewDialog({
  application,
  onClose,
  onRevoke,
}: {
  application: ConsentedApplication | null
  onClose: () => void
  onRevoke: (application: ConsentedApplication) => void
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={application !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{application?.applicationName}</DialogTitle>
          <DialogDescription>
            {tt('Review the identity access this application can use on your behalf.')}
          </DialogDescription>
        </DialogHeader>
        {application ? (
          <AccountRows className="rounded-lg border px-2">
            <AccountRow label={tt('Application')} value={application.applicationName} />
            <AccountRow label={tt('Authorized')} value={formatDate(application.grantedAt)} />
            <AccountRow
              label={tt('Expires')}
              value={application.expiresAt ? formatDate(application.expiresAt) : tt('Never')}
            />
            <AccountRow label={tt('Scopes')} value={<code>{application.scopes.join(' ')}</code>} />
          </AccountRows>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            {tt('Close')}
          </Button>
          {application ? (
            <Button onClick={() => onRevoke(application)} variant="destructive">
              {tt('Revoke access')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AccountAgentsPage() {
  const [tab, setTab] = useState('identities')
  const [selected, setSelected] = useState<Agent | null>(null)
  const [request, setRequest] = useState<AccessRequestApproval | null>(null)
  const agentsQuery = useAccountAgents()
  const requestsQuery = useAccountAccessRequests()
  const mutate = useAccountMutation()
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  const agents = agentsQuery.data?.items ?? []
  const requests = requestsQuery.data?.items ?? []
  return (
    <AccountSurface section="agents">
      {() => (
        <>
          <AccountPageHeader
            description={tt('Review Agent identities you control and approve new resource access requests.')}
            title={tt('Agents')}
          />
          <AccountTabs
            onValueChange={setTab}
            tabs={[
              { value: 'identities', label: tt('My Agents') },
              { value: 'requests', label: tt('Requests · {{count}}', { count: requests.length }) },
              { value: 'activity', label: tt('Activity') },
            ]}
            value={tab}
          >
            <AccountTabContent value="identities">
              <div className="accountEntityList">
                {agents.map((agent) => (
                  <AccountObjectSection description={agent.subject} key={agent.id} title={agent.name}>
                    <AccountRows>
                      <AccountRow
                        action={
                          <Button onClick={() => setSelected(agent)} variant="outline">
                            {tt('Manage')}
                          </Button>
                        }
                        description={tt('Created {{date}}', { date: formatDate(agent.createdAt) })}
                        label={tt('Lifecycle')}
                        value={
                          <Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>
                            {tt(agent.status)}
                          </Badge>
                        }
                      />
                    </AccountRows>
                  </AccountObjectSection>
                ))}
                {!agentsQuery.isLoading && !agents.length ? (
                  <p className="accountEmptyState">{tt('No Agent identities belong to your account.')}</p>
                ) : null}
              </div>
            </AccountTabContent>
            <AccountTabContent value="requests">
              <AccountRows>
                {requests.map((item) => (
                  <AccountRow
                    action={<Button onClick={() => setRequest(item)}>{tt('Review request')}</Button>}
                    description={tt('{{resource}} · {{scopes}}', {
                      resource: item.resource.name,
                      scopes: item.scopes.join(' '),
                    })}
                    key={item.id}
                    label={item.agent.name}
                    value={
                      <Badge className="bg-amber-50 text-amber-800" variant="secondary">
                        {tt(item.status)}
                      </Badge>
                    }
                  />
                ))}
                {!requestsQuery.isLoading && !requests.length ? (
                  <p className="accountEmptyState">{tt('No Agent access requests need your review.')}</p>
                ) : null}
              </AccountRows>
            </AccountTabContent>
            <AccountTabContent value="activity">
              <p className="accountEmptyState">{tt('No Agent activity is available for this account.')}</p>
            </AccountTabContent>
          </AccountTabs>
          <AgentDialog
            agent={selected}
            onClose={() => setSelected(null)}
            onRetire={async (agent) => {
              setConfirmation({
                title: tt('Retire {{agent}}?', { agent: agent.name }),
                description: tt(
                  'Hosts and active resource access stop immediately. The stable subject remains reserved for audit history.',
                ),
                actionLabel: tt('Retire Agent'),
                onConfirm: async () => {
                  let failed = false
                  await mutate('Agent retired.', () => retireAgent(agent.id), {
                    invalidate: [accountQueryKeys.agents],
                    onError: () => {
                      failed = true
                    },
                  })
                  if (!failed) setSelected(null)
                },
              })
            }}
          />
          <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
          <AgentRequestDialog
            onClose={() => setRequest(null)}
            onDecision={async (item, input) => {
              let failed = false
              await mutate(
                input.decision === 'approve' ? 'Request approved.' : 'Request denied.',
                () => decideAccountAgentResourceRequest(item.id, input),
                {
                  invalidate: [accountQueryKeys.accessRequests],
                  onError: () => {
                    failed = true
                  },
                },
              )
              if (!failed) setRequest(null)
            }}
            request={request}
          />
        </>
      )}
    </AccountSurface>
  )
}

function AgentDialog({
  agent,
  onClose,
  onRetire,
}: {
  agent: Agent | null
  onClose: () => void
  onRetire: (agent: Agent) => void
}) {
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={agent !== null}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{agent?.name}</DialogTitle>
          <DialogDescription>{agent?.id}</DialogDescription>
        </DialogHeader>
        {agent ? (
          <AccountRows className="rounded-lg border px-2">
            <AccountRow label={tt('Stable subject')} value={<code>{agent.subject}</code>} />
            <AccountRow label={tt('Issuer')} value={<code>{agent.issuer}</code>} />
            <AccountRow label={tt('Status')} value={tt(agent.status)} />
            <AccountRow label={tt('Created')} value={formatDate(agent.createdAt)} />
            <AccountRow label={tt('Last updated')} value={formatDate(agent.updatedAt)} />
          </AccountRows>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            {tt('Close')}
          </Button>
          {agent ? (
            <Button disabled={agent.status === 'retired'} onClick={() => onRetire(agent)} variant="destructive">
              {tt('Retire Agent')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AgentRequestDialog({
  onClose,
  onDecision,
  request,
}: {
  onClose: () => void
  onDecision: (request: AccessRequestApproval, input: DecideAccessRequest) => void
  request: AccessRequestApproval | null
}) {
  const [mode, setMode] = useState<'once' | 'until' | 'persistent'>('once')
  const [expiresAt, setExpiresAt] = useState('')
  const requestId = request?.id
  useEffect(() => {
    if (!requestId) return
    setMode('once')
    setExpiresAt('')
  }, [requestId])
  const expiryIsValid = mode !== 'until' || (expiresAt.length > 0 && new Date(expiresAt).getTime() > Date.now())
  return (
    <Dialog onOpenChange={(next) => !next && onClose()} open={request !== null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tt('Review Agent access request')}</DialogTitle>
          <DialogDescription>
            {tt('Confirm the Agent, resource, permissions, and access duration before deciding.')}
          </DialogDescription>
        </DialogHeader>
        {request ? (
          <div className="grid gap-4">
            <dl className="grid divide-y">
              <div className="grid gap-1 pb-3">
                <dt className="text-xs text-muted-foreground">{tt('Agent')}</dt>
                <dd className="font-medium">{request.agent.name}</dd>
                <dd className="break-all font-mono text-xs text-muted-foreground">{request.agent.id}</dd>
              </div>
              <div className="grid gap-1 py-3">
                <dt className="text-xs text-muted-foreground">{tt('Resource server')}</dt>
                <dd className="font-medium">{request.resource.name}</dd>
                <dd className="break-all font-mono text-xs text-muted-foreground">{request.resource.id}</dd>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3">
                <div className="grid content-start gap-1">
                  <dt className="text-xs text-muted-foreground">{tt('Permissions')}</dt>
                  <dd className="break-words font-mono text-xs">{request.scopes.join(' ')}</dd>
                </div>
                <div className="grid content-start gap-1">
                  <dt className="text-xs text-muted-foreground">{tt('Request expires')}</dt>
                  <dd className="text-xs">{new Date(request.expiresAt).toLocaleString()}</dd>
                </div>
              </div>
              {request.authorizationDetails.length > 0 ? (
                <div className="grid gap-1 pt-3">
                  <dt className="text-xs text-muted-foreground">{tt('Authorization context')}</dt>
                  <dd className="whitespace-pre-wrap break-all font-mono text-xs">
                    {request.authorizationDetails.map((detail) => JSON.stringify(detail)).join('\n')}
                  </dd>
                </div>
              ) : null}
            </dl>
            <Field label={tt('Access duration')}>
              <SelectInput
                name="access-duration"
                onChange={(event) => setMode(event.target.value as typeof mode)}
                value={mode}
              >
                <option value="once">{tt('One use')}</option>
                <option value="until">{tt('Until a date and time')}</option>
                <option value="persistent">{tt('Until revoked')}</option>
              </SelectInput>
            </Field>
            {mode === 'until' ? (
              <Field label={tt('Expiry date and time')}>
                <TextInput
                  aria-invalid={expiresAt.length > 0 && !expiryIsValid}
                  min={toLocalDateTimeValue()}
                  name="expires-at"
                  onChange={(event) => setExpiresAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={expiresAt}
                />
              </Field>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          {request ? (
            <Button onClick={() => onDecision(request, { decision: 'deny' })} variant="destructive">
              {tt('Deny')}
            </Button>
          ) : null}
          {request ? (
            <Button
              disabled={!expiryIsValid}
              onClick={() =>
                onDecision(request, {
                  decision: 'approve',
                  mode,
                  authorizationDetails: request.authorizationDetails,
                  ...(mode === 'until' ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
                })
              }
            >
              {tt('Approve')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AccountOrganizationsPage() {
  const organizationsQuery = useAccountOrganizations()
  const invitationsQuery = useAccountOrganizationInvitations()
  const mutate = useAccountMutation()
  const [createOpen, setCreateOpen] = useState(false)
  const organizations = organizationsQuery.data ?? []
  const invitations = (invitationsQuery.data ?? []).filter((invitation) => invitation.status === 'pending')
  return (
    <AccountSurface section="organizations">
      {(_profile, access, activeOrganizationId) => (
        <>
          <AccountPageHeader
            action={
              access.canCreateOrganization ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus />
                  {tt('New organization')}
                </Button>
              ) : undefined
            }
            description={tt('Create shared spaces and manage the organizations where you belong.')}
            title={tt('Organizations')}
          />
          {invitations.length ? (
            <AccountObjectSection title={tt('Invitations')}>
              <AccountRows>
                {invitations.map((invitation) => (
                  <AccountRow
                    action={
                      <div className="flex gap-2">
                        <Button
                          onClick={() =>
                            mutate('Invitation declined.', () => rejectAccountOrganizationInvitation(invitation.id), {
                              invalidate: [accountQueryKeys.organizationInvitations],
                            })
                          }
                          variant="outline"
                        >
                          {tt('Decline')}
                        </Button>
                        <Button
                          onClick={() =>
                            mutate('Invitation accepted.', () => acceptAccountOrganizationInvitation(invitation.id), {
                              invalidate: [accountQueryKeys.organizationInvitations, accountQueryKeys.organizations],
                            })
                          }
                        >
                          {tt('Accept')}
                        </Button>
                      </div>
                    }
                    description={tt('Invited {{date}} · expires {{expires}}', {
                      date: formatDate(invitation.createdAt),
                      expires: formatDate(invitation.expiresAt),
                    })}
                    key={invitation.id}
                    label={invitation.organizationName}
                    value={organizationAccessLevelLabel(invitation.role as OrganizationAccessLevel)}
                  />
                ))}
              </AccountRows>
            </AccountObjectSection>
          ) : null}
          {organizations.length ? (
            <div className="accountEntityList">
              {organizations.map((organization) => (
                <section className="accountObjectSection accountOrganizationCard" key={organization.id}>
                  <header>
                    <OrganizationName
                      active={activeOrganizationId === organization.id}
                      id={organization.id}
                      name={organization.name}
                    />
                  </header>
                  <AccountRows>
                    <AccountRow label={tt('Slug')} value={<code>{organization.slug}</code>} />
                    <AccountRow
                      action={
                        <OrganizationActions
                          active={activeOrganizationId === organization.id}
                          id={organization.id}
                          mutate={mutate}
                        />
                      }
                      label={tt('Created')}
                      value={formatDate(organization.createdAt)}
                    />
                  </AccountRows>
                </section>
              ))}
            </div>
          ) : null}
          {!organizationsQuery.isLoading && !organizations.length ? (
            <p className="accountEmptyState">{tt('You do not belong to an Organization yet.')}</p>
          ) : null}
          {access.canCreateOrganization ? (
            <NewOrganizationDialog
              onClose={() => setCreateOpen(false)}
              onCreate={async (input) => {
                let failed = false
                await mutate('Organization created.', () => createAccountOrganization(input), {
                  invalidate: [accountQueryKeys.organizations],
                  onError: () => {
                    failed = true
                  },
                })
                if (!failed) setCreateOpen(false)
              }}
              open={createOpen}
            />
          ) : null}
        </>
      )}
    </AccountSurface>
  )
}

function OrganizationName({ active, id, name }: { active: boolean; id: string; name: string }) {
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-2">
        <strong className="truncate">{name}</strong>
        {active ? <Badge variant="secondary">{tt('Current')}</Badge> : null}
      </span>
      <span className="block truncate font-mono text-xs text-muted-foreground">{id}</span>
    </div>
  )
}

function OrganizationActions({
  active,
  className,
  id,
  mutate,
}: {
  active: boolean
  className?: string
  id: string
  mutate: ReturnType<typeof useAccountMutation>
}) {
  return (
    <div className={`flex justify-end gap-2 ${className ?? ''}`}>
      {!active ? (
        <Button
          className={className ? 'flex-1' : undefined}
          onClick={() =>
            mutate('Active organization changed.', () => setActiveAccountOrganization(id), {
              invalidate: [accountQueryKeys.profile, accountQueryKeys.organizationContext],
            })
          }
          variant={className ? 'secondary' : 'ghost'}
        >
          {tt('Switch')}
        </Button>
      ) : null}
      <Button asChild className={className ? 'flex-1' : undefined} variant="outline">
        <Link params={{ organizationId: id }} to="/account/organizations/$organizationId">
          {tt('Manage')}
        </Link>
      </Button>
    </div>
  )
}

function NewOrganizationDialog({
  onClose,
  onCreate,
  open,
}: {
  onClose: () => void
  onCreate: (input: { name: string; slug: string }) => void
  open: boolean
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedSlug = slug.trim()
    if (!trimmedName || !trimmedSlug) return
    onCreate({ name: trimmedName, slug: trimmedSlug })
    setName('')
    setSlug('')
    setSlugEdited(false)
  }
  return (
    <Dialog onOpenChange={(next) => !next && onClose()} open={open}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{tt('New organization')}</DialogTitle>
            <DialogDescription>
              {tt('Create a shared identity and authorization context. You become its Owner.')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <Field label={tt('Organization name')}>
              <TextInput
                name="name"
                onChange={(event) => {
                  const nextName = event.target.value
                  setName(nextName)
                  if (!slugEdited) setSlug(organizationSlug(nextName))
                }}
                required
                value={name}
              />
            </Field>
            <Field label={tt('Slug')}>
              <TextInput
                name="slug"
                onChange={(event) => {
                  setSlug(event.target.value.toLowerCase())
                  setSlugEdited(true)
                }}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="payments-team"
                required
                value={slug}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              {tt('Cancel')}
            </Button>
            <Button type="submit">{tt('Create organization')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function organizationSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function AccountOrganizationDetailPage({ organizationId }: { organizationId: string }) {
  const navigate = useNavigate()
  const organizationQuery = useAccountOrganization(organizationId)
  const agentsQuery = useAccountOrganizationAgents(organizationId)
  const roleAssignmentsQuery = useAccountOrganizationRoleAssignments(organizationId)
  const agentAccessGrantsQuery = useAccountOrganizationAgentAccessGrants(organizationId)
  const mutate = useAccountMutation()
  const [tab, setTab] = useState('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selectedMember, setSelectedMember] = useState<OrganizationMemberRow | null>(null)
  const [selectedInvitation, setSelectedInvitation] = useState<OrganizationInvitationRow | null>(null)
  const [confirmation, setConfirmation] = useState<'leave' | 'delete' | null>(null)
  const [membershipConfirmation, setMembershipConfirmation] = useState<
    | { type: 'remove-member'; member: OrganizationMemberRow }
    | { type: 'cancel-invitation'; invitation: OrganizationInvitationRow }
    | null
  >(null)
  const organization = organizationQuery.data
  const agents = agentsQuery.data?.items ?? []
  const roleAssignments = roleAssignmentsQuery.data?.assignments ?? []
  const agentAccessGrants = agentAccessGrantsQuery.data?.grants ?? []
  return (
    <AccountSurface section="organizations">
      {(profile, access) => {
        if (organizationQuery.isLoading)
          return <p className="text-sm text-muted-foreground">{tt('Loading Organization…')}</p>
        if (organizationQuery.error || !organization)
          return (
            <p className="text-sm text-destructive" role="alert">
              {organizationQuery.error instanceof Error
                ? organizationQuery.error.message
                : tt('Organization not found.')}
            </p>
          )
        const membership = organization.members.find((member) => member.userId === profile.id)
        const accessLevel = membership?.role as OrganizationAccessLevel | undefined
        const canManageOrganization = accessLevel === 'owner' || accessLevel === 'admin'
        const canOpenConsole =
          access.realmOperator || access.consoleOrganizations.some((item) => item.organizationId === organization.id)
        const pendingInvitations = organization.invitations.filter((invitation) => invitation.status === 'pending')
        return (
          <>
            <Link className="accountBackLink" to="/account/organizations">
              ← {tt('Organizations')}
            </Link>
            <AccountPageHeader
              action={
                canOpenConsole ? (
                  <Button asChild variant="outline">
                    <a href={`/console?context=${encodeURIComponent(organization.id)}`}>{tt('Open Console')}</a>
                  </Button>
                ) : undefined
              }
              description={tt('Manage members, Agent identities, shared authority, and Organization settings.')}
              title={organization.name}
            />
            <AccountTabs
              onValueChange={setTab}
              tabs={[
                { value: 'overview', label: tt('Overview') },
                { value: 'members', label: tt('Members') },
                { value: 'agents', label: tt('Agents') },
                { value: 'authority', label: tt('Role assignments') },
                { value: 'settings', label: tt('Settings') },
              ]}
              value={tab}
            >
              <AccountTabContent value="overview">
                <AccountRows>
                  <AccountRow
                    description={tt('Controls Organization administration, not business API authority.')}
                    label={tt('Your access level')}
                    value={organizationAccessLevelLabel(accessLevel)}
                  />
                  <AccountRow label={tt('Organization ID')} value={<code>{organization.id}</code>} />
                  <AccountRow label={tt('Slug')} value={<code>{organization.slug}</code>} />
                  <AccountRow label={tt('Members')} value={String(organization.members.length)} />
                  <AccountRow label={tt('Pending invitations')} value={String(pendingInvitations.length)} />
                  <AccountRow label={tt('Agent identities')} value={String(agents.length)} />
                  <AccountRow label={tt('Created')} value={formatDate(organization.createdAt)} />
                </AccountRows>
              </AccountTabContent>
              <AccountTabContent value="members">
                <div className="grid gap-4">
                  {canManageOrganization ? (
                    <div className="flex justify-end">
                      <Button onClick={() => setInviteOpen(true)}>
                        <Plus />
                        {tt('Invite member')}
                      </Button>
                    </div>
                  ) : null}
                  <OrganizationMembersTable
                    canManage={canManageOrganization}
                    currentUserId={profile.id}
                    invitations={pendingInvitations}
                    members={organization.members}
                    onInvitationSelect={setSelectedInvitation}
                    onMemberSelect={setSelectedMember}
                  />
                </div>
              </AccountTabContent>
              <AccountTabContent value="agents">
                <AccountRows>
                  {agents.map((agent) => (
                    <AccountRow
                      description={agent.subject}
                      key={agent.id}
                      label={agent.name}
                      value={
                        <Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>{tt(agent.status)}</Badge>
                      }
                    />
                  ))}
                  {!agents.length ? (
                    <AccountRow
                      description={tt(
                        'Agents can belong to a person or an Organization and are established only through enrollment.',
                      )}
                      label={tt('No Organization Agents')}
                      value="—"
                    />
                  ) : null}
                </AccountRows>
                {agentsQuery.error ? (
                  <p className="pt-4 text-sm text-destructive" role="alert">
                    {agentsQuery.error instanceof Error
                      ? agentsQuery.error.message
                      : tt('Unable to load Organization Agents.')}
                  </p>
                ) : null}
              </AccountTabContent>
              <AccountTabContent value="authority">
                {roleAssignmentsQuery.isLoading || agentAccessGrantsQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">{tt('Loading Organization authority…')}</p>
                ) : null}
                {roleAssignmentsQuery.error || agentAccessGrantsQuery.error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {roleAssignmentsQuery.error instanceof Error
                      ? roleAssignmentsQuery.error.message
                      : agentAccessGrantsQuery.error instanceof Error
                        ? agentAccessGrantsQuery.error.message
                        : tt('Unable to load Organization authority.')}
                  </p>
                ) : null}
                {!roleAssignmentsQuery.isLoading && !agentAccessGrantsQuery.isLoading ? (
                  <div className="grid gap-8">
                    <AccountObjectSection
                      description={tt(
                        'Realm-wide and Organization-context Roles currently effective for your account.',
                      )}
                      title={tt('Your effective Roles')}
                    >
                      <AccountRows>
                        {roleAssignments.map(({ assignment, role, permissions }) => (
                          <AccountRow
                            description={role.description ?? role.key}
                            key={assignment.id}
                            label={role.name}
                            value={
                              permissions.length ? (
                                <span className="flex max-w-xl flex-wrap justify-end gap-1">
                                  {permissions.map((permission) => (
                                    <code key={`${permission.resourceId}:${permission.scope}`}>
                                      {permission.resourceId} · {permission.scope}
                                    </code>
                                  ))}
                                </span>
                              ) : (
                                tt('No permissions')
                              )
                            }
                          />
                        ))}
                        {!roleAssignments.length ? (
                          <AccountRow
                            description={tt('Organization access levels do not grant business API scopes.')}
                            label={tt('No effective Role assignments')}
                            value="—"
                          />
                        ) : null}
                      </AccountRows>
                    </AccountObjectSection>
                    <AccountObjectSection
                      description={tt('Active delegated Resource server access held by Organization Agents.')}
                      title={tt('Agent access grants')}
                    >
                      <AccountRows>
                        {agentAccessGrants.map((grant) => (
                          <AccountRow
                            description={tt('Resource {{resource}} · {{mode}}', {
                              resource: grant.resourceId,
                              mode: grant.mode,
                            })}
                            key={grant.id}
                            label={grant.agentName}
                            value={<code>{grant.scopes.join(' ')}</code>}
                          />
                        ))}
                        {!agentAccessGrants.length ? (
                          <AccountRow label={tt('No active Agent access grants')} value="—" />
                        ) : null}
                      </AccountRows>
                    </AccountObjectSection>
                  </div>
                ) : null}
              </AccountTabContent>
              <AccountTabContent value="settings">
                <AccountRows>
                  <AccountRow
                    action={
                      canManageOrganization ? (
                        <Button onClick={() => setEditOpen(true)} variant="outline">
                          {tt('Edit')}
                        </Button>
                      ) : null
                    }
                    label={tt('Organization profile')}
                    value={organization.name}
                  />
                  <AccountRow
                    action={
                      accessLevel !== 'owner' ? (
                        <Button onClick={() => setConfirmation('leave')} variant="destructive">
                          {tt('Leave')}
                        </Button>
                      ) : null
                    }
                    description={
                      accessLevel === 'owner'
                        ? tt('Transfer ownership before leaving this Organization.')
                        : tt('Your Organization-scoped access stops immediately.')
                    }
                    label={tt('Leave organization')}
                    value={organizationAccessLevelLabel(accessLevel)}
                  />
                  {accessLevel === 'owner' ? (
                    <AccountRow
                      action={
                        <Button onClick={() => setConfirmation('delete')} variant="destructive">
                          {tt('Delete')}
                        </Button>
                      }
                      description={tt('Permanently delete this Organization after resolving its dependencies.')}
                      label={tt('Delete organization')}
                      value={tt('Permanent')}
                    />
                  ) : null}
                </AccountRows>
              </AccountTabContent>
            </AccountTabs>
            <EditOrganizationDialog
              onClose={() => setEditOpen(false)}
              onSave={async (input) => {
                let failed = false
                await mutate('Organization updated.', () => updateAccountOrganization(organization.id, input), {
                  invalidate: [accountQueryKeys.organizations, [...accountQueryKeys.organizations, organization.id]],
                  onError: () => {
                    failed = true
                  },
                })
                if (!failed) setEditOpen(false)
              }}
              open={editOpen}
              organization={organization}
            />
            <InviteOrganizationMemberDialog
              onClose={() => setInviteOpen(false)}
              onInvite={async (input) => {
                let failed = false
                await mutate('Invitation sent.', () => inviteAccountOrganizationMember(organization.id, input), {
                  invalidate: [[...accountQueryKeys.organizations, organization.id]],
                  onError: () => {
                    failed = true
                  },
                })
                if (!failed) setInviteOpen(false)
              }}
              open={inviteOpen}
            />
            <OrganizationMemberDialog
              member={selectedMember}
              onClose={() => setSelectedMember(null)}
              onRemove={(member) => {
                setSelectedMember(null)
                setMembershipConfirmation({ type: 'remove-member', member })
              }}
              onSave={async (member, role) => {
                let failed = false
                await mutate(
                  'Access level updated.',
                  () => updateAccountOrganizationMemberRole(organization.id, member.id, role),
                  {
                    invalidate: [[...accountQueryKeys.organizations, organization.id]],
                    onError: () => {
                      failed = true
                    },
                  },
                )
                if (!failed) setSelectedMember(null)
              }}
            />
            <OrganizationInvitationDialog
              invitation={selectedInvitation}
              onCancel={(invitation) => {
                setSelectedInvitation(null)
                setMembershipConfirmation({ type: 'cancel-invitation', invitation })
              }}
              onClose={() => setSelectedInvitation(null)}
            />
            <DestructiveConfirmation
              confirmLabel={
                membershipConfirmation?.type === 'remove-member' ? tt('Remove member') : tt('Cancel invitation')
              }
              description={
                membershipConfirmation?.type === 'remove-member'
                  ? tt('This member immediately loses Organization access and Organization-scoped authority.')
                  : tt('This invitation can no longer be accepted. You can send a new invitation later.')
              }
              onClose={() => setMembershipConfirmation(null)}
              onConfirm={async () => {
                const action = membershipConfirmation
                if (!action) return
                let failed = false
                await mutate(
                  action.type === 'remove-member' ? 'Member removed.' : 'Invitation canceled.',
                  async () => {
                    if (action.type === 'remove-member') {
                      await removeAccountOrganizationMember(organization.id, action.member.id)
                    } else {
                      await cancelAccountOrganizationInvitation(action.invitation.id)
                    }
                  },
                  {
                    invalidate: [[...accountQueryKeys.organizations, organization.id]],
                    onError: () => {
                      failed = true
                    },
                  },
                )
                if (!failed) setMembershipConfirmation(null)
              }}
              open={membershipConfirmation !== null}
              title={
                membershipConfirmation?.type === 'remove-member'
                  ? tt('Remove {{name}}?', { name: membershipConfirmation.member.user.name })
                  : tt('Cancel invitation for {{email}}?', {
                      email:
                        membershipConfirmation?.type === 'cancel-invitation'
                          ? membershipConfirmation.invitation.email
                          : '',
                    })
              }
            />
            <DestructiveConfirmation
              confirmLabel={confirmation === 'delete' ? tt('Delete organization') : tt('Leave organization')}
              description={
                confirmation === 'delete'
                  ? tt('This permanently removes the Organization after its dependencies are resolved.')
                  : tt('Your membership and Organization-scoped access stop immediately.')
              }
              onClose={() => setConfirmation(null)}
              onConfirm={async () => {
                const action = confirmation
                if (!action) return
                let failed = false
                await mutate(
                  action === 'delete' ? 'Organization deleted.' : 'Organization left.',
                  async () => {
                    if (action === 'delete') await deleteAccountOrganization(organization.id)
                    else await leaveAccountOrganization(organization.id)
                  },
                  {
                    invalidateExact: [accountQueryKeys.organizations],
                    onError: () => {
                      failed = true
                    },
                  },
                )
                if (!failed) await navigate({ to: '/account/organizations' })
              }}
              open={confirmation !== null}
              title={
                confirmation === 'delete'
                  ? tt('Delete {{name}}?', { name: organization.name })
                  : tt('Leave {{name}}?', { name: organization.name })
              }
            />
          </>
        )
      }}
    </AccountSurface>
  )
}

type OrganizationMemberRow = {
  id: string
  userId: string
  role: string
  createdAt: Date
  user: { id: string; name: string; email: string; image?: string | null }
}
type OrganizationInvitationRow = {
  id: string
  email: string
  role: string
  status: string
  createdAt: Date
  expiresAt: Date
}

function OrganizationMembersTable({
  canManage,
  currentUserId,
  invitations,
  members,
  onInvitationSelect,
  onMemberSelect,
}: {
  canManage: boolean
  currentUserId: string
  invitations: OrganizationInvitationRow[]
  members: OrganizationMemberRow[]
  onInvitationSelect: (invitation: OrganizationInvitationRow) => void
  onMemberSelect: (member: OrganizationMemberRow) => void
}) {
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Member')}</TableHead>
            <TableHead>{tt('Access level')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
            <TableHead>{tt('Added')}</TableHead>
            {canManage ? (
              <TableHead>
                <span className="sr-only">{tt('Actions')}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell>
                <strong>{member.user.name}</strong>
                <span className="block text-xs text-muted-foreground">{member.user.email}</span>
              </TableCell>
              <TableCell>{organizationAccessLevelLabel(member.role as OrganizationAccessLevel)}</TableCell>
              <TableCell>
                <Badge variant="secondary">{tt('Active')}</Badge>
              </TableCell>
              <TableCell>{formatDate(member.createdAt)}</TableCell>
              {canManage ? (
                <TableCell className="text-right">
                  {member.userId !== currentUserId ? (
                    <Button onClick={() => onMemberSelect(member)} size="sm" variant="ghost">
                      {tt('Manage')}
                    </Button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          {invitations.map((invitation) => (
            <TableRow key={invitation.id}>
              <TableCell>
                <strong>{invitation.email}</strong>
                <span className="block text-xs text-muted-foreground">
                  {tt('Invitation expires {{date}}', { date: formatDate(invitation.expiresAt) })}
                </span>
              </TableCell>
              <TableCell>{organizationAccessLevelLabel(invitation.role as OrganizationAccessLevel)}</TableCell>
              <TableCell>
                <Badge variant="outline">{tt(invitation.status)}</Badge>
              </TableCell>
              <TableCell>{formatDate(invitation.createdAt)}</TableCell>
              {canManage ? (
                <TableCell className="text-right">
                  <Button onClick={() => onInvitationSelect(invitation)} size="sm" variant="ghost">
                    {tt('Review')}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function organizationAccessLevelLabel(role?: OrganizationAccessLevel) {
  if (role === 'owner') return tt('Owner')
  if (role === 'admin') return tt('Administrator')
  if (role === 'developer') return tt('Developer')
  return tt('Member')
}

function OrganizationMemberDialog({
  member,
  onClose,
  onRemove,
  onSave,
}: {
  member: OrganizationMemberRow | null
  onClose: () => void
  onRemove: (member: OrganizationMemberRow) => void
  onSave: (member: OrganizationMemberRow, role: OrganizationAccessLevel) => void
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={member !== null}
    >
      <DialogContent>
        {member ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              onSave(member, String(form.get('role')) as OrganizationAccessLevel)
            }}
          >
            <DialogHeader>
              <DialogTitle>{tt('Manage {{name}}', { name: member.user.name })}</DialogTitle>
              <DialogDescription>{member.user.email}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-5">
              <Field label={tt('Access level')}>
                <SelectInput defaultValue={member.role} name="role">
                  <option value="owner">{tt('Owner')}</option>
                  <option value="admin">{tt('Administrator')}</option>
                  <option value="developer">{tt('Developer')}</option>
                  <option value="member">{tt('Member')}</option>
                </SelectInput>
              </Field>
            </div>
            <DialogFooter className="sm:justify-between">
              <Button onClick={() => onRemove(member)} type="button" variant="destructive">
                {tt('Remove member')}
              </Button>
              <div className="flex gap-2">
                <Button onClick={onClose} type="button" variant="outline">
                  {tt('Cancel')}
                </Button>
                <Button type="submit">{tt('Save access level')}</Button>
              </div>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function OrganizationInvitationDialog({
  invitation,
  onCancel,
  onClose,
}: {
  invitation: OrganizationInvitationRow | null
  onCancel: (invitation: OrganizationInvitationRow) => void
  onClose: () => void
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={invitation !== null}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tt('Pending invitation')}</DialogTitle>
          <DialogDescription>
            {tt('Review the recipient and access level before canceling this invitation.')}
          </DialogDescription>
        </DialogHeader>
        {invitation ? (
          <AccountRows className="rounded-lg border px-2">
            <AccountRow label={tt('Email')} value={invitation.email} />
            <AccountRow
              label={tt('Access level')}
              value={organizationAccessLevelLabel(invitation.role as OrganizationAccessLevel)}
            />
            <AccountRow label={tt('Expires')} value={formatDate(invitation.expiresAt)} />
          </AccountRows>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            {tt('Close')}
          </Button>
          {invitation ? (
            <Button onClick={() => onCancel(invitation)} variant="destructive">
              {tt('Cancel invitation')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditOrganizationDialog({
  onClose,
  onSave,
  open,
  organization,
}: {
  onClose: () => void
  onSave: (input: { name: string; slug: string }) => void
  open: boolean
  organization: { name: string; slug: string }
}) {
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open={open}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            onSave({ name: String(form.get('name')), slug: String(form.get('slug')) })
          }}
        >
          <DialogHeader>
            <DialogTitle>{tt('Edit organization')}</DialogTitle>
            <DialogDescription>
              {tt('Update the name and stable slug used to recognize this Organization.')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <Field label={tt('Name')}>
              <TextInput defaultValue={organization.name} name="name" required />
            </Field>
            <Field label={tt('Slug')}>
              <TextInput defaultValue={organization.slug} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              {tt('Cancel')}
            </Button>
            <Button type="submit">{tt('Save changes')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InviteOrganizationMemberDialog({
  onClose,
  onInvite,
  open,
}: {
  onClose: () => void
  onInvite: (input: { email: string; role: 'owner' | 'admin' | 'developer' | 'member' }) => void
  open: boolean
}) {
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open={open}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            onInvite({
              email: String(form.get('email')),
              role: String(form.get('role')) as 'owner' | 'admin' | 'developer' | 'member',
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{tt('Invite member')}</DialogTitle>
            <DialogDescription>
              {tt('Invite a Realm user and choose the access level used to administer this Organization.')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <Field label={tt('Email')}>
              <TextInput name="email" required type="email" />
            </Field>
            <Field label={tt('Access level')}>
              <SelectInput defaultValue="member" name="role">
                <option value="owner">{tt('Owner')}</option>
                <option value="admin">{tt('Administrator')}</option>
                <option value="developer">{tt('Developer')}</option>
                <option value="member">{tt('Member')}</option>
              </SelectInput>
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              {tt('Cancel')}
            </Button>
            <Button type="submit">{tt('Send invitation')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
