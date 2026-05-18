import { Fingerprint, KeyRound, Laptop, LinkIcon, LoaderCircle, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { BrandIdentity } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Field, TextInput } from '@/components/ui/field'
import { Status } from '@/components/ui/status'
import { useExperienceConfig } from '@/features/auth/hooks'
import { apiRequest } from '@/lib/api'

type UserProfile = {
  id: string
  email: string
  emailVerified: boolean
  displayName: string
  username: string | null
  avatarAssetId: string | null
  image: string | null
}

type LinkedAccount = {
  id: string
  accountId: string
  providerId: string
  createdAt: string
}

type ConsentedApplication = {
  id: string
  applicationName: string
  applicationSlug: string
  scopes: string[]
  grantedAt: string
  expiresAt: string | null
}

type UserSessionDevice = {
  id: string
  expiresAt: string
  createdAt: string
  ipAddress: string | null
  userAgent: string | null
}

type SecurityState = {
  mfa: { enabled: boolean; factors: Array<{ id: string; type: string; verified: boolean | null }> }
  passkeys: { enabled: boolean; count: number }
  policy: { mfa: { mode: 'optional' | 'required' }; passkeys: { enabled: boolean; rpName: string } }
}

type Passkey = {
  id: string
  name: string | null
  deviceType: string
  backedUp: boolean
  createdAt: string | null
}

type AccountData = {
  profile: UserProfile | null
  linkedAccounts: LinkedAccount[]
  applications: ConsentedApplication[]
  sessions: UserSessionDevice[]
  security: SecurityState | null
  passkeys: Passkey[]
}

const emptyAccountData: AccountData = {
  profile: null,
  linkedAccounts: [],
  applications: [],
  sessions: [],
  security: null,
  passkeys: [],
}

