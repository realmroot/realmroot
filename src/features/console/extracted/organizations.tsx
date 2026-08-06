import {
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  updateOrganizationRequestSchema,
} from '@shared/api/authorization'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Ellipsis, Plus, UserPlus } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Field, SelectInput, TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SimpleCreateDialog } from '@/features/management/create-dialogs'
import { ErrorState, LoadingState, StatusBadge } from '@/features/management/dialogs'
import {
  DetailTabs,
  ListToolbar,
  navigateConsoleTab,
  organizationDetailTabs,
  ResourcePage,
} from '@/features/management/resource-components'
import type { OrganizationDetailSection } from '@/features/management/shared'
import { formatDate, parseForm, useAdminMutation } from '@/features/management/utils'
import {
  cancelOrganizationInvitation,
  consoleQueryKeys,
  createOrganization,
  createOrganizationInvitation,
  deleteOrganization,
  getAgentAuditEvents,
  getAgentInventory,
  getOrganization,
  listOrganizationInvitations,
  listOrganizationMembers,
  listOrganizations,
  listRoles,
  listUsers,
  removeOrganizationMember,
  replaceOrganizationMemberRoles,
  updateOrganization,
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
  const organizations = query.data?.organizations ?? []
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
                  <a className="font-medium hover:underline" href={`/organizations/${organization.id}/overview`}>
                    {organization.displayName ?? organization.name}
                  </a>
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
                  <a
                    aria-label={tt('Open {{name}}', { name: organization.name })}
                    href={`/organizations/${organization.id}/overview`}
                  >
                    →
                  </a>
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
  return <>{query.data?.pagination.total ?? query.data?.members.length ?? 0}</>
}
export function OrganizationDetailPage({
  organizationId,
  section = 'overview',
}: {
  organizationId: string
  section?: OrganizationDetailSection
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const [selectedTab, setSelectedTab] = useState<OrganizationDetailSection>(section)
  const [editOpen, setEditOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [memberLevel, setMemberLevel] = useState('')
  const [memberAction, setMemberAction] = useState<
    | { type: 'remove-member'; id: string; label: string }
    | { type: 'cancel-invitation'; id: string; label: string }
    | null
  >(null)
  const query = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId],
    queryFn: () => getOrganization(organizationId),
  })
  const membersQuery = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId, 'members'],
    queryFn: () => listOrganizationMembers(organizationId),
  })
  const invitationsQuery = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId, 'invitations'],
    queryFn: () => listOrganizationInvitations(organizationId),
  })
  const rolesQuery = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId, 'roles'],
    queryFn: () => listRoles(organizationId),
  })
  const usersQuery = useQuery({
    queryKey: [...consoleQueryKeys.users, 'organization-detail'],
    queryFn: () => listUsers({ limit: 100, offset: 0 }),
  })
  const agentsQuery = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId, 'agents'],
    queryFn: () => getAgentInventory({ organizationId }),
  })
  const activityQuery = useQuery({
    queryKey: [...consoleQueryKeys.organizations, organizationId, 'activity'],
    queryFn: () => getAgentAuditEvents({ organizationId }),
  })
  const organization = query.data
  const updateMutation = useAdminMutation({
    mutationFn: (input: Parameters<typeof updateOrganization>[1]) => updateOrganization(organizationId, input),
    onSuccess: async (updated) => {
      queryClient.setQueryData([...consoleQueryKeys.organizations, organizationId], updated)
      setEditOpen(false)
      setSuspendOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: consoleQueryKeys.organizations, exact: true }),
        router.invalidate(),
      ])
    },
  })
  const inviteMutation = useAdminMutation({
    mutationFn: (input: Parameters<typeof createOrganizationInvitation>[1]) =>
      createOrganizationInvitation(organizationId, input),
    onSuccess: () => {
      setInviteOpen(false)
      return queryClient.invalidateQueries({
        queryKey: [...consoleQueryKeys.organizations, organizationId, 'invitations'],
      })
    },
  })
  const deleteMutation = useAdminMutation({
    mutationFn: () => deleteOrganization(organizationId),
    onSuccess: async () => {
      const detailKey = [...consoleQueryKeys.organizations, organizationId]
      await queryClient.cancelQueries({ queryKey: detailKey })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQueryKeys.organizations,
          exact: true,
          refetchType: 'none',
        }),
        router.invalidate(),
      ])
      await navigate({ to: '/console/organizations' })
      queryClient.removeQueries({ queryKey: detailKey })
    },
  })
  const memberActionMutation = useAdminMutation({
    mutationFn: async (
      action:
        | { type: 'remove-member'; id: string; label: string }
        | { type: 'cancel-invitation'; id: string; label: string },
    ) => {
      if (action.type === 'remove-member') await removeOrganizationMember(organizationId, action.id)
      else await cancelOrganizationInvitation(organizationId, action.id)
    },
    onSuccess: async () => {
      setMemberAction(null)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...consoleQueryKeys.organizations, organizationId, 'members'],
        }),
        queryClient.invalidateQueries({
          queryKey: [...consoleQueryKeys.organizations, organizationId, 'invitations'],
        }),
      ])
    },
  })
  useEffect(() => setSelectedTab(section), [section])
  const organizationAgents = (agentsQuery.data?.items ?? []).filter(
    (identity) => identity.homeSpace.type === 'organization' && identity.homeSpace.organizationId === organizationId,
  )
  const userById = new Map((usersQuery.data?.users ?? []).map((user) => [user.id, user]))
  const visibleMembers = (membersQuery.data?.members ?? []).filter((member) => {
    const user = userById.get(member.userId)
    const matchesSearch = [user?.displayName, user?.name, user?.email, member.userId].some((value) =>
      value?.toLowerCase().includes(memberSearch.trim().toLowerCase()),
    )
    return matchesSearch && (!memberLevel || member.roles.includes(memberLevel))
  })
  const pendingInvitations = (invitationsQuery.data?.invitations ?? []).filter(
    (invitation) => invitation.status === 'pending',
  )
  const agentIds = new Set(organizationAgents.map((agent) => agent.id))
  const activity = (activityQuery.data?.items ?? []).filter(
    (event) => event.agentIdentityId && agentIds.has(event.agentIdentityId),
  )
  const loading =
    query.isLoading ||
    membersQuery.isLoading ||
    invitationsQuery.isLoading ||
    rolesQuery.isLoading ||
    usersQuery.isLoading ||
    agentsQuery.isLoading ||
    activityQuery.isLoading
  const error =
    query.error ??
    membersQuery.error ??
    invitationsQuery.error ??
    rolesQuery.error ??
    usersQuery.error ??
    agentsQuery.error ??
    activityQuery.error
  if (loading) return <LoadingState label={tt('Loading Organization')} />
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() =>
          Promise.all([
            query.refetch(),
            membersQuery.refetch(),
            invitationsQuery.refetch(),
            rolesQuery.refetch(),
            usersQuery.refetch(),
            agentsQuery.refetch(),
            activityQuery.refetch(),
          ])
        }
      />
    )
  if (!organization) return <ErrorState error={new Error(tt('Organization not found.'))} />
  return (
    <>
      <div className="consoleDetailStack">
        <Link className="consoleBackLink" to="/console/organizations">
          <ArrowLeft /> {tt('Organizations')}
        </Link>
        <header className="consoleDetailHeader">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1>{organization.name}</h1>
              <Badge variant={organization.disabled ? 'outline' : 'secondary'}>
                {organization.disabled ? tt('Suspended') : tt('Active')}
              </Badge>
            </div>
            <p>{tt('Shared identity and authorization context for members and owned Agent identities.')}</p>
            <span className="consoleDetailMeta">
              {organization.slug} · {organization.id}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link params={{ organizationId: organization.id }} to="/organizations/$organizationId/overview">
                {tt('Open Organization Workspace')}
              </Link>
            </Button>
          </div>
        </header>
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
        {selectedTab === 'overview' ? (
          <OrganizationOverview
            agents={organizationAgents.length}
            createdAt={organization.createdAt}
            invitations={pendingInvitations.length}
            members={membersQuery.data?.members.length ?? 0}
            updatedAt={organization.updatedAt}
          />
        ) : null}
        {selectedTab === 'members' ? (
          <OrganizationMembers
            invitations={pendingInvitations}
            members={visibleMembers}
            memberLevel={memberLevel}
            memberSearch={memberSearch}
            onCancelInvitation={(invitationId) => {
              const invitation = pendingInvitations.find((item) => item.id === invitationId)
              setMemberAction({
                type: 'cancel-invitation',
                id: invitationId,
                label: invitation?.email ?? invitationId,
              })
            }}
            onChangeLevel={setMemberLevel}
            onChangeSearch={setMemberSearch}
            onInvite={() => setInviteOpen(true)}
            onRemove={(memberId) => {
              const member = (membersQuery.data?.members ?? []).find((item) => item.id === memberId)
              const user = member ? userById.get(member.userId) : undefined
              setMemberAction({
                type: 'remove-member',
                id: memberId,
                label: user?.displayName ?? user?.name ?? user?.email ?? member?.userId ?? memberId,
              })
            }}
            onUpdate={(memberId, roles) =>
              replaceOrganizationMemberRoles(organizationId, memberId, { roles }).then(() =>
                queryClient.invalidateQueries({
                  queryKey: [...consoleQueryKeys.organizations, organizationId, 'members'],
                }),
              )
            }
            userById={userById}
          />
        ) : null}
        {selectedTab === 'agents' ? <OrganizationAgents identities={organizationAgents} /> : null}
        {selectedTab === 'activity' ? <OrganizationActivity events={activity} /> : null}
        {selectedTab === 'settings' ? (
          <OrganizationSettings
            disabled={organization.disabled}
            onDelete={() => setDeleteOpen(true)}
            onEdit={() => setEditOpen(true)}
            onSuspend={() => setSuspendOpen(true)}
          />
        ) : null}
      </div>
      <OrganizationEditSheet
        error={updateMutation.errorMessage}
        onOpenChange={setEditOpen}
        onSubmit={(form) =>
          updateMutation.mutate(
            parseForm(updateOrganizationRequestSchema, {
              slug: String(form.get('slug') ?? ''),
              name: String(form.get('name') ?? ''),
            }),
          )
        }
        open={editOpen}
        organization={organization}
        pending={updateMutation.isPending}
      />
      <OrganizationInviteDialog
        error={inviteMutation.errorMessage}
        onOpenChange={setInviteOpen}
        onSubmit={(form) =>
          inviteMutation.mutate(
            parseForm(createInvitationRequestSchema, {
              email: String(form.get('email') ?? ''),
              roles: form.getAll('roles').map(String).sort(),
            }),
          )
        }
        open={inviteOpen}
        pending={inviteMutation.isPending}
        roles={rolesQuery.data?.roles ?? []}
      />
      <LifecycleDialog
        confirmLabel={organization?.disabled ? tt('Resume organization') : tt('Suspend organization')}
        description={
          organization?.disabled
            ? tt('Members can resume Organization operations immediately.')
            : tt('New Organization operations stop while identity and audit history remain available.')
        }
        destructive={!organization?.disabled}
        error={updateMutation.errorMessage}
        onConfirm={() =>
          updateMutation.mutate({
            disabled: !organization?.disabled,
            disabledReason: organization?.disabled ? null : 'Suspended by Realm operator',
          })
        }
        onOpenChange={setSuspendOpen}
        open={suspendOpen}
        pending={updateMutation.isPending}
        title={organization?.disabled ? tt('Resume this organization?') : tt('Suspend this organization?')}
      />
      <LifecycleDialog
        confirmLabel={tt('Delete organization')}
        description={tt(
          'Resolve ownership, active grants, and member dependencies before permanently deleting this Organization.',
        )}
        destructive
        error={deleteMutation.errorMessage}
        onConfirm={() => deleteMutation.mutate(undefined)}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        pending={deleteMutation.isPending}
        title={tt('Delete {{name}}?', { name: organization?.name ?? tt('organization') })}
      />
      <DestructiveConfirmation
        confirmLabel={memberAction?.type === 'remove-member' ? tt('Remove member') : tt('Cancel invitation')}
        description={
          memberAction?.type === 'remove-member'
            ? tt('This member immediately loses Organization access and Organization-scoped authority.')
            : tt('This invitation can no longer be accepted. You can send a new invitation later.')
        }
        error={
          memberActionMutation.errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {memberActionMutation.errorMessage}
            </p>
          ) : null
        }
        onClose={() => setMemberAction(null)}
        onConfirm={() => memberAction && memberActionMutation.mutate(memberAction)}
        open={memberAction !== null}
        pending={memberActionMutation.isPending}
        title={
          memberAction?.type === 'remove-member'
            ? tt('Remove {{name}}?', { name: memberAction.label })
            : tt('Cancel invitation for {{email}}?', { email: memberAction?.label ?? '' })
        }
      />
    </>
  )
}

