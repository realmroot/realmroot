import type { ManagementAgent } from '@shared/api/agent-api'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { SelectInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { consoleQueryKeys, getAgentInventory } from '@/lib/api/management'
import { useConsoleScope } from '@/lib/console-context'
import { tt } from '@/lib/i18n'
import { ListToolbar, ResourcePage } from '../helpers/helpers-resource'

export function AgentsPage() {
  const { organizationId: context } = useConsoleScope()
  const [search, setSearch] = useState('')
  const [ownerType, setOwnerType] = useState('any')
  const [status, setStatus] = useState('any')
  const query = useQuery({
    queryKey: [...consoleQueryKeys.agents, { organizationId: context }],
    queryFn: () => getAgentInventory({ organizationId: context }),
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
        context
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
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tt('Search Agents')}
              value={search}
            />
          </InputGroup>
          {context ? null : (
            <SelectInput
              aria-label={tt('Filter owner type')}
              onChange={(event) => setOwnerType(event.target.value)}
              value={ownerType}
            >
              <option value="any">{tt('Any owner type')}</option>
              <option value="user">{tt('User')}</option>
              <option value="organization">{tt('Organization')}</option>
            </SelectInput>
          )}
          <SelectInput
            aria-label={tt('Filter Agent status')}
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="any">{tt('Any status')}</option>
            <option value="active">{tt('Active')}</option>
            <option value="retired">{tt('Retired')}</option>
          </SelectInput>
        </ListToolbar>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Agent')}</TableHead>
            <TableHead>{tt('Access grants')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
            <TableHead>{tt('Owner')}</TableHead>
            <TableHead>{tt('Updated')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.length ? (
            agents.map((agent) => <AgentRow agent={agent} context={context} key={agent.id} />)
          ) : (
            <TableEmptyRow
              colSpan={6}
              description={tt('Agents appear after enrollment approval.')}
              title={tt('No Agents found')}
            />
          )}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}

function AgentRow({ agent, context }: { agent: ManagementAgent; context?: string }) {
  return (
    <TableRow className="cursor-pointer">
      <TableCell>
        {context ? (
          <Link
            className="block"
            params={{ agentId: agent.id, organizationId: context }}
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
      <TableCell>{agent.activeGrantCount.toLocaleString()}</TableCell>
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
        {context ? (
          <Link
            aria-label={tt('Open {{name}}', { name: agent.name })}
            params={{ agentId: agent.id, organizationId: context }}
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
