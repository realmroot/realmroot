import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Search, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState, LoadingState, MutationError } from '@/features/management/dialogs'
import { navigateConsoleTab } from '@/features/management/resource-components'
import {
  activateAgent,
  consoleQueryKeys,
  deactivateAgent,
  deleteAgent,
  deleteAgentScopeEntitlement,
  getAgent,
  getAgentAuditEvents,
  listAgentAccessRequests,
  listAgentInstallations,
  listAgentScopeEntitlements,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'

export type AgentDetailSection = 'overview' | 'hosts' | 'requests' | 'grants' | 'activity' | 'settings'

export function AgentDetailPage({
  agentId,
  organizationId,
  section = 'overview',
}: {
  agentId: string
  organizationId?: string
  section?: AgentDetailSection
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<AgentDetailSection>(section)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [revokeEntitlementId, setRevokeEntitlementId] = useState<string | null>(null)
  const [selectedGrantResourceId, setSelectedGrantResourceId] = useState('')
  const agentQuery = useQuery({ queryKey: [...consoleQueryKeys.agents, agentId], queryFn: () => getAgent(agentId) })
  const hosts = useQuery({
    queryKey: [...consoleQueryKeys.agents, agentId, 'hosts'],
    queryFn: () => listAgentInstallations(agentId, { limit: 100 }),
  })
  const requests = useQuery({
    queryKey: [...consoleQueryKeys.agents, agentId, 'requests'],
    queryFn: () => listAgentAccessRequests({ agentId, limit: 100 }),
  })
  const grantInventory = useQuery({
    queryKey: [...consoleQueryKeys.agents, agentId, 'grants', 'resources'],
    queryFn: () => listAgentScopeEntitlements(agentId, { limit: 100 }),
  })
  const grantResources = useMemo(() => {
    const resources = new Map<string, { id: string; name: string; identifier: string }>()
    for (const entitlement of grantInventory.data?.items ?? []) {
      resources.set(entitlement.resource.id, entitlement.resource)
    }
    return [...resources.values()]
  }, [grantInventory.data?.items])
  const grants = useQuery({
    enabled: selectedGrantResourceId.length > 0,
    queryKey: [...consoleQueryKeys.agents, agentId, 'grants', { resourceId: selectedGrantResourceId }],
    queryFn: () =>
      listAgentScopeEntitlements(agentId, {
        limit: 100,
        resourceId: selectedGrantResourceId,
      }),
  })
  const audit = useQuery({
    queryKey: [...consoleQueryKeys.agents, agentId, 'audit', { organizationId }],
    queryFn: () => getAgentAuditEvents({ agentId, organizationId }),
  })
  const agent = agentQuery.data?.agent
  const deletion = useMutation({
    mutationFn: () => deleteAgent(agentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: consoleQueryKeys.agents })
      setDeleteOpen(false)
      if (organizationId) {
        await navigate({
          params: { organizationId },
          search: {},
          to: '/organizations/$organizationId/agents',
        })
      } else {
        await navigate({ search: {}, to: '/console/agents' })
      }
    },
  })
  const activation = useMutation({
    mutationFn: (active: boolean) => (active ? activateAgent(agentId) : deactivateAgent(agentId)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: consoleQueryKeys.agents }),
  })
  const entitlementRevocation = useMutation({
    mutationFn: (entitlementId: string) => deleteAgentScopeEntitlement(agentId, entitlementId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...consoleQueryKeys.agents, agentId] })
      setRevokeEntitlementId(null)
    },
  })
  useEffect(() => {
    setTab(section)
  }, [section])
  useEffect(() => {
    if (grantResources.length === 0) {
      if (selectedGrantResourceId) setSelectedGrantResourceId('')
      return
    }
    if (!grantResources.some((resource) => resource.id === selectedGrantResourceId)) {
      setSelectedGrantResourceId(grantResources[0].id)
    }
  }, [grantResources, selectedGrantResourceId])

  const detailQueries = [agentQuery, hosts, requests, grantInventory, audit]
  if (detailQueries.some((query) => query.isLoading)) return <LoadingState label={tt('Loading Agent')} />
  const loadError = detailQueries.find((query) => query.error)?.error
  if (loadError)
    return <ErrorState error={loadError} onRetry={() => Promise.all(detailQueries.map((query) => query.refetch()))} />
  if (!agent) return <ErrorState error={new Error(tt('Agent not found.'))} />
  if (organizationId && (agent.owner.type !== 'organization' || agent.owner.id !== organizationId)) {
    return <ErrorState error={new Error(tt('Agent does not belong to this Organization.'))} />
  }
  const events = (audit.data?.items ?? []).filter((event) => event.agentIdentityId === agent.id)
  const resources = new Map(
    [...(requests.data?.items ?? []), ...(grantInventory.data?.items ?? [])].map((item) => [
      item.resource.id,
      item.resource,
    ]),
  )
  const owner = `${agent.owner.displayName} · ${agent.owner.id}`
  const tabs: AgentDetailSection[] = ['overview', 'hosts', 'requests', 'grants', 'activity', 'settings']

  return (
    <>
      <div className="consoleDetailStack">
        {organizationId ? (
          <Link className="consoleBackLink" params={{ organizationId }} to="/organizations/$organizationId/agents">
            <ArrowLeft />
            {tt('Agents')}
          </Link>
        ) : (
          <Link className="consoleBackLink" to="/console/agents">
            <ArrowLeft />
            {tt('Agents')}
          </Link>
        )}
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
            navigateConsoleTab(
              navigate,
              organizationId
                ? `/organizations/${organizationId}/agents/${agentId}/${next}`
                : `/console/agents/${agentId}/${next}`,
            )
          }}
          value={tab}
        >
          <TabsList className="w-full" variant="navigation">
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
                ['Pending access requests', agent.pendingRequestCount.toLocaleString()],
                ['Active Resources', agent.activeResourceCount.toLocaleString()],
                ['Active scopes', agent.activeScopeCount.toLocaleString()],
                ['Created', new Date(agent.createdAt).toLocaleString()],
                ['Last updated', new Date(agent.updatedAt).toLocaleString()],
              ]}
            />
          </TabsContent>
          <TabsContent className="mt-5" value="hosts">
            <AgentInstallationsTable items={hosts.data?.items ?? []} />
          </TabsContent>
          <TabsContent className="mt-5" value="requests">
            <AgentRequestsTable items={requests.data?.items ?? []} />
          </TabsContent>
          <TabsContent className="mt-5" value="grants">
            <AgentGrantsPanel
              error={grants.error}
              items={grants.data?.items ?? []}
              loading={grants.isLoading}
              onRevoke={setRevokeEntitlementId}
              onResourceChange={setSelectedGrantResourceId}
              onRetry={() => {
                void grants.refetch()
              }}
              resources={grantResources}
              revoking={entitlementRevocation.isPending}
              selectedResourceId={selectedGrantResourceId}
              total={grants.data?.pagination.total ?? 0}
            />
          </TabsContent>
          <TabsContent className="mt-5" value="activity">
            <AgentActivityTable events={events} resources={resources} />
          </TabsContent>
          <TabsContent className="mt-5" value="settings">
            <div className="detailFlatRows">
              <div className="detailFlatRow">
                <div>
                  <strong>{tt('Agent status')}</strong>
                  <span>{tt('Inactive Agents remain visible but cannot authenticate or use authority.')}</span>
                </div>
                <span>{tt(agent.status === 'active' ? 'Active' : 'Inactive')}</span>
                <Button
                  disabled={activation.isPending}
                  onClick={() => activation.mutate(agent.status !== 'active')}
                  variant="outline"
                >
                  {tt(agent.status === 'active' ? 'Deactivate' : 'Activate')}
                </Button>
              </div>
              <div className="detailFlatRow">
                <div>
                  <strong>{tt('Delete Agent')}</strong>
                  <span>{tt('Permanently hides the Agent and revokes installations and grants.')}</span>
                </div>
                <span>{tt('Cannot be restored')}</span>
                <Button onClick={() => setDeleteOpen(true)} variant="destructive">
                  <Trash2 />
                  {tt('Delete')}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
      <DestructiveConfirmation
        confirmLabel={entitlementRevocation.isPending ? tt('Revoking…') : tt('Revoke scope')}
        description={tt('This scope stops applying immediately. Existing audit history is preserved.')}
        error={<MutationError error={entitlementRevocation.error} />}
        onClose={() => setRevokeEntitlementId(null)}
        onConfirm={() => entitlementRevocation.mutate(revokeEntitlementId!)}
        open={revokeEntitlementId !== null}
        pending={entitlementRevocation.isPending}
        title={tt('Revoke scope?')}
      />
      <DestructiveConfirmation
        confirmLabel={deletion.isPending ? tt('Deleting…') : tt('Delete Agent')}
        description={tt(
          'The Agent disappears from every interface. Installations, active grants, and pending requests stop immediately, and it cannot be restored.',
        )}
        error={<MutationError error={deletion.error} />}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deletion.mutate()}
        open={deleteOpen}
        pending={deletion.isPending}
        title={tt('Delete {{name}}?', { name: agent.name })}
      />
    </>
  )
}

