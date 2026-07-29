import {
  consoleQueryKeys,
  createOrganization,
  getAgentInventory,
  getOrganization,
  listOrganizations,
  updateOrganization,
  uploadOrganizationLogo,
} from '@/lib/api/management'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  createOrganizationRequestSchema,
  type OrganizationDetailSection,
  Plus,
  SettingRow,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
  tt,
  Undo2,
  updateOrganizationRequestSchema,
  useEffect,
  useMutation,
  useNavigate,
  useQuery,
  useQueryClient,
  useState,
  type z,
} from '../console-shared'
import { SimpleCreateDialog } from '../helpers/helpers-create'
import { StatusBadge } from '../helpers/helpers-dialogs'
import { AssetUploadControl, AuthorizationForm } from '../helpers/helpers-forms'
import {
  DetailTabs,
  ListToolbar,
  navigateConsoleTab,
  ObjectHeader,
  organizationDetailTabs,
  ResourcePage,
} from '../helpers/helpers-resource'
import { formatDate, nullableString, parseForm, useAdminMutation } from '../helpers/helpers-utils'

export function OrganizationsPage() {
  const query = useQuery({
    queryKey: consoleQueryKeys.organizations,
    queryFn: listOrganizations,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createOrganization,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.organizations,
      })
    },
  })
  const logoMutation = useAdminMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => uploadOrganizationLogo(id, file),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.organizations,
      }),
  })
  const organizations = query.data?.organizations ?? []
  const visibleOrganizations = organizations.filter((organization) =>
    [organization.name, organization.slug, organization.displayName ?? ''].some((value) =>
      value.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  )
  return (
    <ResourcePage
      title={tt('Organizations')}
      description={tt('Manage tenant organizations. Teams are intentionally excluded from this console.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New organization')}{' '}
        </Button>
      }
      auxiliary={
        <SimpleCreateDialog
          error={createMutation.errorMessage}
          fields={[
            ['slug', 'Slug'],
            ['name', 'Name'],
            ['displayName', 'Display name'],
          ]}
          onClose={() => setDialogOpen(false)}
          onSubmit={(form) => createMutation.mutate(parseForm(createOrganizationRequestSchema, form))}
          open={dialogOpen}
          pending={createMutation.isPending}
          title={tt('Create organization')}
        />
      }
      error={query.error}
      empty={organizations.length === 0}
      emptyDescription="Create organizations when authorization needs tenant-owned groups."
      emptyTitle="No organizations yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      toolbar={
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
            <TableHead>{tt('Display name')}</TableHead>
            <TableHead>{tt('Logo')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleOrganizations.length ? (
            visibleOrganizations.map((organization) => (
              <TableRow key={organization.id}>
                <TableCell>
                  <a className="font-medium hover:underline" href={`/console/organizations/${organization.id}`}>
                    {organization.name}
                  </a>
                  <div className="text-xs text-muted-foreground">{organization.slug}</div>
                </TableCell>
                <TableCell>{organization.displayName ?? 'Not set'}</TableCell>
                <TableCell>
                  <AssetUploadControl
                    accept="image/png,image/jpeg,image/webp"
                    label={`Upload logo for ${organization.name}`}
                    onFile={(file) =>
                      logoMutation.mutate({
                        id: organization.id,
                        file,
                      })
                    }
                    previewUrl={organization.logo}
                  />
                </TableCell>
                <TableCell>
                  <StatusBadge active={!organization.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={4}
              description={
                search
                  ? tt('No organizations match the current search.')
                  : tt('Create organizations when authorization needs tenant-owned groups.')
              }
              title={search ? tt('No organizations found') : tt('No organizations yet')}
            />
          )}
        </TableBody>
      </Table>
      {logoMutation.errorMessage ? <p className="p-4 text-sm text-destructive">{logoMutation.errorMessage}</p> : null}
    </ResourcePage>
  )
}
export function OrganizationDetailPage({
  organizationId,
  section = 'settings',
}: {
  organizationId: string
  section?: OrganizationDetailSection
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedTab, setSelectedTab] = useState<OrganizationDetailSection>(section)
  const query = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId],
    queryFn: () => getOrganization(organizationId),
  })
  const agentsQuery = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId, 'agents'],
    queryFn: getAgentInventory,
  })
  const organization = query.data
  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof updateOrganizationRequestSchema>) => updateOrganization(organizationId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...consoleQueryKeys.organizations, organizationId], updated)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.organizations,
      })
    },
  })
  useEffect(() => setSelectedTab(section), [section])
  return (
    <ResourcePage
      title={organization?.name ?? tt('Organization')}
      description={tt('Review and update the organization record exposed by the existing authorization model.')}
      framed={false}
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      {organization ? (
        <div className="consoleDetailStack">
          <a className="consoleBackLink" href="/console/organizations">
            <Undo2 data-icon="inline-start" /> {tt('Back to organizations')}{' '}
          </a>
          <ObjectHeader
            badge={organization.disabled ? 'Disabled' : 'Enabled'}
            id={organization.slug}
            title={organization.name}
          />
          <DetailTabs
            label={tt('Organization detail sections')}
            onChange={(value) => {
              const next = value as OrganizationDetailSection
              setSelectedTab(next)
              navigateConsoleTab(navigate, `/console/organizations/${organizationId}/${next}`)
            }}
            tabs={organizationDetailTabs()}
            value={selectedTab}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            {selectedTab === 'settings' ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{tt('General')}</CardTitle>
                    <CardDescription>
                      {' '}
                      {tt('Team collaboration and invitation management are outside this console surface.')}{' '}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <AuthorizationForm
                      buttonLabel="Save organization"
                      defaults={{
                        slug: organization.slug,
                        name: organization.name,
                        displayName: organization.displayName ?? '',
                        disabledReason: organization.disabledReason ?? '',
                      }}
                      error={updateMutation.error}
                      fields={[
                        ['slug', 'Slug'],
                        ['name', 'Name'],
                        ['displayName', 'Display name'],
                        ['disabledReason', 'Disabled reason'],
                      ]}
                      onSubmit={(form) =>
                        updateMutation.mutate(
                          parseForm(updateOrganizationRequestSchema, {
                            ...form,
                            displayName: nullableString(form.displayName ?? ''),
                            disabledReason: nullableString(form.disabledReason ?? ''),
                          }),
                        )
                      }
                      pending={updateMutation.isPending}
                    />
                    <div className="mt-4">
                      <StatusBadge active={!organization.disabled} activeLabel="Enabled" inactiveLabel="Disabled" />
                    </div>
                  </CardContent>
                </Card>
                <OrganizationAgentsCard
                  identities={(agentsQuery.data?.items ?? []).filter(
                    (identity) =>
                      identity.homeSpace.type === 'organization' &&
                      identity.homeSpace.organizationId === organizationId,
                  )}
                />
              </>
            ) : null}
            {selectedTab === 'authorization' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Authorization model')}</CardTitle>
                  <CardDescription>
                    {tt('Only persisted organization identity fields are editable here.')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <SettingRow label={tt('Organization ID')} value={organization.id} />
                  <SettingRow
                    label={tt('Role assignment scope')}
                    value="Use organization-scoped roles from Console roles."
                  />
                  <SettingRow label={tt('Members and invitations')} value="Not exposed in this product surface." />
                  <SettingRow label={tt('Created')} value={formatDate(organization.createdAt)} />
                  <SettingRow label={tt('Updated')} value={formatDate(organization.updatedAt)} />
                </CardContent>
              </Card>
            ) : null}
            <OrganizationSummaryCard organization={organization} />
          </div>
        </div>
      ) : null}
    </ResourcePage>
  )
}

