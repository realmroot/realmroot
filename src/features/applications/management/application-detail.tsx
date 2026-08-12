import {
  type ApplicationOidcClaims,
  type ApplicationResponse,
  deviceCodeGrantType,
  tokenExchangeGrantType,
  updateApplicationRequestSchema,
} from '@shared/api/applications'
import type { ApiResourceResponse, OrganizationResponse } from '@shared/api/authorization'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, RotateCw, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Field, TextArea, TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PermissionsPanel } from '@/features/authorization/permissions-panel'
import {
  CopyButton,
  clientConfig,
  clientTypeLabel,
  DeleteApplicationDialog,
  ErrorState,
  LoadingState,
  listValue,
  MutationError,
  SecretDisclosureDialog,
  SwitchRow,
} from '@/features/management/dialogs'
import { OrganizationOwnerField, ownerLabel } from '@/features/management/ownership-controls'
import { navigateConsoleTab } from '@/features/management/resource-components'
import type { ApplicationDetailSection } from '@/features/management/shared'
import { formatDate, nullableString, parseForm, parseLineList, useAdminMutation } from '@/features/management/utils'
import { consoleQueryKeys } from '@/lib/api/console-query-keys'
import {
  deleteApplication,
  getApplication,
  listApiResources,
  listApplicationAuthorizations,
  listApplicationClientSecrets,
  listOrganizations,
  revokeApplicationAuthorization,
  rotateApplicationClientSecret,
  updateApplication,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import { ApplicationFederatedCredentialsPanel } from './application-federated-credentials'

type Editor = 'details' | 'redirects' | 'authorization' | 'claims' | 'ownership' | 'consent' | null

export function ApplicationDetailPage({
  applicationId,
  organizationId,
  section = 'overview',
}: {
  applicationId: string
  organizationId?: string
  section?: ApplicationDetailSection
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedTab, setSelectedTab] = useState<ApplicationDetailSection>(section)
  const [editor, setEditor] = useState<Editor>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null)
  useEffect(() => setSelectedTab(section), [section])
  const query = useQuery({
    queryKey: [...consoleQueryKeys.applications, applicationId],
    queryFn: () => getApplication(applicationId),
  })
  const organizationsQuery = useQuery({ queryKey: consoleQueryKeys.organizations, queryFn: listOrganizations })
  const resourcesQuery = useQuery({ queryKey: consoleQueryKeys.apiResources, queryFn: () => listApiResources() })
  const application = query.data
  const secretsQuery = useQuery({
    queryKey: [...consoleQueryKeys.applications, applicationId, 'client-secrets'],
    queryFn: () => listApplicationClientSecrets(applicationId),
    enabled: selectedTab === 'oauth' && application?.public === false,
  })
  const updateMutation = useAdminMutation({
    mutationFn: (input: Parameters<typeof updateApplication>[1]) => updateApplication(applicationId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData([...consoleQueryKeys.applications, applicationId], updated)
      setEditor(null)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.applications, exact: true })
    },
  })
  const rotateMutation = useAdminMutation({
    mutationFn: () => rotateApplicationClientSecret(applicationId),
    onSuccess: (result) => {
      setRotateOpen(false)
      setRotatedSecret(result.clientSecret)
      return queryClient.invalidateQueries({
        queryKey: [...consoleQueryKeys.applications, applicationId, 'client-secrets'],
      })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteApplication(applicationId),
    onSuccess: async () => {
      const detailKey = [...consoleQueryKeys.applications, applicationId]
      await queryClient.cancelQueries({ queryKey: detailKey })
      await queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.applications,
        exact: true,
        refetchType: 'none',
      })
      if (organizationId) {
        await navigate({ params: { organizationId }, to: '/organizations/$organizationId/applications' })
      } else {
        await navigate({ to: '/console/applications' })
      }
      queryClient.removeQueries({ queryKey: detailKey })
    },
  })

  if (query.isLoading || organizationsQuery.isLoading || resourcesQuery.isLoading)
    return <LoadingState label={tt('Loading application')} />
  const loadError = query.error ?? organizationsQuery.error ?? resourcesQuery.error
  if (loadError)
    return (
      <ErrorState
        error={loadError}
        onRetry={() => Promise.all([query.refetch(), organizationsQuery.refetch(), resourcesQuery.refetch()])}
      />
    )
  if (!application) return <ErrorState error={new Error(tt('Application not found.'))} />
  if (organizationId && application.ownerOrganizationId !== organizationId) {
    return <ErrorState error={new Error(tt('Application does not belong to this Organization.'))} />
  }
  const organizations = organizationsQuery.data?.items ?? []
  const machinePrincipalEnabled = application.allowedGrantTypes.some(
    (grantType) => grantType === 'client_credentials' || grantType === tokenExchangeGrantType,
  )
  const userAuthorizationEnabled = application.allowedGrantTypes.some(
    (grantType) => grantType === 'authorization_code' || grantType === deviceCodeGrantType,
  )
  const visibleTab =
    (selectedTab === 'permissions' && !machinePrincipalEnabled) ||
    (selectedTab === 'authorizations' && !userAuthorizationEnabled)
      ? 'overview'
      : selectedTab

  return (
    <>
      <div className="consoleDetailStack">
        {organizationId ? (
          <Link
            className="consoleBackLink"
            params={{ organizationId }}
            to="/organizations/$organizationId/applications"
          >
            <ArrowLeft />
            {tt('Applications')}
          </Link>
        ) : (
          <Link className="consoleBackLink" to="/console/applications">
            <ArrowLeft />
            {tt('Applications')}
          </Link>
        )}
        <header className="consoleDetailHeader">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1>{application.name}</h1>
              <Badge variant={application.disabled ? 'outline' : 'secondary'}>
                {application.disabled ? tt('Disabled') : tt('Enabled')}
              </Badge>
            </div>
            <p>{application.description ?? tt('OIDC client registered in this Realm.')}</p>
            <span className="consoleDetailMeta">
              {clientTypeLabel(application.clientType)} · {application.clientId}
            </span>
          </div>
        </header>
        <Tabs
          onValueChange={(value) => {
            const next = value as ApplicationDetailSection
            setSelectedTab(next)
            navigateConsoleTab(
              navigate,
              organizationId
                ? `/organizations/${organizationId}/applications/${applicationId}/${next}`
                : `/console/applications/${applicationId}/${next}`,
            )
          }}
          value={visibleTab}
        >
          <TabsList aria-label={tt('Application detail sections')} className="w-full" variant="navigation">
            <TabsTrigger value="overview">{tt('Overview')}</TabsTrigger>
            <TabsTrigger value="oauth">{tt('OAuth')}</TabsTrigger>
            {machinePrincipalEnabled ? <TabsTrigger value="permissions">{tt('Resource access')}</TabsTrigger> : null}
            {userAuthorizationEnabled ? (
              <TabsTrigger value="authorizations">{tt('User authorizations')}</TabsTrigger>
            ) : null}
            <TabsTrigger value="settings">{tt('Settings')}</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-5" value="overview">
            <ApplicationOverview application={application} organizations={organizations} />
          </TabsContent>
          <TabsContent className="mt-5" value="oauth">
            <ApplicationOAuth
              application={application}
              onEditAuthorization={() => setEditor('authorization')}
              onEditClaims={() => setEditor('claims')}
              onEditRedirects={() => setEditor('redirects')}
              onRotate={() => setRotateOpen(true)}
              pending={rotateMutation.isPending}
              secrets={secretsQuery.data?.items ?? []}
            />
            <ApplicationFederatedCredentialsPanel applicationId={applicationId} />
          </TabsContent>
          {machinePrincipalEnabled ? (
            <TabsContent className="mt-5" value="permissions">
              <PermissionsPanel subject={{ type: 'application', id: applicationId, label: application.name }} />
            </TabsContent>
          ) : null}
          {userAuthorizationEnabled ? (
            <TabsContent className="mt-5" value="authorizations">
              <ApplicationAuthorizations applicationId={applicationId} resources={resourcesQuery.data?.items ?? []} />
            </TabsContent>
          ) : null}
          <TabsContent className="mt-5" value="settings">
            <ApplicationSettings
              application={application}
              organizations={organizations}
              onDelete={() => setDeleteOpen(true)}
              onEditOwnership={() => setEditor('ownership')}
              onEditConsent={() => setEditor('consent')}
              onEditDetails={() => setEditor('details')}
              onToggle={() =>
                updateMutation.mutate({
                  disabled: !application.disabled,
                  disabledReason: application.disabled ? null : 'Disabled by Realm operator',
                })
              }
              pending={updateMutation.isPending}
            />
          </TabsContent>
        </Tabs>
      </div>
      <ApplicationEditor
        application={application}
        editor={editor}
        error={updateMutation.errorMessage}
        fixedOwnerOrganizationId={organizationId}
        onClose={() => setEditor(null)}
        onSave={(input) => updateMutation.mutate(input)}
        organizations={organizations}
        pending={updateMutation.isPending}
        resources={resourcesQuery.data?.items ?? []}
      />
      <SecretDisclosureDialog
        clientId={application.clientId}
        clientSecret={rotatedSecret}
        onClose={() => setRotatedSecret(null)}
        open={rotatedSecret !== null}
      />
      <DestructiveConfirmation
        confirmLabel={rotateMutation.isPending ? tt('Rotating…') : tt('Rotate secret')}
        description={tt(
          'The current client secret will stop working immediately. Update every deployment that uses it with the new secret.',
        )}
        error={<MutationError error={rotateMutation.error} />}
        onClose={() => setRotateOpen(false)}
        onConfirm={() => rotateMutation.mutate(undefined)}
        open={rotateOpen}
        pending={rotateMutation.isPending}
        title={tt('Rotate client secret?')}
      />
      <DeleteApplicationDialog
        applicationName={application.name}
        error={deleteMutation.error}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        open={deleteOpen}
        pending={deleteMutation.isPending}
      />
    </>
  )
}

