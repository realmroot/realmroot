import { type RolePermission, updateRoleRequestSchema } from '@shared/api/authorization'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Plus, Search, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Field, SelectInput, TextArea, TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  consoleQueryKeys,
  createRole,
  createRoleAssignment,
  deleteRole,
  getAgentInventory,
  getApiResourceContract,
  getRole,
  listApiResources,
  listApplications,
  listOrganizations,
  listRoleAssignments,
  listRolePermissions,
  listRoles,
  listUsers,
  replaceRolePermissions,
  updateRole,
} from '@/lib/api/management'
import { useConsoleScope } from '@/lib/console-context'
import { tt } from '@/lib/i18n'
import type { RoleDetailSection } from '../console-shared'
import { CreateRoleDialog } from '../helpers/helpers-create'
import { ErrorState, LoadingState, MutationError, StatusBadge } from '../helpers/helpers-dialogs'
import { ListToolbar, navigateConsoleTab, ResourcePage } from '../helpers/helpers-resource'
import { formatDate, nullableString, parseForm, useAdminMutation, userDisplayName } from '../helpers/helpers-utils'

type Permission = { scope: string; resourceId: string; resourceName: string; description: string }

export function RolesPage() {
  const { organizationId: context } = useConsoleScope()
  const query = useQuery({ queryKey: consoleQueryKeys.roles, queryFn: listRoles })
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const createMutation = useAdminMutation({
    mutationFn: createRole,
    onSuccess: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.roles })
    },
  })
  const roles = query.data?.roles ?? []
  const visibleRoles = roles.filter((role) => {
    const matchesSearch = [role.name, role.key, role.description ?? ''].some((value) =>
      value.toLowerCase().includes(search.trim().toLowerCase()),
    )
    return matchesSearch && (!type || (role.system ? 'system' : 'custom') === type)
  })
  return (
    <ResourcePage
      title={tt('Roles')}
      description={tt(
        'Define reusable Realm-wide permission sets, then assign them to actors in Realm or Organization context.',
      )}
      action={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus />
          {tt('New role')}
        </Button>
      }
      auxiliary={
        <CreateRoleDialog
          error={createMutation.errorMessage}
          onClose={() => setDialogOpen(false)}
          onSubmit={createMutation.mutate}
          open={dialogOpen}
          pending={createMutation.isPending}
        />
      }
      empty={roles.length === 0}
      emptyDescription="Create a reusable permission definition before assigning authority to an actor."
      emptyTitle="No roles yet"
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      tableToolbar={
        <ListToolbar>
          <TextInput
            aria-label={tt('Search roles')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search roles')}
            value={search}
          />
          <SelectInput
            aria-label={tt('Filter role type')}
            onChange={(event) => setType(event.target.value)}
            value={type}
          >
            <option value="">{tt('Any type')}</option>
            <option value="custom">{tt('Custom')}</option>
            <option value="system">{tt('System')}</option>
          </SelectInput>
        </ListToolbar>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Role')}</TableHead>
            <TableHead>{tt('Permissions')}</TableHead>
            <TableHead>{tt('Type')}</TableHead>
            <TableHead>{tt('Updated')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRoles.length ? (
            visibleRoles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    params={{ roleId: role.id }}
                    search={context ? { context } : {}}
                    to="/console/roles/$roleId"
                  >
                    {role.name}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">{role.key}</span>
                </TableCell>
                <TableCell>
                  <RoleScopeCount roleId={role.id} />
                </TableCell>
                <TableCell>
                  <Badge variant={role.system ? 'outline' : 'secondary'}>
                    {role.system ? tt('System') : tt('Custom')}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(role.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    <Link params={{ roleId: role.id }} search={context ? { context } : {}} to="/console/roles/$roleId">
                      {tt('Open')}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={5}
              description={
                search || type
                  ? tt('No roles match the current filters.')
                  : tt('Create a reusable permission definition before assigning authority.')
              }
              title={search || type ? tt('No roles found') : tt('No roles yet')}
            />
          )}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}

function RoleScopeCount({ roleId }: { roleId: string }) {
  const query = useQuery({
    queryKey: [...consoleQueryKeys.roles, roleId, 'permissions'],
    queryFn: () => listRolePermissions(roleId),
  })
  if (query.isLoading) return <span className="text-muted-foreground">—</span>
  if (query.error) return <span className="text-destructive">{tt('Unavailable')}</span>
  return <>{query.data?.permissions.length ?? 0}</>
}

export function RoleDetailPage({ roleId, section = 'overview' }: { roleId: string; section?: RoleDetailSection }) {
  const { organizationId: context } = useConsoleScope()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedTab, setSelectedTab] = useState<RoleDetailSection>(section)
  const [editOpen, setEditOpen] = useState(false)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const roleQuery = useQuery({ queryKey: [...consoleQueryKeys.roles, roleId], queryFn: () => getRole(roleId) })
  const permissionsQuery = useQuery({
    queryKey: [...consoleQueryKeys.roles, roleId, 'permissions'],
    queryFn: () => listRolePermissions(roleId),
  })
  const resourcesQuery = useQuery({ queryKey: consoleQueryKeys.apiResources, queryFn: () => listApiResources() })
  const resourceContracts = useQueries({
    queries: (resourcesQuery.data?.items ?? []).map((resource) => ({
      enabled: selectedTab === 'permissions' || permissionsOpen,
      queryFn: () => getApiResourceContract(resource.id),
      queryKey: [...consoleQueryKeys.apiResources, resource.id, 'contract'],
    })),
  })
  const role = roleQuery.data
  const updateMutation = useAdminMutation({
    mutationFn: (input: Parameters<typeof updateRole>[1]) => updateRole(roleId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...consoleQueryKeys.roles, roleId], updated)
      setEditOpen(false)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.roles })
    },
  })
  const permissionsMutation = useAdminMutation({
    mutationFn: (permissions: RolePermission[]) =>
      replaceRolePermissions(roleId, permissions, permissionsQuery.data!.etag),
    onSuccess: () => {
      setPermissionsOpen(false)
      return permissionsQuery.refetch()
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteRole(roleId),
    onSuccess: async () => {
      const detailKey = [...consoleQueryKeys.roles, roleId]
      await queryClient.cancelQueries({ queryKey: detailKey })
      await queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.roles,
        exact: true,
        refetchType: 'none',
      })
      await navigate({ to: '/console/roles' })
      queryClient.removeQueries({ queryKey: detailKey })
    },
  })
  useEffect(() => {
    setSelectedTab(section)
  }, [section])
  if (roleQuery.isLoading || permissionsQuery.isLoading || resourcesQuery.isLoading)
    return <LoadingState label={tt('Loading role')} />
  const error = roleQuery.error ?? permissionsQuery.error ?? resourcesQuery.error
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => Promise.all([roleQuery.refetch(), permissionsQuery.refetch(), resourcesQuery.refetch()])}
      />
    )
  if (!role) return <ErrorState error={new Error(tt('Role not found.'))} />
  const assignedPermissions = permissionsQuery.data?.permissions ?? []
  const permissions = permissionCatalog(
    resourcesQuery.data?.items ?? [],
    resourceContracts.map((query) => query.data),
    assignedPermissions,
  )
  const assigned = new Set(assignedPermissions.map(permissionKey))
  return (
    <>
      <div className="consoleDetailStack">
        <Link className="consoleBackLink" search={context ? { context } : {}} to="/console/roles">
          <ArrowLeft />
          {tt('Roles')}
        </Link>
        <header className="consoleDetailHeader">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1>{role.name}</h1>
              <Badge variant={role.system ? 'outline' : 'secondary'}>{role.system ? tt('System') : tt('Custom')}</Badge>
            </div>
            <p>{role.description ?? tt('Reusable Realm-wide permission definition.')}</p>
            <span className="consoleDetailMeta">{role.key}</span>
          </div>
        </header>
        <Tabs
          onValueChange={(value) => {
            const next = value as RoleDetailSection
            setSelectedTab(next)
            navigateConsoleTab(navigate, `/console/roles/${roleId}/${next}`, context)
          }}
          value={selectedTab}
        >
          <TabsList className="w-full" variant="navigation">
            <TabsTrigger value="overview">{tt('Overview')}</TabsTrigger>
            <TabsTrigger value="permissions">{tt('Permissions')}</TabsTrigger>
            <TabsTrigger value="assignments">{tt('Assignments')}</TabsTrigger>
            <TabsTrigger value="settings">{tt('Settings')}</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-5" value="overview">
            <RoleOverview permissions={assigned.size} role={role} />
          </TabsContent>
          <TabsContent className="mt-5" value="permissions">
            <RolePermissions assigned={assigned} onEdit={() => setPermissionsOpen(true)} permissions={permissions} />
          </TabsContent>
          <TabsContent className="mt-5" value="assignments">
            <RoleAssignments onAssign={() => setAssignOpen(true)} role={role} />
          </TabsContent>
          <TabsContent className="mt-5" value="settings">
            <RoleSettings onDelete={() => setDeleteOpen(true)} onEdit={() => setEditOpen(true)} role={role} />
          </TabsContent>
        </Tabs>
      </div>
      <RoleEditSheet
        error={updateMutation.errorMessage}
        onClose={() => setEditOpen(false)}
        onSave={(input) => updateMutation.mutate(input)}
        open={editOpen}
        pending={updateMutation.isPending}
        role={role}
      />
      <PermissionSheet
        assigned={assigned}
        error={permissionsMutation.errorMessage}
        onClose={() => setPermissionsOpen(false)}
        onSave={(nextPermissions) => permissionsMutation.mutate(nextPermissions)}
        open={permissionsOpen}
        pending={permissionsMutation.isPending}
        permissions={permissions}
      />
      <RoleAssignmentDialog
        context={context}
        key={context ?? 'realm'}
        onClose={() => setAssignOpen(false)}
        open={assignOpen}
        role={role}
      />
      <DestructiveConfirmation
        confirmLabel={deleteMutation.isPending ? tt('Deleting…') : tt('Delete role')}
        description={tt(
          'Permanently deletes this role and all active and historical assignments. Existing sessions may retain already issued claims until their tokens expire. This cannot be undone.',
        )}
        error={<MutationError error={deleteMutation.error} />}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        open={deleteOpen}
        pending={deleteMutation.isPending}
        title={tt('Delete {{name}}?', { name: role.name })}
      />
    </>
  )
}

