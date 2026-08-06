import {
  createWebhookEndpointRequestSchema,
  type WebhookEndpoint,
  type WebhookEvent,
  type WebhookRequest,
  webhookEvents,
} from '@shared/api/webhooks'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ellipsis, Plus, RefreshCw } from 'lucide-react'
import { type FormEvent, useId, useMemo, useState } from 'react'
import { Field, SelectInput, TextInput } from '@/components/product-form'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DangerConfirmDialog, StatusBadge } from '@/features/management/dialogs'
import { WebhookRequestDialog, WebhookSecretDisclosureDialog } from '@/features/management/previews'
import {
  DataTablePanel,
  ListToolbar,
  ResourcePage,
  RoutedSettingsTabs,
} from '@/features/management/resource-components'
import type { WebhooksSection } from '@/features/management/shared'
import { formatDate, useAdminMutation } from '@/features/management/utils'
import {
  consoleQueryKeys,
  createWebhookDeliveryAttempt,
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listOrganizations,
  listWebhookEndpoints,
  listWebhookRequests,
  rotateWebhookEndpointSecret,
  updateWebhookEndpoint,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'

export function WebhooksPage({
  organizationId,
  realmOperator = true,
  section = 'endpoints',
}: {
  organizationId?: string
  realmOperator?: boolean
  section?: WebhooksSection
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [organizationFilter, setOrganizationFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editEndpoint, setEditEndpoint] = useState<WebhookEndpoint | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [request, setRequest] = useState<WebhookRequest | null>(null)
  const organizations = useQuery({ queryKey: consoleQueryKeys.organizations, queryFn: listOrganizations })
  const effectiveOrganizationFilter = organizationId ?? organizationFilter
  const organizationNames = useMemo(
    () =>
      new Map(
        (organizations.data?.organizations ?? []).map((organization) => [
          organization.id,
          organization.displayName ?? organization.name,
        ]),
      ),
    [organizations.data?.organizations],
  )
  const endpoints = useQuery({
    queryKey: [...consoleQueryKeys.webhookEndpoints, search, status, effectiveOrganizationFilter],
    queryFn: () =>
      listWebhookEndpoints({
        search: search || undefined,
        status: status === 'enabled' || status === 'disabled' ? status : undefined,
        organizationId: effectiveOrganizationFilter || undefined,
      }),
    enabled: section === 'endpoints',
  })
  const requests = useQuery({
    queryKey: [...consoleQueryKeys.webhookRequests, search, status, effectiveOrganizationFilter],
    queryFn: () =>
      listWebhookRequests({
        search: search || undefined,
        status: status === 'pending' || status === 'delivered' || status === 'failed' ? status : undefined,
        organizationId: effectiveOrganizationFilter || undefined,
      }),
    enabled: section === 'requests',
  })
  const create = useAdminMutation({
    mutationFn: createWebhookEndpoint,
    onSuccess: async (result) => {
      setCreateOpen(false)
      setSecret(result.signingSecret)
      await queryClient.invalidateQueries({ queryKey: consoleQueryKeys.webhookEndpoints })
    },
  })
  const update = useAdminMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateWebhookEndpoint>[1] }) =>
      updateWebhookEndpoint(id, input),
    onSuccess: async () => {
      setEditEndpoint(null)
      await queryClient.invalidateQueries({ queryKey: consoleQueryKeys.webhookEndpoints })
    },
  })
  const remove = useAdminMutation({
    mutationFn: deleteWebhookEndpoint,
    onSuccess: async () => {
      setDeleteId(null)
      await queryClient.invalidateQueries({ queryKey: consoleQueryKeys.webhookEndpoints })
    },
  })
  const rotate = useAdminMutation({
    mutationFn: rotateWebhookEndpointSecret,
    onSuccess: async (result) => {
      setSecret(result.signingSecret)
      await queryClient.invalidateQueries({ queryKey: consoleQueryKeys.webhookEndpoints })
    },
  })
  const retry = useAdminMutation({
    mutationFn: ({ endpointId, id, idempotencyKey }: { endpointId: string; id: string; idempotencyKey: string }) =>
      createWebhookDeliveryAttempt(endpointId, id, idempotencyKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: consoleQueryKeys.webhookRequests }),
  })
  const error = organizations.error ?? (section === 'endpoints' ? endpoints.error : requests.error)
  const loading = organizations.isLoading || (section === 'endpoints' ? endpoints.isLoading : requests.isLoading)
  return (
    <ResourcePage
      title={tt('Webhooks')}
      description={tt(
        'Send signed Realm or Organization events to downstream systems and inspect every delivery attempt.',
      )}
      framed={false}
      action={
        section === 'endpoints' ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            {tt('Create endpoint')}
          </Button>
        ) : null
      }
      error={error}
      loading={loading}
      onRetry={() => (section === 'endpoints' ? endpoints.refetch() : requests.refetch())}
      toolbar={
        <RoutedSettingsTabs
          active={section}
          ariaLabel="Webhook sections"
          tabs={[
            [
              'endpoints',
              'Endpoints',
              organizationId ? `/organizations/${organizationId}/webhooks/endpoints` : '/console/webhooks/endpoints',
            ],
            [
              'requests',
              'Requests',
              organizationId ? `/organizations/${organizationId}/webhooks/requests` : '/console/webhooks/requests',
            ],
          ]}
        />
      }
    >
      <DataTablePanel
        toolbar={
          <ListToolbar>
            <TextInput
              aria-label={tt('Search webhooks')}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={section === 'endpoints' ? tt('Search endpoints or events') : tt('Search requests or events')}
              value={search}
            />
            <SelectInput
              aria-label={tt('Filter webhook status')}
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="">{tt('Any status')}</option>
              {section === 'endpoints' ? (
                <>
                  <option value="enabled">{tt('Enabled')}</option>
                  <option value="disabled">{tt('Disabled')}</option>
                </>
              ) : (
                <>
                  <option value="pending">{tt('Pending')}</option>
                  <option value="delivered">{tt('Delivered')}</option>
                  <option value="failed">{tt('Failed')}</option>
                </>
              )}
            </SelectInput>
            {realmOperator ? (
              <SelectInput
                aria-label={tt('Filter webhook scope')}
                onChange={(event) => setOrganizationFilter(event.target.value)}
                value={organizationFilter}
              >
                <option value="">{tt('Any scope')}</option>
                {organizations.data?.organizations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName ?? item.name}
                  </option>
                ))}
              </SelectInput>
            ) : null}
          </ListToolbar>
        }
      >
        {section === 'endpoints' ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tt('Endpoint')}</TableHead>
                <TableHead>{tt('Events')}</TableHead>
                <TableHead>{tt('Scope')}</TableHead>
                <TableHead>{tt('Status')}</TableHead>
                <TableHead>{tt('Signing secret')}</TableHead>
                <TableHead>{tt('Updated')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpoints.data?.endpoints.length ? (
                endpoints.data.endpoints.map((endpoint) => (
                  <TableRow key={endpoint.id}>
                    <TableCell className="max-w-80">
                      <span className="block truncate font-medium" title={endpoint.url}>
                        {endpoint.url}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{endpoint.id}</span>
                    </TableCell>
                    <TableCell className="max-w-72 truncate">{endpoint.events.join(', ')}</TableCell>
                    <TableCell>
                      {endpoint.organizationId
                        ? (organizationNames.get(endpoint.organizationId) ?? endpoint.organizationId)
                        : tt('Realm-wide')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge active={endpoint.enabled} activeLabel="Enabled" inactiveLabel="Disabled" />
                    </TableCell>
                    <TableCell>
                      <code>{endpoint.secretPrefix}••••</code>
                    </TableCell>
                    <TableCell>{formatDate(endpoint.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={tt('Actions for {{endpoint}}', { endpoint: endpoint.url })}
                            size="icon"
                            variant="ghost"
                          >
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditEndpoint(endpoint)}>
                            {tt('Edit endpoint')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => update.mutate({ id: endpoint.id, input: { enabled: !endpoint.enabled } })}
                          >
                            {endpoint.enabled ? tt('Disable') : tt('Enable')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => rotate.mutate(endpoint.id)}>
                            <RefreshCw />
                            {tt('Rotate secret')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDeleteId(endpoint.id)} variant="destructive">
                            {tt('Delete endpoint')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyRow
                  colSpan={7}
                  description={tt('Create an HTTPS endpoint to receive signed Realm events.')}
                  title={tt('No webhook endpoints')}
                />
              )}
            </TableBody>
          </Table>
        ) : null}
        {section === 'requests' ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tt('Request')}</TableHead>
                <TableHead>{tt('Endpoint')}</TableHead>
                <TableHead>{tt('Scope')}</TableHead>
                <TableHead>{tt('HTTP')}</TableHead>
                <TableHead>{tt('Status')}</TableHead>
                <TableHead>{tt('Created')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.data?.requests.length ? (
                requests.data.requests.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <button className="font-medium hover:underline" onClick={() => setRequest(item)} type="button">
                        {item.event}
                      </button>
                      <span className="block font-mono text-xs text-muted-foreground">{item.id}</span>
                    </TableCell>
                    <TableCell className="max-w-72 truncate">{item.endpointUrl}</TableCell>
                    <TableCell>
                      {item.organizationId
                        ? (organizationNames.get(item.organizationId) ?? item.organizationId)
                        : tt('Realm-wide')}
                    </TableCell>
                    <TableCell>{item.httpStatus ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === 'delivered' ? 'secondary' : 'outline'}>{item.status}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(item.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        disabled={item.status === 'delivered' || retry.isPending}
                        onClick={() =>
                          retry.mutate({
                            endpointId: item.endpointId,
                            id: item.id,
                            idempotencyKey: crypto.randomUUID(),
                          })
                        }
                        size="sm"
                        variant="ghost"
                      >
                        <RefreshCw />
                        {tt('Retry')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyRow
                  colSpan={7}
                  description={tt('Delivery attempts appear here after Realm events are dispatched.')}
                  title={tt('No webhook requests')}
                />
              )}
            </TableBody>
          </Table>
        ) : null}
      </DataTablePanel>
      {createOpen ? (
        <EndpointDialog
          error={create.errorMessage}
          fixedOrganizationId={organizationId}
          onClose={() => setCreateOpen(false)}
          onSubmit={(input) => create.mutate({ ...input, enabled: true })}
          organizations={organizations.data?.organizations ?? []}
          pending={create.isPending}
        />
      ) : null}
      {editEndpoint ? (
        <EndpointDialog
          endpoint={editEndpoint}
          error={update.errorMessage}
          fixedOrganizationId={organizationId}
          onClose={() => setEditEndpoint(null)}
          onSubmit={(input) => update.mutate({ id: editEndpoint.id, input })}
          organizations={organizations.data?.organizations ?? []}
          pending={update.isPending}
        />
      ) : null}
      <DangerConfirmDialog
        actionLabel={tt('Delete endpoint')}
        description={tt(
          'Realmroot stops delivering events to this endpoint immediately. Delivery history remains available.',
        )}
        error={remove.error}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) remove.mutate(deleteId)
        }}
        open={deleteId !== null}
        pending={remove.isPending}
        title={tt('Delete webhook endpoint?')}
      />
      <WebhookSecretDisclosureDialog onClose={() => setSecret(null)} secret={secret} />
      <WebhookRequestDialog onClose={() => setRequest(null)} request={request} />
    </ResourcePage>
  )
}

