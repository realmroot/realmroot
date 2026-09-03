import type { ManagementAgent } from '@shared/api/agent-api'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { SelectInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ListToolbar, ResourcePage } from '@/features/management/resource-components'
import { consoleQueryKeys, getAgentInventory } from '@/lib/api/management'
import { tt } from '@/lib/i18n'

const pageSize = 20

export function AgentsPage({ organizationId }: { organizationId?: string } = {}) {
  const [search, setSearch] = useState('')
  const [ownerType, setOwnerType] = useState('any')
  const [status, setStatus] = useState('any')
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: [...consoleQueryKeys.agents, { organizationId, page, pageSize }],
    queryFn: () => getAgentInventory({ organizationId, page, pageSize }),
  })
  const agents = (query.data?.items ?? []).filter((agent) => {
    const type = agent.homeSpace.type === 'personal' ? 'user' : 'organization'
    return (
      `${agent.name} ${agent.issuer} ${agent.subject}`.toLowerCase().includes(search.toLowerCase()) &&
      (ownerType === 'any' || ownerType === type) &&
      (status === 'any' || agent.status === status)
    )
  })
  return (
    <ResourcePage
      description={tt(
        organizationId
          ? 'Review stable Agent identities belonging to this Organization.'
          : 'Review stable Agent identities belonging to people and Organizations across this Realm.',
      )}
      empty={agents.length === 0}
      emptyDescription={
        search ? tt('No Agents match the current filters.') : tt('Agents appear here after an enrollment is approved.')
      }
      emptyTitle={search ? tt('No Agents found') : tt('No Agents enrolled')}
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      title={tt('Agents')}
      tableToolbar={
        <ListToolbar>
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={tt('Search Agents')}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder={tt('Search Agents')}
              value={search}
            />
          </InputGroup>
          {organizationId ? null : (
            <SelectInput
              aria-label={tt('Filter owner type')}
              onChange={(event) => {
                setOwnerType(event.target.value)
                setPage(1)
              }}
              value={ownerType}
            >
              <option value="any">{tt('Any owner type')}</option>
              <option value="user">{tt('User')}</option>
              <option value="organization">{tt('Organization')}</option>
            </SelectInput>
          )}
          <SelectInput
            aria-label={tt('Filter Agent status')}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
            }}
            value={status}
          >
            <option value="any">{tt('Any status')}</option>
            <option value="active">{tt('Active')}</option>
            <option value="inactive">{tt('Inactive')}</option>
          </SelectInput>
        </ListToolbar>
      }
    >
      <div className="grid gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Agent')}</TableHead>
              <TableHead>{tt('Resource access')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead>{tt('Owner')}</TableHead>
              <TableHead>{tt('Updated')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.length ? (
              agents.map((agent) => <AgentRow agent={agent} organizationId={organizationId} key={agent.id} />)
            ) : (
              <TableEmptyRow
                colSpan={6}
                description={tt('Agents appear after enrollment approval.')}
                title={tt('No Agents found')}
              />
            )}
          </TableBody>
        </Table>
        {query.data && query.data.pagination.totalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 text-sm text-muted-foreground">
            <span>
              {tt('{{start}}–{{end}} of {{total}}', {
                start: (query.data.pagination.page - 1) * query.data.pagination.pageSize + 1,
                end: Math.min(
                  query.data.pagination.page * query.data.pagination.pageSize,
                  query.data.pagination.totalItems,
                ),
                total: query.data.pagination.totalItems,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                disabled={page === 1}
                onClick={() => setPage(Math.max(1, page - 1))}
                type="button"
                variant="secondary"
              >
                {tt('Previous')}
              </Button>
              <Button
                disabled={page >= query.data.pagination.totalPages}
                onClick={() => setPage(page + 1)}
                type="button"
                variant="secondary"
              >
                {tt('Next')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </ResourcePage>
  )
}

function AgentRow({ agent, organizationId }: { agent: ManagementAgent; organizationId?: string }) {
  return (
    <TableRow className="cursor-pointer">
      <TableCell>
        {organizationId ? (
          <Link
            className="block"
            params={{ agentId: agent.id, organizationId }}
            to="/organizations/$organizationId/agents/$agentId"
          >
            <strong>{agent.name}</strong>
            <span className="block max-w-60 truncate font-mono text-xs text-muted-foreground">
              {agent.issuer} · {agent.subject}
            </span>
          </Link>
        ) : (
          <Link className="block" params={{ agentId: agent.id }} to="/console/agents/$agentId">
            <strong>{agent.name}</strong>
            <span className="block max-w-60 truncate font-mono text-xs text-muted-foreground">
              {agent.issuer} · {agent.subject}
            </span>
          </Link>
        )}
      </TableCell>
      <TableCell>{agent.activeScopeCount.toLocaleString()}</TableCell>
      <TableCell>
        <Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>{agent.status}</Badge>
      </TableCell>
      <TableCell>
        <span className="block font-medium">{agent.owner.displayName}</span>
        <span className="block max-w-52 truncate text-xs text-muted-foreground">
          {agent.owner.type === 'organization' ? tt('Organization') : tt('User')} · <code>{agent.owner.id}</code>
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap">{new Date(agent.updatedAt).toLocaleDateString()}</TableCell>
      <TableCell className="text-right">
        {organizationId ? (
          <Link
            aria-label={tt('Open {{name}}', { name: agent.name })}
            params={{ agentId: agent.id, organizationId }}
            to="/organizations/$organizationId/agents/$agentId"
          >
            <ChevronRight className="ml-auto size-4 text-muted-foreground" />
          </Link>
        ) : (
          <Link
            aria-label={tt('Open {{name}}', { name: agent.name })}
            params={{ agentId: agent.id }}
            to="/console/agents/$agentId"
          >
            <ChevronRight className="ml-auto size-4 text-muted-foreground" />
          </Link>
        )}
      </TableCell>
    </TableRow>
  )
}
