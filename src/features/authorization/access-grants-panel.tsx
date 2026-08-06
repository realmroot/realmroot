import type { ApiResourceResponse } from '@shared/api/authorization'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Field, SelectInput, TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState, LoadingState, MutationError } from '@/features/management/dialogs'
import { consoleQueryKeys } from '@/lib/api/console-query-keys'
import {
  createApplicationScopeGrant,
  createUserScopeGrant,
  deleteApplicationScopeGrant,
  deleteUserScopeGrant,
  listApiResources,
  listApplicationScopeGrants,
  listUserScopeGrants,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'

type AccessGrantSubject =
  | { type: 'user'; id: string; label: string }
  | { type: 'application'; id: string; label: string }

type AccessGrant = Pick<
  Awaited<ReturnType<typeof listUserScopeGrants>>['items'][number],
  'id' | 'resourceServerId' | 'scopes' | 'status' | 'expiresAt'
>
type AccessGrantPage = {
  items: AccessGrant[]
  pagination: Awaited<ReturnType<typeof listUserScopeGrants>>['pagination']
}

const pageSize = 50

export function AccessGrantsPanel({ subject }: { subject: AccessGrantSubject }) {
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<AccessGrant | null>(null)
  const queryKey = accessGrantQueryKey(subject, offset)
  const resourcesQuery = useQuery({
    queryKey: [...consoleQueryKeys.apiResources, { purpose: 'access-grants' }],
    queryFn: () => listApiResources({ limit: 100 }),
  })
  const grantsQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<AccessGrantPage> => {
      const result =
        subject.type === 'user'
          ? await listUserScopeGrants(subject.id, { limit: pageSize, offset })
          : await listApplicationScopeGrants(subject.id, { limit: pageSize, offset })
      return { items: result.items, pagination: result.pagination }
    },
  })
  const createMutation = useMutation({
    mutationFn: async (input: { resourceServerId: string; scopes: string[]; expiresAt: string | null }) => {
      if (subject.type === 'user') await createUserScopeGrant(subject.id, input)
      else await createApplicationScopeGrant(subject.id, input)
    },
    onSuccess: async () => {
      setCreateOpen(false)
      setOffset(0)
      await queryClient.invalidateQueries({ queryKey: accessGrantQueryPrefix(subject) })
    },
  })
  const revokeMutation = useMutation({
    mutationFn: (grantId: string) =>
      subject.type === 'user'
        ? deleteUserScopeGrant(subject.id, grantId)
        : deleteApplicationScopeGrant(subject.id, grantId),
    onSuccess: async () => {
      setRevokeTarget(null)
      if (grantsQuery.data?.items.length === 1 && offset > 0) setOffset(Math.max(0, offset - pageSize))
      await queryClient.invalidateQueries({ queryKey: accessGrantQueryPrefix(subject) })
    },
  })

  if (resourcesQuery.isLoading || grantsQuery.isLoading) return <LoadingState label={tt('Loading access grants')} />
  const error = resourcesQuery.error ?? grantsQuery.error
  if (error)
    return <ErrorState error={error} onRetry={() => Promise.all([resourcesQuery.refetch(), grantsQuery.refetch()])} />

  const resources = resourcesQuery.data?.items ?? []
  const assignableResources = resources.filter((resource) => assignedScopes(resource).length > 0)
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  const grants = grantsQuery.data?.items ?? []
  const pagination = grantsQuery.data?.pagination

  return (
    <>
      <div className="detailSections">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{tt('Access grants')}</h2>
            <p className="text-sm text-muted-foreground">
              {tt('Assigned Resource Server scopes held directly by {{subject}}.', { subject: subject.label })}
            </p>
          </div>
          <Button disabled={assignableResources.length === 0} onClick={() => setCreateOpen(true)}>
            <Plus />
            {tt('Add access grant')}
          </Button>
        </div>
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tt('Resource Server')}</TableHead>
                <TableHead>{tt('Scopes')}</TableHead>
                <TableHead>{tt('Status')}</TableHead>
                <TableHead>{tt('Expires')}</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">{tt('Actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.length ? (
                grants.map((grant) => {
                  const resource = resourceById.get(grant.resourceServerId)
                  return (
                    <TableRow key={grant.id}>
                      <TableCell>
                        <div className="flex min-w-40 flex-col whitespace-normal">
                          <span className="font-medium">{resource?.name ?? grant.resourceServerId}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {resource?.identifier ?? grant.resourceServerId}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-md flex-wrap gap-1 whitespace-normal">
                          {grant.scopes.map((scope) => (
                            <Badge key={scope} variant="outline">
                              {scope}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={grant.status === 'active' ? 'secondary' : 'outline'}>{grant.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {grant.expiresAt ? new Date(grant.expiresAt).toLocaleString() : tt('Does not expire')}
                      </TableCell>
                      <TableCell>
                        <Button onClick={() => setRevokeTarget(grant)} size="sm" variant="outline">
                          {tt('Revoke')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableEmptyRow
                  colSpan={5}
                  description={tt('Assigned Resource Server scopes will appear here.')}
                  title={tt('No access grants')}
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
                  onClick={() => setOffset(pagination.nextOffset ?? offset)}
                  variant="outline"
                >
                  {tt('Next')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <CreateAccessGrantSheet
        error={<MutationError error={createMutation.error} />}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => createMutation.mutate(input)}
        open={createOpen}
        pending={createMutation.isPending}
        resources={assignableResources}
      />
      <DestructiveConfirmation
        confirmLabel={revokeMutation.isPending ? tt('Revoking…') : tt('Revoke access grant')}
        description={tt('The assigned scopes stop applying immediately. Existing audit history is preserved.')}
        error={<MutationError error={revokeMutation.error} />}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (revokeTarget) revokeMutation.mutate(revokeTarget.id)
        }}
        open={revokeTarget !== null}
        pending={revokeMutation.isPending}
        title={tt('Revoke access grant?')}
      />
    </>
  )
}

function CreateAccessGrantSheet({
  error,
  onClose,
  onSubmit,
  open,
  pending,
  resources,
}: {
  error: ReactNode
  onClose: () => void
  onSubmit: (input: { resourceServerId: string; scopes: string[]; expiresAt: string | null }) => void
  open: boolean
  pending: boolean
  resources: ApiResourceResponse[]
}) {
  const [resourceId, setResourceId] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const selectedResource = resources.find((resource) => resource.id === resourceId)
  const availableScopes = useMemo(() => assignedScopes(selectedResource), [selectedResource])

  useEffect(() => {
    if (!open) return
    setResourceId(resources[0]?.id ?? '')
    setScopes([])
  }, [open, resources[0]?.id])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const expiresAt = String(form.get('expiresAt') ?? '').trim()
    onSubmit({
      resourceServerId: resourceId,
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    })
  }

  return (
    <Sheet onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
      <SheetContent className="flex h-full flex-col overflow-hidden sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{tt('Add access grant')}</SheetTitle>
          <SheetDescription>{tt('Assign scopes that require an explicit grant.')}</SheetDescription>
        </SheetHeader>
        <form
          className="grid flex-1 content-start gap-5 overflow-y-auto px-4 py-5"
          id="create-access-grant"
          onSubmit={submit}
        >
          <Field label={tt('Resource Server')}>
            <SelectInput
              onChange={(event) => {
                setResourceId(event.target.value)
                setScopes([])
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
          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">{tt('Assigned scopes')}</legend>
            {availableScopes.map((scope) => {
              const checkboxId = `access-grant-scope-${scope.value}`
              return (
                <label className="flex items-start gap-3 rounded-lg border p-3" htmlFor={checkboxId} key={scope.value}>
                  <Checkbox
                    checked={scopes.includes(scope.value)}
                    id={checkboxId}
                    onCheckedChange={(checked) =>
                      setScopes((current) =>
                        checked ? [...current, scope.value].sort() : current.filter((value) => value !== scope.value),
                      )
                    }
                  />
                  <span className="grid gap-1 text-sm">
                    <code>{scope.value}</code>
                    {scope.description ? <span className="text-muted-foreground">{scope.description}</span> : null}
                  </span>
                </label>
              )
            })}
          </fieldset>
          <Field help={tt('Leave empty for a grant that lasts until revoked.')} label={tt('Expires')}>
            <TextInput name="expiresAt" type="datetime-local" />
          </Field>
          {error}
        </form>
        <SheetFooter>
          <Button onClick={onClose} type="button" variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending || !resourceId || scopes.length === 0} form="create-access-grant" type="submit">
            {pending ? tt('Adding…') : tt('Add access grant')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function assignedScopes(resource?: ApiResourceResponse) {
  return resource?.scopeRegistry?.scopes.filter((scope) => scope.grantMode === 'assigned') ?? []
}

function accessGrantQueryPrefix(subject: AccessGrantSubject) {
  return subject.type === 'user'
    ? [...consoleQueryKeys.users, subject.id, 'access-grants']
    : [...consoleQueryKeys.applications, subject.id, 'access-grants']
}

function accessGrantQueryKey(subject: AccessGrantSubject, offset: number) {
  return [...accessGrantQueryPrefix(subject), { limit: pageSize, offset }]
}
