import {
  consoleQueryKeys,
  createConnector,
  deleteConnector,
  getConnector,
  getSecurityPolicy,
  getSignInSettings,
  listConnectors,
  listConnectorTemplates,
  updateConnector,
  updateSecurityPolicy,
  updateSignInSettings,
} from '@/lib/api/management'
import {
  Button,
  type ConnectorResponse,
  createManagementConnectorRequestSchema,
  emptyForm,
  type FormState,
  type ManagementSignInSettingsResponse,
  ProviderIcon,
  type SecurityPolicy,
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Trash2,
  tt,
  updateManagementConnectorRequestSchema,
  type updateManagementSignInSettingsRequestSchema,
  useEffect,
  useQuery,
  useQueryClient,
  useState,
  type z,
} from '../console-shared'
import { ConfirmDialog } from '../helpers/helpers-create'
import { StatusBadge } from '../helpers/helpers-dialogs'
import { ResourcePage } from '../helpers/helpers-resource'
import {
  connectorToForm,
  connectorUpdateForm,
  parseConnectorMetadata,
  parseForm,
  setValue,
  useAdminMutation,
} from '../helpers/helpers-utils'
import { BuiltinProviderPanel } from './connectors/builtin-provider-panel'
import { type ConnectorProviderRow, connectorProviderRows } from './connectors/provider-rows'
import {
  CallbackUrlField,
  ConnectorDynamicFields,
  connectorCallbackUrl,
  GenericConnectorFields,
} from './connectors/social-fields'