function OrganizationOverview({
  agents,
  createdAt,
  invitations,
  members,
  updatedAt,
}: {
  agents: number
  createdAt: string
  invitations: number
  members: number
  updatedAt: string
}) {
  return (
    <div className="detailFlatRows">
      <DetailRow label="Members" value={String(members)} />
      <DetailRow label="Pending invitations" value={String(invitations)} />
      <DetailRow label="Agent identities" value={String(agents)} />
      <DetailRow label="Created" value={formatDate(createdAt)} />
      <DetailRow label="Last updated" value={formatDate(updatedAt)} />
    </div>
  )
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

function OrganizationMembers({
  invitations,
  members,
  memberLevel,
  memberSearch,
  onCancelInvitation,
  onChangeLevel,
  onChangeSearch,
  onInvite,
  onRemove,
  onUpdate,
  userById,
}: {
  invitations: Awaited<ReturnType<typeof listOrganizationInvitations>>['invitations']
  members: Awaited<ReturnType<typeof listOrganizationMembers>>['members']
  memberLevel: string
  memberSearch: string
  onCancelInvitation: (id: string) => void
  onChangeLevel: (value: string) => void
  onChangeSearch: (value: string) => void
  onInvite: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, roles: string[]) => void
  userById: Map<string, Awaited<ReturnType<typeof listUsers>>['users'][number]>
}) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListToolbar>
          <TextInput
            aria-label={tt('Search members')}
            onChange={(event) => onChangeSearch(event.target.value)}
            placeholder={tt('Search members')}
            value={memberSearch}
          />
          <SelectInput
            aria-label={tt('Filter access level')}
            onChange={(event) => onChangeLevel(event.target.value)}
            value={memberLevel}
          >
            <option value="">{tt('Any access level')}</option>
            <option value="owner">{tt('Owner')}</option>
            <option value="admin">{tt('Administrator')}</option>
            <option value="developer">{tt('Developer')}</option>
            <option value="member">{tt('Member')}</option>
          </SelectInput>
        </ListToolbar>
        <Button onClick={onInvite}>
          <UserPlus />
          {tt('Invite member')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Member')}</TableHead>
              <TableHead>{tt('Email')}</TableHead>
              <TableHead>{tt('Access level')}</TableHead>
              <TableHead>{tt('Added')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const user = userById.get(member.userId)
              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <span className="font-medium">{user?.displayName ?? user?.name ?? member.userId}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{member.userId}</span>
                  </TableCell>
                  <TableCell>{user?.email ?? '—'}</TableCell>
                  <TableCell>{member.roles.map(accessLevelLabel).join(', ')}</TableCell>
                  <TableCell>{formatDate(member.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{tt('Active')}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {!member.roles.includes('owner') ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={tt('Manage {{name}}', {
                              name: user?.displayName ?? user?.name ?? member.userId,
                            })}
                            size="icon"
                            variant="ghost"
                          >
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => onUpdate(member.id, toggleAdministratorRole(member.roles))}>
                            {member.roles.includes('admin') ? tt('Remove Administrator') : tt('Add Administrator')}
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => onRemove(member.id)}>
                            {tt('Remove member')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell>
                  <span className="font-medium">{invitation.email}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{invitation.id}</span>
                </TableCell>
                <TableCell>{invitation.email}</TableCell>
                <TableCell>{invitation.roles.map(accessLevelLabel).join(', ')}</TableCell>
                <TableCell>{formatDate(invitation.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{tt('Invited')}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    aria-label={tt('Cancel invitation for {{email}}', { email: invitation.email })}
                    onClick={() => onCancelInvitation(invitation.id)}
                    size="sm"
                    variant="ghost"
                  >
                    {tt('Cancel')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!members.length && !invitations.length ? (
              <TableEmptyRow
                colSpan={6}
                description={tt('Invite a member to begin collaborating in this Organization.')}
                title={tt('No members found')}
              />
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function OrganizationAgents({ identities }: { identities: Awaited<ReturnType<typeof getAgentInventory>>['items'] }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Agent')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
            <TableHead>{tt('Issuer')}</TableHead>
            <TableHead>{tt('Updated')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {identities.length ? (
            identities.map((identity) => (
              <TableRow key={identity.id}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    params={{ agentId: identity.id }}
                    to="/console/agents/$agentId"
                  >
                    {identity.name}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">{identity.subject}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={identity.status === 'active' ? 'secondary' : 'outline'}>{identity.status}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{identity.issuer}</TableCell>
                <TableCell>{formatDate(identity.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    <Link params={{ agentId: identity.id }} to="/console/agents/$agentId">
                      {tt('Open')}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={5}
              description={tt('Organization-owned Agents appear here after enrollment.')}
              title={tt('No Agent identities')}
            />
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function OrganizationActivity({ events }: { events: Awaited<ReturnType<typeof getAgentAuditEvents>>['items'] }) {
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
                <TableCell>{formatDate(event.occurredAt)}</TableCell>
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

function OrganizationSettings({
  disabled,
  onDelete,
  onEdit,
  onSuspend,
}: {
  disabled: boolean
  onDelete: () => void
  onEdit: () => void
  onSuspend: () => void
}) {
  return (
    <div className="detailFlatRows">
      <DetailRow
        action={
          <Button onClick={onEdit} variant="outline">
            {tt('Edit')}
          </Button>
        }
        description="Name and slug used across Realmroot."
        label="Organization profile"
        value={tt('Configured')}
      />
      <DetailRow
        action={
          <Button onClick={onSuspend} variant={disabled ? 'outline' : 'destructive'}>
            {disabled ? tt('Resume') : tt('Suspend')}
          </Button>
        }
        description="Suspending blocks new Organization operations while preserving audit history."
        label="Organization status"
        value={<Badge variant={disabled ? 'outline' : 'secondary'}>{disabled ? tt('Suspended') : tt('Active')}</Badge>}
      />
      <DetailRow
        action={
          <Button onClick={onDelete} variant="destructive">
            {tt('Delete')}
          </Button>
        }
        description="Resolve owned identities and active authority before deletion."
        label="Delete organization"
        value="Permanent"
      />
    </div>
  )
}

function OrganizationEditSheet({
  error,
  onOpenChange,
  onSubmit,
  open,
  organization,
  pending,
}: {
  error?: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (form: FormData) => void
  open: boolean
  organization?: Awaited<ReturnType<typeof getOrganization>>
  pending: boolean
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="h-full overflow-hidden">
        <SheetHeader className="shrink-0">
          <SheetTitle>{tt('Edit organization')}</SheetTitle>
          <SheetDescription>{tt('Update the identity used to recognize this shared context.')}</SheetDescription>
        </SheetHeader>
        {organization ? (
          <form
            className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-5"
            id="organization-edit"
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit(new FormData(event.currentTarget))
            }}
          >
            <Field label={tt('Name')}>
              <TextInput defaultValue={organization.name} name="name" required />
            </Field>
            <Field label={tt('Slug')} help={tt('Lowercase letters, numbers, and hyphens only.')}>
              <TextInput defaultValue={organization.slug} name="slug" required />
            </Field>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
        <SheetFooter className="shrink-0">
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending} form="organization-edit" type="submit">
            {pending ? tt('Saving…') : tt('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function OrganizationInviteDialog({
  error,
  onOpenChange,
  onSubmit,
  open,
  pending,
  roles,
}: {
  error?: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (form: FormData) => void
  open: boolean
  pending: boolean
  roles: { key: string; displayName: string }[]
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tt('Invite member')}</DialogTitle>
          <DialogDescription>
            {tt('Invite a Realm user and choose the access level used to administer this Organization.')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          id="organization-invite"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            onSubmit(new FormData(event.currentTarget))
          }}
        >
          <Field label={tt('Email')}>
            <TextInput name="email" required type="email" />
          </Field>
          <Field label={tt('Roles')}>
            <div className="grid gap-2 rounded-md border p-3">
              {roles.map((role) => (
                <label className="flex items-center gap-2 text-sm" key={role.key}>
                  <input defaultChecked={role.key === 'member'} name="roles" type="checkbox" value={role.key} />
                  {role.displayName}
                </label>
              ))}
            </div>
          </Field>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending} form="organization-invite" type="submit">
            {pending ? tt('Sending…') : tt('Send invitation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LifecycleDialog({
  confirmLabel,
  description,
  destructive,
  error,
  onConfirm,
  onOpenChange,
  open,
  pending,
  title,
}: {
  confirmLabel: string
  description: string
  destructive?: boolean
  error?: string | null
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  pending: boolean
  title: string
}) {
  if (destructive)
    return (
      <DestructiveConfirmation
        confirmLabel={confirmLabel}
        description={description}
        error={
          error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null
        }
        onClose={() => onOpenChange(false)}
        onConfirm={onConfirm}
        open={open}
        pending={pending}
        title={title}
      />
    )
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            {pending ? tt('Working…') : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function accessLevelLabel(role: string) {
  return (
    (
      { owner: tt('Owner'), admin: tt('Administrator'), developer: tt('Developer'), member: tt('Member') } as Record<
        string,
        string
      >
    )[role] ?? role
  )
}

function toggleAdministratorRole(roles: string[]) {
  if (!roles.includes('admin')) return [...roles.filter((role) => role !== 'member'), 'admin'].sort()
  const remaining = roles.filter((role) => role !== 'admin')
  return remaining.length > 0 ? remaining : ['member']
}
