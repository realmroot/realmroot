import { useQuery } from '@tanstack/react-query'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState, LoadingState } from '@/features/console/helpers/helpers-dialogs'
import { consoleQueryKeys, getAgentAuditEvents } from '@/lib/api/management'
import { tt } from '@/lib/i18n'

export function OrganizationActivityPage({ organizationId }: { organizationId: string }) {
  const query = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId, 'activity'],
    queryFn: () => getAgentAuditEvents({ organizationId }),
  })
  if (query.isLoading) return <LoadingState label={tt('Loading Organization activity')} />
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const events = query.data?.items ?? []
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Event')}</TableHead>
            <TableHead>{tt('Result')}</TableHead>
            <TableHead>{tt('Target')}</TableHead>
            <TableHead>{tt('Time')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length ? (
            events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <span className="font-medium">{event.action}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{event.id}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={event.result === 'allowed' ? 'secondary' : 'outline'}>{event.result}</Badge>
                </TableCell>
                <TableCell>{event.resourceId ?? tt('Realmroot')}</TableCell>
                <TableCell>{new Date(event.occurredAt).toLocaleString()}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={4}
              description={tt('Organization and Agent audit events will appear here.')}
              title={tt('No recent activity')}
            />
          )}
        </TableBody>
      </Table>
    </div>
  )
}
