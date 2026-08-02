import type { AccountProfileResponse } from '@shared/api/account'
import type { ReactNode } from 'react'
import { AccountPageError, AccountPageLoading, AccountPageShell } from './account-shell'
import { useAccountConfig, useAccountProfile } from './queries'
import type { AccountCenterSection } from './settings'
import { defaultAccountCenterSettings } from './settings'
import type { UserProfile } from './types'

export function AccountSurface({
  children,
  section,
}: {
  children: (
    profile: UserProfile,
    access: AccountProfileResponse['access'],
    activeOrganizationId: string | null,
  ) => ReactNode
  section: AccountCenterSection
}) {
  const configQuery = useAccountConfig()
  const profileQuery = useAccountProfile()
  const config = configQuery.data ?? null
  const error = configQuery.error ?? profileQuery.error

  if (configQuery.isLoading || profileQuery.isLoading) return <AccountPageLoading config={config} />
  if (error) {
    return <AccountPageError config={config} message={error instanceof Error ? error.message : 'Unable to load.'} />
  }

  const profile = profileQuery.data?.user ?? null
  const access = profileQuery.data?.access ?? null
  if (!profile || !access) return <AccountPageError config={config} message="Unable to load account center." />

  return (
    <AccountPageShell
      accountCenter={config?.accountCenter ?? defaultAccountCenterSettings}
      config={config}
      profile={profile}
      access={access}
      section={section}
    >
      {children(profile, access, profileQuery.data?.activeOrganizationId ?? null)}
    </AccountPageShell>
  )
}
