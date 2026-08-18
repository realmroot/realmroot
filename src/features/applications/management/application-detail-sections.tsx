import type { OrganizationResponse } from '@shared/api/authorization'
import { Link } from '@tanstack/react-router'
import { clientTypeLabel, StatusBadge } from '@/features/management/dialogs'
import { ownerLabel } from '@/features/management/ownership-controls'
import {
  type ApplicationResponse,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MoreHorizontal,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  tt,
} from '@/features/management/shared'
export function ApplicationsTableContent({
  applications,
  emptyDescription,
  emptyTitle,
  hasApplications,
  onToggleDisabled,
  organizations,
  organizationId,
}: {
  applications: ApplicationResponse[]
  emptyDescription: string
  emptyTitle: string
  hasApplications: boolean
  onToggleDisabled: (application: ApplicationResponse) => void
  organizations: OrganizationResponse[]
  organizationId?: string
}) {
  if (!applications.length && hasApplications) {
    return (
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[27%]">{tt('Application')}</TableHead>
            <TableHead className="w-[19%]">{tt('Type')}</TableHead>
            <TableHead className="w-[15%]">{tt('Resource access')}</TableHead>
            <TableHead className="w-[10%]">{tt('Status')}</TableHead>
            <TableHead className="w-[16%]">{tt('Owner')}</TableHead>
            <TableHead className="w-[11%]">{tt('Updated')}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmptyRow colSpan={7} description={emptyDescription} title={emptyTitle} />
        </TableBody>
      </Table>
    )
  }
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[27%]">{tt('Application')}</TableHead>
          <TableHead className="w-[19%]">{tt('Type')}</TableHead>
          <TableHead className="w-[15%]">{tt('Resource access')}</TableHead>
          <TableHead className="w-[10%]">{tt('Status')}</TableHead>
          <TableHead className="w-[16%]">{tt('Owner')}</TableHead>
          <TableHead className="w-[11%]">{tt('Updated')}</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {applications.length ? (
          applications.map((application) => (
            <TableRow key={application.id}>
              <TableCell className="min-w-0">
                {organizationId ? (
                  <Link
                    className="block truncate font-medium hover:underline"
                    params={{ applicationId: application.id, organizationId }}
                    to="/organizations/$organizationId/applications/$applicationId"
                  >
                    {application.name}
                  </Link>
                ) : (
                  <Link
                    className="block truncate font-medium hover:underline"
                    params={{ applicationId: application.id }}
                    to="/console/applications/$applicationId"
                  >
                    {application.name}
                  </Link>
                )}
                <div className="truncate font-mono text-xs text-muted-foreground" title={application.clientId}>
                  {application.clientId}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{clientTypeLabel(application.clientType)}</Badge>
                </div>
                <div
                  className="mt-1 truncate text-xs text-muted-foreground"
                  title={application.allowedGrantTypes.join(', ')}
                >
                  {application.allowedGrantTypes.join(', ')}
                </div>
              </TableCell>
              <TableCell>{tt('{{count}} Resource Servers', { count: application.resourceScopes.length })}</TableCell>
              <TableCell>
                <StatusBadge active={!application.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
              </TableCell>
              <TableCell className="truncate" title={ownerLabel(application.ownerOrganizationId, organizations)}>
                {ownerLabel(application.ownerOrganizationId, organizations)}
              </TableCell>
              <TableCell>{new Date(application.updatedAt).toLocaleDateString()}</TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger aria-label={`Actions for ${application.name}`}>
                    <MoreHorizontal data-icon="inline-start" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => onToggleDisabled(application)}>
                        {application.disabled ? 'Enable' : 'Disable'}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableEmptyRow
            colSpan={7}
            description={tt('Create your first OIDC client to connect an application to hosted authentication.')}
            title={tt('No applications yet')}
          />
        )}
      </TableBody>
    </Table>
  )
}
