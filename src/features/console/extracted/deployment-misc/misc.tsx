import { consoleQueryKeys, listRoles } from '@/lib/api/management'
import {
  type OrganizationTemplateSection,
  Plus,
  SettingRow,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
  tt,
  useEffect,
  useQuery,
  useState,
} from '../../console-shared'
import { SettingsSection, SettingsSections, TokenCustomizationCard } from '../../helpers/helpers-preview'
import { ResourcePage, RoutedSettingsTabs } from '../../helpers/helpers-resource'

export function ConsolePlaceholderPage({
  description,
  rows,
  title,
}: {
  description: string
  rows: Array<[string, string]>
  title: string
}) {
  return (
    <ResourcePage title={title} description={description} framed={false}>
      <SettingsSections>
        <SettingsSection title={title} description={description}>
          <div className="grid gap-3">
            {rows.map(([label, value]) => (
              <SettingRow key={label} label={label} value={value} />
            ))}
          </div>
        </SettingsSection>
      </SettingsSections>
    </ResourcePage>
  )
}
export function OrganizationTemplatePage({
  section = 'organization-roles',
}: {
  section?: OrganizationTemplateSection
}) {
  const [tab, setTab] = useState<OrganizationTemplateSection>(section)
  const [roleSearch, setRoleSearch] = useState('')
  const rolesQuery = useQuery({
    queryKey: consoleQueryKeys.roles,
    queryFn: listRoles,
  })
  const organizationRoles = rolesQuery.data?.roles.filter(
    (role) =>
      (role.organizationId || (!role.applicationId && !role.resourceId)) &&
      [role.name, role.key, role.description ?? ''].some((value) =>
        value.toLowerCase().includes(roleSearch.trim().toLowerCase()),
      ),
  )
  useEffect(() => setTab(section), [section])
  return (
    <ResourcePage
      title={tt('Organization template')}
      description={tt(
        'Configure authorization templates used by organizations. Team management is not part of this surface.',
      )}
      framed={false}
      error={rolesQuery.error}
      loading={rolesQuery.isLoading}
      onRetry={() => rolesQuery.refetch()}
    >
      <div className="grid gap-4">
        <RoutedSettingsTabs
          active={tab}
          ariaLabel="Organization template sections"
          onSelect={(value) => setTab(value)}
          tabs={[['organization-roles', 'Organization roles', '/console/organization-template/organization-roles']]}
        />
        <SettingsSections>
          {tab === 'organization-roles' ? (
            <SettingsSection
              title={tt('Organization roles')}
              description={tt('Create and search organization role definitions through the roles API.')}
            >
              <div className="grid gap-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <TextInput
                    aria-label={tt('Search organization roles')}
                    onChange={(event) => setRoleSearch(event.target.value)}
                    placeholder={tt('Search roles')}
                    value={roleSearch}
                  />
                  <a className="uiButton uiButton-primary" href="/console/roles">
                    <Plus data-icon="inline-start" /> {tt('Create role')}{' '}
                  </a>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tt('Role')}</TableHead>
                      <TableHead>{tt('Scope')}</TableHead>
                      <TableHead>{tt('Emitted claim')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {organizationRoles?.map((role) => (
                      <TableRow key={role.id}>
                        <TableCell>
                          <a className="font-medium hover:underline" href={`/console/roles/${role.id}`}>
                            {role.name}
                          </a>
                          <div className="text-xs text-muted-foreground">{role.key}</div>
                        </TableCell>
                        <TableCell>{role.organizationId ? 'Organization' : 'Global template'}</TableCell>
                        <TableCell>roles</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SettingsSection>
          ) : null}
        </SettingsSections>
      </div>
    </ResourcePage>
  )
}
export function CustomizeJwtPage() {
  return (
    <ResourcePage
      title={tt('Custom JWT')}
      description={tt('Review token claim controls backed by the current authorization model.')}
      framed={false}
    >
      <SettingsSections>
        <TokenCustomizationCard
          title={tt('Access token')}
          rows={[
            ['Audience', 'API resource URLs are emitted as audiences for matching protected APIs.'],
            ['Roles', 'Role keys are emitted in the roles claim.'],
            ['Groups', 'Relevant organization IDs are emitted in the groups claim.'],
            ['Scopes', 'Approved scopes are emitted in the scope claim.'],
          ]}
        />
        <TokenCustomizationCard
          title={tt('Machine-to-machine token')}
          rows={[
            ['Application roles', 'Application role assignments are supported.'],
            ['Claims', 'Uses the fixed roles, groups, and scope authorization claims.'],
          ]}
        />
        <TokenCustomizationCard
          title={tt('ID token')}
          rows={[
            ['Profile claims', 'Built-in auth profile claims are issued by the auth provider.'],
            ['Scope toggles', 'API scopes can opt into ID token inclusion where configured.'],
          ]}
        />
      </SettingsSections>
    </ResourcePage>
  )
}
