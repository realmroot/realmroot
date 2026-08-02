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
  Field,
  type FormState,
  type ManagementSignInSettingsResponse,
  Plus,
  ProviderIcon,
  type SecurityPolicy,
  SelectInput,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextInput,
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
import { ListToolbar, ResourcePage } from '../helpers/helpers-resource'
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
  const [selectedTab, setSelectedTab] = useState('builtin')
  const [deleteTarget, setDeleteTarget] = useState<ConnectorResponse | null>(null)
  const [providerSearch, setProviderSearch] = useState('')
  const [providerType, setProviderType] = useState('')
  const [providerStatus, setProviderStatus] = useState('')
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
  const visibleProviderRows = providerRows.filter((provider) => {
    const query = providerSearch.trim().toLowerCase()
    const matchesSearch =
      !query ||
      [provider.displayName, provider.providerId, provider.description].some((value) =>
        value.toLowerCase().includes(query),
      )
    const matchesType = !providerType || provider.typeLabel === providerType
    const matchesStatus = !providerStatus || (providerStatus === 'enabled' ? provider.enabled : !provider.enabled)
    return matchesSearch && matchesType && matchesStatus
  })
  const oidcConnectors = connectors.filter((connector) => connector.providerType === 'generic_oauth')
  const selectedOidc =
    selectedProviderKey?.startsWith('oidc:') && selectedProviderKey !== 'oidc:new'
      ? (oidcConnectors.find((connector) => `oidc:${connector.id}` === selectedProviderKey) ?? null)
      : null
  const selectedProvider =
    providerRows.find((provider) => provider.key === selectedProviderKey) ??
    (selectedProviderKey === 'oidc:new' ? oidcProviderRow(null) : selectedOidc ? oidcProviderRow(selectedOidc) : null)
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
      title={tt('Identity providers')}
      description={tt(
        'Configure built-in sign-in methods and reusable OIDC connections for authentication and external authorization.',
      )}
      action={
        selectedTab === 'oidc' ? (
          <Button onClick={() => setSelectedProviderKey('oidc:new')}>
            <Plus />
            {tt('Add OIDC connector')}
          </Button>
        ) : undefined
      }
      error={query.error ?? templatesQuery.error ?? signInQuery.error ?? securityQuery.error}
      loading={query.isLoading || templatesQuery.isLoading || signInQuery.isLoading || securityQuery.isLoading}
      onRetry={() => {
        void query.refetch()
        void templatesQuery.refetch()
        void signInQuery.refetch()
        void securityQuery.refetch()
      }}
    >
      <Tabs onValueChange={setSelectedTab} value={selectedTab}>
        <TabsList className="w-full justify-start px-4 pt-2" variant="line">
          <TabsTrigger value="builtin">{tt('Builtin connectors')}</TabsTrigger>
          <TabsTrigger value="oidc">{tt('OIDC connectors')}</TabsTrigger>
        </TabsList>
        <TabsContent value="builtin">
          <div className="p-4">
            <ListToolbar>
              <TextInput
                aria-label={tt('Search providers')}
                onChange={(event) => setProviderSearch(event.target.value)}
                placeholder={tt('Search providers')}
                value={providerSearch}
              />
              <SelectInput
                aria-label={tt('Filter provider type')}
                onChange={(event) => setProviderType(event.target.value)}
                value={providerType}
              >
                <option value="">{tt('Any type')}</option>
                <option value="Built-in">{tt('Built-in')}</option>
                <option value="Social">{tt('Social')}</option>
              </SelectInput>
              <SelectInput
                aria-label={tt('Filter provider status')}
                onChange={(event) => setProviderStatus(event.target.value)}
                value={providerStatus}
              >
                <option value="">{tt('Any status')}</option>
                <option value="enabled">{tt('Enabled')}</option>
                <option value="disabled">{tt('Not enabled')}</option>
              </SelectInput>
            </ListToolbar>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tt('Provider')}</TableHead>
                <TableHead>{tt('Type')}</TableHead>
                <TableHead>{tt('Configuration')}</TableHead>
                <TableHead>{tt('Status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProviderRows.length ? (
                visibleProviderRows.map((provider) => (
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
                          <div className="font-mono text-xs text-muted-foreground">{provider.providerId}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{provider.typeLabel}</TableCell>
                    <TableCell>{provider.configurationLabel}</TableCell>
                    <TableCell>
                      <StatusBadge active={provider.enabled} activeLabel="Enabled" inactiveLabel="Not enabled" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyRow
                  colSpan={4}
                  description={tt('Adjust the search or filters to find a provider.')}
                  title={tt('No providers found')}
                />
              )}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="oidc">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tt('Name')}</TableHead>
                <TableHead>{tt('Issuer')}</TableHead>
                <TableHead>{tt('Client ID')}</TableHead>
                <TableHead>{tt('Login')}</TableHead>
                <TableHead>{tt('Status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {oidcConnectors.length ? (
                oidcConnectors.map((connector) => (
                  <TableRow
                    className="cursor-pointer"
                    key={connector.id}
                    onClick={() => setSelectedProviderKey(`oidc:${connector.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setSelectedProviderKey(`oidc:${connector.id}`)
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <TableCell>
                      <div className="font-medium">{connector.displayName}</div>
                      <div className="text-xs text-muted-foreground">{connector.providerId}</div>
                    </TableCell>
                    <TableCell>{connector.issuer}</TableCell>
                    <TableCell>{connector.clientId}</TableCell>
                    <TableCell>{connector.loginEnabled ? tt('Enabled') : tt('Disabled')}</TableCell>
                    <TableCell>
                      <StatusBadge active={connector.enabled} activeLabel="Ready" inactiveLabel="Disabled" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyRow
                  colSpan={5}
                  description={tt('Add a standard OIDC client for hosted login or external API authorization.')}
                  title={tt('No OIDC connectors yet')}
                />
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
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
        onUpdateBuiltInPasskey={(passkeys) =>
          updateBuiltInSecurityMutation.mutate({
            policy: {
              passkeys,
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

function oidcProviderRow(connector: ConnectorResponse | null): ConnectorProviderRow {
  return {
    key: connector ? `oidc:${connector.id}` : 'oidc:new',
    displayName: connector?.displayName ?? 'New OIDC connector',
    description: 'Standard OpenID Connect client',
    icon: 'oauth',
    providerId: connector?.providerId ?? '',
    providerType: 'generic_oauth',
    typeLabel: 'OIDC',
    configurationLabel: connector?.clientSecretConfigured ? 'Credentials configured' : 'Credentials required',
    enabled: connector?.enabled ?? true,
    connector,
    template: null,
  }
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
  onUpdateBuiltInPasskey: (input: SecurityPolicy['passkeys']) => void
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
      enabled: provider.providerType === 'generic_oauth' ? 'true' : 'false',
      loginEnabled: provider.providerType === 'generic_oauth' ? 'false' : 'true',
      registrationMode: 'manual',
      slug: '',
      displayName: '',
      clientId: '',
      clientSecret: '',
      scopes: provider.template?.defaultScopes.join(' ') ?? '',
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
          <SheetDescription>
            {tt(
              provider.providerType === 'builtin'
                ? 'Configure this built-in sign-in method and its runtime behavior.'
                : provider.providerType === 'generic_oauth'
                  ? 'Configure this reusable OpenID Connect connection for sign-in or external authorization.'
                  : 'Configure how this social provider authenticates users into the Realm.',
            )}
          </SheetDescription>
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
                const providerMetadata = parseConnectorMetadata(form)
                if (isExisting) {
                  onUpdate(
                    activeConnector,
                    parseForm(updateManagementConnectorRequestSchema, {
                      ...connectorUpdateForm(form),
                      enabled: form.enabled === 'true',
                      loginEnabled: form.loginEnabled === 'true',
                      registrationMode: form.registrationMode,
                      scopes,
                      providerMetadata,
                    }),
                  )
                  return
                }
                onCreate(
                  parseForm(createManagementConnectorRequestSchema, {
                    ...form,
                    slug: provider.providerType === 'generic_oauth' ? form.slug : provider.providerId,
                    enabled: form.enabled === 'true',
                    loginEnabled: form.loginEnabled === 'true',
                    providerType: provider.providerType,
                    providerId: provider.providerType === 'generic_oauth' ? form.slug : provider.providerId,
                    displayName: provider.providerType === 'generic_oauth' ? form.displayName : provider.displayName,
                    registrationMode: provider.providerType === 'generic_oauth' ? form.registrationMode : undefined,
                    scopes,
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
                  <div
                    className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    {error}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{tt('Enabled')}</p>
                    <p className="text-xs text-muted-foreground">
                      {tt(
                        provider.providerType === 'generic_oauth'
                          ? 'Allow this connector to serve login or associated API resources.'
                          : 'Show this provider on hosted sign-in.',
                      )}
                    </p>
                  </div>
                  <Switch
                    aria-label={tt('Enabled')}
                    checked={form.enabled === 'true'}
                    name="enabled"
                    onCheckedChange={(enabled) => setValue(setForm, 'enabled', String(enabled))}
                    type="button"
                  />
                </div>
                {provider.providerType === 'generic_oauth' ? (
                  <>
                    {!isExisting ? (
                      <>
                        <Field label={tt('Name')}>
                          <TextInput
                            name="displayName"
                            onChange={(event) => setValue(setForm, 'displayName', event.target.value)}
                            required
                            value={form.displayName ?? ''}
                          />
                        </Field>
                        <Field label={tt('Provider ID')}>
                          <TextInput
                            name="providerId"
                            onChange={(event) => setValue(setForm, 'slug', event.target.value)}
                            required
                            value={form.slug ?? ''}
                          />
                        </Field>
                      </>
                    ) : null}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">{tt('Allow hosted login')}</p>
                        <p className="text-xs text-muted-foreground">
                          {tt('Offer this OIDC connector as a Realmroot sign-in method.')}
                        </p>
                      </div>
                      <Switch
                        aria-label={tt('Allow hosted login')}
                        checked={form.loginEnabled === 'true'}
                        name="loginEnabled"
                        onCheckedChange={(enabled) => setValue(setForm, 'loginEnabled', String(enabled))}
                        type="button"
                      />
                    </div>
                    {!isExisting ? (
                      <Field label={tt('Client registration')}>
                        <SelectInput
                          name="registrationMode"
                          onChange={(event) => setValue(setForm, 'registrationMode', event.target.value)}
                          value={form.registrationMode ?? 'manual'}
                        >
                          <option value="manual">{tt('Pre-registered client')}</option>
                          <option value="dynamic">{tt('Dynamic registration (RFC 7591)')}</option>
                        </SelectInput>
                      </Field>
                    ) : null}
                  </>
                ) : null}
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
                    name="allowUsersWithoutEmail"
                    onCheckedChange={(allowUsersWithoutEmail) =>
                      setValue(setForm, 'metadata.allowUsersWithoutEmail', String(allowUsersWithoutEmail))
                    }
                    type="button"
                  />
                </div>
                {provider.providerType === 'generic_oauth' ? (
                  <GenericConnectorFields form={form} isExisting={isExisting} setForm={setForm} />
                ) : (
                  <ConnectorDynamicFields
                    form={form}
                    isExisting={isExisting}
                    setForm={setForm}
                    template={provider.template}
                  />
                )}
                {provider.providerId ? <CallbackUrlField value={connectorCallbackUrl(provider.providerId)} /> : null}
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
                {pending ? tt('Saving…') : tt('Save')}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
