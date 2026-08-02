import type { DeveloperConsoleAccessResponse } from '@shared/api/account'
import type { ReactNode } from 'react'
import { AccountPageError, AccountPageLoading, AccountPageShell } from './account-shell'
import {
  useAccountConfig,
  useAccountOrganizationContext,
  useAccountProfile,
  useDeveloperConsoleAccess,
} from './queries'
import type { AccountCenterSection } from './settings'
import { defaultAccountCenterSettings } from './settings'
import type { UserProfile } from './types'

export function AccountSurface({
  children,
  section,
}: {
  children: (
    profile: UserProfile,
    access: DeveloperConsoleAccessResponse,
    activeOrganizationId: string | null,
  ) => ReactNode
  section: AccountCenterSection
}) {
  const configQuery = useAccountConfig()
  const profileQuery = useAccountProfile()
  const accessQuery = useDeveloperConsoleAccess()
  const organizationContextQuery = useAccountOrganizationContext()
  const config = configQuery.data ?? null
  const error = configQuery.error ?? profileQuery.error ?? accessQuery.error ?? organizationContextQuery.error

  if (configQuery.isLoading || profileQuery.isLoading || accessQuery.isLoading || organizationContextQuery.isLoading) {
    return <AccountPageLoading config={config} />
  }
  if (error) {
    return <AccountPageError config={config} message={error instanceof Error ? error.message : 'Unable to load.'} />
  }

  const profile = profileQuery.data?.user ?? null
  const access = accessQuery.data ?? null
  if (!profile || !access) return <AccountPageError config={config} message="Unable to load account center." />

  return (
    <AccountPageShell
      accountCenter={config?.accountCenter ?? defaultAccountCenterSettings}
      config={config}
      profile={profile}
      access={access}
      section={section}
    >
      {children(profile, access, organizationContextQuery.data?.activeOrganizationId ?? null)}
    </AccountPageShell>
  )
}
