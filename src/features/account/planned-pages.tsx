import type { AccessRequestApproval, Agent, DecideAccessRequest } from '@shared/api/agent-api'
import type { OrganizationAccessLevel } from '@shared/organization-access'
import { Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
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
  activateAgent,
  cancelAccountOrganizationInvitation,
  createAccountOrganization,
  deactivateAgent,
  decideAccountAgentResourceRequest,
  deleteAccountOrganization,
  deleteAgent,
  inviteAccountOrganizationMember,
  leaveAccountOrganization,
  rejectAccountOrganizationInvitation,
  removeAccountOrganizationMember,
  revokeApplicationConsent,
  setActiveAccountOrganization,
  updateAccountOrganization,
  updateAccountOrganizationMemberRole,
} from '@/lib/api/account'
import { toLocalDateTimeValue } from '@/lib/date-time'
import { tt } from '@/lib/i18n'
import {
  AccountEmptyState,
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
  useAccountMutation,
  useAccountOrganization,
  useAccountOrganizationAgents,
  useAccountOrganizationInvitations,
  useAccountOrganizationRoles,
  useAccountOrganizations,
  useAccountSecurity,
  useAccountSessions,
  useConsentedApplications,
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
            <AccountObjectSection surface title={tt('Needs your attention')}>
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
                        <Link to="/organizations">{tt('Review invitation')}</Link>
                      </Button>
                    }
                    description={tt('Organization invitation expires {{date}}', {
                      date: formatDate(invitation.expiresAt),
                    })}
                    key={invitation.id}
                    label={invitation.organizationName}
                    value={
                      <Badge variant="outline">
                        {organizationAccessLevelLabel(organizationAccessLevel(invitation.role))}
                      </Badge>
                    }
                  />
                ))}
                {!requestsQuery.isLoading && !invitationsQuery.isLoading && !requests.length && !invitations.length ? (
                  <AccountEmptyState
                    description={tt('There are no pending Agent access decisions or Organization invitations.')}
                    title={tt("You're all caught up")}
                  />
                ) : null}
              </AccountRows>
            </AccountObjectSection>
            <AccountObjectSection surface title={tt('Recent sessions')}>
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
                  <AccountEmptyState
                    description={tt('New sign-ins will appear here.')}
                    title={tt('No active sessions')}
                  />
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
  const mutate = useAccountMutation()
  const [selected, setSelected] = useState<ConsentedApplication | null>(null)
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  const applications = applicationsQuery.data?.applications ?? []
  return (
    <AccountSurface section="applications">
      {() => (
        <>
          <AccountPageHeader
            description={tt('Review applications authorized to access your Realmroot identity.')}
            title={tt('Authorized applications')}
          />
          <AccountObjectSection
            description={tt('Provider accounts used by Realmroot and Agents are managed separately in Connections.')}
            surface
            title={tt('Authorized applications')}
          >
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
                  <AccountEmptyState
                    description={tt('Applications you approve will appear here.')}
                    title={tt('No authorized applications')}
                  />
                ) : null}
              </AccountRows>
            ) : null}
          </AccountObjectSection>
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
            <AccountTabContent surface value="identities">
              <AccountRows>
                {agents.map((agent) => (
                  <AccountRow
                    action={
                      <Button onClick={() => setSelected(agent)} variant="outline">
                        {tt('Manage')}
                      </Button>
                    }
                    description={tt('{{subject}} · Created {{date}}', {
                      subject: agent.subject,
                      date: formatDate(agent.createdAt),
                    })}
                    key={agent.id}
                    label={agent.name}
                    value={
                      <Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>{tt(agent.status)}</Badge>
                    }
                  />
                ))}
                {!agentsQuery.isLoading && !agents.length ? (
                  <AccountEmptyState
                    description={tt('Agent identities you control will appear here.')}
                    title={tt('No Agent identities')}
                  />
                ) : null}
              </AccountRows>
            </AccountTabContent>
            <AccountTabContent surface value="requests">
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
                  <AccountEmptyState
                    description={tt('New resource access requests will appear here.')}
                    title={tt('No pending requests')}
                  />
                ) : null}
              </AccountRows>
            </AccountTabContent>
            <AccountTabContent surface value="activity">
              <AccountEmptyState
                description={tt('Agent activity will appear here when events are available.')}
                title={tt('No Agent activity')}
              />
            </AccountTabContent>
          </AccountTabs>
          <AgentDialog
            agent={selected}
            onClose={() => setSelected(null)}
            onDelete={async (agent) => {
              setConfirmation({
                title: tt('Delete {{agent}}?', { agent: agent.name }),
                description: tt(
                  'The Agent disappears from every interface. Hosts and active resource access stop immediately, and it cannot be restored.',
                ),
                actionLabel: tt('Delete Agent'),
                onConfirm: async () => {
                  let failed = false
                  await mutate('Agent deleted.', () => deleteAgent(agent.id), {
                    invalidate: [accountQueryKeys.agents],
                    onError: () => {
                      failed = true
                    },
                  })
                  if (!failed) setSelected(null)
                },
              })
            }}
            onStatusChange={async (agent) => {
              await mutate(
                agent.status === 'active' ? 'Agent deactivated.' : 'Agent activated.',
                () => (agent.status === 'active' ? deactivateAgent(agent.id) : activateAgent(agent.id)),
                { invalidate: [accountQueryKeys.agents] },
              )
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
  onDelete,
  onStatusChange,
}: {
  agent: Agent | null
  onClose: () => void
  onDelete: (agent: Agent) => void
  onStatusChange: (agent: Agent) => void
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
            <>
              <Button onClick={() => onStatusChange(agent)} variant="outline">
                {tt(agent.status === 'active' ? 'Deactivate Agent' : 'Activate Agent')}
              </Button>
              <Button onClick={() => onDelete(agent)} variant="destructive">
                {tt('Delete Agent')}
              </Button>
            </>
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
                <Button onClick={() => setCreateOpen(true)} size="sm">
                  <Plus />
                  {tt('New organization')}
                </Button>
              ) : undefined
            }
            description={tt('Create shared spaces and manage the organizations where you belong.')}
            title={tt('Organizations')}
          />
          {invitations.length ? (
            <AccountObjectSection surface title={tt('Invitations')}>
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
                    value={organizationAccessLevelLabel(organizationAccessLevel(invitation.role))}
                  />
                ))}
              </AccountRows>
            </AccountObjectSection>
          ) : null}
          {organizations.length ? (
            <div className="accountEntityList">
              {organizations.map((organization) => (
                <section className="accountObjectSection accountOrganizationCard is-surface" key={organization.id}>
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
            <AccountEmptyState
              description={tt('Create an organization or accept an invitation to get started.')}
              title={tt('No organizations yet')}
            />
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
        <Link params={{ organizationId: id }} to="/organizations/$organizationId">
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

export function AccountOrganizationDetailPage({
  content,
  organizationId,
  section = 'overview',
}: {
  content?: ReactNode
  organizationId: string
  section?:
    | 'overview'
    | 'members'
    | 'roles'
    | 'applications'
    | 'resource-servers'
    | 'agents'
    | 'webhooks'
    | 'activity'
    | 'settings'
}) {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState(section)
  const organizationQuery = useAccountOrganization(organizationId)
  const organizationRolesQuery = useAccountOrganizationRoles(organizationId, activeSection === 'members')
  const agentsQuery = useAccountOrganizationAgents(
    organizationId,
    activeSection === 'overview' || (activeSection === 'agents' && !content),
  )
  const mutate = useAccountMutation()
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
  useEffect(() => setActiveSection(section), [section])
  return (
    <AccountSurface section="organizations">
      {(profile) => {
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
        const accessLevel = organizationAccessLevel(membership?.role)
        const canManageOrganization = organizationMemberRoles(membership?.role).some(
          (role) => role === 'owner' || role === 'admin',
        )
        const pendingInvitations = organization.invitations.filter((invitation) => invitation.status === 'pending')
        return (
          <>
            <Link className="accountBackLink" to="/organizations">
              ← {tt('Organizations')}
            </Link>
            <AccountPageHeader
              description={tt('Manage members, Agent identities, shared authority, and Organization settings.')}
              title={organization.name}
            />
            <AccountTabs
              onValueChange={(next) => {
                const routes = {
                  overview: '/organizations/$organizationId/overview',
                  members: '/organizations/$organizationId/members',
                  roles: '/organizations/$organizationId/roles',
                  applications: '/organizations/$organizationId/applications',
                  'resource-servers': '/organizations/$organizationId/resource-servers',
                  agents: '/organizations/$organizationId/agents',
                  webhooks: '/organizations/$organizationId/webhooks/endpoints',
                  activity: '/organizations/$organizationId/activity',
                  settings: '/organizations/$organizationId/settings',
                } as const
                const route = routes[next as keyof typeof routes]
                if (route) {
                  setActiveSection(next as typeof activeSection)
                  void navigate({ params: { organizationId }, to: route })
                }
              }}
              tabs={[
                { value: 'overview', label: tt('Overview') },
                { value: 'members', label: tt('Members') },
                { value: 'roles', label: tt('Roles') },
                { value: 'applications', label: tt('Applications') },
                { value: 'resource-servers', label: tt('Resource Servers') },
                { value: 'agents', label: tt('Agents') },
                { value: 'webhooks', label: tt('Webhooks') },
                { value: 'activity', label: tt('Activity') },
                { value: 'settings', label: tt('Settings') },
              ]}
              value={activeSection}
            >
              <AccountTabContent surface value="overview">
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
              <AccountTabContent surface value="members">
                <div className="accountTabBody">
                  {canManageOrganization ? (
                    <div className="accountTabToolbar">
                      <Button onClick={() => setInviteOpen(true)} size="sm">
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
              <AccountTabContent surface value={content && section === 'agents' ? '__legacy-agents' : 'agents'}>
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
              <AccountTabContent surface value={content && section === 'roles' ? '__legacy-roles' : 'roles'}>
                <AccountObjectSection
                  description={tt('Better Auth Organization Roles assigned to your membership.')}
                  title={tt('Your Organization Roles')}
                >
                  <AccountRows>
                    <AccountRow
                      description={tt('Roles are resolved to scopes for this Organization only.')}
                      label={tt('Assigned Roles')}
                      value={<code>{membership?.role ?? 'member'}</code>}
                    />
                  </AccountRows>
                </AccountObjectSection>
              </AccountTabContent>
              <AccountTabContent surface value="settings">
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
              {content ? (
                <AccountTabContent surface value={section}>
                  {content}
                </AccountTabContent>
              ) : null}
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
              roleError={organizationRolesQuery.error instanceof Error ? organizationRolesQuery.error.message : null}
              roleLoading={organizationRolesQuery.isLoading}
              roles={organizationRolesQuery.data?.roles ?? []}
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
                const roles = [
                  ...organizationMemberRoles(member.role).filter(
                    (assigned) => !['owner', 'admin', 'developer', 'member'].includes(assigned),
                  ),
                  role,
                ].sort()
                await mutate(
                  'Access level updated.',
                  () => updateAccountOrganizationMemberRole(organization.id, member.id, roles),
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
                if (!failed) await navigate({ to: '/organizations' })
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
              <TableCell>{organizationAccessLevelLabel(organizationAccessLevel(member.role))}</TableCell>
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
              <TableCell>{organizationAccessLevelLabel(organizationAccessLevel(invitation.role))}</TableCell>
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

function organizationMemberRoles(role?: string | null) {
  return (role ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function organizationAccessLevel(role?: string | null): OrganizationAccessLevel {
  return (organizationMemberRoles(role).find((value) => ['owner', 'admin', 'developer', 'member'].includes(value)) ??
    'member') as OrganizationAccessLevel
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
                <SelectInput defaultValue={organizationAccessLevel(member.role)} name="role">
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
              value={organizationAccessLevelLabel(organizationAccessLevel(invitation.role))}
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
  roleError,
  roleLoading,
  roles,
}: {
  onClose: () => void
  onInvite: (input: { email: string; roles: string[] }) => void
  open: boolean
  roleError: string | null
  roleLoading: boolean
  roles: { key: string; displayName: string }[]
}) {
  const [selectionError, setSelectionError] = useState<string | null>(null)
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
            const selectedRoles = form.getAll('roles').map(String).sort()
            if (selectedRoles.length === 0) {
              setSelectionError(tt('Select at least one Role.'))
              return
            }
            setSelectionError(null)
            onInvite({
              email: String(form.get('email')),
              roles: selectedRoles,
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
            <Field label={tt('Roles')}>
              <div className="grid gap-2 rounded-md border p-3">
                {roles.map((role) => (
                  <label className="flex items-center gap-2 text-sm" key={role.key}>
                    <input defaultChecked={role.key === 'member'} name="roles" type="checkbox" value={role.key} />
                    {role.displayName}
                  </label>
                ))}
              </div>
            </Field>
            {roleLoading ? <p className="text-sm text-muted-foreground">{tt('Loading Roles…')}</p> : null}
            {roleError ? (
              <p className="text-sm text-destructive" role="alert">
                {roleError}
              </p>
            ) : null}
            {selectionError ? (
              <p className="text-sm text-destructive" role="alert">
                {selectionError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              {tt('Cancel')}
            </Button>
            <Button disabled={roleLoading || Boolean(roleError) || roles.length === 0} type="submit">
              {tt('Send invitation')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