function OrganizationAgentsCard({ identities }: { identities: import('@shared/api/agent-api').Agent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Organization Agent identities')}</CardTitle>
        <CardDescription>{tt('Stable Agents owned and governed by this organization.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {identities.length ? (
          identities.map((identity) => (
            <SettingRow
              key={identity.id}
              label={identity.name}
              value={`${identity.issuer} · ${identity.subject} · ${identity.status}`}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{tt('No organization-owned Agent identities.')}</p>
        )}
      </CardContent>
    </Card>
  )
}
function OrganizationSummaryCard({
  organization,
}: {
  organization: {
    id: string
    slug: string
    name: string
    displayName: string | null
    disabled: boolean
    disabledReason: string | null
    createdAt: string | Date
    updatedAt: string | Date
  }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Organization summary')}</CardTitle>
        <CardDescription>{tt('Read-only organization identity and lifecycle fields.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('Organization ID')} value={organization.id} />
        <SettingRow label={tt('Slug')} value={organization.slug} />
        <SettingRow label={tt('Display name')} value={organization.displayName ?? organization.name} />
        <SettingRow label={tt('Status')} value={organization.disabled ? 'Disabled' : 'Enabled'} />
        <SettingRow label={tt('Disabled reason')} value={organization.disabledReason ?? 'Not set'} />
        <SettingRow label={tt('Created')} value={formatDate(organization.createdAt)} />
        <SettingRow label={tt('Updated')} value={formatDate(organization.updatedAt)} />
      </CardContent>
    </Card>
  )
}
