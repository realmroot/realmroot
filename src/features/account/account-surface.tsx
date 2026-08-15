import type { DeveloperConsoleAccessResponse } from '@shared/api/account'
import { createContext, type ReactNode, useContext } from 'react'
import { Status } from '@/components/ui/status'
import { AccountPageError, AccountPageLoading, AccountPageShell } from './account-shell'
import { useAccountConfig, useAccountProfile, useDeveloperConsoleAccess } from './queries'
import type { AccountCenterSection } from './settings'
import { defaultAccountCenterSettings } from './settings'
import type { UserProfile } from './types'

type AccountCenterLayoutValue = {
  access: DeveloperConsoleAccessResponse
  accountCenter: typeof defaultAccountCenterSettings
  config: NonNullable<ReturnType<typeof useAccountConfig>['data']> | null
  profile: UserProfile
}

const AccountCenterLayoutContext = createContext<AccountCenterLayoutValue | null>(null)

export function AccountCenterLayout({
  children,
  organizationId,
  pathname,
  section,
}: {
  children: ReactNode
  organizationId?: string
  pathname?: string
  section: AccountCenterSection
}) {
  const configQuery = useAccountConfig()
  const profileQuery = useAccountProfile()
  const accessQuery = useDeveloperConsoleAccess()
  const config = configQuery.data ?? null
  const refreshError = configQuery.error ?? profileQuery.error ?? accessQuery.error

  if (configQuery.isLoading || profileQuery.isLoading || accessQuery.isLoading) {
    return <AccountPageLoading config={config} />
  }
  const blockingError =
    (!configQuery.data && configQuery.error) ||
    (!profileQuery.data && profileQuery.error) ||
    (!accessQuery.data && accessQuery.error)
  if (blockingError) {
    return <AccountPageError config={config} message={blockingError.message} />
  }

  const profile = profileQuery.data?.user ?? null
  const access = accessQuery.data ?? null
  if (!profile || !access) return <AccountPageError config={config} message="Unable to load account center." />

  const accountCenter = config?.accountCenter ?? defaultAccountCenterSettings
  return (
    <AccountCenterLayoutContext.Provider value={{ access, accountCenter, config, profile }}>
      <AccountPageShell
        access={access}
        accountCenter={accountCenter}
        config={config}
        organizationId={organizationId}
        pathname={pathname}
        profile={profile}
        section={section}
      >
        {refreshError ? <Status tone="error">{refreshError.message}</Status> : null}
        {children}
      </AccountPageShell>
    </AccountCenterLayoutContext.Provider>
  )
}

export function useAccountCenterLayout() {
  const value = useContext(AccountCenterLayoutContext)
  if (!value) throw new Error('Account Center pages must render inside AccountCenterLayout.')
  return value
}

export function AccountSurface({
  children,
}: {
  children: (profile: UserProfile, access: DeveloperConsoleAccessResponse) => ReactNode
}) {
  const { access, profile } = useAccountCenterLayout()
  return <>{children(profile, access)}</>
}
