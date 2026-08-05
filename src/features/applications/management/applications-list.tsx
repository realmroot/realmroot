import { CreateApplicationDialog } from '@/features/management/create-dialogs'
import { MutationError } from '@/features/management/dialogs'
import { organizationOptions } from '@/features/management/ownership-controls'
import { ListToolbar, ResourcePage } from '@/features/management/resource-components'
import {
  Button,
  Plus,
  SelectInput,
  TextInput,
  tt,
  useEffect,
  useQuery,
  useQueryClient,
  useState,
} from '@/features/management/shared'
import { useAdminMutation } from '@/features/management/utils'
import {
  consoleQueryKeys,
  createApplication,
  listApplications,
  listOrganizations,
  listUsers,
  updateApplication,
} from '@/lib/api/management'
import { ApplicationsTableContent } from './application-detail-sections'

export function ApplicationsPage({ organizationId }: { organizationId?: string } = {}) {
  const [owner, setOwner] = useState(organizationId ?? '')
  const query = useQuery({
    queryKey: [...consoleQueryKeys.applications, { ownerOrganizationId: owner || undefined }],
    queryFn: () => listApplications({ ownerOrganizationId: owner || undefined }),
  })
  const organizationsQuery = useQuery({
    queryKey: consoleQueryKeys.organizations,
    queryFn: listOrganizations,
  })
  const usersQuery = useQuery({
    queryKey: [...consoleQueryKeys.users, { limit: 100, organizationId, purpose: 'application-audience' }],
    queryFn: () => listUsers({ limit: 100, organizationId }),
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [audience, setAudience] = useState('')
  useEffect(() => setOwner(organizationId ?? ''), [organizationId])
  const createMutation = useAdminMutation({
    mutationFn: createApplication,
    onSuccess: () => {
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQueryKeys.applications,
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQueryKeys.readiness,
        }),
      ])
    },
  })
  const toggleMutation = useAdminMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => updateApplication(id, { disabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: consoleQueryKeys.applications }),
  })
  const applications = query.data?.applications ?? []
  const visibleApplications = applications.filter((application) => {
    const matchesSearch =
      search.trim().length === 0 ||
      [application.name, application.clientId, application.slug].some((value) =>
        value.toLowerCase().includes(search.trim().toLowerCase()),
      )
    return (
      matchesSearch &&
      (!owner || application.ownerOrganizationId === owner) &&
      (!type || application.clientType === type) &&
      (!audience || application.audience.mode === audience)
    )
  })
  const organizations = organizationsQuery.data?.organizations ?? []
  const users = usersQuery.data?.users ?? []
  const owners = organizationOptions(organizations).sort((left, right) => left.label.localeCompare(right.label))
  return (
    <ResourcePage
      title={tt('Applications')}
      description={tt(
        organizationId
          ? 'Manage this Organization’s OIDC clients, redirect URIs, grant types, and client security posture.'
          : 'Manage OIDC clients, redirect URIs, grant types, and client security posture across this Realm.',
      )}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New application')}{' '}
        </Button>
      }
      auxiliary={
        <CreateApplicationDialog
          defaultOwnerOrganizationId={organizationId}
          fixedOwnerOrganizationId={organizationId}
          key={organizationId ?? 'realm'}
          organizations={organizations}
          users={users}
          createdApplication={createMutation.data ?? null}
          error={createMutation.errorMessage}
          onClose={() => {
            setDialogOpen(false)
            createMutation.reset()
          }}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          pending={createMutation.isPending}
        />
      }
      error={query.error ?? organizationsQuery.error ?? usersQuery.error}
      empty={applications.length === 0}
      emptyDescription="Create your first OIDC client to connect an application to hosted authentication."
      emptyTitle="No applications yet"
      loading={query.isLoading || organizationsQuery.isLoading || usersQuery.isLoading}
      onRetry={() => Promise.all([query.refetch(), organizationsQuery.refetch(), usersQuery.refetch()])}
      tableToolbar={
        <ListToolbar>
          <TextInput
            aria-label={tt('Search applications')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search applications')}
            value={search}
          />
          {organizationId ? null : (
            <SelectInput
              aria-label={tt('Filter owner')}
              onChange={(event) => setOwner(event.target.value)}
              value={owner}
            >
              <option value="">{tt('Any owner')}</option>
              {owners.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.label}
                </option>
              ))}
            </SelectInput>
          )}
          <SelectInput aria-label={tt('Filter type')} onChange={(event) => setType(event.target.value)} value={type}>
            <option value="">{tt('Any type')}</option>
            <option value="confidential_web">{tt('Web application')}</option>
            <option value="public_spa">{tt('Single-page app')}</option>
            <option value="public_native">{tt('Native application')}</option>
          </SelectInput>
          <SelectInput
            aria-label={tt('Filter audience')}
            onChange={(event) => setAudience(event.target.value)}
            value={audience}
          >
            <option value="">{tt('Any audience')}</option>
            <option value="realm">{tt('All Realm users')}</option>
            <option value="organizations">{tt('Selected Organizations')}</option>
            <option value="users">{tt('Assigned users')}</option>
            <option value="public">{tt('Anyone who can register')}</option>
          </SelectInput>
        </ListToolbar>
      }
    >
      <MutationError error={toggleMutation.error} />
      <ApplicationsTableContent
        applications={visibleApplications}
        organizationId={organizationId}
        organizations={organizations}
        emptyDescription={
          search || owner || type || audience
            ? 'No applications match the current filters.'
            : 'Create an OIDC client to connect an application.'
        }
        emptyTitle={search || owner || type || audience ? 'No applications found' : 'No applications yet'}
        hasApplications={applications.length > 0}
        onToggleDisabled={(application) =>
          toggleMutation.mutate({ id: application.id, disabled: !application.disabled })
        }
      />
    </ResourcePage>
  )
}