function ApplicationOverview({
  application,
  organizations,
}: {
  application: ApplicationResponse
  organizations: OrganizationResponse[]
}) {
  return (
    <div className="detailFlatRows">
      <DetailRow label="Owner" value={ownerLabel(application.ownerOrganizationId, organizations)} />
      {isPlatformApplication(application, organizations) ? (
        <DetailRow
          label="Consent requirement"
          value={application.consentRequired ? tt('Required') : tt('Not required')}
        />
      ) : null}
      <DetailRow label="Created" value={formatDate(application.createdAt)} />
      <DetailRow label="Updated" value={formatDate(application.updatedAt)} />
    </div>
  )
}

function ApplicationOAuth({
  application,
  onEditAuthorization,
  onEditClaims,
  onEditRedirects,
  onRotate,
  pending,
  secrets,
}: {
  application: ApplicationResponse
  onEditAuthorization: () => void
  onEditClaims: () => void
  onEditRedirects: () => void
  onRotate: () => void
  pending: boolean
  secrets: Awaited<ReturnType<typeof listApplicationClientSecrets>>['items']
}) {
  return (
    <div className="detailSections">
      {application.clientType === 'machine' ? null : (
        <DetailSection
          action={
            <Button onClick={onEditRedirects} variant="outline">
              {tt('Edit')}
            </Button>
          }
          description="Callbacks and browser origins accepted by this client."
          title="Redirects and origins"
        >
          <DetailRow label="Redirect URIs" value={<CodeList values={application.redirectUris} />} />
          <DetailRow label="Post sign-out redirects" value={<CodeList values={application.postLogoutRedirectUris} />} />
          <DetailRow label="CORS origins" value={<CodeList values={application.corsOrigins} />} />
        </DetailSection>
      )}
      <DetailSection
        action={
          <Button onClick={onEditAuthorization} variant="outline">
            {tt('Edit')}
          </Button>
        }
        description="Type-derived OAuth behavior and Resource Server scope allowlists."
        title="Authorization"
      >
        <DetailRow label="Grant types" value={application.allowedGrantTypes.join(' · ')} />
        <DetailRow label="OIDC scopes" value={application.oidcScopes.join(' · ')} />
        <DetailRow
          label="Resource scope allowlists"
          value={
            application.resourceScopes.length
              ? application.resourceScopes
                  .map((resource) => `${resource.resourceServerId}: ${resource.scopes.join(', ')}`)
                  .join(' · ')
              : tt('None')
          }
        />
        <DetailRow label="PKCE" value={application.requirePkce ? tt('Required') : tt('Optional')} />
        <DetailRow label="Client authentication" value={application.tokenEndpointAuthMethod} />
        <DetailRow
          action={
            application.public ? undefined : (
              <Button disabled={pending} onClick={onRotate} variant="outline">
                <RotateCw />
                {tt('Rotate secret')}
              </Button>
            )
          }
          description="Raw secrets are shown once after creation or rotation."
          label="Client secret"
          value={
            application.public
              ? tt('Not issued for public clients')
              : secrets[0]
                ? tt('Version {{version}} · created {{date}}', {
                    version: secrets[0].version,
                    date: formatDate(secrets[0].createdAt),
                  })
                : tt('No active secret')
          }
        />
      </DetailSection>
      {application.clientType === 'machine' ? null : (
        <DetailSection
          action={
            <Button onClick={onEditClaims} variant="outline">
              {tt('Edit')}
            </Button>
          }
          description="Claims returned to this client after authorization."
          title="Token claims"
        >
          <DetailRow label="Access token" value={enabledClaims(application.oidcClaims.accessToken)} />
          <DetailRow label="ID token" value={enabledClaims(application.oidcClaims.idToken)} />
          <DetailRow label="UserInfo" value={enabledClaims(application.oidcClaims.userInfo)} />
        </DetailSection>
      )}
      <DetailSection description="Standard endpoints used by OIDC clients and SDKs." title="Integration endpoints">
        <DetailRow label="Issuer" value={<code>{application.oidc.issuer}</code>} />
        <DetailRow label="Discovery" value={<code>{application.oidc.issuer}/.well-known/openid-configuration</code>} />
        <CopyButton label={tt('Copy client config')} value={clientConfig(application, null)} />
      </DetailSection>
    </div>
  )
}

