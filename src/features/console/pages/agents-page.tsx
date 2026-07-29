import type {
  AgentAuditEvent,
  AgentIdentity,
  AgentProtocolAgent,
  AgentProtocolApprovalRequest,
  AgentProtocolCapabilityGrant,
  AgentProtocolHost,
} from '@shared/api/agents'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Fingerprint, ScrollText, Server, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableEmptyRow, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  consoleQueryKeys,
  emergencyRetireAgentIdentity,
  getAgentAuditEvents,
  getAgentIdentityInventory,
  getAgentInventory,
  revokeAgent,
  revokeAgentCapabilityGrant,
  revokeAgentHost,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import { ResourcePage } from '../helpers/helpers-resource'
import { MetricCard } from './dashboard-page'

export function AgentsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: consoleQueryKeys.agents,
    queryFn: getAgentInventory,
  })
  const governanceQuery = useQuery({
    queryKey: [...consoleQueryKeys.agents, 'governance'],
    queryFn: () =>
      Promise.all([getAgentIdentityInventory(), getAgentAuditEvents()]).then(([identities, audit]) => ({
        identities,
        audit,
      })),
  })
  const revokeMutation = useMutation({
    mutationFn: (input: { kind: 'agent' | 'host' | 'grant' | 'identity'; id: string }) => {
      if (input.kind === 'identity') return emergencyRetireAgentIdentity(input.id)
      if (input.kind === 'agent') return revokeAgent(input.id)
      if (input.kind === 'host') return revokeAgentHost(input.id)
      return revokeAgentCapabilityGrant(input.id)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: consoleQueryKeys.agents }),
  })

  return (
    <ResourcePage
      description={tt('Inventory AgentAuth hosts, agents, approval requests, and capability grants.')}
      error={query.error ?? governanceQuery.error ?? revokeMutation.error}
      framed={false}
      loading={query.isLoading || governanceQuery.isLoading}
      onRetry={() => Promise.all([query.refetch(), governanceQuery.refetch()])}
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
          <AgentIdentityTable
            identities={governanceQuery.data?.identities.identities ?? []}
            pending={revokeMutation.isPending}
            retire={(id) => revokeMutation.mutate({ kind: 'identity', id })}
          />
          <AgentAuditTable events={governanceQuery.data?.audit.events ?? []} />
        </div>
      ) : null}
    </ResourcePage>
  )
}

function AgentIdentityTable({
  identities,
  pending,
  retire,
}: {
  identities: AgentIdentity[]
  pending: boolean
  retire: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Stable Agent identities')}</CardTitle>
        <CardDescription>{tt('Tenant inventory keyed by immutable issuer and subject.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Identity')}</TableHead>
              <TableHead>{tt('Home space')}</TableHead>
              <TableHead>{tt('Hosts')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead>{tt('Emergency action')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {identities.length ? (
              identities.map((identity) => (
                <TableRow key={identity.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Fingerprint className="size-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{identity.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {identity.issuer} · {identity.subject}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {identity.homeSpace.type === 'personal'
                      ? `User ${identity.homeSpace.userId}`
                      : `Organization ${identity.homeSpace.organizationId}`}
                  </TableCell>
                  <TableCell>{identity.bindings.filter((binding) => binding.status === 'active').length}</TableCell>
                  <TableCell>
                    <Badge variant={identity.status === 'active' ? 'secondary' : 'outline'}>{identity.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      disabled={pending || identity.status === 'retired'}
                      onClick={() => retire(identity.id)}
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 data-icon="inline-start" /> {tt('Retire')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={5}
                title={tt('No stable Agent identities.')}
                description={tt('Enrolled Agent identities will appear here.')}
              />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function AgentAuditTable({ events }: { events: AgentAuditEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Agent audit')}</CardTitle>
        <CardDescription>{tt('Credential-broker decisions without credentials or request bodies.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Decision')}</TableHead>
              <TableHead>{tt('Agent / host')}</TableHead>
              <TableHead>{tt('Target')}</TableHead>
              <TableHead>{tt('Grant')}</TableHead>
              <TableHead>{tt('Time')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length ? (
              events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <div>
                      <div className="flex items-center gap-2">
                        <ScrollText className="size-4 text-muted-foreground" />
                        <Badge variant={event.result === 'allowed' ? 'secondary' : 'outline'}>{event.result}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{event.action}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p>{event.agentIdentityId ?? tt('Unresolved')}</p>
                    <p className="text-xs text-muted-foreground">{event.hostId ?? tt('Unknown host')}</p>
                  </TableCell>
                  <TableCell>
                    {event.method} {event.targetOrigin}
                    {event.targetPath}
                  </TableCell>
                  <TableCell>{event.externalAccountGrantId ?? event.reasonCode ?? tt('None')}</TableCell>
                  <TableCell>{new Date(event.occurredAt).toLocaleString()}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={5}
                title={tt('No Agent audit events.')}
                description={tt('Credential-broker decisions will appear here.')}
              />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
              agents.map((agent) =>
                agentRow(
                  agent,
                  grants.filter((grant) => grant.agentId === agent.id),
                  pending,
                  revoke,
                ),
              )
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

function agentRow(
  agent: AgentProtocolAgent,
  agentGrants: AgentProtocolCapabilityGrant[],
  pending: boolean,
  revoke: (kind: 'agent' | 'grant', id: string) => void,
) {
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
                <Button disabled={pending} onClick={() => revoke('grant', grant.id)} type="button" variant="ghost">
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
        <Button disabled={pending} onClick={() => revoke('agent', agent.id)} type="button" variant="ghost">
          <Trash2 data-icon="inline-start" /> {tt('Revoke')}
        </Button>
      </TableCell>
    </TableRow>
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