function EndpointDialog({
  endpoint,
  error,
  fixedOrganizationId,
  onClose,
  onSubmit,
  organizations,
  pending,
}: {
  endpoint?: WebhookEndpoint
  error?: string | null
  fixedOrganizationId?: string
  onClose: () => void
  onSubmit: (input: Pick<Parameters<typeof createWebhookEndpoint>[0], 'url' | 'events' | 'organizationId'>) => void
  organizations: Awaited<ReturnType<typeof listOrganizations>>['organizations']
  pending: boolean
}) {
  const [events, setEvents] = useState<WebhookEvent[]>(endpoint?.events ?? ['user.created'])
  const [scope, setScope] = useState(endpoint?.organizationId ?? fixedOrganizationId ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)
  const eventsId = useId()
  const close = () => {
    setValidationError(null)
    onClose()
  }
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) close()
      }}
      open
    >
      <DialogContent>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const result = createWebhookEndpointRequestSchema.safeParse({
              url: form.get('url'),
              events,
              enabled: true,
              organizationId: scope || null,
            })
            if (!result.success) {
              setValidationError(tt(result.error.issues[0]?.message ?? 'Invalid form input.'))
              return
            }
            setValidationError(null)
            onSubmit({
              url: result.data.url,
              events: result.data.events,
              organizationId: result.data.organizationId,
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{tt(endpoint ? 'Edit webhook endpoint' : 'Create webhook endpoint')}</DialogTitle>
            <DialogDescription>
              {tt(
                endpoint
                  ? 'Update the HTTPS destination and subscribed Realm events.'
                  : 'Realmroot signs every selected event before delivering it to this HTTPS endpoint.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <Field label={tt('Endpoint URL')}>
              <TextInput
                defaultValue={endpoint?.url}
                name="url"
                placeholder="https://example.com/webhooks/realmroot"
                required
                type="url"
              />
            </Field>
            <Field
              help={tt(
                'Realm-wide endpoints receive every matching event. Organization endpoints receive only events applicable to that Organization.',
              )}
              label={tt('Event scope')}
            >
              {fixedOrganizationId ? (
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  {organizations.find((item) => item.id === fixedOrganizationId)?.displayName ??
                    organizations.find((item) => item.id === fixedOrganizationId)?.name ??
                    fixedOrganizationId}
                </div>
              ) : (
                <SelectInput name="organizationId" onChange={(event) => setScope(event.target.value)} value={scope}>
                  <option value="">{tt('Realm-wide')}</option>
                  {organizations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName ?? item.name}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <div className="grid gap-3">
              <strong className="text-sm">{tt('Events')}</strong>
              <div className="grid gap-2 sm:grid-cols-2">
                {webhookEvents.map((item) => (
                  <label className="flex items-center gap-2 text-sm" htmlFor={`${eventsId}-${item}`} key={item}>
                    <Checkbox
                      checked={events.includes(item)}
                      id={`${eventsId}-${item}`}
                      onCheckedChange={(checked) =>
                        setEvents((current) =>
                          checked ? [...current, item] : current.filter((value) => value !== item),
                        )
                      }
                    />
                    {item}
                  </label>
                ))}
              </div>
            </div>
            {validationError || error ? (
              <p className="text-sm text-destructive" role="alert">
                {validationError ?? error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={close} type="button" variant="outline">
              {tt('Cancel')}
            </Button>
            <Button disabled={pending || !events.length} type="submit">
              {pending ? tt(endpoint ? 'Saving…' : 'Creating…') : tt(endpoint ? 'Save changes' : 'Create endpoint')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
