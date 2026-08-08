import type { AccountProviderConnection } from '@shared/api/account'
import { Link } from '@tanstack/react-router'
import { Fingerprint, Laptop, Link2, ShieldCheck, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { deletePasskey, revokeOtherSessions, revokeSession, unlinkWalletAddress } from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import { AccountPageHeader, AccountTabContent, AccountTabs } from './account-page'
import { AccountPageError, AccountPageLoading, AccountPageShell } from './account-shell'
import {
  DestructiveConfirmationDialog,
  ItemList,
  SettingsAction,
  SubsectionTitle,
  useDestructiveConfirmation,
} from './primitives'
import { ProfilePasswordPanel } from './profile-page'
import {
  accountQueryKeys,
  useAccountConfig,
  useAccountMutation,
  useAccountPasskeys,
  useAccountProfile,
  useAccountProviderConnections,
  useAccountSecurity,
  useAccountSessions,
  useDeveloperConsoleAccess,
  useLinkedAccounts,
} from './queries'
import { PasskeyDialog, TotpDialogs } from './security-dialogs'
import { defaultAccountCenterSettings } from './settings'
import type { ConfirmDestructiveHandler, MutationHandler, Passkey, SecurityState, UserSessionDevice } from './types'
import { enrollWallet, formatDate, formatSessionDevice, type TotpEnrollmentDisplay } from './utils'

export function AccountSecurityPage() {
  const configQuery = useAccountConfig()
  const profileQuery = useAccountProfile()
  const accessQuery = useDeveloperConsoleAccess()
  const securityQuery = useAccountSecurity()
  const passkeysQuery = useAccountPasskeys()
  const config = configQuery.data ?? null
  const accountCenter = config?.accountCenter ?? defaultAccountCenterSettings
  const sessionsQuery = useAccountSessions(accountCenter.sessionsViewEnabled)
  const linkedAccountsQuery = useLinkedAccounts(accountCenter.connectedAccountsEnabled)
  const providerConnectionsQuery = useAccountProviderConnections()
  const mutate = useAccountMutation()
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  const queries = [
    configQuery,
    profileQuery,
    accessQuery,
    securityQuery,
    passkeysQuery,
    sessionsQuery,
    linkedAccountsQuery,
    providerConnectionsQuery,
  ]
  const error = queries.find((query) => query.error)?.error
  if (queries.some((query) => query.isLoading)) return <AccountPageLoading config={config} />
  if (error)
    return <AccountPageError config={config} message={error instanceof Error ? error.message : tt('Unable to load.')} />
  const profile = profileQuery.data?.user ?? null
  const access = accessQuery.data
  if (!profile || !access) return <AccountPageError config={config} message={tt('Unable to load account center.')} />
  return (
    <AccountPageShell
      access={access}
      accountCenter={accountCenter}
      config={config}
      profile={profile}
      section="security"
    >
      <AccountPageHeader
        description={tt('Control credentials, recovery methods, sign-in identities, and active sessions.')}
        title={tt('Sign-in & security')}
      />
      <SecuritySections
        confirm={setConfirmation}
        providerConnections={providerConnectionsQuery.data?.items ?? []}
        walletAccounts={(linkedAccountsQuery.data?.accounts ?? []).filter((account) => account.providerId === 'siwe')}
        mutate={mutate}
        passkeys={passkeysQuery.data?.passkeys ?? []}
        passwordEnabled={accountCenter.passwordChangeEnabled}
        profile={profile}
        security={securityQuery.data?.security ?? null}
        sessions={sessionsQuery.data?.sessions ?? []}
        sessionsEnabled={accountCenter.sessionsViewEnabled}
        walletProvider={config?.builtInProviders.web3Wallet}
      />
      <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </AccountPageShell>
  )
}

function SecuritySections({
  confirm,
  providerConnections,
  mutate,
  passkeys,
  passwordEnabled,
  profile,
  security,
  sessions,
  sessionsEnabled,
  walletAccounts,
  walletProvider,
}: {
  confirm: ConfirmDestructiveHandler
  providerConnections: AccountProviderConnection[]
  mutate: MutationHandler
  passkeys: Passkey[]
  passwordEnabled: boolean
  profile: import('./types').UserProfile
  security: SecurityState | null
  sessions: UserSessionDevice[]
  sessionsEnabled: boolean
  walletAccounts: import('./types').LinkedAccount[]
  walletProvider?: import('./types').Web3WalletProvider
}) {
  const [tab, setTab] = useState('sign-in')
  const [dialog, setDialog] = useState<'mfa-enroll' | 'mfa-verify' | 'mfa-disable' | 'passkey' | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollmentDisplay | null>(null)
  const mfaRequired = security?.policy.mfa.mode === 'required'
  const mfaEnabled = Boolean(security?.mfa.enabled)
  return (
    <>
      <AccountTabs
        onValueChange={setTab}
        tabs={[
          { value: 'sign-in', label: tt('Sign-in') },
          { value: 'mfa', label: tt('MFA') },
          { value: 'passkeys', label: tt('Passkeys') },
          sessionsEnabled ? { value: 'sessions', label: tt('Sessions') } : null,
        ].filter((item): item is { value: string; label: string } => item !== null)}
        value={tab}
      >
        <AccountTabContent value="sign-in">
          <div className="accountSignInStack">
            {passwordEnabled ? (
              <div className="accountTabPanel">
                <ProfilePasswordPanel profile={profile} />
              </div>
            ) : null}
            <div className="accountTabPanel">
              <ExternalSignInSummary connections={providerConnections} />
            </div>
            {walletProvider?.enabled ? (
              <div className="accountTabPanel">
                <WalletSignInPanel
                  accounts={walletAccounts}
                  confirm={confirm}
                  mutate={mutate}
                  walletProvider={walletProvider}
                />
              </div>
            ) : null}
          </div>
        </AccountTabContent>
        <AccountTabContent surface value="mfa">
          <MfaPanel mfaEnabled={mfaEnabled} mfaRequired={mfaRequired} security={security} setDialog={setDialog} />
        </AccountTabContent>
        <AccountTabContent surface value="passkeys">
          <PasskeysPanel
            confirm={confirm}
            mutate={mutate}
            passkeys={passkeys}
            security={security}
            setDialog={setDialog}
          />
        </AccountTabContent>
        <AccountTabContent surface value="sessions">
          {sessionsEnabled ? <SessionsPanel confirm={confirm} mutate={mutate} sessions={sessions} /> : null}
        </AccountTabContent>
      </AccountTabs>
      <TotpDialogs
        code={code}
        dialog={dialog}
        mfaRequired={mfaRequired}
        mutate={mutate}
        password={password}
        profileEmail={profile.email}
        setCode={setCode}
        setDialog={setDialog}
        setPassword={setPassword}
        setTotpEnrollment={setTotpEnrollment}
        totpEnrollment={totpEnrollment}
      />
      <PasskeyDialog
        dialog={dialog}
        mutate={mutate}
        passkeyName={passkeyName}
        security={security}
        setDialog={setDialog}
        setPasskeyName={setPasskeyName}
      />
    </>
  )
}

function ExternalSignInSummary({ connections }: { connections: AccountProviderConnection[] }) {
  const signInConnections = connections.filter((connection) => connection.capabilities.signIn.active)
  return (
    <section aria-label={tt('External sign-in')}>
      <SubsectionTitle
        description={tt('Provider identities that can authenticate this account are managed in Connections.')}
        title={tt('External sign-in')}
      />
      <ItemList
        compactEmpty
        empty={tt('No external sign-in Providers')}
        emptyDescription={tt('Connect an available Provider from Connections.')}
        emptyIcon={<Link2 size={18} />}
        items={signInConnections.map((connection) => ({
          id: connection.id,
          icon: <Link2 size={16} />,
          title: connection.connector.displayName,
          meta: connection.displayName,
          status: tt('Enabled'),
        }))}
      />
      <div className="accountPanelActions">
        <Button asChild variant="outline">
          <Link to="/connections">{tt('Manage Connections')}</Link>
        </Button>
      </div>
    </section>
  )
}

function WalletSignInPanel({
  accounts,
  confirm,
  mutate,
  walletProvider,
}: {
  accounts: import('./types').LinkedAccount[]
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
  walletProvider: import('./types').Web3WalletProvider
}) {
  async function connectWallet() {
    await mutate('Wallet linked.', () => enrollWallet(walletProvider.chains ?? [1]), {
      invalidate: [accountQueryKeys.linkedAccounts],
    })
  }
  return (
    <section aria-label={tt('Web3 wallet')}>
      <SubsectionTitle
        description={tt('A cryptographic credential used directly for Realmroot sign-in.')}
        title={tt('Web3 wallet')}
      />
      <ItemList
        compactEmpty
        empty={tt('No wallet linked')}
        emptyDescription={tt('Link a wallet after signing in with an email-based account.')}
        emptyIcon={<Wallet size={18} />}
        items={accounts.map((account) => ({
          id: account.id,
          icon: <Wallet size={16} />,
          title: account.accountId,
          meta: tt('Linked {{date}}', { date: formatDate(account.createdAt) }),
          status: tt('Enabled'),
          action: (
            <Button
              onClick={() =>
                confirm({
                  title: tt('Unlink wallet'),
                  description: tt('This wallet will no longer sign in to your account.'),
                  actionLabel: tt('Unlink wallet'),
                  onConfirm: () =>
                    mutate('Wallet removed.', () => unlinkWalletAddress(account.accountId), {
                      invalidate: [accountQueryKeys.linkedAccounts],
                    }),
                })
              }
              variant="ghost"
            >
              {tt('Unlink')}
            </Button>
          ),
        }))}
      />
      {!accounts.length ? (
        <div className="accountPanelActions">
          <Button onClick={() => void connectWallet()} variant="outline">
            {tt('Link wallet')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function MfaPanel({
  mfaEnabled,
  mfaRequired,
  security,
  setDialog,
}: {
  mfaEnabled: boolean
  mfaRequired: boolean
  security: SecurityState | null
  setDialog: (dialog: 'mfa-enroll' | 'mfa-verify' | 'mfa-disable') => void
}) {
  return (
    <section className="settingsPanel">
      <SettingsAction
        action={
          <div className="settingsActionButtons">
            {mfaEnabled ? (
              <>
                <Button
                  aria-label={tt('Verify code')}
                  onClick={() => setDialog('mfa-verify')}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {tt('Verify')}
                </Button>
                <Button
                  aria-label={tt('Disable MFA')}
                  disabled={mfaRequired}
                  onClick={() => setDialog('mfa-disable')}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  {tt('Disable')}
                </Button>
              </>
            ) : (
              <Button
                aria-label={tt('Set up authenticator app')}
                onClick={() => setDialog('mfa-enroll')}
                size="sm"
                type="button"
                variant="outline"
              >
                {tt('Set up')}
              </Button>
            )}
          </div>
        }
        icon={<ShieldCheck size={18} />}
        meta={
          security?.mfa.enabled
            ? tt('Authenticator app is enabled.')
            : tt('Protect your account with an authenticator app.')
        }
        title={tt('Multi-factor authentication')}
        value={mfaEnabled ? tt('Enabled') : tt('Not set up')}
      />
    </section>
  )
}

function PasskeysPanel({
  confirm,
  mutate,
  passkeys,
  security,
  setDialog,
}: {
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
  passkeys: Passkey[]
  security: SecurityState | null
  setDialog: (dialog: 'passkey') => void
}) {
  return (
    <section className="settingsPanel">
      <SettingsAction
        action={
          <Button
            disabled={!security?.policy.passkeys.enabled}
            onClick={() => setDialog('passkey')}
            size="sm"
            type="button"
            variant="outline"
          >
            <Fingerprint size={18} /> {tt('Add passkey')}
          </Button>
        }
        icon={<Fingerprint size={18} />}
        meta={
          passkeys.length === 0
            ? tt('Use a passkey for fast, passwordless sign-in.')
            : passkeys.length === 1
              ? tt('1 passkey added for passwordless sign-in.')
              : tt('{{count}} passkeys added for passwordless sign-in.', { count: passkeys.length })
        }
        title={tt('Passkeys')}
      />
      <ItemList
        emptyDescription={tt('Add a passkey to sign in without a password.')}
        empty={tt('No passkeys have been added yet.')}
        emptyIcon={<Fingerprint size={18} />}
        items={passkeys.map((passkey) => ({
          id: passkey.id,
          icon: <Fingerprint size={16} />,
          title: passkey.name ?? tt('Unnamed passkey'),
          meta: `${passkey.deviceType}${passkey.backedUp ? tt(' / backed up') : tt(' / not backed up')}${passkey.createdAt ? tt(' / added {{date}}', { date: formatDate(passkey.createdAt) }) : ''}`,
          action: (
            <Button
              onClick={() =>
                confirm({
                  title: tt('Remove passkey'),
                  description: tt('This passkey will no longer sign in to your account.'),
                  actionLabel: tt('Remove passkey'),
                  onConfirm: () =>
                    mutate('Passkey removed.', () => deletePasskey(passkey.id), {
                      invalidate: [accountQueryKeys.passkeys, accountQueryKeys.security],
                    }),
                })
              }
              type="button"
              variant="ghost"
            >
              {tt('Remove')}
            </Button>
          ),
        }))}
      />
    </section>
  )
}

function SessionsPanel({
  confirm,
  mutate,
  sessions,
}: {
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
  sessions: UserSessionDevice[]
}) {
  return (
    <section className="settingsPanel" aria-label={tt('Session management')}>
      <ItemList
        empty={tt('No other active sessions.')}
        emptyDescription={tt('This browser is your only active session.')}
        emptyIcon={<Laptop size={18} />}
        items={sessions.map((session) => ({
          id: session.id,
          icon: <Laptop size={16} />,
          title: formatSessionDevice(session.userAgent),
          meta: tt('{{ip}} · expires {{date}}', {
            ip: session.ipAddress?.trim() || tt('Unknown IP'),
            date: formatDate(session.expiresAt),
          }),
          status: session.current ? tt('Current') : undefined,
          action: session.current ? undefined : (
            <Button
              onClick={() =>
                confirm({
                  title: tt('Revoke session'),
                  description: tt('This device session will be signed out.'),
                  actionLabel: tt('Revoke session'),
                  onConfirm: () => revokeUserSession(session, mutate),
                })
              }
              type="button"
              variant="ghost"
            >
              {tt('Revoke')}
            </Button>
          ),
        }))}
      />
      <SettingsAction
        action={
          <Button
            aria-label={tt('Sign out others')}
            onClick={() =>
              confirm({
                title: tt('Revoke other sessions'),
                description: tt('Every other active session for this account will be signed out.'),
                actionLabel: tt('Revoke sessions'),
                onConfirm: () =>
                  mutate('Other sessions revoked.', revokeOtherSessions, { invalidate: [accountQueryKeys.sessions] }),
              })
            }
            size="sm"
            type="button"
            variant="destructive"
          >
            {tt('Sign out others')}
          </Button>
        }
        icon={<Laptop />}
        meta={tt('Sign out every other active session.')}
        title={tt('Other sessions')}
      />
    </section>
  )
}

async function revokeUserSession(session: UserSessionDevice, mutate: MutationHandler) {
  await mutate('Session revoked.', () => revokeSession(session.id), {
    invalidate: [accountQueryKeys.sessions],
  })
}
