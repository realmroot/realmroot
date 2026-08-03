import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { SelectInput, TextInput } from '@/components/product-form'
import {
  hasSettingsChanges,
  SettingsForm,
  SettingsFormField,
  SettingsFormSection,
  SettingsSwitchField,
  SettingsValueField,
} from '@/components/settings-form'
import { Badge } from '@/components/ui/badge'
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
import { ResourcePage } from '../../helpers/helpers-resource'
import { useAdminMutation } from '../../helpers/helpers-utils'
import { IdentityMultiSelectControl, organizationOptions, userOptions } from '../../helpers/ownership-access-controls'

export type SettingsSection = 'general' | 'email' | 'developer' | 'deployment'
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
      queryClient.setQueryData(consoleQueryKeys.developer, settings)
      return queryClient.invalidateQueries({ queryKey: consoleQueryKeys.organizations })
    },
  })
  const generalMutation = useAdminMutation({
    mutationFn: updateRealm,
    onSuccess: async (settings) => {
      queryClient.setQueryData(consoleQueryKeys.general, settings)
      setSaved((current) => ({ ...current, realmName: settings.name }))
    },
  })
  const emailMutation = useAdminMutation({
    mutationFn: replaceEmailDeliveryConfiguration,
    onSuccess: async (settings) => {
      queryClient.setQueryData(consoleQueryKeys.email, settings)
      setSaved((current) => ({ ...current, ...emailSettingsState(settings) }))
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
  const pageDescription = tt('Manage Realm identity, delivery, developer access, and deployment information.')
  const pageTitle = tt('Settings')
  const retry = () => {
    void organizations.refetch()
    void users.refetch()
    void developerSettings.refetch()
    void generalSettings.refetch()
    void emailSettings.refetch()
  }

  if (
    organizations.isLoading ||
    users.isLoading ||
    developerSettings.isLoading ||
    generalSettings.isLoading ||
    emailSettings.isLoading
  )
    return (
      <ResourcePage description={pageDescription} framed={false} loading title={pageTitle}>
        <div />
      </ResourcePage>
    )
  const queryError =
    organizations.error ?? users.error ?? developerSettings.error ?? generalSettings.error ?? emailSettings.error
  if (queryError)
    return (
      <ResourcePage description={pageDescription} error={queryError} framed={false} onRetry={retry} title={pageTitle}>
        <div />
      </ResourcePage>
    )

  const emailConfigured = saved.emailEnabled && Boolean(saved.senderAddress) && emailSettings.data?.bindingAvailable

  return (
    <ResourcePage description={pageDescription} framed={false} title={pageTitle}>
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
          <SettingsForm
            dirty={saved.realmName !== generalSettings.data!.name}
            error={generalMutation.errorMessage}
            onDiscard={() => setSaved((current) => ({ ...current, realmName: generalSettings.data!.name }))}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              generalMutation.mutate({ input: { name: saved.realmName }, etag: generalSettings.data!.etag })
            }}
            pending={generalMutation.isPending}
          >
            <SettingsFormSection
              description="Name used to identify this Realm across hosted product surfaces."
              title="Realm details"
            >
              <SettingsFormField label="Realm name">
                <TextInput
                  name="realmName"
                  onChange={(event) => setSaved((current) => ({ ...current, realmName: event.target.value }))}
                  required
                  value={saved.realmName}
                />
              </SettingsFormField>
              <SettingsValueField label="Issuer" value={<code>{generalSettings.data!.issuer}</code>} />
            </SettingsFormSection>
            <SettingsFormSection
              description="Stable standards endpoints exposed by this Realm."
              title="Protocol endpoints"
            >
              <SettingsValueField
                label="OIDC discovery"
                value={<code>{generalSettings.data!.oidcDiscoveryUrl}</code>}
              />
              <SettingsValueField label="JWKS" value={<code>{generalSettings.data!.jwksUrl}</code>} />
              <SettingsValueField
                label="Management API"
                value={<code>{generalSettings.data!.managementApiUrl}</code>}
              />
            </SettingsFormSection>
          </SettingsForm>
        </TabsContent>
        <TabsContent className="mt-5" value="email">
          <SettingsForm
            dirty={hasSettingsChanges(emailFormState(saved), emailSettingsState(emailSettings.data!))}
            error={emailMutation.errorMessage}
            onDiscard={() => setSaved((current) => ({ ...current, ...emailSettingsState(emailSettings.data!) }))}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              emailMutation.mutate({
                etag: emailSettings.data!.etag,
                input: {
                  provider: 'cloudflare_email',
                  enabled: saved.emailEnabled,
                  fromName: saved.senderName || null,
                  fromEmail: saved.senderAddress,
                  replyToEmail: saved.replyToAddress || null,
                },
              })
            }}
            pending={emailMutation.isPending}
          >
            <SettingsFormSection
              description="Configure the provider and sender shown on verification, recovery, and security email."
              title="Sender identity"
            >
              <SettingsValueField label="Provider" value="Cloudflare Email" />
              <SettingsSwitchField
                control={
                  <Switch
                    aria-label={tt('Email delivery')}
                    checked={saved.emailEnabled}
                    disabled={!emailSettings.data!.bindingAvailable && !saved.emailEnabled}
                    onCheckedChange={(emailEnabled) => setSaved((current) => ({ ...current, emailEnabled }))}
                  />
                }
                description={
                  emailSettings.data!.bindingAvailable
                    ? 'Authentication messages use the deployment Cloudflare Email binding.'
                    : 'Add a Cloudflare Email binding before enabling delivery.'
                }
                label="Email delivery"
              />
              <SettingsFormField label="Sender name">
                <TextInput
                  name="senderName"
                  onChange={(event) => setSaved((current) => ({ ...current, senderName: event.target.value }))}
                  value={saved.senderName}
                />
              </SettingsFormField>
              <SettingsFormField label="Sender address">
                <TextInput
                  name="senderAddress"
                  onChange={(event) => setSaved((current) => ({ ...current, senderAddress: event.target.value }))}
                  required
                  type="email"
                  value={saved.senderAddress}
                />
              </SettingsFormField>
              <SettingsFormField description="Leave empty to use the sender address." label="Reply-to address">
                <TextInput
                  name="replyToAddress"
                  onChange={(event) => setSaved((current) => ({ ...current, replyToAddress: event.target.value }))}
                  type="email"
                  value={saved.replyToAddress}
                />
              </SettingsFormField>
              <SettingsValueField
                label="Delivery status"
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
              <SettingsValueField
                label="Configuration source"
                value={emailSettings.data!.source === 'database' ? tt('Realm settings') : tt('Deployment fallback')}
              />
            </SettingsFormSection>
          </SettingsForm>
        </TabsContent>
        <TabsContent className="mt-5" value="developer">
          <SettingsForm
            dirty={hasSettingsChanges(developerFormState(saved), developerSettingsState(developerSettings.data!))}
            error={developerMutation.errorMessage}
            onDiscard={() =>
              setSaved((current) => ({ ...current, ...developerSettingsState(developerSettings.data!) }))
            }
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              developerMutation.mutate({
                organizationCreation: organizationCreationValue(saved.organizationCreation),
                approvedUserIds: saved.approvedUserIds,
                consoleAccess: consoleAccessValue(saved.consoleAccess),
                eligibleAccessLevels: eligibleAccessLevelValues(saved.eligibleLevels),
                selectedOrganizationIds: saved.selectedOrganizationIds,
                organizationCreationEtag: developerSettings.data!.organizationCreationEtag,
                consoleAccessEtag: developerSettings.data!.consoleAccessEtag,
              })
            }}
            pending={developerMutation.isPending}
          >
            <SettingsFormSection
              description="Organization creation and Console developer access are independent product capabilities."
              title="Access policies"
            >
              <SettingsFormField
                description="Choose who may create a new Organization. This does not grant Console access."
                label="Organization creation"
              >
                <SelectInput
                  name="organizationCreation"
                  onChange={(event) =>
                    setSaved((current) => ({ ...current, organizationCreation: event.target.value }))
                  }
                  value={saved.organizationCreation}
                >
                  {developerPolicyOptions.organizationCreation.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </SelectInput>
              </SettingsFormField>
              {saved.organizationCreation === 'Approved users' ? (
                <SettingsFormField description="Users approved to create an Organization." label="Approved users">
                  <IdentityMultiSelectControl
                    emptyLabel={tt('No users found')}
                    label={tt('Approved users')}
                    onChange={(approvedUserIds) => setSaved((current) => ({ ...current, approvedUserIds }))}
                    options={userOptions(users.data?.users ?? [])}
                    placeholder={tt('Select users')}
                    value={saved.approvedUserIds}
                  />
                </SettingsFormField>
              ) : null}
              <SettingsFormField
                description="Choose which Organization members may register and manage technical resources."
                label="Console access"
              >
                <SelectInput
                  name="consoleAccess"
                  onChange={(event) => setSaved((current) => ({ ...current, consoleAccess: event.target.value }))}
                  value={saved.consoleAccess}
                >
                  {developerPolicyOptions.consoleAccess.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </SelectInput>
              </SettingsFormField>
              <SettingsFormField
                description="Members must also hold one of these Organization access levels."
                label="Eligible access levels"
              >
                <SelectInput
                  name="eligibleLevels"
                  onChange={(event) => setSaved((current) => ({ ...current, eligibleLevels: event.target.value }))}
                  value={saved.eligibleLevels}
                >
                  {developerPolicyOptions.eligibleLevels.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </SelectInput>
              </SettingsFormField>
              {saved.consoleAccess === 'Selected organizations' ? (
                <SettingsFormField
                  description="Organizations whose eligible members may use Console."
                  label="Selected organizations"
                >
                  <IdentityMultiSelectControl
                    emptyLabel={tt('No Organizations found')}
                    label={tt('Selected organizations')}
                    onChange={(selectedOrganizationIds) =>
                      setSaved((current) => ({ ...current, selectedOrganizationIds }))
                    }
                    options={organizationOptions(organizations.data?.organizations ?? []).filter(
                      (organization) => organization.id !== 'org_platform',
                    )}
                    placeholder={tt('Select Organizations')}
                    value={saved.selectedOrganizationIds}
                  />
                </SettingsFormField>
              ) : null}
            </SettingsFormSection>
          </SettingsForm>
        </TabsContent>
        <TabsContent className="mt-5" value="deployment">
          <SettingsFormSection description="Current infrastructure and request origin." title="Runtime">
            <SettingsValueField label="Platform" value="Cloudflare Workers" />
            <SettingsValueField label="Database" value="Cloudflare D1" />
            <SettingsValueField label="Environment" value={import.meta.env.MODE} />
            <SettingsValueField label="Origin" value={<code>{window.location.origin}</code>} />
          </SettingsFormSection>
        </TabsContent>
      </Tabs>
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

function emailFormState(
  settings: SettingsState,
): Pick<SettingsState, 'emailEnabled' | 'senderName' | 'senderAddress' | 'replyToAddress'> {
  return {
    emailEnabled: settings.emailEnabled,
    senderName: settings.senderName,
    senderAddress: settings.senderAddress,
    replyToAddress: settings.replyToAddress,
  }
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

function developerFormState(
  settings: SettingsState,
): Pick<
  SettingsState,
  'organizationCreation' | 'approvedUserIds' | 'consoleAccess' | 'eligibleLevels' | 'selectedOrganizationIds'
> {
  return {
    organizationCreation: settings.organizationCreation,
    approvedUserIds: settings.approvedUserIds,
    consoleAccess: settings.consoleAccess,
    eligibleLevels: settings.eligibleLevels,
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