function RoleOverview({ permissions, role }: { permissions: number; role: Awaited<ReturnType<typeof getRole>> }) {
  return (
    <div className="detailFlatRows">
      <DetailRow label="Role key" value={<code>{role.key}</code>} />
      <DetailRow label="Permissions" value={String(permissions)} />
      <DetailRow label="Role type" value={role.system ? tt('System') : tt('Custom')} />
      <DetailRow label="Created" value={formatDate(role.createdAt)} />
      <DetailRow label="Last updated" value={formatDate(role.updatedAt)} />
    </div>
  )
}

function RolePermissions({
  assigned,
  onEdit,
  permissions,
}: {
  assigned: Set<string>
  onEdit?: () => void
  permissions: Permission[]
}) {
  const [search, setSearch] = useState('')
  const [resource, setResource] = useState('')
  const selected = permissions.filter(
    (permission) =>
      assigned.has(permissionKey(permission)) &&
      (!resource || permission.resourceId === resource) &&
      `${permission.scope} ${permission.description}`.toLowerCase().includes(search.toLowerCase()),
  )
  const resources = uniqueResources(permissions)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListToolbar>
          <TextInput
            aria-label={tt('Search permissions')}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tt('Search permissions')}
            value={search}
          />
          <SelectInput
            aria-label={tt('Filter resource server')}
            onChange={(event) => setResource(event.target.value)}
            value={resource}
          >
            <option value="">{tt('Any resource server')}</option>
            {resources.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectInput>
        </ListToolbar>
        {onEdit ? <Button onClick={onEdit}>{tt('Edit permissions')}</Button> : null}
      </div>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Permission')}</TableHead>
              <TableHead>{tt('Resource server')}</TableHead>
              <TableHead>{tt('Description')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selected.length ? (
              selected.map((permission) => (
                <TableRow key={permissionKey(permission)}>
                  <TableCell>
                    <code>{permission.scope}</code>
                  </TableCell>
                  <TableCell>{permission.resourceName}</TableCell>
                  <TableCell>{permission.description}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={3}
                description={
                  search || resource
                    ? tt('No assigned permissions match the current filters.')
                    : tt('Use Edit permissions to add scopes from any Resource server.')
                }
                title={tt('No permissions found')}
              />
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function RoleAssignments({ onAssign, role }: { onAssign: () => void; role: Awaited<ReturnType<typeof getRole>> }) {
  const assignments = useQuery({
    queryKey: [...consoleQueryKeys.roles, role.id, 'assignments'],
    queryFn: () => listRoleAssignments({ roleId: role.id, limit: 100 }),
  })
  const users = useQuery({
    queryKey: [...consoleQueryKeys.users, { organizationId: undefined }],
    queryFn: () => listUsers({ limit: 100 }),
  })
  const applications = useQuery({
    queryKey: [...consoleQueryKeys.applications, { ownerOrganizationId: undefined }],
    queryFn: () => listApplications(),
  })
  const agents = useQuery({
    queryKey: [...consoleQueryKeys.agents, { organizationId: undefined }],
    queryFn: () => getAgentInventory(),
  })
  const organizations = useQuery({ queryKey: consoleQueryKeys.organizations, queryFn: listOrganizations })
  if (assignments.isLoading) return <LoadingState label={tt('Loading role assignments')} />
  if (assignments.error) return <ErrorState error={assignments.error} onRetry={() => assignments.refetch()} />
  const organizationNames = new Map(
    (organizations.data?.organizations ?? []).map((organization) => [
      organization.id,
      organization.displayName ?? organization.name,
    ]),
  )
  const subjectNames = new Map([
    ...(users.data?.users ?? []).map((user) => [`user:${user.id}`, userDisplayName(user)] as const),
    ...(applications.data?.applications ?? []).map(
      (application) => [`workload:${application.id}`, application.name] as const,
    ),
    ...(agents.data?.items ?? []).map((agent) => [`agent:${agent.id}`, agent.name] as const),
  ])
  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button onClick={onAssign}>
          <Plus />
          {tt('Assign role')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Subject')}</TableHead>
              <TableHead>{tt('Type')}</TableHead>
              <TableHead>{tt('Context')}</TableHead>
              <TableHead>{tt('Expires')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead>{tt('Assigned by')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.data?.assignments.length ? (
              assignments.data.assignments.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell>
                    <strong>
                      {subjectNames.get(`${assignment.subjectType}:${assignment.subjectId}`) ?? assignment.subjectId}
                    </strong>
                    <span className="block font-mono text-xs text-muted-foreground">{assignment.subjectId}</span>
                  </TableCell>
                  <TableCell>{subjectTypeLabel(assignment.subjectType)}</TableCell>
                  <TableCell>
                    {assignment.organizationId
                      ? (organizationNames.get(assignment.organizationId) ?? <code>{assignment.organizationId}</code>)
                      : tt('Realm-wide')}
                  </TableCell>
                  <TableCell>{assignment.expiresAt ? formatDate(assignment.expiresAt) : tt('Never')}</TableCell>
                  <TableCell>
                    <AssignmentStatus expiresAt={assignment.expiresAt} revokedAt={assignment.revokedAt} />
                  </TableCell>
                  <TableCell>
                    {assignment.assignedByUserId
                      ? (subjectNames.get(`user:${assignment.assignedByUserId}`) ?? (
                          <code>{assignment.assignedByUserId}</code>
                        ))
                      : tt('System')}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={6}
                description={tt('Assignments for {{role}} will appear here.', { role: role.name })}
                title={tt('No role assignments')}
              />
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function RoleSettings({
  onDelete,
  onEdit,
  role,
}: {
  onDelete: () => void
  onEdit: () => void
  role: Awaited<ReturnType<typeof getRole>>
}) {
  return (
    <div className="detailFlatRows">
      <DetailRow
        action={
          <Button disabled={role.system} onClick={onEdit} variant="outline">
            {tt('Edit')}
          </Button>
        }
        description="Human-readable name shown anywhere this permission set is assigned."
        label="Name"
        value={role.name}
      />
      <DetailRow
        description="Optional context explaining the authority represented by this role."
        label="Description"
        value={role.description ?? tt('Not configured')}
      />
      <DetailRow
        action={
          <Button disabled={role.system} onClick={onDelete} variant="destructive">
            <Trash2 />
            {tt('Delete')}
          </Button>
        }
        description="Permanently remove this permission definition and all of its assignments."
        label="Delete role"
        value={role.system ? tt('System roles cannot be deleted') : tt('Permanent')}
      />
    </div>
  )
}

function RoleEditSheet({
  error,
  onClose,
  onSave,
  open,
  pending,
  role,
}: {
  error?: string | null
  onClose: () => void
  onSave: (input: Parameters<typeof updateRole>[1]) => void
  open: boolean
  pending: boolean
  role: Awaited<ReturnType<typeof getRole>>
}) {
  return (
    <Sheet
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open={open}
    >
      <SheetContent className="h-full overflow-hidden">
        <SheetHeader className="shrink-0">
          <SheetTitle>{tt('Edit role')}</SheetTitle>
          <SheetDescription>
            {tt('Change the human-readable metadata for this reusable permission set.')}
          </SheetDescription>
        </SheetHeader>
        <form
          className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-5"
          id="role-edit"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            onSave(
              parseForm(updateRoleRequestSchema, {
                name: form.get('name'),
                description: nullableString(String(form.get('description') ?? '')),
              }),
            )
          }}
        >
          <Field
            help={tt('Stable after creation because policies and integrations may reference it.')}
            label={tt('Key')}
          >
            <TextInput disabled value={role.key} />
          </Field>
          <Field label={tt('Name')}>
            <TextInput defaultValue={role.name} name="name" required />
          </Field>
          <Field label={tt('Description')}>
            <TextArea defaultValue={role.description ?? ''} name="description" rows={4} />
          </Field>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <SheetFooter className="shrink-0">
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending} form="role-edit" type="submit">
            {pending ? tt('Saving…') : tt('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function PermissionSheet({
  assigned,
  error,
  onClose,
  onSave,
  open,
  pending,
  permissions,
}: {
  assigned: Set<string>
  error?: string | null
  onClose: () => void
  onSave: (permissions: RolePermission[]) => void
  open: boolean
  pending: boolean
  permissions: Permission[]
}) {
  const [selected, setSelected] = useState(() => new Set(assigned))
  const [search, setSearch] = useState('')
  const [resource, setResource] = useState('')
  useEffect(() => {
    if (open) setSelected(new Set(assigned))
  }, [assigned, open])
  const visible = permissions.filter(
    (permission) =>
      (!resource || permission.resourceId === resource) &&
      `${permission.scope} ${permission.description}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <Sheet
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open={open}
    >
      <SheetContent className="h-full overflow-hidden sm:max-w-2xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>{tt('Edit permissions')}</SheetTitle>
          <SheetDescription>
            {tt('Select scopes from any Resource server. Filters change the view, not the current selection.')}
          </SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-5">
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={tt('Search available permissions')}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tt('Search scope or description')}
              value={search}
            />
          </InputGroup>
          <SelectInput
            aria-label={tt('Filter available permissions by resource server')}
            onChange={(event) => setResource(event.target.value)}
            value={resource}
          >
            <option value="">{tt('Any resource server')}</option>
            {uniqueResources(permissions).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectInput>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>{tt('Permission')}</TableHead>
                  <TableHead>{tt('Resource server')}</TableHead>
                  <TableHead>{tt('Description')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length ? (
                  visible.map((permission) => {
                    const key = permissionKey(permission)
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <Checkbox
                            aria-label={tt('Select {{scope}}', { scope: permission.scope })}
                            checked={selected.has(key)}
                            onCheckedChange={(checked) =>
                              setSelected((current) => {
                                const next = new Set(current)
                                if (checked) next.add(key)
                                else next.delete(key)
                                return next
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <code>{permission.scope}</code>
                        </TableCell>
                        <TableCell>{permission.resourceName}</TableCell>
                        <TableCell>{permission.description}</TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableEmptyRow
                    colSpan={4}
                    description={tt('Try another keyword or Resource server filter.')}
                    title={tt('No matching permissions')}
                  />
                )}
              </TableBody>
            </Table>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <SheetFooter className="shrink-0">
          <span className="mr-auto text-sm text-muted-foreground">
            {tt('{{count}} selected', { count: selected.size })}
          </span>
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSave(
                permissions
                  .filter((permission) => selected.has(permissionKey(permission)))
                  .map(({ resourceId, scope }) => ({ resourceId, scope })),
              )
            }
          >
            {pending ? tt('Saving…') : tt('Save permissions')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function RoleAssignmentDialog({
  context,
  onClose,
  open,
  role,
}: {
  context?: string
  onClose: () => void
  open: boolean
  role: Awaited<ReturnType<typeof getRole>>
}) {
  const queryClient = useQueryClient()
  const [type, setType] = useState('user')
  const [subject, setSubject] = useState('')
  const [organizationId, setOrganizationId] = useState(context ?? '')
  const [expiry, setExpiry] = useState('never')
  const [expiresAt, setExpiresAt] = useState('')
  const users = useQuery({
    queryKey: consoleQueryKeys.users,
    queryFn: () => listUsers({ limit: 100 }),
    enabled: open,
  })
  const applications = useQuery({
    queryKey: consoleQueryKeys.applications,
    queryFn: () => listApplications(),
    enabled: open,
  })
  const agents = useQuery({
    queryKey: consoleQueryKeys.agents,
    queryFn: () => getAgentInventory(),
    enabled: open,
  })
  const organizations = useQuery({
    queryKey: consoleQueryKeys.organizations,
    queryFn: listOrganizations,
    enabled: open,
  })
  const subjects =
    type === 'agent'
      ? (agents.data?.items ?? []).map((agent) => ({ id: agent.id, label: agent.name }))
      : type === 'application'
        ? (applications.data?.applications ?? []).map((application) => ({
            id: application.id,
            label: application.name,
          }))
        : (users.data?.users ?? []).map((user) => ({ id: user.id, label: userDisplayName(user) }))
  const mutation = useAdminMutation({
    mutationFn: () =>
      createRoleAssignment({
        roleId: role.id,
        subjectId: subject,
        subjectType: type === 'application' ? 'workload' : (type as 'user' | 'agent'),
        organizationId: organizationId || null,
        ...(expiry === 'date' ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      }),
    onSuccess: () => {
      resetForm()
      onClose()
      return queryClient.invalidateQueries({ queryKey: [...consoleQueryKeys.roles, role.id, 'assignments'] })
    },
  })

  function resetForm() {
    setType('user')
    setSubject('')
    setOrganizationId(context ?? '')
    setExpiry('never')
    setExpiresAt('')
  }

  function close() {
    resetForm()
    mutation.reset()
    onClose()
  }
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) close()
      }}
      open={open}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate(undefined)
          }}
        >
          <DialogHeader>
            <DialogTitle>{tt('Assign {{role}}', { role: role.name })}</DialogTitle>
            <DialogDescription>
              {tt('Choose an actor and whether this authority applies Realm-wide or only in one Organization context.')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <Field label={tt('Subject type')}>
              <SelectInput
                name="subjectType"
                onChange={(event) => {
                  setType(event.target.value)
                  setSubject('')
                }}
                value={type}
              >
                <option value="user">{tt('User')}</option>
                <option value="agent">{tt('Agent')}</option>
                <option value="application">{tt('Workload')}</option>
              </SelectInput>
            </Field>
            <Field label={tt('Subject')}>
              <SelectInput
                name="subjectId"
                onChange={(event) => setSubject(event.target.value)}
                required
                value={subject}
              >
                <option value="">{tt('Select a subject')}</option>
                {subjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field
              help={tt(
                'Organization context limits when the assignment is effective; it does not change the Role definition.',
              )}
              label={tt('Context')}
            >
              <SelectInput
                name="organizationId"
                onChange={(event) => setOrganizationId(event.target.value)}
                value={organizationId}
              >
                <option value="">{tt('Realm-wide')}</option>
                {(organizations.data?.organizations ?? []).map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.displayName ?? organization.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label={tt('Expires')}>
              <SelectInput name="expiryMode" onChange={(event) => setExpiry(event.target.value)} value={expiry}>
                <option value="never">{tt('Never')}</option>
                <option value="date">{tt('Until a date')}</option>
              </SelectInput>
            </Field>
            {expiry === 'date' ? (
              <Field
                help={tt('The assignment stops applying at this exact local date and time.')}
                label={tt('Expiry date and time')}
              >
                <TextInput
                  name="expiresAt"
                  onChange={(event) => setExpiresAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={expiresAt}
                />
              </Field>
            ) : null}
            <MutationError error={mutation.error} />
          </div>
          <DialogFooter>
            <Button onClick={close} type="button" variant="outline">
              {tt('Cancel')}
            </Button>
            <Button disabled={mutation.isPending || !subject} type="submit">
              {mutation.isPending ? tt('Assigning…') : tt('Assign role')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function permissionCatalog(
  resources: Awaited<ReturnType<typeof listApiResources>>['items'],
  contracts: Array<Awaited<ReturnType<typeof getApiResourceContract>> | undefined>,
  assigned: RolePermission[],
): Permission[] {
  const resourceNames = new Map(resources.map((resource) => [resource.id, resource.name]))
  const catalog = new Map<string, Permission>()
  for (const contract of contracts) {
    if (!contract) continue
    for (const scope of contract.scopes) {
      const permission = {
        resourceId: contract.resourceId,
        resourceName: resourceNames.get(contract.resourceId) ?? contract.resourceId,
        scope: scope.value,
        description: scope.description ?? tt('No description provided by this Resource server.'),
      }
      catalog.set(permissionKey(permission), permission)
    }
  }
  for (const permission of assigned) {
    const key = permissionKey(permission)
    if (!catalog.has(key)) {
      catalog.set(key, {
        ...permission,
        resourceName: resourceNames.get(permission.resourceId) ?? permission.resourceId,
        description: tt('This assigned scope is currently unavailable from the Resource server contract.'),
      })
    }
  }
  return [...catalog.values()]
}

function permissionKey(permission: Pick<Permission, 'resourceId' | 'scope'>) {
  return `${permission.resourceId}\u0000${permission.scope}`
}
function subjectTypeLabel(subjectType: 'user' | 'agent' | 'workload') {
  return tt(subjectType === 'workload' ? 'Workload' : subjectType === 'agent' ? 'Agent' : 'User')
}
function AssignmentStatus({ expiresAt, revokedAt }: { expiresAt: string | null; revokedAt: string | null }) {
  const expired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false
  return (
    <StatusBadge
      active={!revokedAt && !expired}
      activeLabel={tt('Active')}
      inactiveLabel={tt(revokedAt ? 'Revoked' : 'Expired')}
    />
  )
}
function uniqueResources(permissions: Permission[]) {
  return [...new Map(permissions.map((permission) => [permission.resourceId, permission.resourceName])).entries()]
}
function DetailRow({
  action,
  description,
  label,
  value,
}: {
  action?: ReactNode
  description?: string
  label: string
  value: ReactNode
}) {
  return (
    <div className="detailFlatRow">
      <div>
        <strong>{tt(label)}</strong>
        {description ? <span>{tt(description)}</span> : null}
      </div>
      <span>{value}</span>
      {action ?? <i />}
    </div>
  )
}
