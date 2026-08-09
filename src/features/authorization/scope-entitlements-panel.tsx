import type { ApiResourceResponse } from '@shared/api/authorization'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Field, SelectInput, TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState, LoadingState, MutationError } from '@/features/management/dialogs'
import { consoleQueryKeys } from '@/lib/api/console-query-keys'
import {
  createApplicationScopeEntitlement,
  createUserScopeEntitlement,
  deleteApplicationScopeEntitlement,
  deleteUserScopeEntitlement,
  listApiResources,
  listApplicationScopeEntitlements,
  listUserScopeEntitlements,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'

type ScopeEntitlementSubject =
  | { type: 'user'; id: string; label: string }
  | { type: 'application'; id: string; label: string }

type ScopeEntitlement = Pick<
  Awaited<ReturnType<typeof listUserScopeEntitlements>>['items'][number],
  'id' | 'resourceServerId' | 'scope' | 'mode' | 'status' | 'expiresAt'
>
type ScopeEntitlementPage = {
  items: ScopeEntitlement[]
  pagination: Awaited<ReturnType<typeof listUserScopeEntitlements>>['pagination']
}

const pageSize = 50

export function ScopeEntitlementsPanel({ subject }: { subject: ScopeEntitlementSubject }) {
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ScopeEntitlement | null>(null)
  const queryKey = scopeEntitlementQueryKey(subject, offset)
  const resourcesQuery = useQuery({
    queryKey: [...consoleQueryKeys.apiResources, { purpose: 'scope-entitlements' }],
    queryFn: () => listApiResources({ limit: 100 }),
  })
  const entitlementsQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<ScopeEntitlementPage> => {
      const result =
        subject.type === 'user'
          ? await listUserScopeEntitlements(subject.id, { limit: pageSize, offset })
          : await listApplicationScopeEntitlements(subject.id, { limit: pageSize, offset })
      return { items: result.items, pagination: result.pagination }
    },
  })
  const createMutation = useMutation({
    mutationFn: async (input: {
      resourceServerId: string
      scope: string
      mode: 'persistent' | 'until'
      expiresAt: string | null
    }) => {
      if (subject.type === 'user') await createUserScopeEntitlement(subject.id, input)
      else await createApplicationScopeEntitlement(subject.id, input)
    },
    onSuccess: async () => {
      setCreateOpen(false)
      setOffset(0)
      await queryClient.invalidateQueries({ queryKey: scopeEntitlementQueryPrefix(subject) })
    },
  })
  const revokeMutation = useMutation({
    mutationFn: (entitlementId: string) =>
      subject.type === 'user'
        ? deleteUserScopeEntitlement(subject.id, entitlementId)
        : deleteApplicationScopeEntitlement(subject.id, entitlementId),
    onSuccess: async () => {
      setRevokeTarget(null)
      if (entitlementsQuery.data?.items.length === 1 && offset > 0) setOffset(Math.max(0, offset - pageSize))
      await queryClient.invalidateQueries({ queryKey: scopeEntitlementQueryPrefix(subject) })
    },
  })

  if (resourcesQuery.isLoading || entitlementsQuery.isLoading)
    return <LoadingState label={tt('Loading Resource access')} />
  const error = resourcesQuery.error ?? entitlementsQuery.error
  if (error)
    return (
      <ErrorState error={error} onRetry={() => Promise.all([resourcesQuery.refetch(), entitlementsQuery.refetch()])} />
    )

  const resources = resourcesQuery.data?.items ?? []
  const assignableResources = resources.filter((resource) => assignedScopes(resource).length > 0)
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  const entitlements = entitlementsQuery.data?.items ?? []
  const pagination = entitlementsQuery.data?.pagination

  return (
    <>
      <div className="detailSections">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{tt('Resource access')}</h2>
            <p className="text-sm text-muted-foreground">
              {tt('Assigned Resource Server scopes held directly by {{subject}}.', { subject: subject.label })}
            </p>
          </div>
          <Button disabled={assignableResources.length === 0} onClick={() => setCreateOpen(true)}>
            <Plus />
            {tt('Add scope')}
          </Button>
        </div>
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tt('Resource Server')}</TableHead>
                <TableHead>{tt('Scope')}</TableHead>
                <TableHead>{tt('Mode')}</TableHead>
                <TableHead>{tt('Status')}</TableHead>
                <TableHead>{tt('Expires')}</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">{tt('Actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entitlements.length ? (
                entitlements.map((entitlement) => {
                  const resource = resourceById.get(entitlement.resourceServerId)
                  return (
                    <TableRow key={entitlement.id}>
                      <TableCell>
                        <div className="flex min-w-40 flex-col whitespace-normal">
                          <span className="font-medium">{resource?.name ?? entitlement.resourceServerId}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {resource?.identifier ?? entitlement.resourceServerId}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{entitlement.scope}</Badge>
                      </TableCell>
                      <TableCell>{entitlement.mode}</TableCell>
                      <TableCell>
                        <Badge variant={entitlement.status === 'active' ? 'secondary' : 'outline'}>
                          {entitlement.status === 'active' ? tt('Active') : tt('Ended')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entitlement.expiresAt
                          ? new Date(entitlement.expiresAt).toLocaleString()
                          : tt('Does not expire')}
                      </TableCell>
                      <TableCell>
                        {entitlement.status === 'active' ? (
                          <Button onClick={() => setRevokeTarget(entitlement)} size="sm" variant="outline">
                            {tt('Revoke')}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableEmptyRow
                  colSpan={6}
                  description={tt('Assigned Resource Server scopes will appear here.')}
                  title={tt('No Resource access')}
                />
              )}
            </TableBody>
          </Table>
          {pagination && pagination.total > pageSize ? (
            <div className="flex items-center justify-between border-t px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {tt('{{start}}–{{end}} of {{total}}', {
                  start: pagination.offset + 1,
                  end: Math.min(pagination.offset + pagination.limit, pagination.total),
                  total: pagination.total,
                })}
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - pageSize))}
                  variant="outline"
                >
                  {tt('Previous')}
                </Button>
                <Button
                  disabled={!pagination.hasMore || pagination.nextOffset === null}
                  onClick={() => setOffset(pagination.nextOffset!)}
                  variant="outline"
                >
                  {tt('Next')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <CreateScopeEntitlementSheet
        error={<MutationError error={createMutation.error} />}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => createMutation.mutate(input)}
        open={createOpen}
        pending={createMutation.isPending}
        resources={assignableResources}
      />
      <DestructiveConfirmation
        confirmLabel={revokeMutation.isPending ? tt('Revoking…') : tt('Revoke scope')}
        description={tt('This scope stops applying immediately. Existing audit history is preserved.')}
        error={<MutationError error={revokeMutation.error} />}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => revokeMutation.mutate(revokeTarget!.id)}
        open={revokeTarget !== null}
        pending={revokeMutation.isPending}
        title={tt('Revoke scope?')}
      />
    </>
  )
}

