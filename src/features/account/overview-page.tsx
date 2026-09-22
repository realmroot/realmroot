import type { AccessRequestApproval, Agent } from '@shared/api/agent-api'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Check, ChevronRight, CircleDot, Pause, ShieldCheck, Users } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import {
  acceptAccountOrganizationInvitation,
  activateAgent,
  deactivateAgent,
  decideAccountAgentResourceRequest,
  deleteAgent,
  rejectAccountOrganizationInvitation,
} from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import * as Drawer from './account-drawer'
import { AccountEmptyState, AccountPageHeader, AccountRow, AccountRows } from './account-page'
import { AgentEnrollmentGuide } from './agent-enrollment-guide'
import { IdentityMark } from './identity-mark'
import { AgentDialog, AgentRequestDialog } from './planned-pages'
import { DestructiveConfirmationDialog, useDestructiveConfirmation } from './primitives'
import {
  accountQueryKeys,
  useAccountAccessRequests,
  useAccountAgents,
  useAccountMutation,
  useAccountOrganizationInvitations,
} from './queries'

export function AccountOverviewPage() {
  const agentsQuery = useAccountAgents()
  const requestsQuery = useAccountAccessRequests()
  const invitationsQuery = useAccountOrganizationInvitations()
  const runMutation = useAccountMutation()
  function mutate(label: string, operation: () => Promise<unknown>, options: Parameters<typeof runMutation>[2]) {
    return runMutation(
      label,
      async () => {
        await operation()
        return true
      },
      options,
    )
  }
  const [selected, setSelected] = useState<Agent | null>(null)
  const [request, setRequest] = useState<AccessRequestApproval | null>(null)
  const [invitationId, setInvitationId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  const agents = agentsQuery.data?.items ?? []
  const requests = requestsQuery.data?.items ?? []
  const invitations = (invitationsQuery.data ?? []).filter((item) => item.status === 'pending')
  const invitation = invitations.find((item) => item.id === invitationId)
  const count = requests.length + invitations.length
  return (
    <>
      <AccountPageHeader
        title={tt('Workbench')}
        description={tt('Manage your Agents and review access that needs your approval.')}
        action={<AgentEnrollmentGuide />}
      />
      <div className="accountWorkbench">
        <section>
          <div className="accountWorkbenchHeading">
            <div>
              <h2>{tt('Your Agents')}</h2>
              <span>
                {tt('{{count}} identities · {{active}} enabled', {
                  count: agents.length,
                  active: agents.filter((agent) => agent.status === 'active').length,
                })}
              </span>
            </div>
            <Link to="/agents">
              {tt('Manage Agents')} <ArrowUpRight />
            </Link>
          </div>
          {agentsQuery.error ? (
            <Status tone="error">{agentsQuery.error.message}</Status>
          ) : agentsQuery.isLoading ? (
            <Status>{tt('Loading Agents…')}</Status>
          ) : agents.length ? (
            <div className="accountAgentCards">
              {agents.slice(0, 3).map((agent) => {
                const agentRequests = requests.filter((item) => item.agent.id === agent.id)
                return (
                  <article className="accountAgentCard" key={agent.id}>
                    <button
                      type="button"
                      className="accountAgentCardMain"
                      onClick={() => setSelected(agent)}
                      aria-label={tt('Manage {{name}}', { name: agent.name })}
                    >
                      <div className="accountAgentCardTop">
                        <IdentityMark name={agent.name} />
                        <Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>
                          {tt(agent.status === 'active' ? 'Enabled' : 'Disabled')}
                        </Badge>
                      </div>
                      <h3>{agent.name}</h3>
                      <p>{agent.subject}</p>
                      <div className="accountAgentCardMeta">
                        <span>{tt('Agent identity')}</span>
                        <ArrowUpRight />
                      </div>
                    </button>
                    <div className="accountAgentCardBottom">
                      {agentRequests.length ? (
                        <button type="button" onClick={() => setRequest(agentRequests[0]!)}>
                          <CircleDot />
                          <span>{tt('{{count}} requests to review', { count: agentRequests.length })}</span>
                          <ChevronRight />
                        </button>
                      ) : (
                        <span>
                          {agent.status === 'active' ? <Check /> : <Pause />}
                          {requestsQuery.error
                            ? tt('Unable to load requests')
                            : requestsQuery.isLoading
                              ? tt('Loading requests…')
                              : tt(agent.status === 'active' ? 'No pending requests' : 'Identity disabled')}
                        </span>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="accountOnboarding">
              <AccountEmptyState
                title={tt('Start with your first Agent')}
                description={tt(
                  'Give the enrollment instructions to your Agent. It completes setup in its own environment.',
                )}
              />
              <AgentEnrollmentGuide />
            </div>
          )}
        </section>
        <section>
          <div className="accountWorkbenchHeading">
            <div>
              <h2>{tt('Needs your confirmation')}</h2>
              <span>{tt('{{count}} items', { count })}</span>
            </div>
          </div>
          <div className="accountInbox">
            {requestsQuery.error || invitationsQuery.error ? (
              <Status tone="error">{(requestsQuery.error ?? invitationsQuery.error)?.message}</Status>
            ) : null}
            {requestsQuery.isLoading || invitationsQuery.isLoading ? <Status>{tt('Loading requests…')}</Status> : null}
            {requests.map((item) => (
              <div className="accountInboxRow" key={item.id}>
                <span className="accountInboxIcon">
                  <ShieldCheck />
                </span>
                <div>
                  <strong>
                    {tt('{{agent}} requests access to {{resource}}', {
                      agent: item.agent.name,
                      resource: item.resourceServer.name,
                    })}
                  </strong>
                  <p>{item.authorizationDetail?.name ?? item.resourceServer.name}</p>
                  <code>{item.scopes.join(' ')}</code>
                </div>
                <Button onClick={() => setRequest(item)}>{tt('Review request')}</Button>
              </div>
            ))}
            {invitations.map((item) => (
              <div className="accountInboxRow" key={item.id}>
                <span className="accountInboxIcon">
                  <Users />
                </span>
                <div>
                  <strong>{tt('Join {{organization}}', { organization: item.organizationName })}</strong>
                  <p>
                    {tt('Organization invitation')} · {item.role}
                  </p>
                </div>
                <Button variant="outline" onClick={() => setInvitationId(item.id)}>
                  {tt('Review invitation')}
                </Button>
              </div>
            ))}
            {!count &&
            !requestsQuery.isLoading &&
            !invitationsQuery.isLoading &&
            !requestsQuery.error &&
            !invitationsQuery.error ? (
              <AccountEmptyState
                title={tt("You're all caught up")}
                description={tt('New access requests and organization invitations will appear here.')}
              />
            ) : null}
          </div>
        </section>
      </div>
      <AgentRequestDialog
        request={request}
        onClose={() => setRequest(null)}
        onDecision={async (item, input) => {
          const result = await mutate(
            input.decision === 'approve' ? 'Request approved.' : 'Request denied.',
            () => decideAccountAgentResourceRequest(item.id, input),
            { invalidate: [accountQueryKeys.accessRequests] },
          )
          if (result) setRequest(null)
        }}
      />
      <AgentDialog
        agent={selected}
        onClose={() => setSelected(null)}
        onStatusChange={async (agent) => {
          const result = await mutate(
            'Agent updated.',
            () => (agent.status === 'active' ? deactivateAgent(agent.id) : activateAgent(agent.id)),
            { invalidate: [accountQueryKeys.agents] },
          )
          if (result) setSelected(null)
        }}
        onDelete={(agent) =>
          setConfirmation({
            title: tt('Delete {{agent}}?', { agent: agent.name }),
            description: tt(
              'The Agent disappears from every interface. Hosts and active resource access stop immediately, and it cannot be restored.',
            ),
            actionLabel: tt('Delete Agent'),
            onConfirm: async () => {
              const result = await mutate('Agent deleted.', () => deleteAgent(agent.id), {
                invalidate: [accountQueryKeys.agents, accountQueryKeys.accessRequests],
              })
              if (result) setSelected(null)
            },
          })
        }
      />
      <Drawer.Dialog open={Boolean(invitation)} onOpenChange={(open) => !open && setInvitationId(null)}>
        <Drawer.DialogContent>
          <Drawer.DialogHeader>
            <Drawer.DialogTitle>{tt('Organization invitation')}</Drawer.DialogTitle>
            <Drawer.DialogDescription>{invitation?.organizationName}</Drawer.DialogDescription>
          </Drawer.DialogHeader>
          {invitation ? (
            <>
              <AccountRows>
                <AccountRow label={tt('Organization')} value={invitation.organizationName} />
                <AccountRow label={tt('Role')} value={invitation.role} />
              </AccountRows>
              <Drawer.DialogFooter>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const result = await mutate(
                      'Invitation declined.',
                      () => rejectAccountOrganizationInvitation(invitation.id),
                      { invalidate: [accountQueryKeys.organizationInvitations] },
                    )
                    if (result) setInvitationId(null)
                  }}
                >
                  {tt('Decline')}
                </Button>
                <Button
                  onClick={async () => {
                    const result = await mutate(
                      'Invitation accepted.',
                      () => acceptAccountOrganizationInvitation(invitation.id),
                      {
                        invalidate: [
                          accountQueryKeys.organizationInvitations,
                          accountQueryKeys.organizations,
                          accountQueryKeys.developerConsoleAccess,
                        ],
                      },
                    )
                    if (result) setInvitationId(null)
                  }}
                >
                  {tt('Accept')}
                </Button>
              </Drawer.DialogFooter>
            </>
          ) : null}
        </Drawer.DialogContent>
      </Drawer.Dialog>
      <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </>
  )
}