export function AccountCenterPage() {
  const { data: config } = useExperienceConfig()
  const [active, setActive] = useState('profile')
  const [data, setData] = useState(emptyAccountData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [profile, linkedAccounts, applications, sessions, security, passkeys] = await Promise.all([
        apiRequest<{ user: UserProfile }>('/api/account/profile'),
        apiRequest<{ accounts: LinkedAccount[] }>('/api/account/linked-accounts'),
        apiRequest<{ applications: ConsentedApplication[] }>('/api/account/applications'),
        apiRequest<{ sessions: UserSessionDevice[] }>('/api/account/sessions'),
        apiRequest<{ security: SecurityState }>('/api/account/security'),
        apiRequest<{ passkeys: Passkey[] }>('/api/account/security/passkeys'),
      ])
      setData({
        profile: profile.user,
        linkedAccounts: linkedAccounts.accounts,
        applications: applications.applications,
        sessions: sessions.sessions,
        security: security.security,
        passkeys: passkeys.passkeys,
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load account center.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function mutate(label: string, operation: () => Promise<unknown>) {
    setMessage(null)
    setError(null)
    try {
      await operation()
      setMessage(label)
      await reload()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Account update failed.')
    }
  }

  return (
    <main className="accountShell">
      <aside className="accountSidebar">
        <BrandIdentity config={config} />
        <nav className="accountNav" aria-label="Account center">
          {accountSections.map((section) => (
            <button
              className={active === section.id ? 'active' : ''}
              key={section.id}
              onClick={() => setActive(section.id)}
              type="button"
            >
              <section.icon size={18} />
              {section.label}
            </button>
          ))}
        </nav>
      </aside>
      <section className="accountContent">
        <div className="accountHeader">
          <div>
            <p className="eyebrow">Account center</p>
            <h1>{data.profile?.displayName ?? 'Your account'}</h1>
          </div>
          <Button
            onClick={() => mutate('Signed out.', () => apiRequest('/api/experience/session', { method: 'DELETE' }))}
            variant="secondary"
          >
            Sign out
          </Button>
        </div>
        {loading ? (
          <Status>
            <LoaderCircle className="spin" size={18} />
            Loading account
          </Status>
        ) : null}
        {error ? <Status tone="error">{error}</Status> : null}
        {message ? <Status tone="success">{message}</Status> : null}
        {active === 'profile' && data.profile ? <ProfileSection profile={data.profile} mutate={mutate} /> : null}
        {active === 'security' ? <SecuritySection data={data} mutate={mutate} /> : null}
        {active === 'connections' ? <ConnectionsSection accounts={data.linkedAccounts} mutate={mutate} /> : null}
        {active === 'sessions' ? <SessionsSection sessions={data.sessions} mutate={mutate} /> : null}
        {active === 'apps' ? <ApplicationsSection applications={data.applications} /> : null}
      </section>
    </main>
  )
}

const accountSections = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'connections', label: 'Linked accounts', icon: LinkIcon },
  { id: 'sessions', label: 'Sessions', icon: Laptop },
  { id: 'apps', label: 'Consented apps', icon: BadgeIcon },
]

function ProfileSection({ profile, mutate }: { profile: UserProfile; mutate: MutationHandler }) {
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [username, setUsername] = useState(profile.username ?? '')
  const [avatarAssetId, setAvatarAssetId] = useState(profile.avatarAssetId ?? '')
  const [email, setEmail] = useState(profile.email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  function saveProfile(event: FormEvent) {
    event.preventDefault()
    return mutate('Profile updated.', () =>
      apiRequest('/api/account/profile', {
        method: 'PATCH',
        body: { displayName, username: username || null, avatarAssetId: avatarAssetId || null },
      }),
    )
  }

  function changeEmail(event: FormEvent) {
    event.preventDefault()
    return mutate('Email change requested.', () =>
      apiRequest('/api/account/email/change', {
        method: 'POST',
        body: { email, callbackURL: `${window.location.origin}/email-verification` },
      }),
    )
  }

  function changePassword(event: FormEvent) {
    event.preventDefault()
    return mutate('Password changed.', () =>
      apiRequest('/api/account/password/change', {
        method: 'POST',
        body: { currentPassword, newPassword, revokeOtherSessions: true },
      }),
    )
  }

  return (
    <div className="accountGrid">
      <section className="settingsPanel">
        <h2>Profile</h2>
        <form className="formStack" onSubmit={saveProfile}>
          <Field label="Display name">
            <TextInput onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
          </Field>
          <Field label="Username">
            <TextInput onChange={(event) => setUsername(event.target.value)} value={username} />
          </Field>
          <Field label="Avatar asset ID">
            <TextInput onChange={(event) => setAvatarAssetId(event.target.value)} value={avatarAssetId} />
          </Field>
          <Button type="submit">Save profile</Button>
        </form>
      </section>
      <section className="settingsPanel">
        <h2>Email</h2>
        <p className="muted">{profile.emailVerified ? 'Verified email address' : 'Verification required'}</p>
        <form className="formStack" onSubmit={changeEmail}>
          <Field label="Email">
            <TextInput onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </Field>
          <Button type="submit" variant="secondary">
            <Mail size={18} />
            Change email
          </Button>
        </form>
      </section>
      <section className="settingsPanel">
        <h2>Password</h2>
        <form className="formStack" onSubmit={changePassword}>
          <Field label="Current password">
            <TextInput
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              type="password"
              value={currentPassword}
            />
          </Field>
          <Field label="New password">
            <TextInput
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
          </Field>
          <Button type="submit" variant="secondary">
            <KeyRound size={18} />
            Change password
          </Button>
        </form>
      </section>
    </div>
  )
}

function SecuritySection({ data, mutate }: { data: AccountData; mutate: MutationHandler }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const mfaRequired = data.security?.policy.mfa.mode === 'required'

  return (
    <div className="accountGrid">
      <section className="settingsPanel">
        <h2>MFA</h2>
        <p className="muted">{data.security?.mfa.enabled ? 'Enabled' : 'No factor enrolled'}</p>
        <form
          className="formStack"
          onSubmit={(event) => {
            event.preventDefault()
            return mutate('TOTP enrollment started.', () =>
              apiRequest('/api/account/security/mfa/totp-enrollment', { method: 'POST', body: { password } }),
            )
          }}
        >
          <Field label="Password">
            <TextInput onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          </Field>
          <Button type="submit" variant="secondary">
            Enroll authenticator app
          </Button>
        </form>
        <form
          className="formStack compactForm"
          onSubmit={(event) => {
            event.preventDefault()
            return mutate('MFA challenge verified.', () =>
              apiRequest('/api/account/security/mfa/totp-verification', {
                method: 'POST',
                body: { code, trustDevice: true },
              }),
            )
          }}
        >
          <Field label="Authenticator code">
            <TextInput inputMode="numeric" onChange={(event) => setCode(event.target.value)} value={code} />
          </Field>
          <Button type="submit" variant="secondary">
            Verify code
          </Button>
        </form>
        <Button
          disabled={mfaRequired}
          onClick={() =>
            mutate('MFA disabled.', () =>
              apiRequest('/api/account/security/mfa/totp', { method: 'DELETE', body: { password } }),
            )
          }
          type="button"
          variant="danger"
        >
          Disable MFA
        </Button>
      </section>
      <section className="settingsPanel">
        <h2>Passkeys</h2>
        <form
          className="formStack"
          onSubmit={(event) => {
            event.preventDefault()
            return mutate('Passkey enrollment options created.', () =>
              apiRequest('/api/account/security/passkeys/registration-options', {
                method: 'POST',
                body: { name: passkeyName },
              }),
            )
          }}
        >
          <Field label="Passkey name">
            <TextInput onChange={(event) => setPasskeyName(event.target.value)} value={passkeyName} />
          </Field>
          <Button disabled={!data.security?.policy.passkeys.enabled} type="submit" variant="secondary">
            <Fingerprint size={18} />
            Add passkey
          </Button>
        </form>
        <ItemList
          empty="No passkeys enrolled."
          items={data.passkeys.map((passkey) => ({
            id: passkey.id,
            title: passkey.name ?? 'Unnamed passkey',
            meta: `${passkey.deviceType}${passkey.backedUp ? ' / backed up' : ''}`,
            action: (
              <Button
                onClick={() =>
                  mutate('Passkey removed.', () =>
                    apiRequest(`/api/account/security/passkeys/${passkey.id}`, { method: 'DELETE' }),
                  )
                }
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            ),
          }))}
        />
      </section>
    </div>
  )
}

function ConnectionsSection({ accounts, mutate }: { accounts: LinkedAccount[]; mutate: MutationHandler }) {
  return (
    <section className="settingsPanel">
      <h2>Linked social accounts</h2>
      <ItemList
        empty="No linked social accounts."
        items={accounts.map((account) => ({
          id: account.id,
          title: account.providerId,
          meta: `Linked ${formatDate(account.createdAt)}`,
          action: (
            <Button
              onClick={() =>
                mutate('Linked account removed.', () =>
                  apiRequest(`/api/account/linked-accounts/${account.providerId}?accountId=${account.accountId}`, {
                    method: 'DELETE',
                  }),
                )
              }
              type="button"
              variant="ghost"
            >
              Unlink
            </Button>
          ),
        }))}
      />
    </section>
  )
}

function SessionsSection({ sessions, mutate }: { sessions: UserSessionDevice[]; mutate: MutationHandler }) {
  return (
    <section className="settingsPanel">
      <div className="panelHeader">
        <h2>Sessions and devices</h2>
        <Button
          onClick={() =>
            mutate('Other sessions revoked.', () => apiRequest('/api/account/security/sessions', { method: 'DELETE' }))
          }
          type="button"
          variant="secondary"
        >
          Revoke all
        </Button>
      </div>
      <ItemList
        empty="No active sessions."
        items={sessions.map((session) => ({
          id: session.id,
          title: session.userAgent ?? 'Unknown device',
          meta: `${session.ipAddress ?? 'No IP'} / expires ${formatDate(session.expiresAt)}`,
          action: (
            <Button
              onClick={() =>
                mutate('Session revoked.', () =>
                  apiRequest(`/api/account/security/sessions/${session.id}`, { method: 'DELETE' }),
                )
              }
              type="button"
              variant="ghost"
            >
              Revoke
            </Button>
          ),
        }))}
      />
    </section>
  )
}

function ApplicationsSection({ applications }: { applications: ConsentedApplication[] }) {
  return (
    <section className="settingsPanel">
      <h2>Consented applications</h2>
      <ItemList
        empty="No application consents."
        items={applications.map((application) => ({
          id: application.id,
          title: application.applicationName,
          meta: `${application.scopes.join(', ')} / granted ${formatDate(application.grantedAt)}`,
        }))}
      />
    </section>
  )
}

type MutationHandler = (label: string, operation: () => Promise<unknown>) => Promise<void>

type ListItem = {
  id: string
  title: string
  meta: string
  action?: ReactNode
}

function ItemList({ empty, items }: { empty: string; items: ListItem[] }) {
  if (items.length === 0) return <p className="emptyState">{empty}</p>

  return (
    <div className="itemList">
      {items.map((item) => (
        <article className="itemRow" key={item.id}>
          <div>
            <h3>{item.title}</h3>
            <p>{item.meta}</p>
          </div>
          {item.action}
        </article>
      ))}
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function BadgeIcon({ size = 18 }: { size?: number }) {
  return <ShieldCheck size={size} />
}