function agentTabLabel(value: AgentDetailSection) {
  return {
    overview: 'Overview',
    hosts: 'Installations',
    requests: 'Access requests',
    grants: 'Resource access',
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

function AgentGrantsPanel({
  error,
  items,
  loading,
  onResourceChange,
  onRetry,
  onRevoke,
  resources,
  revoking,
  selectedResourceId,
  total,
}: {
  error: Error | null
  items: Awaited<ReturnType<typeof listAgentScopeEntitlements>>['items']
  loading: boolean
  onResourceChange: (resourceId: string) => void
  onRetry: () => void
  onRevoke: (entitlementId: string) => void
  resources: Array<{ id: string; name: string; identifier: string }>
  revoking: boolean
  selectedResourceId: string
  total: number
}) {
  const [resourceSearch, setResourceSearch] = useState('')
  if (resources.length === 0) {
    return <AgentGrantsTable items={[]} onRevoke={onRevoke} revoking={revoking} />
  }
  const selectedResource = resources.find((resource) => resource.id === selectedResourceId) ?? resources[0]
  const normalizedSearch = resourceSearch.trim().toLowerCase()
  const visibleResources = resources.filter((resource) =>
    [resource.name, resource.identifier].some((value) => value.toLowerCase().includes(normalizedSearch)),
  )

  return (
    <div className="grid min-h-[24rem] border-b md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="min-w-0 border-b md:border-r md:border-b-0">
        <div className="border-b px-3 py-2.5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="font-medium">{tt('Resource Servers')}</h2>
            <span className="text-xs tabular-nums text-muted-foreground">{resources.length.toLocaleString()}</span>
          </div>
          <label className="sr-only" htmlFor="agent-resource-search">
            {tt('Search Resource Servers')}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label={tt('Search Resource Servers')}
              className="pl-8"
              id="agent-resource-search"
              onChange={(event) => setResourceSearch(event.target.value)}
              placeholder={tt('Search by name or identifier')}
              value={resourceSearch}
            />
          </div>
        </div>
        <nav aria-label={tt('Resource Servers')} className="max-h-56 overflow-y-auto p-1.5 md:max-h-[28rem]">
          {visibleResources.length ? (
            visibleResources.map((resource) => (
              <button
                aria-current={resource.id === selectedResourceId ? 'true' : undefined}
                className="block min-h-12 w-full border-l-2 border-transparent px-2.5 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:border-primary data-[active=true]:bg-muted"
                data-active={resource.id === selectedResourceId}
                key={resource.id}
                onClick={() => onResourceChange(resource.id)}
                type="button"
              >
                <span className="line-clamp-2 break-words text-sm font-medium leading-snug">{resource.name}</span>
                <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                  {resource.identifier}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{tt('No matching Resource Servers.')}</p>
          )}
        </nav>
      </aside>
      <section className="min-w-0">
        <header className="flex min-h-16 flex-col justify-center border-b px-4 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <h2 className="break-words font-semibold leading-tight">{selectedResource.name}</h2>
              <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                {selectedResource.identifier}
              </span>
            </div>
            {!loading && !error ? (
              <span className="text-sm text-muted-foreground">
                {tt('{{count}} scope Entitlements', { count: total })}
              </span>
            ) : null}
          </div>
        </header>
        <div className="px-4 py-3">
          {loading ? (
            <LoadingState label={tt('Loading Resource access')} />
          ) : error ? (
            <ErrorState error={error} onRetry={onRetry} />
          ) : (
            <AgentGrantsTable flat items={items} onRevoke={onRevoke} revoking={revoking} />
          )}
        </div>
      </section>
    </div>
  )
}

function AgentGrantsTable({
  flat = false,
  items,
  onRevoke,
  revoking,
}: {
  flat?: boolean
  items: Awaited<ReturnType<typeof listAgentScopeEntitlements>>['items']
  onRevoke: (entitlementId: string) => void
  revoking: boolean
}) {
  return (
    <DetailTable
      emptyDescription="This Agent has no Resource access."
      emptyTitle="No Resource access"
      flat={flat}
      headers={['Scope', 'Source', 'Lifetime', 'Status', '']}
      rows={items.map((entitlement) => ({
        id: entitlement.id,
        cells: [
          <span className="font-mono text-sm" key="scope">
            {entitlement.scope}
          </span>,
          entitlement.sourceAccessRequestId ? tt('Access request') : tt('Direct'),
          entitlement.mode === 'until' && entitlement.expiresAt
            ? tt('Until {{date}}', { date: new Date(entitlement.expiresAt).toLocaleString() })
            : entitlement.mode === 'once'
              ? tt('One use')
              : tt('Until revoked'),
          <Badge key="status" variant="secondary">
            {entitlement.status}
          </Badge>,
          entitlement.status === 'active' ? (
            <Button
              disabled={revoking}
              key="revoke"
              onClick={() => onRevoke(entitlement.id)}
              size="sm"
              variant="outline"
            >
              {tt('Revoke')}
            </Button>
          ) : null,
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
  if (action === 'agent.identity_deleted') return tt('Agent deleted')
  if (action === 'agent.identity_activated') return tt('Agent activated')
  if (action === 'agent.identity_deactivated') return tt('Agent deactivated')
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
  flat = false,
  headers,
  rows,
}: {
  emptyDescription: string
  emptyTitle: string
  flat?: boolean
  headers: string[]
  rows: Array<{ id: string; cells: ReactNode[] }>
}) {
  return (
    <div className={flat ? 'overflow-x-auto' : 'overflow-hidden rounded-xl border'}>
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
