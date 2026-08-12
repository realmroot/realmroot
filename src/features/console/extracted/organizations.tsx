import { createOrganizationRequestSchema } from '@shared/api/authorization'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SimpleCreateDialog } from '@/features/management/create-dialogs'
import { StatusBadge } from '@/features/management/dialogs'
import { ListToolbar, ResourcePage } from '@/features/management/resource-components'
import { formatDate, parseForm, useAdminMutation } from '@/features/management/utils'
import {
  consoleQueryKeys,
  createOrganization,
  getAgentInventory,
  listOrganizationMembers,
  listOrganizations,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'

export function OrganizationsPage() {
  const router = useRouter()
  const query = useQuery({
    queryKey: consoleQueryKeys.organizations,
    queryFn: listOrganizations,
  })
  const queryClient = useQueryClient()
  const agentsQuery = useQuery({ queryKey: consoleQueryKeys.agents, queryFn: () => getAgentInventory() })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createOrganization,
    onSuccess: async () => {
      setDialogOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: consoleQueryKeys.organizations }),
        router.invalidate(),
      ])
    },
  })
  const organizations = query.data?.items ?? []
  const visibleOrganizations = organizations.filter((organization) =>
    [organization.name, organization.slug, organization.displayName ?? ''].some((value) =>
      value.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  )
  return (
    <ResourcePage
      title={tt('Organizations')}
      description={tt('Review shared identity spaces, membership scale, ownership, and lifecycle across this Realm.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('Provision organization')}{' '}
        </Button>
      }
      auxiliary={
        <SimpleCreateDialog
          description={tt('Create a shared identity and authorization context for a team, household, or group.')}
          error={createMutation.errorMessage}
          fields={[
            ['slug', 'Slug'],
            ['name', 'Name'],
          ]}
          onClose={() => setDialogOpen(false)}
          onSubmit={(form) => createMutation.mutate(parseForm(createOrganizationRequestSchema, form))}
          open={dialogOpen}
          pending={createMutation.isPending}
          title={tt('Provision organization')}
        />
      }
      error={query.error ?? agentsQuery.error}
      empty={organizations.length === 0}
      emptyDescription="Provision an Organization when people need a shared identity and authorization context."
      emptyTitle="No organizations yet"
      loading={query.isLoading || agentsQuery.isLoading}
      onRetry={() => Promise.all([query.refetch(), agentsQuery.refetch()])}
      tableToolbar={
        <ListToolbar>
          <TextInput
            aria-label={tt('Search organizations')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search organizations')}
            value={search}
          />
        </ListToolbar>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Organization')}</TableHead>
            <TableHead>{tt('Members')}</TableHead>
            <TableHead>{tt('Agents')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
            <TableHead>{tt('Updated')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleOrganizations.length ? (
            visibleOrganizations.map((organization) => (
              <TableRow key={organization.id}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    params={{ organizationId: organization.id }}
                    to="/organizations/$organizationId/overview"
                  >
                    {organization.displayName ?? organization.name}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">{organization.id}</div>
                </TableCell>
                <TableCell>
                  <OrganizationMemberCount organizationId={organization.id} />
                </TableCell>
                <TableCell>
                  {
                    (agentsQuery.data?.items ?? []).filter(
                      (agent) =>
                        agent.homeSpace.type === 'organization' && agent.homeSpace.organizationId === organization.id,
                    ).length
                  }
                </TableCell>
                <TableCell>
                  <StatusBadge active={!organization.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
                </TableCell>
                <TableCell>{formatDate(organization.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <Link
                    aria-label={tt('Open {{name}}', { name: organization.name })}
                    params={{ organizationId: organization.id }}
                    to="/organizations/$organizationId/overview"
                  >
                    →
                  </Link>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={6}
              description={
                search
                  ? tt('No organizations match the current search.')
                  : tt('Create organizations for shared membership and authority contexts.')
              }
              title={search ? tt('No organizations found') : tt('No organizations yet')}
            />
          )}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}

function OrganizationMemberCount({ organizationId }: { organizationId: string }) {
  const query = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId, 'members'],
    queryFn: () => listOrganizationMembers(organizationId),
  })
  if (query.isLoading) return <span className="text-muted-foreground">—</span>
  if (query.error) return <span className="text-destructive">{tt('Unavailable')}</span>
  return <>{query.data?.pagination.total ?? 0}</>
}
