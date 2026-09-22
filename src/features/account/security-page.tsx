import { Link } from '@tanstack/react-router'
import { Fingerprint, Laptop, Link2, LoaderCircle, ShieldCheck, Wallet } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Field, TextInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import {
  deletePasskey,
  renamePasskey,
  revokeOtherSessions,
  revokeSession,
  unlinkWalletAddress,
} from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import * as Drawer from './account-drawer'
import { AccountSettingsNavigation } from './account-navigation'
import { AccountPageHeader } from './account-page'
import { useAccountCenterLayout } from './account-surface'
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
  useAccountMutation,
  useAccountPasskeys,
  useAccountProviderConnections,
  useAccountSecurity,
  useAccountSessions,
  useLinkedAccounts,
} from './queries'
import { PasskeyDialog, TotpDialogs } from './security-dialogs'
import type { defaultAccountCenterSettings } from './settings'
import type { ConfirmDestructiveHandler, MutationHandler, Passkey, SecurityState, UserSessionDevice } from './types'
import { enrollWallet, formatDate, formatSessionDevice, type TotpEnrollmentDisplay } from './utils'

export function AccountSecurityPage() {
  const { accountCenter, config, profile } = useAccountCenterLayout()
  const mutate = useAccountMutation()
  const [confirmation, setConfirmation] = useDestructiveConfirmation()
  return (
    <>
      <AccountPageHeader description={tt('Manage your profile and sign-in security.')} title={tt('Account settings')} />
      <AccountSettingsNavigation section="security" />
      <SecuritySections
        accountCenter={accountCenter}
        confirm={setConfirmation}
        mutate={mutate}
        profile={profile}
        walletProvider={config?.builtInProviders.web3Wallet}
      />
      <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </>
  )
}

