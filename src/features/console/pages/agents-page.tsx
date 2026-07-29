import type { Agent } from '@shared/api/agent-api'
import type { AgentAuditEvent } from '@shared/api/agents'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ScrollText, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableEmptyRow, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { consoleQueryKeys, emergencyRetireAgent, getAgentAuditEvents, getAgentInventory } from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import { ResourcePage } from '../helpers/helpers-resource'
import { MetricCard } from './dashboard-page'

export function AgentsPage() {
  const queryClient = useQueryClient()
  const agentsQuery = useQuery({
    queryKey: consoleQueryKeys.agents,
    queryFn: getAgentInventory,
  })
  const auditQuery = useQuery({
    queryKey: [...consoleQueryKeys.agents, 'audit'],
    queryFn: getAgentAuditEvents,
  })
  const retireMutation = useMutation({
    mutationFn: emergencyRetireAgent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: consoleQueryKeys.agents }),
  })

  return (
    <ResourcePage
      description={tt('Govern stable Agents and review their authorization history.')}
      error={agentsQuery.error ?? auditQuery.error ?? retireMutation.error}
      framed={false}
      loading={agentsQuery.isLoading || auditQuery.isLoading}
      onRetry={() => Promise.all([agentsQuery.refetch(), auditQuery.refetch()])}
      title={tt('Agents')}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <MetricCard
            detail={tt('Stable Agent identities in this tenant.')}
            label={tt('Agents')}
            value={agentsQuery.data?.pagination.total ?? 0}
          />
          <MetricCard
            detail={tt('Recorded Agent authorization decisions.')}
            label={tt('Audit events')}
            value={auditQuery.data?.pagination.total ?? 0}
          />
        </div>
        <AgentTable
          agents={agentsQuery.data?.items ?? []}
          pending={retireMutation.isPending}
          retire={(id) => retireMutation.mutate(id)}
        />
        <AgentAuditTable events={auditQuery.data?.items ?? []} />
      </div>
    </ResourcePage>
  )
}

function AgentTable({ agents, pending, retire }: { agents: Agent[]; pending: boolean; retire: (id: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Stable Agents')}</CardTitle>
        <CardDescription>{tt('Protocol credentials and bindings remain internal to FlareAuth.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Agent')}</TableHead>
              <TableHead>{tt('Home space')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead>{tt('Emergency action')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.length ? (
              agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Bot className="size-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{agent.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {agent.issuer} · {agent.subject}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {agent.homeSpace.type === 'personal'
                      ? `User ${agent.homeSpace.userId}`
                      : `Organization ${agent.homeSpace.organizationId}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>{agent.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      disabled={pending || agent.status === 'retired'}
                      onClick={() => retire(agent.id)}
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
                colSpan={4}
                title={tt('No Agents.')}
                description={tt('Enrolled Agents will appear here.')}
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
        <CardDescription>{tt('Authorization decisions without credentials or request bodies.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Decision')}</TableHead>
              <TableHead>{tt('Agent')}</TableHead>
              <TableHead>{tt('Target')}</TableHead>
              <TableHead>{tt('Time')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length ? (
              events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ScrollText className="size-4 text-muted-foreground" />
                      <Badge variant={event.result === 'allowed' ? 'secondary' : 'outline'}>{event.result}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{event.action}</p>
                  </TableCell>
                  <TableCell>{event.agentIdentityId ?? tt('Unresolved')}</TableCell>
                  <TableCell>
                    {event.resourceId ?? tt('FlareAuth')}
                    {event.scopes?.length ? ` · ${event.scopes.join(' ')}` : null}
                  </TableCell>
                  <TableCell>{new Date(event.occurredAt).toLocaleString()}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={4}
                title={tt('No Agent audit events.')}
                description={tt('Agent authorization decisions will appear here.')}
              />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
