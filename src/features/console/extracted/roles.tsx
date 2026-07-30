import {
  assignAgentRole,
  assignApplicationRole,
  assignMemberRole,
  assignUserRole,
  consoleQueryKeys,
  createRole,
  deleteRole,
  getRole,
  listApiResources,
  listRoleScopes,
  listRoles,
  replaceRoleScopes,
  updateRole,
} from '@/lib/api/management'
import {
  type assignRoleRequestSchema,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Plus,
  type RoleDetailSection,
  Save,
  SelectInput,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
  Trash2,
  tt,
  Undo2,
  updateRoleRequestSchema,
  useEffect,
  useMutation,
  useNavigate,
  useQuery,
  useQueryClient,
  useState,
  type z,
} from '../console-shared'
import { CreateRoleDialog } from '../helpers/helpers-create'
import { MutationError, StatusBadge } from '../helpers/helpers-dialogs'
import { AuthorizationForm } from '../helpers/helpers-forms'
import {
  DetailTabs,
  ListToolbar,
  navigateConsoleTab,
  ObjectHeader,
  ResourcePage,
  roleDetailTabs,
} from '../helpers/helpers-resource'
import { parseForm, useAdminMutation } from '../helpers/helpers-utils'
import { RoleSummaryCard } from './role-summary-card'

