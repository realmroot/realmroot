import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  consoleQueryKeys,
  emergencyRetireAgent,
  getAgent,
  getAgentAuditEvents,
  listAgentAccessGrants,
  listAgentAccessRequests,
  listAgentInstallations,
  listAgentRoles,
} from '@/lib/api/management'
import { useConsoleScope } from '@/lib/console-context'
import { tt } from '@/lib/i18n'
import { ErrorState, LoadingState, MutationError } from '../helpers/helpers-dialogs'
import { navigateConsoleTab } from '../helpers/helpers-resource'

export type AgentDetailSection = 'overview' | 'hosts' | 'roles' | 'requests' | 'grants' | 'activity' | 'settings'

export function AgentDetailPage({ agentId, section = 'overview' }: { agentId: string; section?: AgentDetailSection }) {
  const { organizationId: context } = useConsoleScope()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<AgentDetailSection>(section)
  const [retireOpen, setRetireOpen] = useState(false)
  const agentQuery = useQuery({ queryKey: [...consoleQueryKeys.agents, agentId], queryFn: () => getAgent(agentId) })
  const hosts = useQuery({
    queryKey: [...consoleQueryKeys.agents, agentId, 'hosts'],
    queryFn: () => listAgentInstallations(agentId, { limit: 100 }),
  })
  const roles = useQuery({
    queryKey: [...consoleQueryKeys.agents, agentId, 'roles'],
    queryFn: () => listAgentRoles(agentId, { limit: 100 }),
  })
  const requests = useQuery({
    queryKey: [...consoleQueryKeys.agents, agentId, 'requests'],
    queryFn: () => listAgentAccessRequests({ agentId, limit: 100 }),
  })
  const grants = useQuery({
    queryKey: [...consoleQueryKeys.agents, agentId, 'grants'],
    queryFn: () => listAgentAccessGrants({ agentId, limit: 100 }),
  })
  const audit = useQuery({
    queryKey: [...consoleQueryKeys.agents, agentId, 'audit', { organizationId: context }],
    queryFn: () => getAgentAuditEvents({ agentId, organizationId: context }),
  })
  const agent = agentQuery.data?.agent
  const retire = useMutation({
    mutationFn: () => emergencyRetireAgent(agentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: consoleQueryKeys.agents })
      setRetireOpen(false)
      await navigate({ search: {}, to: '/console/agents' })
    },
  })
  useEffect(() => {
    if (context && section === 'settings') {
      setTab('overview')
      navigateConsoleTab(navigate, `/console/agents/${agentId}/overview`, context)
      return
    }
    setTab(section)
  }, [agentId, context, navigate, section])

  const detailQueries = [agentQuery, hosts, roles, requests, grants, audit]
  if (detailQueries.some((query) => query.isLoading)) return <LoadingState label={tt('Loading Agent')} />
  const loadError = detailQueries.find((query) => query.error)?.error
  if (loadError)
    return <ErrorState error={loadError} onRetry={() => Promise.all(detailQueries.map((query) => query.refetch()))} />
  if (!agent) return <ErrorState error={new Error(tt('Agent not found.'))} />
  const events = (audit.data?.items ?? []).filter((event) => event.agentIdentityId === agent.id)
  const resources = new Map(
    [...(requests.data?.items ?? []), ...(grants.data?.items ?? [])].map((item) => [item.resource.id, item.resource]),
  )
  const owner = `${agent.owner.displayName} · ${agent.owner.id}`
  const tabs: AgentDetailSection[] = [
    'overview',
    'hosts',
    'roles',
    'requests',
    'grants',
    'activity',
    ...(!context ? (['settings'] as const) : []),
  ]

  return (
    <>
      <div className="consoleDetailStack">
        <Link className="consoleBackLink" search={context ? { context } : {}} to="/console/agents">
          <ArrowLeft />
          {tt('Agents')}
        </Link>
        <header className="consoleDetailHeader">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1>{agent.name}</h1>
              <Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>{agent.status}</Badge>
            </div>
            <p>{tt('Stable Agent identity owned by {{owner}}.', { owner })}</p>
            <span className="consoleDetailMeta">
              {agent.issuer} · {agent.subject}
            </span>
          </div>
        </header>
        <Tabs
          onValueChange={(value) => {
            const next = value as AgentDetailSection
            setTab(next)
            navigateConsoleTab(navigate, `/console/agents/${agentId}/${next}`, context)
          }}
          value={tab}
        >
          <TabsList className="w-full justify-start" variant="line">
            {tabs.map((value) => (
              <TabsTrigger key={value} value={value}>
                {tt(agentTabLabel(value))}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent className="mt-5" value="overview">
            <DetailRows
              rows={[
                ['Owner type', agent.owner.type === 'organization' ? 'Organization' : 'User'],
                ['Owner', owner],
                ['Stable subject', agent.subject],
                ['Issuer', agent.issuer],
                ['Installations', agent.installationCount.toLocaleString()],
                ['Effective Roles', agent.roleCount.toLocaleString()],
                ['Pending access requests', agent.pendingRequestCount.toLocaleString()],
                ['Active access grants', agent.activeGrantCount.toLocaleString()],
                ['Created', new Date(agent.createdAt).toLocaleString()],
                ['Last updated', new Date(agent.updatedAt).toLocaleString()],
              ]}
            />
          </TabsContent>
          <TabsContent className="mt-5" value="hosts">
            <AgentInstallationsTable items={hosts.data?.items ?? []} />
          </TabsContent>
          <TabsContent className="mt-5" value="roles">
            <AgentRolesTable items={roles.data?.items ?? []} />
          </TabsContent>
          <TabsContent className="mt-5" value="requests">
            <AgentRequestsTable items={requests.data?.items ?? []} />
          </TabsContent>
          <TabsContent className="mt-5" value="grants">
            <AgentGrantsTable items={grants.data?.items ?? []} />
          </TabsContent>
          <TabsContent className="mt-5" value="activity">
            <AgentActivityTable events={events} resources={resources} />
          </TabsContent>
          {!context ? (
            <TabsContent className="mt-5" value="settings">
              <div className="detailFlatRows">
                <div className="detailFlatRow">
                  <div>
                    <strong>{tt('Retire Agent')}</strong>
                    <span>
                      {tt('Permanently ends active installations and grants while preserving audit history.')}
                    </span>
                  </div>
                  <span>{agent.status === 'retired' ? tt('Already retired') : tt('Active')}</span>
                  <Button
                    disabled={agent.status === 'retired'}
                    onClick={() => setRetireOpen(true)}
                    variant="destructive"
                  >
                    <Trash2 />
                    {tt('Retire')}
                  </Button>
                </div>
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
      <DestructiveConfirmation
        confirmLabel={retire.isPending ? tt('Retiring…') : tt('Retire Agent')}
        description={tt(
          'Installations, active grants, and pending requests stop working immediately. The stable subject remains reserved.',
        )}
        error={<MutationError error={retire.error} />}
        onClose={() => setRetireOpen(false)}
        onConfirm={() => retire.mutate()}
        open={retireOpen}
        pending={retire.isPending}
        title={tt('Retire {{name}}?', { name: agent.name })}
      />
    </>
  )
}

function agentTabLabel(value: AgentDetailSection) {
  return {
    overview: 'Overview',
    hosts: 'Installations',
    roles: 'Roles',
    requests: 'Access requests',
    grants: 'Access grants',
    activity: 'Activity',
    settings: 'Settings',
  }[value]
}

function DetailRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="detailFlatRows">
      {rows.map(([label, value]) => (
        <div className="detailFlatRow" key={label}>
          <div>
            <strong>{tt(label)}</strong>
          </div>
          <span>{value}</span>
          <i />
        </div>
      ))}
    </div>
  )
}

function AgentInstallationsTable({ items }: { items: Awaited<ReturnType<typeof listAgentInstallations>>['items'] }) {
  return (
    <DetailTable
      headers={['Installation', 'Credential', 'Status', 'Last seen']}
      rows={items.map((host) => ({
        id: host.id,
        cells: [
          <div key="host">
            <strong>{host.name}</strong>
            <span className="block font-mono text-xs text-muted-foreground">{host.id}</span>
          </div>,
          host.credentialType === 'remote_jwks' ? tt('Remote JWKS') : tt('Public key'),
          <Badge key="status" variant={host.status === 'active' ? 'secondary' : 'outline'}>
            {host.status}
          </Badge>,
          host.lastSeenAt ? new Date(host.lastSeenAt).toLocaleString() : tt('Never'),
        ],
      }))}
      emptyDescription="No installations have been authorized for this Agent yet."
      emptyTitle="No installations"
    />
  )
}

function AgentRolesTable({ items }: { items: Awaited<ReturnType<typeof listAgentRoles>>['items'] }) {
  return (
    <DetailTable
      headers={['Role', 'Description']}
      rows={items.map((role) => ({
        id: role.id,
        cells: [
          <div key="role">
            <strong>{role.name}</strong>
            <span className="block font-mono text-xs text-muted-foreground">{role.key}</span>
          </div>,
          role.description ?? tt('No description'),
        ],
      }))}
      emptyDescription="This Agent has no effective Role assignments."
      emptyTitle="No effective Roles"
    />
  )
}

function AgentRequestsTable({ items }: { items: Awaited<ReturnType<typeof listAgentAccessRequests>>['items'] }) {
  return (
    <DetailTable
      emptyDescription="No resource access requests have been submitted for this Agent."
      emptyTitle="No access requests"
      headers={['Request', 'Target', 'Scopes', 'Status', 'Created']}
      rows={items.map((request) => ({
        id: request.id,
        cells: [
          <span className="font-mono text-xs" key="request">
            {request.id}
          </span>,
          <div key="resource">
            <strong>{request.resource.name}</strong>
            <span className="block font-mono text-xs text-muted-foreground">{request.resource.identifier}</span>
          </div>,
          <ScopeList key="scopes" scopes={request.scopes} />,
          <Badge key="status" variant={request.status === 'pending' ? 'secondary' : 'outline'}>
            {request.status}
          </Badge>,
          new Date(request.createdAt).toLocaleString(),
        ],
      }))}
    />
  )
}

function AgentGrantsTable({ items }: { items: Awaited<ReturnType<typeof listAgentAccessGrants>>['items'] }) {
  return (
    <DetailTable
      emptyDescription="This Agent has no active resource access grants."
      emptyTitle="No active access grants"
      headers={['Target', 'Scopes', 'Lifetime', 'Status']}
      rows={items.map((grant) => ({
        id: grant.id,
        cells: [
          <div key="resource">
            <strong>{grant.resource.name}</strong>
            <span className="block font-mono text-xs text-muted-foreground">{grant.resource.identifier}</span>
          </div>,
          <ScopeList key="scopes" scopes={grant.scopes} />,
          grant.mode === 'until' && grant.expiresAt
            ? tt('Until {{date}}', { date: new Date(grant.expiresAt).toLocaleString() })
            : grant.mode === 'once'
              ? tt('One use')
              : tt('Until revoked'),
          <Badge key="status" variant="secondary">
            {grant.status}
          </Badge>,
        ],
      }))}
    />
  )
}

function AgentActivityTable({
  events,
  resources,
}: {
  events: Awaited<ReturnType<typeof getAgentAuditEvents>>['items']
  resources: Map<string, { id: string; name: string; identifier: string }>
}) {
  const rows = events.map((event) => ({
    id: event.id,
    cells: [
      agentEventLabel(event.action, event.result),
      <Badge key="result" variant={event.result === 'allowed' ? 'secondary' : 'outline'}>
        {tt(agentResultLabel(event.result))}
      </Badge>,
      <AgentEventTarget
        key="target"
        resource={event.resourceId ? resources.get(event.resourceId) : undefined}
        resourceId={event.resourceId}
      />,
      new Date(event.occurredAt).toLocaleString(),
    ],
  }))
  return (
    <DetailTable
      emptyDescription="No Agent activity has been recorded yet."
      emptyTitle="No Agent activity"
      headers={['Event', 'Result', 'Target', 'Time']}
      rows={rows}
    />
  )
}

function AgentEventTarget({
  resource,
  resourceId,
}: {
  resource?: { id: string; name: string; identifier: string }
  resourceId: string | null
}) {
  if (!resourceId) return tt('Realmroot')
  if (!resource) return <code className="text-xs">{resourceId}</code>
  return (
    <div>
      <strong>{resource.name}</strong>
      <span className="block font-mono text-xs text-muted-foreground">{resource.identifier}</span>
    </div>
  )
}

function agentEventLabel(action: string, result: string) {
  if (action === 'agent.identity_enrolled') return tt('Agent enrolled')
  if (action === 'agent.identity_recovered') return tt('Agent recovered')
  if (action === 'agent.identity_retired') return tt('Agent retired')
  if (action === 'agent.host_revoked') return tt('Host revoked')
  if (action === 'agent.capability_decided') {
    return result === 'denied' ? tt('Agent permissions denied') : tt('Agent permissions approved')
  }
  if (action === 'api_resource.access_requested') return tt('Resource access requested')
  if (action === 'api_resource.access_decided') {
    return result === 'denied' ? tt('Resource access denied') : tt('Resource access approved')
  }
  if (action === 'api_resource.access_revoked') return tt('Resource access revoked')
  if (action === 'api_resource.token_issued') return tt('Access token issued')
  return action
}

function agentResultLabel(result: 'allowed' | 'denied' | 'pending') {
  return { allowed: 'Allowed', denied: 'Denied', pending: 'Pending' }[result]
}

function ScopeList({ scopes }: { scopes: string[] }) {
  return (
    <div className="flex max-w-80 flex-wrap gap-1">
      {scopes.map((scope) => (
        <Badge key={scope} variant="outline">
          {scope}
        </Badge>
      ))}
    </div>
  )
}

function DetailTable({
  emptyDescription,
  emptyTitle,
  headers,
  rows,
}: {
  emptyDescription: string
  emptyTitle: string
  headers: string[]
  rows: Array<{ id: string; cells: ReactNode[] }>
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{tt(header)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.cells.map((cell, index) => (
                  <TableCell key={`${row.id}:${headers[index]}`}>{cell}</TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableEmptyRow colSpan={headers.length} description={emptyDescription} title={emptyTitle} />
          )}
        </TableBody>
      </Table>
    </div>
  )
}