function ApplicationAuthorizations({
  applicationId,
  resources,
}: {
  applicationId: string
  resources: ApiResourceResponse[]
}) {
  const pageSize = 50
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)
  const [revokeTarget, setRevokeTarget] = useState<
    Awaited<ReturnType<typeof listApplicationAuthorizations>>['items'][number] | null
  >(null)
  const queryKey = [...consoleQueryKeys.applications, applicationId, 'authorizations', { limit: pageSize, offset }]
  const query = useQuery({
    queryKey,
    queryFn: () => listApplicationAuthorizations(applicationId, { status: 'active', limit: pageSize, offset }),
  })
  const revokeMutation = useMutation({
    mutationFn: (authorizationId: string) => revokeApplicationAuthorization(applicationId, authorizationId),
    onSuccess: async () => {
      setRevokeTarget(null)
      if (query.data?.items.length === 1 && offset > 0) {
        setOffset(Math.max(0, offset - pageSize))
        return
      }
      await queryClient.invalidateQueries({
        queryKey: [...consoleQueryKeys.applications, applicationId, 'authorizations'],
      })
    },
  })

  if (query.isLoading) return <LoadingState label={tt('Loading authorizations')} />
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />

  const authorizations = query.data?.items ?? []
  const pagination = query.data?.pagination
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  return (
    <>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tt('User')}</TableHead>
              <TableHead>{tt('Resource Server')}</TableHead>
              <TableHead>{tt('Granted access')}</TableHead>
              <TableHead>{tt('Granted')}</TableHead>
              <TableHead>{tt('Expires')}</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">{tt('Actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {authorizations.length === 0 ? (
              <TableEmptyRow
                colSpan={6}
                description={tt('User approvals will appear after the first authorization.')}
                title={tt('No active authorizations')}
              />
            ) : (
              authorizations.map((authorization) => (
                <TableRow key={authorization.id}>
                  <TableCell>
                    <div className="flex min-w-40 flex-col whitespace-normal">
                      <span className="font-medium">{authorization.user.displayName}</span>
                      <span className="text-xs text-muted-foreground">{authorization.user.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {authorization.resourceServerId
                      ? (resourceById.get(authorization.resourceServerId)?.name ?? authorization.resourceServerId)
                      : tt('OIDC')}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-md flex-wrap gap-1 whitespace-normal">
                      {authorization.scopes.map((access) => (
                        <Badge key={access} variant="outline">
                          {access}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(authorization.grantedAt)}</TableCell>
                  <TableCell>
                    {authorization.expiresAt ? formatDate(authorization.expiresAt) : tt('Does not expire')}
                  </TableCell>
                  <TableCell>
                    <Button onClick={() => setRevokeTarget(authorization)} size="sm" variant="outline">
                      {tt('Revoke')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
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
      <DestructiveConfirmation
        confirmLabel={revokeMutation.isPending ? tt('Revoking…') : tt('Revoke authorization')}
        description={tt(
          'This removes {{user}}’s approval and revokes this application’s active access and refresh tokens for the user.',
          { user: revokeTarget?.user.displayName ?? '' },
        )}
        error={<MutationError error={revokeMutation.error} />}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => revokeMutation.mutate(revokeTarget!.id)}
        open={revokeTarget !== null}
        pending={revokeMutation.isPending}
        title={tt('Revoke authorization?')}
      />
    </>
  )
}

function ApplicationSettings({
  application,
  organizations,
  onDelete,
  onEditOwnership,
  onEditConsent,
  onEditDetails,
  onToggle,
  pending,
}: {
  application: ApplicationResponse
  organizations: OrganizationResponse[]
  onDelete: () => void
  onEditOwnership: () => void
  onEditConsent: () => void
  onEditDetails: () => void
  onToggle: () => void
  pending: boolean
}) {
  return (
    <div className="detailSections">
      <DetailSection
        action={
          <Button onClick={onEditDetails} variant="outline">
            {tt('Edit')}
          </Button>
        }
        description="Metadata used to recognize this OIDC client."
        title="Application details"
      >
        <DetailRow label="Name" value={application.name} />
        <DetailRow label="Description" value={application.description ?? tt('Not configured')} />
        <DetailRow
          label="Homepage"
          value={application.homepageUrl ? <code>{application.homepageUrl}</code> : tt('Not configured')}
        />
      </DetailSection>
      <DetailSection
        action={
          <Button onClick={onEditOwnership} variant="outline">
            {tt('Edit')}
          </Button>
        }
        description="Choose the Organization responsible for this client."
        title="Ownership"
      >
        <DetailRow label="Owner" value={ownerLabel(application.ownerOrganizationId, organizations)} />
      </DetailSection>
      {isPlatformApplication(application, organizations) ? (
        <DetailSection
          action={
            <Button onClick={onEditConsent} variant="outline">
              {tt('Edit')}
            </Button>
          }
          description="Control whether users review and approve the access this application requests."
          title="User consent"
        >
          <DetailRow
            label="Consent requirement"
            value={application.consentRequired ? tt('Required') : tt('Not required')}
          />
        </DetailSection>
      ) : null}
      <DetailSection description="Control whether this client can begin new authorization flows." title="Status">
        <DetailRow
          action={
            <Button disabled={pending} onClick={onToggle} variant={application.disabled ? 'outline' : 'destructive'}>
              {application.disabled ? tt('Enable application') : tt('Disable application')}
            </Button>
          }
          description="Disabling prevents new sign-ins and token requests while preserving configuration and history."
          label="Application status"
          value={
            <Badge variant={application.disabled ? 'outline' : 'secondary'}>
              {application.disabled ? tt('Disabled') : tt('Enabled')}
            </Badge>
          }
        />
      </DetailSection>
      <DetailSection
        description="Permanently remove this client after active credentials and authorizations are revoked."
        title="Danger zone"
      >
        <DetailRow
          action={
            <Button onClick={onDelete} variant="destructive">
              <Trash2 />
              {tt('Delete application')}
            </Button>
          }
          description="Removes consent records, secrets, and application configuration."
          label="Delete application"
          value={tt('Permanent')}
        />
      </DetailSection>
    </div>
  )
}

function ApplicationEditor({
  application,
  editor,
  error,
  fixedOwnerOrganizationId,
  onClose,
  onSave,
  organizations,
  pending,
  resources,
}: {
  application: ApplicationResponse
  editor: Editor
  error?: string | null
  fixedOwnerOrganizationId?: string
  onClose: () => void
  onSave: (input: Parameters<typeof updateApplication>[1]) => void
  organizations: OrganizationResponse[]
  pending: boolean
  resources: ApiResourceResponse[]
}) {
  const [claims, setClaims] = useState(application.oidcClaims)
  useEffect(() => setClaims(application.oidcClaims), [application.oidcClaims])
  const title = editorTitle(editor)
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={editor !== null}
    >
      <SheetContent className="flex h-full flex-col overflow-hidden sm:max-w-xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>{tt(title)}</SheetTitle>
          <SheetDescription>{tt(editorDescription(editor))}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {editor === 'details' ? (
            <EditorForm
              id="application-details"
              onSubmit={(form) =>
                onSave(
                  parseForm(updateApplicationRequestSchema, {
                    name: form.get('name'),
                    description: nullableString(String(form.get('description') ?? '')),
                    homepageUrl: nullableString(String(form.get('homepageUrl') ?? '')),
                  }),
                )
              }
            >
              <Field label={tt('Name')}>
                <TextInput defaultValue={application.name} name="name" required />
              </Field>
              <Field label={tt('Description')}>
                <TextArea defaultValue={application.description ?? ''} name="description" rows={4} />
              </Field>
              <Field label={tt('Homepage URL')}>
                <TextInput defaultValue={application.homepageUrl ?? ''} name="homepageUrl" type="url" />
              </Field>
            </EditorForm>
          ) : null}
          {editor === 'redirects' ? (
            <EditorForm
              id="application-redirects"
              onSubmit={(form) =>
                onSave(
                  parseForm(updateApplicationRequestSchema, {
                    redirectUris: parseLineList(String(form.get('redirectUris') ?? '')),
                    postLogoutRedirectUris: parseLineList(String(form.get('postLogoutRedirectUris') ?? '')),
                    corsOrigins: parseLineList(String(form.get('corsOrigins') ?? '')),
                  }),
                )
              }
            >
              <Field help={tt('One URI per line.')} label={tt('Redirect URIs')}>
                <TextArea
                  defaultValue={listValue(application.redirectUris, '\n')}
                  name="redirectUris"
                  required
                  rows={5}
                />
              </Field>
              <Field help={tt('One URI per line.')} label={tt('Post sign-out redirects')}>
                <TextArea
                  defaultValue={listValue(application.postLogoutRedirectUris, '\n')}
                  name="postLogoutRedirectUris"
                  rows={4}
                />
              </Field>
              <Field help={tt('One origin per line.')} label={tt('CORS origins')}>
                <TextArea defaultValue={listValue(application.corsOrigins, '\n')} name="corsOrigins" rows={4} />
              </Field>
            </EditorForm>
          ) : null}
          {editor === 'authorization' ? (
            <AuthorizationEditor application={application} onSave={onSave} resources={resources} />
          ) : null}
          {editor === 'claims' ? <ClaimsEditor claims={claims} onChange={setClaims} /> : null}
          {editor === 'ownership' ? (
            <OwnershipEditor
              application={application}
              fixedOwnerOrganizationId={fixedOwnerOrganizationId}
              onSave={onSave}
              organizations={organizations}
            />
          ) : null}
          {editor === 'consent' && isPlatformApplication(application, organizations) ? (
            <ConsentEditor application={application} onSave={onSave} />
          ) : null}
          {error ? (
            <p className="px-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <SheetFooter className="shrink-0">
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button
            disabled={pending}
            form={editor === 'claims' ? undefined : editorFormId(editor)}
            onClick={editor === 'claims' ? () => onSave({ oidcClaims: claims }) : undefined}
            type={editor === 'claims' ? 'button' : 'submit'}
          >
            {pending ? tt('Saving…') : tt('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function AuthorizationEditor({
  application,
  onSave,
  resources,
}: {
  application: ApplicationResponse
  onSave: (input: Parameters<typeof updateApplication>[1]) => void
  resources: ApiResourceResponse[]
}) {
  const [resourceScopes, setResourceScopes] = useState(application.resourceScopes)
  const [deviceLoginEnabled, setDeviceLoginEnabled] = useState(
    application.allowedGrantTypes.includes(deviceCodeGrantType),
  )
  return (
    <form
      className="grid gap-4 px-4 py-5"
      id="application-authorization"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({
          resourceScopes,
          ...(application.clientType === 'public_native' ? { deviceLoginEnabled } : {}),
        })
      }}
    >
      {application.clientType === 'public_native' ? (
        <SwitchRow checked={deviceLoginEnabled} label={tt('Device login')} onCheckedChange={setDeviceLoginEnabled} />
      ) : null}
      {resources.map((resource) => {
        const values = resourceScopes.find((item) => item.resourceServerId === resource.id)?.scopes ?? []
        const options = (resource.scopeRegistry?.scopes ?? []).map(
          (scope) =>
            [scope.value, scope.description ? `${scope.value} — ${scope.description}` : scope.value] as [
              string,
              string,
            ],
        )
        return (
          <CheckGroup
            description={`${resource.visibility === 'private' ? 'Private' : 'Public'} Resource Server`}
            key={resource.id}
            label={resource.name}
            onChange={(nextScopes) =>
              setResourceScopes((current) => [
                ...current.filter((item) => item.resourceServerId !== resource.id),
                ...(nextScopes.length ? [{ resourceServerId: resource.id, scopes: nextScopes }] : []),
              ])
            }
            options={options}
            values={values}
          />
        )
      })}
    </form>
  )
}

function ClaimsEditor({
  claims,
  onChange,
}: {
  claims: ApplicationOidcClaims
  onChange: (claims: ApplicationOidcClaims) => void
}) {
  return (
    <div className="grid gap-6 px-4 py-5">
      {(['accessToken', 'idToken', 'userInfo'] as const).map((destination) => (
        <div className="grid gap-3" key={destination}>
          <strong className="text-sm">
            {tt({ accessToken: 'Access token', idToken: 'ID token', userInfo: 'UserInfo' }[destination])}
          </strong>
          {(['authorization', 'groups', 'roles', 'scopes'] as const).map((claim) => (
            <div className="flex items-center justify-between gap-4 text-sm" key={claim}>
              <span>{claim}</span>
              <Switch
                aria-label={tt(`${tokenDestinationLabel(destination)} ${claim}`)}
                checked={claims[destination][claim] === true}
                onCheckedChange={(checked) =>
                  onChange({ ...claims, [destination]: { ...claims[destination], [claim]: checked } })
                }
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function OwnershipEditor({
  application,
  fixedOwnerOrganizationId,
  onSave,
  organizations,
}: {
  application: ApplicationResponse
  fixedOwnerOrganizationId?: string
  onSave: (input: Parameters<typeof updateApplication>[1]) => void
  organizations: OrganizationResponse[]
}) {
  const [ownerOrganizationId, setOwnerOrganizationId] = useState(application.ownerOrganizationId)
  return (
    <form
      className="grid gap-4 px-4 py-5"
      id="application-ownership"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({ ownerOrganizationId })
      }}
    >
      {fixedOwnerOrganizationId ? null : (
        <OrganizationOwnerField
          onChange={setOwnerOrganizationId}
          organizations={organizations}
          value={ownerOrganizationId}
        />
      )}
    </form>
  )
}

function ConsentEditor({
  application,
  onSave,
}: {
  application: ApplicationResponse
  onSave: (input: Parameters<typeof updateApplication>[1]) => void
}) {
  const [requirement, setRequirement] = useState(application.consentRequired ? 'required' : 'not-required')
  const consentId = useId()
  return (
    <form
      className="grid gap-4 px-4 py-5"
      id="application-consent"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({ consentRequired: requirement === 'required' })
      }}
    >
      <div className="grid gap-3">
        <strong className="text-sm">{tt('Consent requirement')}</strong>
        <RadioGroup onValueChange={setRequirement} value={requirement}>
          <label className="flex items-start gap-3 rounded-lg border p-3" htmlFor={`${consentId}-required`}>
            <RadioGroupItem id={`${consentId}-required`} value="required" />
            <span>
              <strong className="block text-sm">{tt('Require user consent')}</strong>
              <small className="text-muted-foreground">
                {tt('Users review requested scopes on first use and when access expands.')}
              </small>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border p-3" htmlFor={`${consentId}-not-required`}>
            <RadioGroupItem id={`${consentId}-not-required`} value="not-required" />
            <span>
              <strong className="block text-sm">{tt('Do not require user consent')}</strong>
              <small className="text-muted-foreground">
                {tt('Users continue without a consent prompt. Application and scope policy still apply.')}
              </small>
            </span>
          </label>
        </RadioGroup>
      </div>
    </form>
  )
}

function EditorForm({
  children,
  id,
  onSubmit,
}: {
  children: ReactNode
  id: string
  onSubmit: (form: FormData) => void
}) {
  return (
    <form
      className="grid gap-4 px-4 py-5"
      id={id}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        onSubmit(new FormData(event.currentTarget))
      }}
    >
      {children}
    </form>
  )
}

function tokenDestinationLabel(destination: keyof ApplicationOidcClaims) {
  return { accessToken: 'Access token', idToken: 'ID token', userInfo: 'UserInfo' }[destination]
}

function CheckGroup<T extends string>({
  description,
  disabledValues = [],
  label,
  onChange,
  options,
  values,
}: {
  description?: string
  disabledValues?: T[]
  label: string
  onChange: (values: T[]) => void
  options: Array<[T, string]>
  values: T[]
}) {
  const groupId = useId()
  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-semibold">{tt(label)}</legend>
      {description ? <p className="text-xs text-muted-foreground">{tt(description)}</p> : null}
      {options.map(([value, option]) => (
        <label className="flex items-center gap-3 text-sm" htmlFor={`${groupId}-${value}`} key={value}>
          <Checkbox
            checked={values.includes(value)}
            disabled={disabledValues.includes(value)}
            id={`${groupId}-${value}`}
            onCheckedChange={(checked) =>
              onChange(checked ? [...values, value] : values.filter((current) => current !== value))
            }
          />
          {tt(option)}
        </label>
      ))}
    </fieldset>
  )
}

function DetailSection({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode
  children: ReactNode
  description: string
  title: string
}) {
  return (
    <section className="detailSection">
      <header>
        <div>
          <h2>{tt(title)}</h2>
          <p>{tt(description)}</p>
        </div>
        {action}
      </header>
      <div className="detailFlatRows">{children}</div>
    </section>
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

function CodeList({ values }: { values: string[] }) {
  return values.length ? (
    <span className="grid gap-1">
      {values.map((value) => (
        <code key={value}>{value}</code>
      ))}
    </span>
  ) : (
    <span>—</span>
  )
}

function enabledClaims(claims: Record<string, boolean | undefined>) {
  return (
    Object.entries(claims)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(' · ') || tt('None')
  )
}

function isPlatformApplication(application: ApplicationResponse, organizations: OrganizationResponse[]) {
  return organizations.some(
    (organization) => organization.id === application.ownerOrganizationId && organization.slug === 'realmroot',
  )
}

function editorTitle(editor: Editor) {
  return (
    {
      details: 'Edit application details',
      redirects: 'Edit redirects and origins',
      authorization: 'Edit Resource Server scope allowlists',
      claims: 'Edit token claims',
      ownership: 'Edit ownership',
      consent: 'Edit consent policy',
    } as Record<Exclude<Editor, null>, string>
  )[editor ?? 'details']
}

function editorDescription(editor: Editor) {
  return (
    {
      details: 'Change the name and metadata used to recognize this client.',
      redirects: 'Set the exact callbacks and browser origins accepted by Realmroot.',
      authorization: 'Choose the Resource Server scopes this application may request.',
      claims: 'Choose the authorization claims emitted to each token destination.',
      ownership: 'Set the Organization responsible for this client.',
      consent: 'Decide whether users approve access on first use and when requested scopes expand.',
    } as Record<Exclude<Editor, null>, string>
  )[editor ?? 'details']
}

function editorFormId(editor: Editor) {
  return editor ? `application-${editor}` : undefined
}