export function RolesPage() {
  const query = useQuery({
    queryKey: consoleQueryKeys.roles,
    queryFn: listRoles,
  })
  const resourcesQuery = useQuery({
    queryKey: consoleQueryKeys.apiResources,
    queryFn: listApiResources,
  })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createRole,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.roles,
      })
    },
  })
  const roles = query.data?.roles ?? []
  const visibleRoles = roles.filter((role) => {
    const matchesSearch =
      search.trim().length === 0 ||
      [role.name, role.key, role.description ?? ''].some((value) =>
        value.toLowerCase().includes(search.trim().toLowerCase()),
      )
    const roleScope = role.resourceId
      ? 'resource'
      : role.organizationId
        ? 'organization'
        : role.applicationId
          ? 'application'
          : 'global'
    return matchesSearch && (scope.length === 0 || roleScope === scope)
  })
  return (
    <ResourcePage
      title={tt('Roles')}
      description={tt('Define application, organization, resource, and global roles.')}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus data-icon="inline-start" /> {tt('New role')}{' '}
        </Button>
      }
      auxiliary={
        <CreateRoleDialog
          error={createMutation.errorMessage}
          onClose={() => setDialogOpen(false)}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          pending={createMutation.isPending}
          resources={resourcesQuery.data?.items ?? []}
        />
      }
      error={query.error}
      empty={roles.length === 0}
      emptyDescription="Create roles to model tenant, organization, application, or API permissions."
      emptyTitle="No roles yet"
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      toolbar={
        <ListToolbar>
          <TextInput
            aria-label={tt('Search roles')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search roles')}
            value={search}
          />
          <SelectInput
            aria-label={tt('Filter role scope')}
            onChange={(event) => setScope(event.target.value)}
            value={scope}
          >
            <option value="">{tt('Any scope')}</option>
            <option value="global">{tt('Global')}</option>
            <option value="application">{tt('Application')}</option>
            <option value="organization">{tt('Organization')}</option>
            <option value="resource">{tt('API resource')}</option>
          </SelectInput>
        </ListToolbar>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Role')}</TableHead>
            <TableHead>{tt('Scope')}</TableHead>
            <TableHead>{tt('System')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRoles.length ? (
            visibleRoles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <a className="font-medium hover:underline" href={`/console/roles/${role.id}`}>
                    {role.name}
                  </a>
                  <div className="text-xs text-muted-foreground">{role.key}</div>
                </TableCell>
                <TableCell>{role.resourceId ?? role.organizationId ?? role.applicationId ?? 'Global'}</TableCell>
                <TableCell>
                  <StatusBadge active={role.system} activeLabel="System" inactiveLabel="Custom" />
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={3}
              description={
                search || scope
                  ? tt('No roles match the current search or scope filter.')
                  : tt('Create roles to model tenant, organization, application, or API permissions.')
              }
              title={search || scope ? tt('No roles found') : tt('No roles yet')}
            />
          )}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}
export function RoleDetailPage({ roleId, section = 'settings' }: { roleId: string; section?: RoleDetailSection }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedTab, setSelectedTab] = useState<RoleDetailSection>(section)
  const [assignment, setAssignment] = useState({
    type: 'user',
    subjectId: '',
  })
  const [scopes, setScopes] = useState('')
  const roleQuery = useQuery({
    queryKey: [...consoleQueryKeys.roles, roleId],
    queryFn: () => getRole(roleId),
  })
  const roleScopesQuery = useQuery({
    queryKey: [...consoleQueryKeys.roles, roleId, 'scopes'],
    queryFn: () => listRoleScopes(roleId),
    enabled: selectedTab === 'scopes',
  })
  const role = roleQuery.data
  useEffect(() => {
    if (roleScopesQuery.data) setScopes(roleScopesQuery.data.scopes.join('\n'))
  }, [roleScopesQuery.data])
  useEffect(() => setSelectedTab(section), [section])
  const updateMutation = useMutation({
    mutationFn: (input: z.infer<typeof updateRoleRequestSchema>) => updateRole(roleId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...consoleQueryKeys.roles, roleId], updated)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.roles,
      })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteRole(roleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.roles,
      })
      await navigate({ href: '/console/roles' })
    },
  })
  const scopesMutation = useMutation({
    mutationFn: (values: string[]) => replaceRoleScopes(roleId, values),
    onSuccess: () => roleScopesQuery.refetch(),
  })
  const assignmentMutation = useMutation({
    mutationFn: (
      input: z.infer<typeof assignRoleRequestSchema> & {
        type: string
      },
    ) => {
      const payload = { roleId, subjectId: input.subjectId }
      if (input.type === 'application') return assignApplicationRole(payload)
      if (input.type === 'member') return assignMemberRole(payload)
      if (input.type === 'agent') return assignAgentRole(payload)
      return assignUserRole(payload)
    },
  })
  return (
    <ResourcePage
      title={role?.name ?? tt('Role')}
      description={tt('Manage role metadata, OpenAPI scope references, and subject assignments.')}
      framed={false}
      error={roleQuery.error}
      loading={roleQuery.isLoading}
      onRetry={() => roleQuery.refetch()}
    >
      {role ? (
        <div className="consoleDetailStack">
          <a className="consoleBackLink" href="/console/roles">
            <Undo2 data-icon="inline-start" /> {tt('Back to roles')}{' '}
          </a>
          <ObjectHeader badge={role.system ? 'System role' : 'Custom role'} id={role.key} title={role.name} />
          <DetailTabs
            label={tt('Role detail sections')}
            onChange={(value) => {
              const next = value as RoleDetailSection
              setSelectedTab(next)
              navigateConsoleTab(navigate, `/console/roles/${roleId}/${next}`)
            }}
            tabs={roleDetailTabs()}
            value={selectedTab}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            {selectedTab === 'settings' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Role settings')}</CardTitle>
                  <CardDescription>
                    {' '}
                    {tt('Scope fields are immutable after creation; update display metadata here.')}{' '}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AuthorizationForm
                    buttonLabel="Save role"
                    defaults={{
                      key: role.key,
                      name: role.name,
                      description: role.description ?? '',
                    }}
                    error={updateMutation.error}
                    fields={[
                      ['key', 'Key'],
                      ['name', 'Name'],
                      ['description', 'Description'],
                    ]}
                    onSubmit={(form) => updateMutation.mutate(parseForm(updateRoleRequestSchema, form))}
                    pending={updateMutation.isPending}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <StatusBadge active={role.system} activeLabel="System role" inactiveLabel="Custom role" />
                    <Button
                      disabled={role.system || deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate()}
                      type="button"
                      variant="danger"
                    >
                      <Trash2 data-icon="inline-start" /> {tt('Delete role')}{' '}
                    </Button>
                  </div>
                  <MutationError error={deleteMutation.error} />
                </CardContent>
              </Card>
            ) : null}

            {selectedTab === 'scopes' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Scope eligibility')}</CardTitle>
                  <CardDescription>
                    {tt('Enter scope names published by this role’s business resource OpenAPI document.')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <Field label={tt('Scopes')}>
                    <textarea
                      className="min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      disabled={scopesMutation.isPending || !role.resourceId}
                      onChange={(event) => setScopes(event.target.value)}
                      placeholder="documents.read&#10;documents.write"
                      value={scopes}
                    />
                  </Field>
                  {!role.resourceId ? (
                    <p className="text-sm text-muted-foreground">
                      {tt('Only resource roles can reference business API scopes.')}
                    </p>
                  ) : null}
                  <Button
                    disabled={scopesMutation.isPending || !role.resourceId}
                    onClick={() =>
                      scopesMutation.mutate(
                        scopes
                          .split(/\s+/)
                          .map((scope) => scope.trim())
                          .filter(Boolean),
                      )
                    }
                    type="button"
                  >
                    <Save data-icon="inline-start" /> {tt('Save scopes')}{' '}
                  </Button>
                  <MutationError error={scopesMutation.error} />
                </CardContent>
              </Card>
            ) : null}

            {selectedTab === 'assignments' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tt('Assignments')}</CardTitle>
                  <CardDescription>
                    {' '}
                    {tt('Assign this role to a user, Agent, application, or organization member record.')}{' '}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="formStack"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const submittedForm = new FormData(event.currentTarget)
                      assignmentMutation.mutate({
                        type: submittedForm.get('type') as string,
                        roleId,
                        subjectId: submittedForm.get('subjectId') as string,
                      })
                    }}
                  >
                    <Field label={tt('Subject type')}>
                      <SelectInput
                        name="type"
                        onChange={(event) =>
                          setAssignment((value) => ({
                            ...value,
                            type: event.target.value,
                          }))
                        }
                        value={assignment.type}
                      >
                        <option value="user">{tt('User')}</option>
                        <option value="agent">{tt('Agent')}</option>
                        <option value="application">{tt('Application')}</option>
                        <option value="member">{tt('Organization member')}</option>
                      </SelectInput>
                    </Field>
                    <Field label={tt('Subject ID')}>
                      <TextInput defaultValue={assignment.subjectId} name="subjectId" required />
                    </Field>
                    <Button disabled={assignmentMutation.isPending} type="submit">
                      <Save data-icon="inline-start" /> {tt('Assign role')}{' '}
                    </Button>
                    {assignmentMutation.isSuccess ? (
                      <p className="text-sm text-muted-foreground">{tt('Assignment saved.')}</p>
                    ) : null}
                    <MutationError error={assignmentMutation.error} />
                  </form>
                </CardContent>
              </Card>
            ) : null}
            <RoleSummaryCard role={role} scopeCount={roleScopesQuery.data?.scopes.length ?? 0} />
          </div>
        </div>
      ) : null}
    </ResourcePage>
  )
}
