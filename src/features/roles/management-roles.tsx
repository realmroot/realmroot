import type { CreateRoleRequest, RoleResponse, UpdateRoleRequest } from '@shared/api/authorization'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Field, TextArea, TextInput } from '@/components/product-form'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState, LoadingState, MutationError } from '@/features/management/dialogs'
import { navigateConsoleTab, ResourcePage } from '@/features/management/resource-components'
import type { RoleDetailSection } from '@/features/management/shared'
import { formatDate } from '@/features/management/utils'
import { createRole, deleteRole, getRole, listRoles, updateRole } from '@/lib/api/management'
import { tt } from '@/lib/i18n'

function rolesKey(organizationId: string) {
  return ['console', 'organizations', organizationId, 'roles'] as const
}

export function RolesPage({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const query = useQuery({
    queryKey: rolesKey(organizationId),
    queryFn: () => listRoles(organizationId),
  })
  const createMutation = useMutation({
    mutationFn: (input: CreateRoleRequest) => createRole(organizationId, input),
    onSuccess: async () => {
      setCreateOpen(false)
      await queryClient.invalidateQueries({ queryKey: rolesKey(organizationId) })
    },
  })
  return (
    <ResourcePage
      action={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          {tt('New role')}
        </Button>
      }
      auxiliary={
        <RoleEditor
          error={createMutation.error}
          onClose={() => setCreateOpen(false)}
          onSubmit={(input) => createMutation.mutate(input as CreateRoleRequest)}
          open={createOpen}
          pending={createMutation.isPending}
        />
      }
      description={tt('Organization Roles map human membership to tenant-bound scopes.')}
      empty={(query.data?.items.length ?? 0) === 0}
      emptyDescription={tt('Create a dynamic Organization Role for this tenant.')}
      emptyTitle={tt('No Roles')}
      error={query.error}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
      title={tt('Roles')}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Role')}</TableHead>
            <TableHead>{tt('Key')}</TableHead>
            <TableHead>{tt('Type')}</TableHead>
            <TableHead>{tt('Scopes')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(query.data?.items ?? []).map((role) => (
            <TableRow key={role.key}>
              <TableCell>
                <Link
                  className="font-medium hover:underline"
                  params={{ organizationId, roleId: role.key }}
                  to="/organizations/$organizationId/roles/$roleId/overview"
                >
                  {role.displayName}
                </Link>
                <span className="block text-xs text-muted-foreground">{role.description ?? '—'}</span>
              </TableCell>
              <TableCell>
                <code>{role.key}</code>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{role.predefined ? tt('Predefined') : tt('Dynamic')}</Badge>
              </TableCell>
              <TableCell>{role.scopes.length}</TableCell>
            </TableRow>
          ))}
          {(query.data?.items.length ?? 0) === 0 ? (
            <TableEmptyRow
              colSpan={4}
              description={tt('Create a dynamic Role for this Organization.')}
              title={tt('No Roles')}
            />
          ) : null}
        </TableBody>
      </Table>
    </ResourcePage>
  )
}

export function RoleDetailPage({
  organizationId,
  roleId,
  section = 'overview',
}: {
  organizationId: string
  roleId: string
  section?: RoleDetailSection
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const routeSection = section === 'permissions' ? 'permissions' : 'overview'
  const [selectedTab, setSelectedTab] = useState<'overview' | 'permissions'>(routeSection)
  useEffect(() => setSelectedTab(routeSection), [routeSection])
  const query = useQuery({
    queryKey: [...rolesKey(organizationId), roleId],
    queryFn: () => getRole(organizationId, roleId),
  })
  const updateMutation = useMutation({
    mutationFn: (input: UpdateRoleRequest) => updateRole(organizationId, roleId, input),
    onSuccess: async () => {
      setEditOpen(false)
      await queryClient.invalidateQueries({ queryKey: rolesKey(organizationId) })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteRole(organizationId, roleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: rolesKey(organizationId) })
      await navigate({ params: { organizationId }, to: '/organizations/$organizationId/roles' })
    },
  })
  if (query.isLoading) return <LoadingState label={tt('Loading Role…')} />
  if (query.error || !query.data) return <ErrorState error={query.error ?? new Error('Role was not found.')} />
  const role = query.data
  return (
    <>
      <div className="consoleDetailStack">
        <Link className="consoleBackLink" params={{ organizationId }} to="/organizations/$organizationId/roles">
          <ArrowLeft />
          {tt('Roles')}
        </Link>
        <header className="consoleDetailHeader">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1>{role.displayName}</h1>
              <Badge variant="outline">{role.predefined ? tt('Predefined') : tt('Dynamic')}</Badge>
            </div>
            <p>{role.description ?? tt('Organization Role')}</p>
            <span className="consoleDetailMeta">
              {role.key} · {tt('{{count}} scopes', { count: role.scopes.length })}
            </span>
          </div>
          {role.predefined ? null : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setEditOpen(true)} variant="outline">
                {tt('Edit')}
              </Button>
              <Button onClick={() => setDeleteOpen(true)} variant="destructive">
                <Trash2 />
                {tt('Delete')}
              </Button>
            </div>
          )}
        </header>
        <Tabs
          onValueChange={(value) => {
            const next = value as 'overview' | 'permissions'
            setSelectedTab(next)
            navigateConsoleTab(navigate, `/organizations/${organizationId}/roles/${roleId}/${next}`)
          }}
          value={selectedTab}
        >
          <TabsList aria-label={tt('Role detail sections')} className="w-full" variant="navigation">
            <TabsTrigger value="overview">{tt('Overview')}</TabsTrigger>
            <TabsTrigger value="permissions">{tt('Permissions')}</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-5" value="overview">
            <RoleOverview role={role} />
          </TabsContent>
          <TabsContent className="mt-5" value="permissions">
            <RoleScopes role={role} />
          </TabsContent>
        </Tabs>
      </div>
      <RoleEditor
        error={updateMutation.error}
        initial={role}
        onClose={() => setEditOpen(false)}
        onSubmit={(input) => updateMutation.mutate(input)}
        open={editOpen}
        pending={updateMutation.isPending}
      />
      <DestructiveConfirmation
        confirmLabel={tt('Delete Role')}
        description={tt('Assigned Roles cannot be deleted.')}
        error={deleteMutation.error instanceof Error ? deleteMutation.error.message : undefined}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        open={deleteOpen}
        pending={deleteMutation.isPending}
        title={tt('Delete {{name}}?', { name: role.displayName })}
      />
    </>
  )
}

