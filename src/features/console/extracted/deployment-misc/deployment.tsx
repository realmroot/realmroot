import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Field, SelectInput, TextInput } from '@/components/product-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  consoleQueryKeys,
  getDeveloperSettings,
  getEmailDeliveryConfiguration,
  getRealm,
  listOrganizations,
  listUsers,
  replaceEmailDeliveryConfiguration,
  updateDeveloperSettings,
  updateRealm,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'
import { ErrorState, LoadingState, MutationError } from '../../helpers/helpers-dialogs'
import { ResourcePage } from '../../helpers/helpers-resource'
import { useAdminMutation } from '../../helpers/helpers-utils'
import { IdentityMultiSelect, organizationOptions, userOptions } from '../../helpers/ownership-access-controls'

export type SettingsSection = 'general' | 'email' | 'developer' | 'deployment'
type Editor = 'general' | 'email' | 'developer' | null
type SettingsState = {
  realmName: string
  emailEnabled: boolean
  senderName: string
  senderAddress: string
  replyToAddress: string
  organizationCreation: string
  approvedUserIds: string[]
  consoleAccess: string
  eligibleLevels: string
  selectedOrganizationIds: string[]
}

export const developerPolicyOptions = {
  organizationCreation: ['Realm administrators only', 'Approved users', 'Any verified user'],
  consoleAccess: ['Realm operators only', 'Selected organizations', 'All organizations'],
  eligibleLevels: ['Owner only', 'Owner and Administrator', 'Owner, Administrator, Developer'],
} as const

const initialSettings: SettingsState = {
  realmName: 'Realmroot',
  emailEnabled: false,
  senderName: '',
  senderAddress: '',
  replyToAddress: '',
  organizationCreation: 'Realm administrators only',
  approvedUserIds: [],
  consoleAccess: 'Realm operators only',
  eligibleLevels: 'Owner and Administrator',
  selectedOrganizationIds: [],
}

