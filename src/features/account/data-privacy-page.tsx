import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  listAccountAgents,
  listAccountApplicationAuthorizations,
  listAccountOrganizations,
  listAccountSessions,
  listLinkedAccounts,
} from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import { AccountPageHeader, AccountRow, AccountRows, AccountSectionContent } from './account-page'
import { useAccountCenterLayout } from './account-surface'
import { DeleteAccountPanel } from './delete-account-panel'
import { useAccountMutation } from './queries'
import type { UserProfile } from './types'

export function AccountDataPrivacyPage() {
  const { accountCenter, profile } = useAccountCenterLayout()
  const mutate = useAccountMutation()
  return (
    <>
      <AccountPageHeader
        description={tt('Export your account data and manage permanent deletion.')}
        title={tt('Data & privacy')}
      />
      <AccountSectionContent surface>
        <AccountRows>
          <AccountRow
            action={
              <Button
                onClick={() => {
                  void mutate('Account data downloaded.', () =>
                    downloadAccountData(profile, {
                      includeApplications: accountCenter.connectedAccountsEnabled,
                      includeLinkedAccounts: accountCenter.connectedAccountsEnabled,
                      includeSessions: accountCenter.sessionsViewEnabled,
                    }),
                  )
                }}
                size="sm"
                variant="outline"
              >
                <Download />
                {tt('Download data')}
              </Button>
            }
            description={tt('Receive a machine-readable copy of your profile and grants.')}
            label={tt('Export account data')}
            value={tt('JSON')}
          />
          <DeleteAccountPanel />
        </AccountRows>
      </AccountSectionContent>
    </>
  )
}

async function downloadAccountData(
  profile: UserProfile,
  options: { includeApplications: boolean; includeLinkedAccounts: boolean; includeSessions: boolean },
) {
  const [organizations, agents, applications, linkedAccounts, sessions] = await Promise.all([
    listAccountOrganizations(),
    listAccountAgents(),
    options.includeApplications
      ? listAccountApplicationAuthorizations()
      : Promise.resolve({ items: [], pagination: null }),
    options.includeLinkedAccounts ? listLinkedAccounts() : Promise.resolve({ items: [], pagination: null }),
    options.includeSessions ? listAccountSessions() : Promise.resolve({ items: [], pagination: null }),
  ])
  const exportedAt = new Date().toISOString()
  const document = {
    format: 'realmroot-account-export',
    version: 1,
    exportedAt,
    profile,
    organizations,
    agents: agents.items,
    applications: applications.items,
    linkedAccounts: linkedAccounts.items,
    sessions: sessions.items,
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }))
  const link = window.document.createElement('a')
  link.download = `realmroot-account-${exportedAt.slice(0, 10)}.json`
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
  return document
}