function RoleOverview({ role }: { role: RoleResponse }) {
  return (
    <div className="detailFlatRows">
      <RoleDetailRow label={tt('Key')} value={<code>{role.key}</code>} />
      <RoleDetailRow label={tt('Type')} value={role.predefined ? tt('Predefined') : tt('Dynamic')} />
      <RoleDetailRow label={tt('Created')} value={role.createdAt ? formatDate(role.createdAt) : '—'} />
      <RoleDetailRow label={tt('Updated')} value={role.updatedAt ? formatDate(role.updatedAt) : '—'} />
    </div>
  )
}

function RoleDetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detailFlatRow">
      <div>
        <strong>{label}</strong>
      </div>
      <span>{value}</span>
      <i />
    </div>
  )
}

function RoleScopes({ role }: { role: RoleResponse }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tt('Resource Server')}</TableHead>
          <TableHead>{tt('Scope')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {role.scopes.map((scope) => (
          <TableRow key={`${scope.resourceId}:${scope.scope}`}>
            <TableCell>
              <code>{scope.resourceId}</code>
            </TableCell>
            <TableCell>
              <code>{scope.scope}</code>
            </TableCell>
          </TableRow>
        ))}
        {!role.scopes.length ? (
          <TableEmptyRow colSpan={2} description={tt('This Role grants no scopes.')} title={tt('No scopes')} />
        ) : null}
      </TableBody>
    </Table>
  )
}

function RoleEditor({
  error,
  initial,
  onClose,
  onSubmit,
  open,
  pending,
}: {
  error: unknown
  initial?: RoleResponse
  onClose: () => void
  onSubmit: (input: UpdateRoleRequest | CreateRoleRequest) => void
  open: boolean
  pending: boolean
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const base = {
      displayName: String(form.get('displayName') ?? '').trim(),
      description: String(form.get('description') ?? '').trim() || null,
      scopes: initial ? parseScopes(String(form.get('scopes') ?? '')) : [],
    }
    onSubmit(initial ? base : { ...base, key: String(form.get('key') ?? '').trim() })
  }
  return (
    <Dialog onOpenChange={(value) => !value && onClose()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? tt('Edit Role') : tt('Create Role')}</DialogTitle>
          <DialogDescription>
            {initial
              ? tt('One scope per line: resourceId scope-name.')
              : tt('Create the Role first, then assign Scopes from its detail page.')}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          {!initial ? (
            <Field label={tt('Key')}>
              <TextInput name="key" pattern="[a-z0-9]+(?:[-_][a-z0-9]+)*" required />
            </Field>
          ) : null}
          <Field label={tt('Display name')}>
            <TextInput defaultValue={initial?.displayName} name="displayName" required />
          </Field>
          <Field label={tt('Description')}>
            <TextArea defaultValue={initial?.description ?? ''} name="description" />
          </Field>
          {initial ? (
            <Field label={tt('Scopes')}>
              <TextArea
                defaultValue={initial.scopes.map((scope) => `${scope.resourceId} ${scope.scope}`).join('\n')}
                name="scopes"
                rows={8}
              />
            </Field>
          ) : null}
          <MutationError error={error instanceof Error ? error.message : undefined} />
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              {tt('Cancel')}
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? tt('Saving…') : tt('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function parseScopes(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(' ')
      if (separator < 1) throw new Error('Each scope line must contain a Resource Server ID and scope.')
      return { resourceId: line.slice(0, separator), scope: line.slice(separator + 1).trim() }
    })
}
