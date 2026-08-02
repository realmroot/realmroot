import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Field, SelectInput, TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/page-header'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  consoleQueryKeys,
  createRoleAssignment,
  getAgentInventory,
  listApplications,
  listOrganizations,
  listRoleAssignments,
  listRoles,
  listUsers,
  revokeRoleAssignment,
} from '@/lib/api/management'
import { useConsoleScope } from '@/lib/console-context'
import { tt } from '@/lib/i18n'
import { MutationError, StatusBadge } from '../helpers/helpers-dialogs'
import { ListToolbar } from '../helpers/helpers-resource'
import { formatDate, useAdminMutation, userDisplayName } from '../helpers/helpers-utils'

type SubjectType = 'user' | 'application' | 'agent'

export function RoleAssignmentsPage() {
  const { organizationId: context } = useConsoleScope()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [subjectType, setSubjectType] = useState('')
  const [roleId, setRoleId] = useState('')
  const [organizationId, setOrganizationId] = useState('')
  const [status, setStatus] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; label: string } | null>(null)
  const queryClient = useQueryClient()
  const assignments = useQuery({
    queryKey: consoleQueryKeys.roleAssignments,
    queryFn: () => listRoleAssignments({ limit: 100 }),
  })
  const roles = useQuery({ queryKey: consoleQueryKeys.roles, queryFn: listRoles })
  const users = useQuery({
    queryKey: consoleQueryKeys.users,
    queryFn: () => listUsers({ limit: 100 }),
  })
  const applications = useQuery({
    queryKey: consoleQueryKeys.applications,
    queryFn: () => listApplications(),
  })
  const agents = useQuery({
    queryKey: consoleQueryKeys.agents,
    queryFn: () => getAgentInventory(),
  })
  const organizations = useQuery({ queryKey: consoleQueryKeys.organizations, queryFn: listOrganizations })
  const roleNames = new Map((roles.data?.roles ?? []).map((role) => [role.id, role.name]))
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
  const revokeMutation = useAdminMutation({
    mutationFn: revokeRoleAssignment,
    onSuccess: () => {
      setRevokeTarget(null)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.roleAssignments })
    },
  })
  const visibleAssignments = (assignments.data?.assignments ?? []).filter((assignment) => {
    const subjectName = subjectNames.get(`${assignment.subjectType}:${assignment.subjectId}`) ?? assignment.subjectId
    const roleName = roleNames.get(assignment.roleId) ?? assignment.roleId
    const contextName = assignment.organizationId
      ? (organizationNames.get(assignment.organizationId) ?? assignment.organizationId)
      : tt('Realm-wide')
    const matchesSearch = `${subjectName} ${assignment.subjectId} ${roleName} ${contextName}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
    const matchesContext =
      !organizationId ||
      (organizationId === 'realm' ? !assignment.organizationId : assignment.organizationId === organizationId)
    return (
      matchesSearch &&
      (!subjectType || assignment.subjectType === subjectType) &&
      (!roleId || assignment.roleId === roleId) &&
      matchesContext &&
      (!status || assignmentState(assignment.expiresAt, assignment.revokedAt) === status)
    )
  })

  return (
    <>
      <PageHeader
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus />
            {tt('Assign role')}
          </Button>
        }
        description={tt('Review reusable roles assigned to users, applications, and Agents across this Realm.')}
        title={tt('Role assignments')}
      />
      <ListToolbar>
        <TextInput
          aria-label={tt('Search role assignments')}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tt('Search subject, role, or context')}
          value={search}
        />
        <SelectInput
          aria-label={tt('Filter assignment subject type')}
          onChange={(event) => setSubjectType(event.target.value)}
          value={subjectType}
        >
          <option value="">{tt('Any subject type')}</option>
          <option value="user">{tt('User')}</option>
          <option value="workload">{tt('Workload')}</option>
          <option value="agent">{tt('Agent')}</option>
        </SelectInput>
        <SelectInput
          aria-label={tt('Filter assignments by role')}
          onChange={(event) => setRoleId(event.target.value)}
          value={roleId}
        >
          <option value="">{tt('Any role')}</option>
          {(roles.data?.roles ?? []).map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label={tt('Filter assignments by context')}
          onChange={(event) => setOrganizationId(event.target.value)}
          value={organizationId}
        >
          <option value="">{tt('Any context')}</option>
          <option value="realm">{tt('Realm-wide')}</option>
          {(organizations.data?.organizations ?? []).map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.displayName ?? organization.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label={tt('Filter assignment status')}
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">{tt('Any status')}</option>
          <option value="active">{tt('Active')}</option>
          <option value="expired">{tt('Expired')}</option>
          <option value="revoked">{tt('Revoked')}</option>
        </SelectInput>
      </ListToolbar>
      <div className="consoleResourceFrame overflow-hidden rounded-xl border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('Subject')}</TableHead>
              <TableHead>{tt('Type')}</TableHead>
              <TableHead>{tt('Role')}</TableHead>
              <TableHead>{tt('Context')}</TableHead>
              <TableHead>{tt('Expires')}</TableHead>
              <TableHead>{tt('Status')}</TableHead>
              <TableHead>{tt('Assigned by')}</TableHead>
              <TableHead>{tt('Updated')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleAssignments.length ? (
              visibleAssignments.map((assignment) => {
                const subjectLabel =
                  subjectNames.get(`${assignment.subjectType}:${assignment.subjectId}`) ?? assignment.subjectId
                const active = assignmentState(assignment.expiresAt, assignment.revokedAt) === 'active'
                return (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      <strong>{subjectLabel}</strong>
                      <span className="block font-mono text-xs text-muted-foreground">{assignment.subjectId}</span>
                    </TableCell>
                    <TableCell>{subjectTypeLabel(assignment.subjectType)}</TableCell>
                    <TableCell>{roleNames.get(assignment.roleId) ?? <code>{assignment.roleId}</code>}</TableCell>
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
                    <TableCell>{formatDate(assignment.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      {active ? (
                        <Button
                          onClick={() => setRevokeTarget({ id: assignment.id, label: subjectLabel })}
                          size="sm"
                          variant="ghost"
                        >
                          {tt('Revoke')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableEmptyRow
                colSpan={9}
                description={tt(
                  assignments.isLoading
                    ? 'Loading assignments…'
                    : assignments.data?.assignments.length
                      ? 'Try another subject, role, context, or status filter.'
                      : 'Assignments will appear here after authority is granted to an actor.',
                )}
                title={tt(
                  assignments.error
                    ? 'Role assignments unavailable'
                    : assignments.data?.assignments.length
                      ? 'No matching role assignments'
                      : 'No role assignments',
                )}
              />
            )}
          </TableBody>
        </Table>
      </div>
      <AssignmentDialog context={context} key={context ?? 'realm'} onClose={() => setOpen(false)} open={open} />
      <DestructiveConfirmation
        confirmLabel={revokeMutation.isPending ? tt('Revoking…') : tt('Revoke assignment')}
        description={tt(
          'Remove this role from {{subject}}. Existing sessions may retain already issued token claims until expiry.',
          { subject: revokeTarget?.label ?? '' },
        )}
        error={<MutationError error={revokeMutation.error} />}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
        open={Boolean(revokeTarget)}
        pending={revokeMutation.isPending}
        title={tt('Revoke role assignment')}
      />
    </>
  )
}

function AssignmentDialog({ context, onClose, open }: { context?: string; onClose: () => void; open: boolean }) {
  const queryClient = useQueryClient()
  const [subjectType, setSubjectType] = useState<SubjectType>('user')
  const [subjectId, setSubjectId] = useState('')
  const [roleId, setRoleId] = useState('')
  const [organizationId, setOrganizationId] = useState(context ?? '')
  const [expiryMode, setExpiryMode] = useState('never')
  const [expiresAt, setExpiresAt] = useState('')
  const roles = useQuery({ queryKey: consoleQueryKeys.roles, queryFn: listRoles, enabled: open })
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
  const subjects = useMemo(() => {
    if (subjectType === 'agent') {
      return (agents.data?.items ?? []).map((agent) => ({ id: agent.id, label: agent.name }))
    }
    if (subjectType === 'application') {
      return (applications.data?.applications ?? []).map((application) => ({
        id: application.id,
        label: application.name,
      }))
    }
    return (users.data?.users ?? []).map((user) => ({ id: user.id, label: userDisplayName(user) }))
  }, [agents.data, applications.data, subjectType, users.data])
  const mutation = useAdminMutation({
    mutationFn: () => {
      const input = {
        roleId,
        subjectId,
        ...(expiryMode === 'date' ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      }
      return createRoleAssignment({
        ...input,
        subjectType: subjectType === 'application' ? 'workload' : subjectType,
        organizationId: organizationId || null,
      })
    },
    onSuccess: () => {
      resetForm()
      onClose()
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.roleAssignments })
    },
  })

  function resetForm() {
    setSubjectType('user')
    setSubjectId('')
    setRoleId('')
    setOrganizationId(context ?? '')
    setExpiryMode('never')
    setExpiresAt('')
  }

  function close() {
    resetForm()
    mutation.reset()
    onClose()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate(undefined)
  }

  return (
    <Dialog onOpenChange={(next) => !next && close()} open={open}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{tt('Assign role')}</DialogTitle>
            <DialogDescription>{tt('Grant a reusable Realm role to an existing actor.')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <Field label={tt('Subject type')}>
              <SelectInput
                name="subjectType"
                onChange={(event) => {
                  setSubjectType(event.target.value as SubjectType)
                  setSubjectId('')
                }}
                value={subjectType}
              >
                <option value="user">{tt('User')}</option>
                <option value="application">{tt('Application')}</option>
                <option value="agent">{tt('Agent')}</option>
              </SelectInput>
            </Field>
            <Field label={tt('Subject')}>
              <SelectInput
                name="subjectId"
                onChange={(event) => setSubjectId(event.target.value)}
                required
                value={subjectId}
              >
                <option value="">{tt('Select a subject')}</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label={tt('Role')}>
              <SelectInput name="roleId" onChange={(event) => setRoleId(event.target.value)} required value={roleId}>
                <option value="">{tt('Select a role')}</option>
                {(roles.data?.roles ?? []).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field
              help={tt(
                'Use an Organization context only when this authority should apply while acting in that Organization.',
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
              <SelectInput name="expiryMode" onChange={(event) => setExpiryMode(event.target.value)} value={expiryMode}>
                <option value="never">{tt('Never')}</option>
                <option value="date">{tt('Until a date')}</option>
              </SelectInput>
            </Field>
            {expiryMode === 'date' ? (
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
            <Button disabled={!subjectId || !roleId || mutation.isPending} type="submit">
              {mutation.isPending ? tt('Assigning…') : tt('Assign role')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function subjectTypeLabel(subjectType: 'user' | 'agent' | 'workload') {
  return tt(subjectType === 'workload' ? 'Workload' : subjectType === 'agent' ? 'Agent' : 'User')
}

function AssignmentStatus({ expiresAt, revokedAt }: { expiresAt: string | null; revokedAt: string | null }) {
  const state = assignmentState(expiresAt, revokedAt)
  return (
    <StatusBadge
      active={state === 'active'}
      activeLabel={tt('Active')}
      inactiveLabel={tt(state === 'revoked' ? 'Revoked' : 'Expired')}
    />
  )
}

function assignmentState(expiresAt: string | null, revokedAt: string | null) {
  if (revokedAt) return 'revoked'
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return 'expired'
  return 'active'
}