export function SettingsPage({ section = 'general' }: { section?: SettingsSection }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [active, setActive] = useState<SettingsSection>(section)
  const [editor, setEditor] = useState<Editor>(null)
  const [saved, setSaved] = useState(initialSettings)
  const organizations = useQuery({ queryKey: consoleQueryKeys.organizations, queryFn: listOrganizations })
  const users = useQuery({
    queryKey: [...consoleQueryKeys.users, { limit: 100, purpose: 'developer-policy' }],
    queryFn: () => listUsers({ limit: 100 }),
  })
  const developerSettings = useQuery({ queryKey: consoleQueryKeys.developer, queryFn: getDeveloperSettings })
  const generalSettings = useQuery({ queryKey: consoleQueryKeys.general, queryFn: getRealm })
  const emailSettings = useQuery({ queryKey: consoleQueryKeys.email, queryFn: getEmailDeliveryConfiguration })
  const developerMutation = useAdminMutation({
    mutationFn: updateDeveloperSettings,
    onSuccess: async (settings) => {
      setSaved((current) => ({ ...current, ...developerSettingsState(settings) }))
      setEditor(null)
      queryClient.setQueryData(consoleQueryKeys.developer, settings)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.organizations })
    },
  })
  const generalMutation = useAdminMutation({
    mutationFn: updateRealm,
    onSuccess: async (settings) => {
      queryClient.setQueryData(consoleQueryKeys.general, settings)
      setSaved((current) => ({ ...current, realmName: settings.name }))
      setEditor(null)
    },
  })
  const emailMutation = useAdminMutation({
    mutationFn: replaceEmailDeliveryConfiguration,
    onSuccess: async (settings) => {
      queryClient.setQueryData(consoleQueryKeys.email, settings)
      setSaved((current) => ({ ...current, ...emailSettingsState(settings) }))
      setEditor(null)
    },
  })
  useEffect(() => setActive(section), [section])
  useEffect(() => {
    if (developerSettings.data) {
      setSaved((current) => ({ ...current, ...developerSettingsState(developerSettings.data) }))
    }
  }, [developerSettings.data])
  useEffect(() => {
    if (generalSettings.data) setSaved((current) => ({ ...current, realmName: generalSettings.data.name }))
  }, [generalSettings.data])
  useEffect(() => {
    if (emailSettings.data) setSaved((current) => ({ ...current, ...emailSettingsState(emailSettings.data) }))
  }, [emailSettings.data])

  if (
    organizations.isLoading ||
    users.isLoading ||
    developerSettings.isLoading ||
    generalSettings.isLoading ||
    emailSettings.isLoading
  )
    return <LoadingState label={tt('Loading settings')} />
  const queryError =
    organizations.error ?? users.error ?? developerSettings.error ?? generalSettings.error ?? emailSettings.error
  if (queryError)
    return (
      <ErrorState
        error={queryError}
        onRetry={() => {
          void organizations.refetch()
          void users.refetch()
          void developerSettings.refetch()
          void generalSettings.refetch()
          void emailSettings.refetch()
        }}
      />
    )

  const selectedOrganizations = (organizations.data?.organizations ?? []).filter((organization) =>
    saved.selectedOrganizationIds.includes(organization.id),
  )
  const approvedUsers = (users.data?.users ?? []).filter((user) => saved.approvedUserIds.includes(user.id))
  const emailConfigured = saved.emailEnabled && Boolean(saved.senderAddress) && emailSettings.data?.bindingAvailable

  return (
    <ResourcePage
      description={tt('Manage Realm identity, delivery, developer access, and deployment information.')}
      framed={false}
      title={tt('Settings')}
    >
      <Tabs
        onValueChange={(value) => {
          const next = value as SettingsSection
          setActive(next)
          void navigate({ to: `/console/tenant-settings/${next}` })
        }}
        value={active}
      >
        <TabsList className="w-full" variant="navigation">
          <TabsTrigger value="general">{tt('General')}</TabsTrigger>
          <TabsTrigger value="email">{tt('Email delivery')}</TabsTrigger>
          <TabsTrigger value="developer">{tt('Developer')}</TabsTrigger>
          <TabsTrigger value="deployment">{tt('Deployment')}</TabsTrigger>
        </TabsList>
        <TabsContent className="mt-5" value="general">
          <div className="detailSections">
            <SettingsBlock
              action={
                <Button onClick={() => setEditor('general')} variant="outline">
                  <Pencil />
                  {tt('Edit')}
                </Button>
              }
              description="Name used to identify this Realm across hosted product surfaces."
              title="Realm details"
            >
              <DetailRow label="Realm name" value={saved.realmName} />
              <DetailRow label="Issuer" value={<code>{generalSettings.data!.issuer}</code>} />
            </SettingsBlock>
            <SettingsBlock description="Stable standards endpoints exposed by this Realm." title="Protocol endpoints">
              <DetailRow label="OIDC discovery" value={<code>{generalSettings.data!.oidcDiscoveryUrl}</code>} />
              <DetailRow label="JWKS" value={<code>{generalSettings.data!.jwksUrl}</code>} />
              <DetailRow label="Management API" value={<code>{generalSettings.data!.managementApiUrl}</code>} />
            </SettingsBlock>
          </div>
        </TabsContent>
        <TabsContent className="mt-5" value="email">
          <div className="detailSections">
            <SettingsBlock
              action={
                <Button onClick={() => setEditor('email')} variant="outline">
                  <Pencil />
                  {tt('Configure')}
                </Button>
              }
              description="Delivery provider and sender identity used for authentication messages."
              title="Delivery"
            >
              <DetailRow label="Provider" value="Cloudflare Email" />
              <DetailRow
                label="Delivery"
                value={
                  <Badge variant={emailConfigured ? 'secondary' : 'outline'}>
                    {!emailSettings.data!.bindingAvailable
                      ? tt('Binding unavailable')
                      : saved.emailEnabled
                        ? tt('Enabled')
                        : tt('Disabled')}
                  </Badge>
                }
              />
              <DetailRow
                label="Sender"
                value={emailConfigured ? `${saved.senderName} <${saved.senderAddress}>` : tt('Not configured')}
              />
              <DetailRow label="Reply-to" value={saved.replyToAddress || tt('Uses sender address')} />
              <DetailRow
                label="Configuration source"
                value={emailSettings.data!.source === 'database' ? tt('Realm settings') : tt('Deployment fallback')}
              />
            </SettingsBlock>
            <SettingsBlock
              description="Messages Realmroot can send after a delivery provider is configured."
              title="Messages"
            >
              <DetailRow label="Email verification" value={emailConfigured ? tt('Available') : tt('Unavailable')} />
              <DetailRow label="Password recovery" value={emailConfigured ? tt('Available') : tt('Unavailable')} />
              <DetailRow label="Email sign-in code" value={emailConfigured ? tt('Available') : tt('Unavailable')} />
              <DetailRow
                label="Organization invitation"
                value={emailConfigured ? tt('Available') : tt('Unavailable')}
              />
            </SettingsBlock>
          </div>
        </TabsContent>
        <TabsContent className="mt-5" value="developer">
          <div className="detailSections">
            <SettingsBlock
              action={
                <Button onClick={() => setEditor('developer')} variant="outline">
                  <Pencil />
                  {tt('Edit policy')}
                </Button>
              }
              description="Organization creation and Console developer access are independent product capabilities."
              title="Access policies"
            >
              <DetailRow
                description="Controls who may create an Organization in Account Center. This does not grant Console access."
                label="Organization creation"
                value={saved.organizationCreation}
              />
              <DetailRow
                description="Controls which users may register and manage technical resources."
                label="Console access"
                value={saved.consoleAccess}
              />
              <DetailRow
                description="A member must also hold one of these Organization access levels."
                label="Eligible access levels"
                value={saved.eligibleLevels}
              />
            </SettingsBlock>
            {saved.consoleAccess === 'Selected organizations' ? (
              <SettingsBlock
                description="Organizations whose eligible members may use Console."
                title="Selected organizations"
              >
                {selectedOrganizations.length ? (
                  selectedOrganizations.map((organization) => (
                    <DetailRow
                      key={organization.id}
                      label={organization.displayName ?? organization.name}
                      value={<Badge variant="secondary">{tt('Included')}</Badge>}
                    />
                  ))
                ) : (
                  <DetailRow label="Organizations" value={tt('None selected')} />
                )}
              </SettingsBlock>
            ) : null}
            {saved.organizationCreation === 'Approved users' ? (
              <SettingsBlock
                description="Users who may create an Organization without receiving Console access."
                title="Approved users"
              >
                {approvedUsers.length ? (
                  approvedUsers.map((user) => (
                    <DetailRow
                      key={user.id}
                      label={user.displayName ?? user.name ?? user.email ?? user.id}
                      value={<Badge variant="secondary">{tt('Approved')}</Badge>}
                    />
                  ))
                ) : (
                  <DetailRow label="Users" value={tt('None selected')} />
                )}
              </SettingsBlock>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent className="mt-5" value="deployment">
          <div className="detailSections">
            <SettingsBlock description="Current infrastructure and request origin." title="Runtime">
              <DetailRow label="Platform" value="Cloudflare Workers" />
              <DetailRow label="Database" value="Cloudflare D1" />
              <DetailRow label="Environment" value={import.meta.env.MODE} />
              <DetailRow label="Origin" value={<code>{window.location.origin}</code>} />
            </SettingsBlock>
          </div>
        </TabsContent>
      </Tabs>
      <SettingsEditor
        editor={editor}
        emailBindingAvailable={emailSettings.data!.bindingAvailable}
        error={generalMutation.error ?? emailMutation.error ?? developerMutation.error}
        onClose={() => setEditor(null)}
        onSave={(next) => {
          if (editor === 'general') {
            generalMutation.mutate({ input: { name: next.realmName! }, etag: generalSettings.data!.etag })
            return
          }
          if (editor === 'email') {
            emailMutation.mutate({
              etag: emailSettings.data!.etag,
              input: {
                provider: 'cloudflare_email',
                enabled: next.emailEnabled!,
                fromName: next.senderName || null,
                fromEmail: next.senderAddress!,
                replyToEmail: next.replyToAddress || null,
              },
            })
            return
          }
          if (editor === 'developer') {
            developerMutation.mutate({
              organizationCreation: organizationCreationValue(next.organizationCreation!),
              approvedUserIds: next.approvedUserIds ?? [],
              consoleAccess: consoleAccessValue(next.consoleAccess!),
              eligibleAccessLevels: eligibleAccessLevelValues(next.eligibleLevels!),
              selectedOrganizationIds: next.selectedOrganizationIds ?? [],
              organizationCreationEtag: developerSettings.data!.organizationCreationEtag,
              consoleAccessEtag: developerSettings.data!.consoleAccessEtag,
            })
            return
          }
        }}
        organizations={organizations.data?.organizations ?? []}
        users={users.data?.users ?? []}
        saved={saved}
        saving={generalMutation.isPending || emailMutation.isPending || developerMutation.isPending}
      />
    </ResourcePage>
  )
}

export function DeploymentSettingsPage() {
  return <SettingsPage section="deployment" />
}

function emailSettingsState(
  settings: Awaited<ReturnType<typeof getEmailDeliveryConfiguration>>,
): Pick<SettingsState, 'emailEnabled' | 'senderName' | 'senderAddress' | 'replyToAddress'> {
  return {
    emailEnabled: settings.enabled,
    senderName: settings.fromName ?? '',
    senderAddress: settings.fromEmail ?? '',
    replyToAddress: settings.replyToEmail ?? '',
  }
}

function SettingsEditor({
  editor,
  emailBindingAvailable,
  error,
  onClose,
  onSave,
  organizations,
  saved,
  saving,
  users,
}: {
  editor: Editor
  emailBindingAvailable: boolean
  error: Error | null
  onClose: () => void
  onSave: (next: Partial<SettingsState>) => void
  organizations: Awaited<ReturnType<typeof listOrganizations>>['organizations']
  saved: SettingsState
  saving: boolean
  users: Awaited<ReturnType<typeof listUsers>>['users']
}) {
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState(saved.selectedOrganizationIds)
  const [approvedUserIds, setApprovedUserIds] = useState(saved.approvedUserIds)
  const [organizationCreation, setOrganizationCreation] = useState(saved.organizationCreation)
  const [consoleAccess, setConsoleAccess] = useState(saved.consoleAccess)
  const [emailEnabled, setEmailEnabled] = useState(saved.emailEnabled)
  useEffect(() => {
    if (editor !== 'developer') return
    setSelectedOrganizationIds(saved.selectedOrganizationIds)
    setApprovedUserIds(saved.approvedUserIds)
    setOrganizationCreation(saved.organizationCreation)
    setConsoleAccess(saved.consoleAccess)
  }, [editor, saved])
  useEffect(() => {
    if (editor === 'email') setEmailEnabled(saved.emailEnabled)
  }, [editor, saved.emailEnabled])

  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={editor !== null}
    >
      <SheetContent className="flex h-full flex-col overflow-hidden">
        <SheetHeader>
          <SheetTitle>
            {tt(
              editor === 'general'
                ? 'Edit Realm details'
                : editor === 'email'
                  ? 'Configure email delivery'
                  : 'Edit developer access',
            )}
          </SheetTitle>
          <SheetDescription>
            {tt(
              editor === 'general'
                ? 'Update the name used to identify this Realm.'
                : editor === 'email'
                  ? 'Configure the verified sender used by authentication messages.'
                  : 'Set Organization creation and Console access independently.',
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {editor === 'general' ? (
            <SettingsForm
              id="settings-general"
              onSubmit={(form) => onSave({ realmName: String(form.get('realmName')) })}
            >
              <Field label={tt('Realm name')}>
                <TextInput defaultValue={saved.realmName} name="realmName" required />
              </Field>
            </SettingsForm>
          ) : null}
          {editor === 'email' ? (
            <SettingsForm
              id="settings-email"
              onSubmit={(form) =>
                onSave({
                  emailEnabled,
                  senderName: String(form.get('senderName')),
                  senderAddress: String(form.get('senderAddress')),
                  replyToAddress: String(form.get('replyToAddress')),
                })
              }
            >
              <Field
                help={
                  emailBindingAvailable
                    ? tt('Authentication messages are sent through the deployment Cloudflare Email binding.')
                    : tt('Add a Cloudflare Email binding to this deployment before enabling delivery.')
                }
                label={tt('Email delivery')}
              >
                <Switch
                  aria-label={tt('Email delivery')}
                  checked={emailEnabled}
                  disabled={!emailBindingAvailable && !saved.emailEnabled}
                  name="emailEnabled"
                  onCheckedChange={setEmailEnabled}
                />
              </Field>
              <Field label={tt('Sender name')}>
                <TextInput defaultValue={saved.senderName} name="senderName" />
              </Field>
              <Field label={tt('Sender address')}>
                <TextInput defaultValue={saved.senderAddress} name="senderAddress" required type="email" />
              </Field>
              <Field help={tt('Leave empty to use the sender address.')} label={tt('Reply-to address')}>
                <TextInput defaultValue={saved.replyToAddress} name="replyToAddress" type="email" />
              </Field>
            </SettingsForm>
          ) : null}
          {editor === 'developer' ? (
            <SettingsForm
              id="settings-developer"
              onSubmit={(form) =>
                onSave({
                  organizationCreation: String(form.get('organizationCreation')),
                  approvedUserIds,
                  consoleAccess: String(form.get('consoleAccess')),
                  eligibleLevels: String(form.get('eligibleLevels')),
                  selectedOrganizationIds,
                })
              }
            >
              <Field help={tt('This never grants Console access.')} label={tt('Organization creation')}>
                <SelectInput
                  name="organizationCreation"
                  onChange={(event) => setOrganizationCreation(event.target.value)}
                  value={organizationCreation}
                >
                  {developerPolicyOptions.organizationCreation.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </SelectInput>
              </Field>
              {organizationCreation === 'Approved users' ? (
                <IdentityMultiSelect
                  emptyLabel={tt('No users found')}
                  label={tt('Approved users')}
                  onChange={setApprovedUserIds}
                  options={userOptions(users)}
                  placeholder={tt('Select users')}
                  value={approvedUserIds}
                />
              ) : null}
              <Field
                help={tt('This never controls whether Organizations exist in Account Center.')}
                label={tt('Console access')}
              >
                <SelectInput
                  name="consoleAccess"
                  onChange={(event) => setConsoleAccess(event.target.value)}
                  value={consoleAccess}
                >
                  {developerPolicyOptions.consoleAccess.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </SelectInput>
              </Field>
              <Field label={tt('Eligible access levels')}>
                <SelectInput defaultValue={saved.eligibleLevels} name="eligibleLevels">
                  {developerPolicyOptions.eligibleLevels.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </SelectInput>
              </Field>
              {consoleAccess === 'Selected organizations' ? (
                <IdentityMultiSelect
                  emptyLabel={tt('No Organizations found')}
                  label={tt('Selected organizations')}
                  onChange={setSelectedOrganizationIds}
                  options={organizationOptions(organizations).filter(
                    (organization) => organization.id !== 'org_platform',
                  )}
                  placeholder={tt('Select Organizations')}
                  value={selectedOrganizationIds}
                />
              ) : null}
            </SettingsForm>
          ) : null}
          <MutationError error={error} />
        </div>
        <SheetFooter className="shrink-0">
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={saving} form={editor ? `settings-${editor}` : undefined} type="submit">
            {saving ? tt('Saving…') : tt('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function developerSettingsState(
  settings: Awaited<ReturnType<typeof getDeveloperSettings>>,
): Pick<
  SettingsState,
  'organizationCreation' | 'approvedUserIds' | 'consoleAccess' | 'eligibleLevels' | 'selectedOrganizationIds'
> {
  return {
    organizationCreation: (
      {
        admins_only: 'Realm administrators only',
        approved_users: 'Approved users',
        verified_users: 'Any verified user',
      } as const
    )[settings.organizationCreation],
    approvedUserIds: settings.approvedUserIds,
    consoleAccess: (
      {
        realm_operators: 'Realm operators only',
        selected_organizations: 'Selected organizations',
        all_organizations: 'All organizations',
      } as const
    )[settings.consoleAccess],
    eligibleLevels: settings.eligibleAccessLevels.includes('developer')
      ? 'Owner, Administrator, Developer'
      : settings.eligibleAccessLevels.includes('admin')
        ? 'Owner and Administrator'
        : 'Owner only',
    selectedOrganizationIds: settings.selectedOrganizationIds,
  }
}

function organizationCreationValue(label: string): 'admins_only' | 'approved_users' | 'verified_users' {
  const value = (
    {
      'Realm administrators only': 'admins_only',
      'Approved users': 'approved_users',
      'Any verified user': 'verified_users',
    } as const
  )[label as keyof typeof organizationCreationLabels]
  return value
}

const organizationCreationLabels = {
  'Realm administrators only': true,
  'Approved users': true,
  'Any verified user': true,
} as const

function consoleAccessValue(label: string): 'realm_operators' | 'selected_organizations' | 'all_organizations' {
  return (
    {
      'Realm operators only': 'realm_operators',
      'Selected organizations': 'selected_organizations',
      'All organizations': 'all_organizations',
    } as const
  )[label as 'Realm operators only' | 'Selected organizations' | 'All organizations']
}

function eligibleAccessLevelValues(label: string): Array<'owner' | 'admin' | 'developer'> {
  if (label === 'Owner, Administrator, Developer') return ['owner', 'admin', 'developer']
  if (label === 'Owner and Administrator') return ['owner', 'admin']
  return ['owner']
}

function SettingsForm({
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
      className="grid gap-5 px-4 py-5"
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

function SettingsBlock({
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

function DetailRow({ description, label, value }: { description?: string; label: string; value: ReactNode }) {
  return (
    <div className="detailFlatRow">
      <div>
        <strong>{tt(label)}</strong>
        {description ? <span>{tt(description)}</span> : null}
      </div>
      <span>{value}</span>
      <i />
    </div>
  )
}
