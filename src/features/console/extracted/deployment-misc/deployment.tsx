import { consoleQueryKeys, getSecurityPolicy } from '@/lib/api/management'
import {
  SettingRow,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  tt,
  useQuery,
  useState,
} from '../../console-shared'
import { PolicyCard, StatusBadge } from '../../helpers/helpers-dialogs'
import { SettingsSection, SettingsSections } from '../../helpers/helpers-preview'
import { ResourcePage, RoutedSettingsTabs } from '../../helpers/helpers-resource'

export function DeploymentSettingsPage() {
  const query = useQuery({
    queryKey: consoleQueryKeys.security,
    queryFn: getSecurityPolicy,
  })
  const [keyTab, setKeyTab] = useState('private')
  return (
    <ResourcePage
      title={tt('Settings')}
      description={tt('Review issuer metadata, session TTL, and signing-key runtime state for this tenant.')}
      error={query.error}
      framed={false}
      loading={query.isLoading}
      onRetry={() => query.refetch()}
    >
      <RoutedSettingsTabs
        active="oidc-configs"
        ariaLabel="Tenant settings"
        tabs={[['oidc-configs', 'OIDC configs', '/console/tenant-settings/oidc-configs']]}
      />
      {query.data ? (
        <SettingsSections>
          <SettingsSection
            title={tt('Runtime endpoints')}
            description={tt('Static Console settings tied to the current deployment.')}
          >
            <div className="grid gap-3">
              <SettingRow label={tt('Platform')} value="Cloudflare Workers" />
              <SettingRow label={tt('Database')} value="D1" />
              <SettingRow label={tt('Auth issuer')} value="/api/auth" />
              <SettingRow label={tt('Discovery')} value="/api/auth/.well-known/openid-configuration" />
              <SettingRow label={tt('JWKS URI')} value="/api/auth/jwks" />
              <SettingRow label={tt('Management API')} value="/api" />
            </div>
          </SettingsSection>
          <SettingsSection
            title={tt('Session TTL')}
            description={tt('Runtime session lifetime and cookie-cache values.')}
          >
            <div className="grid gap-3">
              <SettingRow label={tt('Session TTL')} value={`${query.data.policy.sessions.expiresInSeconds}s`} />
              <SettingRow label={tt('Update age')} value={`${query.data.policy.sessions.updateAgeSeconds}s`} />
              <SettingRow label={tt('Fresh age')} value={`${query.data.policy.sessions.freshAgeSeconds}s`} />
              <SettingRow label={tt('Cookie cache')} value={`${query.data.policy.sessions.cookieCacheSeconds}s`} />
            </div>
          </SettingsSection>
          <SettingsSection
            title={tt('Signing keys')}
            description={tt('Deployment-managed OIDC signing material exposed through JWKS.')}
          >
            <div className="grid gap-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tt('Key')}</TableHead>
                    <TableHead>{tt('Use')}</TableHead>
                    <TableHead>{tt('Status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>{tt('Current deployment key')}</TableCell>
                    <TableCell>{tt('OIDC JWT signing')}</TableCell>
                    <TableCell>
                      <StatusBadge active activeLabel="Active" inactiveLabel="Inactive" />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Tabs className="flex flex-col gap-4" setValue={setKeyTab} value={keyTab}>
                <TabsList>
                  <TabsTrigger value="private">{tt('Private key')}</TabsTrigger>
                  <TabsTrigger value="cookie">{tt('Cookie key')}</TabsTrigger>
                </TabsList>
                <TabsContent value="private">
                  <PolicyCard
                    framed={false}
                    rows={[
                      ['Storage', 'AUTH_SECRET deployment binding'],
                      ['Exposure', 'Private key material is never shown in Console.'],
                    ]}
                    title={tt('Private key')}
                  />
                </TabsContent>
                <TabsContent value="cookie">
                  <PolicyCard
                    framed={false}
                    rows={[
                      ['Storage', 'AUTH_SECRET deployment binding'],
                      ['Cookie cache', `${query.data.policy.sessions.cookieCacheSeconds}s`],
                    ]}
                    title={tt('Cookie key')}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </SettingsSection>
        </SettingsSections>
      ) : null}
    </ResourcePage>
  )
}
