import { SettingRow, tt } from '../../console-shared'
import { SettingsSection, SettingsSections, TokenCustomizationCard } from '../../helpers/helpers-preview'
import { ResourcePage } from '../../helpers/helpers-resource'

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