function CreateScopeEntitlementSheet({
  error,
  onClose,
  onSubmit,
  open,
  pending,
  resources,
}: {
  error: ReactNode
  onClose: () => void
  onSubmit: (input: {
    resourceServerId: string
    scope: string
    mode: 'persistent' | 'until'
    expiresAt: string | null
  }) => void
  open: boolean
  pending: boolean
  resources: ApiResourceResponse[]
}) {
  const [resourceId, setResourceId] = useState('')
  const [scope, setScope] = useState('')
  const selectedResource = resources.find((resource) => resource.id === resourceId)
  const firstResource = resources[0]
  const availableScopes = useMemo(() => assignedScopes(selectedResource), [selectedResource])

  useEffect(() => {
    if (!open) return
    setResourceId(firstResource?.id ?? '')
    setScope(assignedScopes(firstResource)[0]?.value ?? '')
  }, [open, firstResource])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const expiresAt = String(form.get('expiresAt') ?? '').trim()
    onSubmit({
      resourceServerId: resourceId,
      scope,
      mode: expiresAt ? 'until' : 'persistent',
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    })
  }

  return (
    <Sheet onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <SheetContent className="flex h-full flex-col overflow-hidden sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{tt('Add Resource scope')}</SheetTitle>
          <SheetDescription>{tt('Assign one scope with its own independent lifetime.')}</SheetDescription>
        </SheetHeader>
        <form
          className="grid flex-1 content-start gap-5 overflow-y-auto px-4 py-5"
          id="create-scope-entitlement"
          onSubmit={submit}
        >
          <Field label={tt('Resource Server')}>
            <SelectInput
              onChange={(event) => {
                setResourceId(event.target.value)
                setScope(
                  assignedScopes(resources.find((resource) => resource.id === event.target.value))[0]?.value ?? '',
                )
              }}
              required
              value={resourceId}
            >
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={tt('Scope')}>
            <SelectInput onChange={(event) => setScope(event.target.value)} required value={scope}>
              {availableScopes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.value}
                  {item.description ? ` — ${item.description}` : ''}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field help={tt('Leave empty for a persistent Entitlement.')} label={tt('Expires')}>
            <TextInput name="expiresAt" type="datetime-local" />
          </Field>
          {error}
        </form>
        <SheetFooter>
          <Button onClick={onClose} type="button" variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending || !resourceId || !scope} form="create-scope-entitlement" type="submit">
            {pending ? tt('Adding…') : tt('Add scope')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function assignedScopes(resource?: ApiResourceResponse) {
  return resource?.scopeRegistry?.scopes.filter((scope) => scope.grantMode === 'assigned') ?? []
}

function scopeEntitlementQueryPrefix(subject: ScopeEntitlementSubject) {
  return subject.type === 'user'
    ? [...consoleQueryKeys.users, subject.id, 'scope-entitlements']
    : [...consoleQueryKeys.applications, subject.id, 'scope-entitlements']
}

function scopeEntitlementQueryKey(subject: ScopeEntitlementSubject, offset: number) {
  return [...scopeEntitlementQueryPrefix(subject), { limit: pageSize, offset }]
}
