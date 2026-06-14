import type {
  AccountProfileResponse,
  AccountSecurityResponse,
  AccountSessionsResponse,
  ConsentedApplicationsResponse,
  LinkedAccountsResponse,
} from '@shared/api/account'
import type { AccountAgent, AccountAgentGrant } from '@shared/api/agents'
import type { ConfigzConfigResponse } from '@shared/api/configz'
import type { PasskeysResponse } from '@shared/api/security'
import type { ReactNode } from 'react'

export type UserProfile = AccountProfileResponse['user']
export type LinkedAccount = LinkedAccountsResponse['accounts'][number]
export type IdentityProvider = ConfigzConfigResponse['identityProviders'][number]
export type Web3WalletProvider = ConfigzConfigResponse['builtInProviders']['web3Wallet']
export type ConsentedApplication = ConsentedApplicationsResponse['applications'][number]
export type UserSessionDevice = AccountSessionsResponse['sessions'][number]
export type SecurityState = AccountSecurityResponse['security']
export type Passkey = PasskeysResponse['passkeys'][number]
export type { AccountAgent, AccountAgentGrant }

export type MutationHandler = <T>(
  label: string,
  operation: () => Promise<T>,
  options?: {
    invalidate?: readonly (readonly unknown[])[]
    onError?: (message: string) => void
  },
) => Promise<T | undefined>

export type DestructiveConfirmation = {
  title: string
  description: string
  actionLabel: string
  onConfirm: () => unknown
}

export type ConfirmDestructiveHandler = (confirmation: DestructiveConfirmation) => void

export type ListItem = {
  id: string
  icon?: ReactNode
  title: string
  meta: string
  action?: ReactNode
  status?: string
  children?: ReactNode
}
