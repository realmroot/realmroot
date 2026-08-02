import { Fingerprint, Laptop, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { deletePasskey, revokeOtherSessions, revokeSession } from '@/lib/api/account'
import { signOut } from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { AccountPageHeader, AccountTabContent, AccountTabs } from './account-page'
import { AccountPageError, AccountPageLoading, AccountPageShell } from './account-shell'
import { ConnectionsSection } from './connections-page'
import { DestructiveConfirmationDialog, ItemList, SettingsAction, useDestructiveConfirmation } from './primitives'
import { ProfilePasswordPanel } from './profile-page'
import {
  accountQueryKeys,
  useAccountConfig,
  useAccountMutation,
  useAccountPasskeys,
  useAccountProfile,
  useAccountSecurity,
  useAccountSessions,
  useLinkedAccounts,
} from './queries'
import { PasskeyDialog, TotpDialogs } from './security-dialogs'
import { defaultAccountCenterSettings } from './settings'
import type { ConfirmDestructiveHandler, MutationHandler, Passkey, SecurityState, UserSessionDevice } from './types'
import { formatDate, formatSessionDevice, type TotpEnrollmentDisplay } from './utils'

export function AccountSecurityPage() {
  const configQuery = useAccountConfig()
  const profileQuery = useAccountProfile()
  const securityQuery = useAccountSecurity()
  const passkeysQuery = useAccountPasskeys()
  const config = configQuery.data ?? null
  const accountCenter = config?.accountCenter ?? defaultAccountCenterSettings
  const sessionsQuery = useAccountSessions(accountCenter.sessionsViewEnabled)
  const linkedAccountsQuery = useLinkedAccounts(accountCenter.connectedAccountsEnabled)
  const mutate = useAccountMutation()
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  const queries = [configQuery, profileQuery, securityQuery, passkeysQuery, sessionsQuery, linkedAccountsQuery]
  const error = queries.find((query) => query.error)?.error
  if (queries.some((query) => query.isLoading)) return <AccountPageLoading config={config} />
  if (error)
    return <AccountPageError config={config} message={error instanceof Error ? error.message : tt('Unable to load.')} />
  const profile = profileQuery.data?.user ?? null
  const access = profileQuery.data?.access
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
        linkedAccounts={linkedAccountsQuery.data?.accounts ?? []}
        mutate={mutate}
        passkeys={passkeysQuery.data?.passkeys ?? []}
        passwordEnabled={accountCenter.passwordChangeEnabled}
        profile={profile}
        security={securityQuery.data?.security ?? null}
        sessions={sessionsQuery.data?.sessions ?? []}
        sessionsEnabled={accountCenter.sessionsViewEnabled}
        providers={config?.identityProviders ?? []}
        walletProvider={config?.builtInProviders.web3Wallet}
      />
      <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </AccountPageShell>
  )
}

function SecuritySections({
  confirm,
  linkedAccounts,
  mutate,
  passkeys,
  passwordEnabled,
  profile,
  security,
  sessions,
  sessionsEnabled,
  providers,
  walletProvider,
}: {
  confirm: ConfirmDestructiveHandler
  linkedAccounts: import('./types').LinkedAccount[]
  mutate: MutationHandler
  passkeys: Passkey[]
  passwordEnabled: boolean
  profile: import('./types').UserProfile
  security: SecurityState | null
  sessions: UserSessionDevice[]
  sessionsEnabled: boolean
  providers: import('./types').IdentityProvider[]
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
          {passwordEnabled ? <ProfilePasswordPanel profile={profile} /> : null}
          <ConnectionsSection
            accounts={linkedAccounts}
            confirm={confirm}
            mutate={mutate}
            providers={providers}
            walletProvider={walletProvider}
          />
        </AccountTabContent>
        <AccountTabContent value="mfa">
          <MfaPanel mfaEnabled={mfaEnabled} mfaRequired={mfaRequired} security={security} setDialog={setDialog} />
        </AccountTabContent>
        <AccountTabContent value="passkeys">
          <PasskeysPanel
            confirm={confirm}
            mutate={mutate}
            passkeys={passkeys}
            security={security}
            setDialog={setDialog}
          />
        </AccountTabContent>
        <AccountTabContent value="sessions">
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
                <Button onClick={() => setDialog('mfa-verify')} type="button" variant="secondary">
                  {tt('Verify code')}
                </Button>
                <Button
                  disabled={mfaRequired}
                  onClick={() => setDialog('mfa-disable')}
                  type="button"
                  variant="destructive"
                >
                  {tt('Disable MFA')}
                </Button>
              </>
            ) : (
              <Button onClick={() => setDialog('mfa-enroll')} type="button" variant="secondary">
                {tt('Enroll authenticator app')}
              </Button>
            )}
          </div>
        }
        icon={<ShieldCheck size={18} />}
        meta={security?.mfa.enabled ? tt('Authenticator app is enabled.') : tt('No authenticator factor enrolled.')}
        title={tt('Multi-factor authentication')}
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
            type="button"
            variant="secondary"
          >
            <Fingerprint size={18} /> {tt('Add passkey')}
          </Button>
        }
        icon={<Fingerprint size={18} />}
        meta={
          passkeys.length === 1
            ? tt('1 passkey added for passwordless sign-in.')
            : tt('{{count}} passkeys added for passwordless sign-in.', { count: passkeys.length })
        }
        title={tt('Passkeys')}
      />
      <ItemList
        empty={tt('No passkeys have been added yet.')}
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
        empty={tt('No active sessions.')}
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
            onClick={() =>
              confirm({
                title: tt('Revoke other sessions'),
                description: tt('Every other active session for this account will be signed out.'),
                actionLabel: tt('Revoke sessions'),
                onConfirm: () =>
                  mutate('Other sessions revoked.', revokeOtherSessions, { invalidate: [accountQueryKeys.sessions] }),
              })
            }
            type="button"
            variant="destructive"
          >
            {tt('Revoke other sessions')}
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
  const result = await mutate('Session revoked.', () => revokeSession(session.id), {
    invalidate: session.current ? [] : [accountQueryKeys.sessions],
  })
  if (result && session.current) {
    try {
      await signOut()
    } finally {
      window.location.assign('/auth/sign-in')
    }
  }
}