function SecuritySections({
  accountCenter,
  confirm,
  mutate,
  profile,
  walletProvider,
}: {
  accountCenter: typeof defaultAccountCenterSettings
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
  profile: import('./types').UserProfile
  walletProvider?: import('./types').Web3WalletProvider
}) {
  const [tab, setTab] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'mfa-enroll' | 'mfa-verify' | 'mfa-disable' | 'passkey' | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollmentDisplay | null>(null)
  const securityQuery = useAccountSecurity(true)
  const passkeysQuery = useAccountPasskeys(true)
  const sessionsQuery = useAccountSessions(accountCenter.sessionsViewEnabled)
  const linkedAccountsQuery = useLinkedAccounts(
    accountCenter.connectedAccountsEnabled && Boolean(walletProvider?.enabled),
  )
  const providerConnectionsQuery = useAccountProviderConnections(true)
  const security = securityQuery.data?.security ?? null
  const mfaRequired = security?.policy.mfa.mode === 'required'
  const mfaEnabled = Boolean(security?.mfa.enabled)
  return (
    <>
      <div className="accountSettingsSurface">
        <section className="accountSettingsGroup">
          <header>
            <h2>{tt('Sign-in methods')}</h2>
            <p>{tt('Choose how you sign in to Realmroot.')}</p>
          </header>
          <SecurityTabState
            error={securityQuery.error ?? passkeysQuery.error}
            loading={securityQuery.isLoading || passkeysQuery.isLoading}
          >
            <SettingsAction
              icon={<Fingerprint />}
              title={tt('Passkeys')}
              meta={tt('Use your fingerprint, face, or device PIN.')}
              value={tt('{{count}} passkeys', { count: passkeysQuery.data?.passkeys?.length ?? 0 })}
              action={
                <Button aria-label={tt('Manage passkeys')} variant="outline" onClick={() => setTab('passkeys')}>
                  {tt('Manage')}
                </Button>
              }
            />
          </SecurityTabState>
          {accountCenter.passwordChangeEnabled ? <ProfilePasswordPanel profile={profile} /> : null}
          <SecurityTabState error={providerConnectionsQuery.error} loading={providerConnectionsQuery.isLoading}>
            <SettingsAction
              icon={<Link2 />}
              title={tt('External accounts')}
              meta={
                (providerConnectionsQuery.data?.items ?? [])
                  .filter((item) => item.capabilities.signIn.active)
                  .map((item) => item.connector.displayName)
                  .join(', ') || tt('No external sign-in Providers')
              }
              action={
                <Button asChild variant="outline">
                  <Link to="/connections">{tt('Manage Connections')}</Link>
                </Button>
              }
            />
          </SecurityTabState>
          {walletProvider?.enabled ? (
            <SettingsAction
              icon={<Wallet />}
              title={tt('Web3 wallet')}
              meta={tt('Verify your wallet address with a signature.')}
              value={
                linkedAccountsQuery.error
                  ? tt('Unable to load.')
                  : tt('{{count}} linked', {
                      count: (linkedAccountsQuery.data?.items ?? []).filter((item) => item.providerId === 'siwe')
                        .length,
                    })
              }
              action={
                <Button aria-label={tt('Manage wallet')} variant="outline" onClick={() => setTab('wallet')}>
                  {tt('Manage')}
                </Button>
              }
            />
          ) : null}
        </section>
        <section className="accountSettingsGroup">
          <header>
            <h2>{tt('Two-step verification')}</h2>
            <p>{tt('Add another verification step to sign-in.')}</p>
          </header>
          <SecurityTabState error={securityQuery.error} loading={securityQuery.isLoading}>
            <SettingsAction
              icon={<ShieldCheck />}
              title={tt('Authenticator app')}
              meta={tt('Use one-time codes from your authenticator app.')}
              value={mfaEnabled ? tt('Enabled') : tt('Not set up')}
              action={
                <Button variant="outline" aria-label={tt('Manage authenticator')} onClick={() => setTab('mfa')}>
                  {tt(mfaEnabled ? 'Manage' : 'Set up')}
                </Button>
              }
            />
          </SecurityTabState>
        </section>
        {accountCenter.sessionsViewEnabled ? (
          <section className="accountSettingsGroup">
            <header>
              <h2>{tt('Login devices')}</h2>
              <p>{tt('Review your active sign-in sessions.')}</p>
            </header>
            <SecurityTabState error={sessionsQuery.error} loading={sessionsQuery.isLoading}>
              <SettingsAction
                icon={<Laptop />}
                title={tt('Sessions')}
                meta={formatSessionDevice(sessionsQuery.data?.items?.find((item) => item.current)?.userAgent ?? null)}
                value={tt('{{count}} sessions', { count: sessionsQuery.data?.items?.length ?? 0 })}
                action={
                  <Button aria-label={tt('Manage sessions')} variant="outline" onClick={() => setTab('sessions')}>
                    {tt('Manage')}
                  </Button>
                }
              />
            </SecurityTabState>
          </section>
        ) : null}
      </div>
      <Drawer.Dialog open={tab !== null && dialog === null} onOpenChange={(open) => !open && setTab(null)}>
        <Drawer.DialogContent>
          <Drawer.DialogHeader>
            <Drawer.DialogTitle>
              {tt(
                tab === 'passkeys'
                  ? 'Passkeys'
                  : tab === 'sessions'
                    ? 'Login devices'
                    : tab === 'wallet'
                      ? 'Web3 wallet'
                      : 'Authenticator app',
              )}
            </Drawer.DialogTitle>
            <Drawer.DialogDescription>{tt('Sign-in & security')}</Drawer.DialogDescription>
          </Drawer.DialogHeader>
          {tab === 'passkeys' ? (
            <SecurityTabState error={passkeysQuery.error} loading={passkeysQuery.isLoading}>
              <PasskeysPanel
                confirm={confirm}
                mutate={mutate}
                passkeys={passkeysQuery.data?.passkeys ?? []}
                security={security}
                setDialog={setDialog}
              />
            </SecurityTabState>
          ) : null}
          {tab === 'sessions' ? (
            <SecurityTabState error={sessionsQuery.error} loading={sessionsQuery.isLoading}>
              <SessionsPanel confirm={confirm} mutate={mutate} sessions={sessionsQuery.data?.items ?? []} />
            </SecurityTabState>
          ) : null}
          {tab === 'mfa' ? (
            <MfaPanel mfaEnabled={mfaEnabled} mfaRequired={mfaRequired} security={security} setDialog={setDialog} />
          ) : null}
          {tab === 'wallet' && walletProvider ? (
            <SecurityTabState error={linkedAccountsQuery.error} loading={linkedAccountsQuery.isLoading}>
              <WalletSignInPanel
                accounts={(linkedAccountsQuery.data?.items ?? []).filter((item) => item.providerId === 'siwe')}
                confirm={confirm}
                mutate={mutate}
                walletProvider={walletProvider}
              />
            </SecurityTabState>
          ) : null}
          <Drawer.DialogFooter>
            <Button variant="outline" onClick={() => setTab(null)}>
              {tt('Done')}
            </Button>
          </Drawer.DialogFooter>
        </Drawer.DialogContent>
      </Drawer.Dialog>
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

function SecurityTabState({ children, error, loading }: { children: ReactNode; error: unknown; loading: boolean }) {
  if (loading)
    return (
      <Status>
        <LoaderCircle className="spin" size={18} />
        {tt('Loading security settings')}
      </Status>
    )
  if (error) return <Status tone="error">{error instanceof Error ? error.message : tt('Unable to load.')}</Status>
  return children
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
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <section className="accountPasskeyManager">
      <div className="accountDrawerIntro">
        <h2>{tt('Your passkeys')}</h2>
        <p>{tt('{{count}} registered keys, managed individually.', { count: passkeys.length })}</p>
      </div>
      <div className="accountPanelActions">
        <Button disabled={!security?.policy.passkeys.enabled} onClick={() => setDialog('passkey')}>
          <Fingerprint />
          {tt('Add passkey')}
        </Button>
      </div>
      {passkeys.map((passkey) => (
        <article className="accountCredentialCard" key={passkey.id}>
          <div className="accountCredentialHeading">
            <Fingerprint />
            <div>
              <h3>{passkey.name ?? tt('Unnamed passkey')}</h3>
              <p>
                {tt(passkey.deviceType === 'multiDevice' ? 'Syncable' : 'Device-bound')} ·{' '}
                {tt(passkey.backedUp ? 'Backed up' : 'Not backed up')}
              </p>
            </div>
          </div>
          {editing === passkey.id ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                if (!name.trim()) return
                setSaving(true)
                setError(null)
                const result = await mutate('Passkey renamed.', () => renamePasskey(passkey.id, name.trim()), {
                  invalidate: [accountQueryKeys.passkeys],
                  onError: setError,
                })
                setSaving(false)
                if (result) setEditing(null)
              }}
            >
              <Field label={tt('Passkey name')}>
                <TextInput value={name} required maxLength={100} onChange={(event) => setName(event.target.value)} />
              </Field>
              {error ? (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="accountPanelActions">
                <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(null)}>
                  {tt('Cancel')}
                </Button>
                <Button type="submit" disabled={saving || !name.trim()}>
                  {tt('Save')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="accountCredentialFooter">
              <span>
                {passkey.createdAt
                  ? tt('Created {{date}}', { date: formatDate(passkey.createdAt) })
                  : tt('Creation date unavailable')}
              </span>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!security?.policy.passkeys.enabled}
                  onClick={() => {
                    setEditing(passkey.id)
                    setName(passkey.name ?? '')
                    setError(null)
                  }}
                >
                  {tt('Rename')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!security?.policy.passkeys.enabled}
                  onClick={() =>
                    confirm({
                      title: tt('Remove passkey'),
                      description:
                        passkeys.length === 1
                          ? tt('This is your last passkey. Use another sign-in method after removing it.')
                          : tt('This passkey will no longer sign in to your account.'),
                      actionLabel: tt('Remove passkey'),
                      onConfirm: () =>
                        mutate('Passkey removed.', () => deletePasskey(passkey.id), {
                          invalidate: [accountQueryKeys.passkeys, accountQueryKeys.security],
                        }),
                    })
                  }
                >
                  {tt('Remove')}
                </Button>
              </div>
            </div>
          )}
        </article>
      ))}
      {!passkeys.length ? (
        <ItemList
          empty={tt('No passkeys have been added yet.')}
          emptyDescription={tt('Add a passkey to sign in without a password.')}
          items={[]}
        />
      ) : null}
      <p className="accountDrawerHelp">
        {tt('A synced passkey may be used on several devices. This list shows registered keys, not login devices.')}
      </p>
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
    <section className="accountSessionManager" aria-label={tt('Session management')}>
      <div className="accountDrawerIntro">
        <h2>{tt('Active sign-in sessions')}</h2>
        <p>{tt('Review your devices. Revoked sessions must sign in again.')}</p>
      </div>
      {sessions.map((session) => (
        <article className="accountCredentialCard" key={session.id}>
          <div className="accountCredentialHeading">
            <Laptop />
            <div>
              <h3>{formatSessionDevice(session.userAgent)}</h3>
              <p>{session.ipAddress?.trim() || tt('Unknown IP')}</p>
            </div>
            {session.current ? <span className="accountCurrentSession">{tt('Current')}</span> : null}
          </div>
          <dl className="accountSessionDates">
            {session.createdAt ? (
              <>
                <dt>{tt('Signed in')}</dt>
                <dd>{formatDate(session.createdAt)}</dd>
              </>
            ) : null}
            <dt>{tt('Expires')}</dt>
            <dd>{formatDate(session.expiresAt)}</dd>
          </dl>
          {!session.current ? (
            <div className="accountPanelActions">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  confirm({
                    title: tt('Revoke session'),
                    description: tt('This device session will be signed out.'),
                    actionLabel: tt('Revoke session'),
                    onConfirm: () => revokeUserSession(session, mutate),
                  })
                }
              >
                {tt('Revoke')}
              </Button>
            </div>
          ) : null}
        </article>
      ))}
      {!sessions.length ? (
        <ItemList
          empty={tt('No other active sessions.')}
          emptyDescription={tt('This browser is your only active session.')}
          items={[]}
        />
      ) : null}
      <div className="accountPanelActions">
        <Button
          aria-label={tt('Sign out others')}
          variant="destructive"
          onClick={() =>
            confirm({
              title: tt('Revoke other sessions'),
              description: tt('Every other active session for this account will be signed out.'),
              actionLabel: tt('Revoke sessions'),
              onConfirm: () =>
                mutate('Other sessions revoked.', revokeOtherSessions, { invalidate: [accountQueryKeys.sessions] }),
            })
          }
        >
          {tt('Sign out others')}
        </Button>
      </div>
    </section>
  )
}

async function revokeUserSession(session: UserSessionDevice, mutate: MutationHandler) {
  await mutate('Session revoked.', () => revokeSession(session.id), {
    invalidate: [accountQueryKeys.sessions],
  })
}