export function ConnectorsPage() {
  const query = useQuery({
    queryKey: consoleQueryKeys.connectors,
    queryFn: listConnectors,
  })
  const templatesQuery = useQuery({
    queryKey: [...consoleQueryKeys.connectors, 'templates'],
    queryFn: listConnectorTemplates,
  })
  const signInQuery = useQuery({
    queryKey: consoleQueryKeys.signIn,
    queryFn: getSignInSettings,
  })
  const securityQuery = useQuery({
    queryKey: consoleQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const queryClient = useQueryClient()
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ConnectorResponse | null>(null)
  const createMutation = useAdminMutation({
    mutationFn: createConnector,
    onSuccess: () => {
      setSelectedProviderKey(null)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.connectors,
      })
    },
  })
  const connectors = query.data?.connectors ?? []
  const templates = templatesQuery.data?.templates ?? []
  const providerRows = connectorProviderRows(templates, connectors, signInQuery.data, securityQuery.data?.policy)
  const selectedProvider = providerRows.find((provider) => provider.key === selectedProviderKey) ?? null
  const selectedConnectorId = selectedProvider?.connector?.id ?? null
  const detailQuery = useQuery({
    queryKey: [...consoleQueryKeys.connectors, selectedConnectorId],
    queryFn: () => getConnector(selectedConnectorId ?? ''),
    enabled: selectedConnectorId !== null,
  })
  const updateMutation = useAdminMutation({
    mutationFn: ({ id, input }: { id: string; input: z.infer<typeof updateManagementConnectorRequestSchema> }) =>
      updateConnector(id, input),
    onSuccess: (connector) => {
      setSelectedProviderKey(null)
      queryClient.setQueryData([...consoleQueryKeys.connectors, connector.id], connector)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.connectors,
      })
    },
  })
  const deleteMutation = useAdminMutation({
    mutationFn: deleteConnector,
    onSuccess: () => {
      setDeleteTarget(null)
      setSelectedProviderKey(null)
      return queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.connectors,
      })
    },
  })
  const updateBuiltInSignInMutation = useAdminMutation({
    mutationFn: updateSignInSettings,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.signIn,
      }),
  })
  const updateBuiltInSecurityMutation = useAdminMutation({
    mutationFn: updateSecurityPolicy,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.security,
      }),
  })
  return (
    <ResourcePage
      title={tt('Connectors')}
      description={tt('Configure sign-in providers and platform-independent OAuth or API credential boundaries.')}
      error={query.error ?? templatesQuery.error ?? signInQuery.error ?? securityQuery.error}
      loading={query.isLoading || templatesQuery.isLoading || signInQuery.isLoading || securityQuery.isLoading}
      onRetry={() => {
        void query.refetch()
        void templatesQuery.refetch()
        void signInQuery.refetch()
        void securityQuery.refetch()
      }}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Provider')}</TableHead>
            <TableHead>{tt('Type')}</TableHead>
            <TableHead>{tt('Configuration')}</TableHead>
            <TableHead>{tt('Provider')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {providerRows.map((provider) => (
            <TableRow
              className="cursor-pointer"
              key={provider.key}
              onClick={() => setSelectedProviderKey(provider.key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setSelectedProviderKey(provider.key)
              }}
              role="button"
              tabIndex={0}
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  <ProviderIcon provider={provider} />
                  <div className="min-w-0">
                    <div className="font-medium">{provider.displayName}</div>
                    <div className="text-xs text-muted-foreground">{provider.description}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>{provider.typeLabel}</TableCell>
              <TableCell>{provider.configurationLabel}</TableCell>
              <TableCell>{provider.providerId}</TableCell>
              <TableCell>
                <StatusBadge active={provider.enabled} activeLabel="Enabled" inactiveLabel="Not enabled" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConnectorProviderDrawer
        connector={detailQuery.data ?? selectedProvider?.connector ?? null}
        createError={createMutation.errorMessage}
        createPending={createMutation.isPending}
        detailError={
          updateMutation.errorMessage ?? (detailQuery.error instanceof Error ? detailQuery.error.message : null)
        }
        loading={detailQuery.isLoading}
        onClose={() => setSelectedProviderKey(null)}
        onCreate={(input) => createMutation.mutate(input)}
        onDelete={(connector) => {
          setSelectedProviderKey(null)
          setDeleteTarget(connector)
        }}
        onUpdate={(connector, input) =>
          updateMutation.mutate({
            id: connector.id,
            input,
          })
        }
        onUpdateBuiltInPasskey={(enabled) =>
          updateBuiltInSecurityMutation.mutate({
            policy: {
              passkeys: {
                enabled,
              },
            },
          })
        }
        onUpdateBuiltInSignIn={(input) => updateBuiltInSignInMutation.mutate(input)}
        open={selectedProvider !== null}
        provider={selectedProvider}
        builtInProviders={signInQuery.data?.builtInProviders ?? null}
        security={securityQuery.data?.policy ?? null}
        updateBuiltInError={updateBuiltInSignInMutation.errorMessage ?? updateBuiltInSecurityMutation.errorMessage}
        updateBuiltInPending={updateBuiltInSignInMutation.isPending || updateBuiltInSecurityMutation.isPending}
        updatePending={updateMutation.isPending}
      />
      <ConfirmDialog
        description={
          deleteTarget ? `Delete ${deleteTarget.displayName}. This removes it from hosted sign-in immediately.` : ''
        }
        error={deleteMutation.errorMessage}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
        open={deleteTarget !== null}
        pending={deleteMutation.isPending}
        title={tt('Delete connector')}
      />
    </ResourcePage>
  )
}
function ConnectorProviderDrawer({
  builtInProviders,
  connector,
  createError,
  createPending,
  detailError,
  loading,
  onClose,
  onCreate,
  onDelete,
  onUpdate,
  onUpdateBuiltInPasskey,
  onUpdateBuiltInSignIn,
  open,
  provider,
  security,
  updateBuiltInError,
  updateBuiltInPending,
  updatePending,
}: {
  builtInProviders: ManagementSignInSettingsResponse['builtInProviders'] | null
  connector: ConnectorResponse | null
  createError: string | null
  createPending: boolean
  detailError: string | null
  loading: boolean
  onClose: () => void
  onCreate: (input: z.infer<typeof createManagementConnectorRequestSchema>) => void
  onDelete: (connector: ConnectorResponse) => void
  onUpdate: (connector: ConnectorResponse, input: z.infer<typeof updateManagementConnectorRequestSchema>) => void
  onUpdateBuiltInPasskey: (enabled: boolean) => void
  onUpdateBuiltInSignIn: (input: z.infer<typeof updateManagementSignInSettingsRequestSchema>) => void
  open: boolean
  provider: ConnectorProviderRow | null
  security: SecurityPolicy | null
  updateBuiltInError: string | null
  updateBuiltInPending: boolean
  updatePending: boolean
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [validationError, setValidationError] = useState<string | null>(null)
  const activeConnector = connector ?? provider?.connector ?? null
  const isExisting = activeConnector !== null
  const pending = createPending || updatePending || loading
  const error = validationError ?? detailError ?? createError
  useEffect(() => {
    setValidationError(null)
    if (!provider) {
      setForm(emptyForm)
      return
    }
    if (activeConnector) {
      setForm(connectorToForm(activeConnector))
      return
    }
    setForm({
      enabled: 'false',
      clientId: '',
      clientSecret: '',
      scopes: provider.template?.defaultScopes.join(' ') ?? '',
      apiBaseUrl: '',
      credentialModes: provider.providerType === 'generic_oauth' ? 'oauth' : '',
      credentialHeaderName: '',
      allowedMethods: 'GET',
      allowedPathPrefixes: '/',
      providerMetadata: '',
    })
  }, [provider, activeConnector])
  if (!provider) return null
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <SheetContent
        aria-describedby={undefined}
        aria-label={provider.displayName}
        className="w-full overflow-hidden data-[side=right]:sm:w-1/2 data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-3">
            <ProviderIcon className="providerIcon providerIconLarge" provider={provider} />
            {provider.displayName}
          </SheetTitle>
        </SheetHeader>
        {provider.providerType === 'builtin' ? (
          <BuiltinProviderPanel
            error={updateBuiltInError}
            onUpdatePasskey={onUpdateBuiltInPasskey}
            onUpdateSignIn={onUpdateBuiltInSignIn}
            pending={updateBuiltInPending}
            provider={provider}
            builtInProviders={builtInProviders}
            security={security}
          />
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              try {
                setValidationError(null)
                const scopes = form.scopes?.split(/\s+/).filter(Boolean)
                const isGenericConnector =
                  provider.providerType === 'generic_oauth' || provider.providerType === 'generic_api'
                const credentialModes =
                  isGenericConnector && form.credentialModes?.trim()
                    ? form.credentialModes.split(/\s+/).filter(Boolean)
                    : undefined
                const allowedMethods =
                  isGenericConnector && form.allowedMethods?.trim()
                    ? form.allowedMethods
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((method) => method.toUpperCase())
                    : undefined
                const allowedPathPrefixes =
                  isGenericConnector && form.allowedPathPrefixes?.trim()
                    ? form.allowedPathPrefixes.split(/\s+/).filter(Boolean)
                    : undefined
                const providerMetadata = parseConnectorMetadata(form)
                if (isExisting) {
                  onUpdate(
                    activeConnector,
                    parseForm(updateManagementConnectorRequestSchema, {
                      ...connectorUpdateForm(form),
                      enabled: form.enabled === 'true',
                      scopes,
                      credentialModes,
                      allowedMethods,
                      allowedPathPrefixes,
                      providerMetadata,
                    }),
                  )
                  return
                }
                onCreate(
                  parseForm(createManagementConnectorRequestSchema, {
                    ...form,
                    slug: provider.providerId,
                    enabled: form.enabled === 'true',
                    providerType: provider.providerType,
                    providerId: provider.providerId,
                    displayName: provider.displayName,
                    scopes,
                    credentialModes,
                    allowedMethods,
                    allowedPathPrefixes,
                    providerMetadata,
                  }),
                )
              } catch (submitError) {
                setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
              }
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-8">
              <div className="grid gap-5">
                {error ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{tt('Enabled')}</p>
                    <p className="text-xs text-muted-foreground">{tt('Show this provider on hosted sign-in.')}</p>
                  </div>
                  <Switch
                    aria-label={tt('Enabled')}
                    checked={form.enabled === 'true'}
                    onCheckedChange={(enabled) => setValue(setForm, 'enabled', String(enabled))}
                    type="button"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{tt('Allow users without an email')}</p>
                    <p className="text-xs text-muted-foreground">
                      {' '}
                      {tt(
                        'Allow this provider to enter the registration path. If it returns no email for a new user, the hosted flow shows an account-binding error.',
                      )}{' '}
                    </p>
                  </div>
                  <Switch
                    aria-label={tt('Allow users without an email')}
                    checked={form['metadata.allowUsersWithoutEmail'] === 'true'}
                    onCheckedChange={(allowUsersWithoutEmail) =>
                      setValue(setForm, 'metadata.allowUsersWithoutEmail', String(allowUsersWithoutEmail))
                    }
                    type="button"
                  />
                </div>
                {provider.providerType === 'generic_oauth' || provider.providerType === 'generic_api' ? (
                  <GenericConnectorFields
                    form={form}
                    isExisting={isExisting}
                    providerType={provider.providerType}
                    setForm={setForm}
                  />
                ) : (
                  <ConnectorDynamicFields
                    form={form}
                    isExisting={isExisting}
                    setForm={setForm}
                    template={provider.template}
                  />
                )}
                {provider.providerType !== 'generic_api' ? (
                  <CallbackUrlField value={connectorCallbackUrl(provider.providerId)} />
                ) : null}
              </div>
            </div>
            <SheetFooter className="border-t border-border sm:flex-row sm:justify-end">
              {isExisting ? (
                <Button onClick={() => onDelete(activeConnector)} type="button" variant="secondary">
                  <Trash2 data-icon="inline-start" /> {tt('Delete')}{' '}
                </Button>
              ) : null}
              <SheetClose asChild>
                <Button type="button" variant="secondary">
                  {' '}
                  {tt('Close')}{' '}
                </Button>
              </SheetClose>
              <Button disabled={pending} type="submit">
                {pending ? tt('Saving...') : tt('Save')}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
