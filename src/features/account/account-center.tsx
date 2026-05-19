import { useNavigate } from '@tanstack/react-router'
import { Fingerprint, KeyRound, LoaderCircle, Mail, UserRound } from 'lucide-react'
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { BrandIdentity, brandingStyle } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, TextInput } from '@/components/ui/field'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import {
  changeAccountPassword,
  createPasskeyRegistrationOptions,
  deletePasskey,
  disableTotp,
  getAccountProfile,
  getAccountSecurity,
  listAccountSessions,
  listConsentedApplications,
  listLinkedAccounts,
  listPasskeys,
  requestAccountEmailChange,
  revokeApplicationConsent,
  revokeOtherSessions,
  revokeSession,
  startTotpEnrollment,
  unlinkAccount,
  updateAccountProfile,
  uploadAccountAvatar,
  verifyPasskeyRegistration,
  verifyTotp,
} from '@/lib/api/account'
import { signOut } from '@/lib/auth-client'

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

type TotpEnrollmentDisplay = {
  qrCode: string | null
  otpAuthUri: string | null
  secret: string | null
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
  return <AccountCenter />
}

export function AccountCenter() {
  const navigate = useNavigate()
  const { data: config } = useConfigz()
  const [data, setData] = useState(emptyAccountData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<DestructiveConfirmation | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [profile, linkedAccounts, applications, sessions, security, passkeys] = await Promise.all([
        getAccountProfile(),
        listLinkedAccounts(),
        listConsentedApplications(),
        listAccountSessions(),
        getAccountSecurity(),
        listPasskeys(),
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

  async function mutate<T>(
    label: string,
    operation: () => Promise<T>,
    options: { reload?: boolean } = {},
  ): Promise<T | undefined> {
    setMessage(null)
    setError(null)
    try {
      const result = await operation()
      setMessage(label)
      if (options.reload !== false) await reload()
      return result
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Account update failed.')
      return undefined
    }
  }

  async function signOutFromAccount() {
    setMessage(null)
    setError(null)
    try {
      await signOut()
      setData(emptyAccountData)
      setLoading(false)
      setConfirmation(null)
      setMessage('Signed out.')
      await navigate({ to: '/sign-in' })
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Account update failed.')
    }
  }

  return (
    <main className="accountShell" style={brandingStyle(config)}>
      <div className="accountChrome">
        <BrandIdentity config={config} />
        <section className="accountContent">
          <div className="accountHeader">
            <div>
              <p className="eyebrow">Account</p>
              <h1>{data.profile?.displayName ?? 'Your account'}</h1>
              {data.profile ? <p className="muted">{data.profile.email}</p> : null}
            </div>
            <Button onClick={() => void signOutFromAccount()} variant="secondary">
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
          {!loading && data.profile ? (
            <div className="accountSectionStack">
              <ProfileSections profile={data.profile} mutate={mutate} />
              <SecuritySections confirm={setConfirmation} data={data} mutate={mutate} />
              <ConnectionsSection accounts={data.linkedAccounts} confirm={setConfirmation} mutate={mutate} />
              <SessionsSection confirm={setConfirmation} sessions={data.sessions} mutate={mutate} />
              <ApplicationsSection applications={data.applications} confirm={setConfirmation} mutate={mutate} />
            </div>
          ) : null}
        </section>
      </div>
      <DestructiveConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </main>
  )
}

function ProfileSections({ profile, mutate }: { profile: UserProfile; mutate: MutationHandler }) {
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [username, setUsername] = useState(profile.username ?? '')
  const [avatarAssetId, setAvatarAssetId] = useState(profile.avatarAssetId ?? '')
  const [avatarPreview, setAvatarPreview] = useState(profile.image ?? '')
  const [email, setEmail] = useState(profile.email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => {
    setDisplayName(profile.displayName)
    setUsername(profile.username ?? '')
    setAvatarAssetId(profile.avatarAssetId ?? '')
    setAvatarPreview(profile.image ?? '')
    setEmail(profile.email)
  }, [profile])

  function saveProfile(event: FormEvent) {
    event.preventDefault()
    return mutate('Profile updated.', () =>
      updateAccountProfile({
        displayName,
        username: username || null,
        avatarAssetId: avatarAssetId || null,
      }),
    )
  }

  function changeEmail(event: FormEvent) {
    event.preventDefault()
    return mutate('Email change requested.', () =>
      requestAccountEmailChange({ email, callbackURL: `${window.location.origin}/email-verification` }),
    )
  }

  function changePassword(event: FormEvent) {
    event.preventDefault()
    return mutate('Password changed.', () =>
      changeAccountPassword({ currentPassword, newPassword, revokeOtherSessions: true }),
    )
  }

  function uploadAvatar(file: File | undefined) {
    if (!file) return
    return mutate('Avatar uploaded.', () => uploadAccountAvatar(file), { reload: false }).then((response) => {
      if (response) {
        setAvatarAssetId(response.asset.id)
        setAvatarPreview(response.asset.publicUrl)
      }
      return response
    })
  }

  return (
    <>
      <section className="settingsPanel">
        <h2>Profile</h2>
        <form className="formStack" onSubmit={saveProfile}>
          <Field label="Display name">
            <TextInput onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
          </Field>
          <Field label="Username">
            <TextInput onChange={(event) => setUsername(event.target.value)} value={username} />
          </Field>
          <Button type="submit">Save profile</Button>
        </form>
      </section>
      <section className="settingsPanel">
        <h2>Avatar</h2>
        <div className="assetUploadRow">
          {avatarPreview ? (
            <img alt="" className="assetPreview" src={avatarPreview} width="64" height="64" />
          ) : (
            <UserRound size={42} />
          )}
          <Field help="PNG, JPEG, or WebP up to 2 MB." label="Avatar image">
            <TextInput
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => uploadAvatar(event.currentTarget.files?.[0])}
              type="file"
            />
          </Field>
        </div>
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
          <input autoComplete="username" hidden readOnly type="text" value={profile.email} />
          <Field label="Current password">
            <TextInput
              autoComplete="current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              type="password"
              value={currentPassword}
            />
          </Field>
          <Field label="New password">
            <TextInput
              autoComplete="new-password"
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
    </>
  )
}

function SecuritySections({
  confirm,
  data,
  mutate,
}: {
  confirm: ConfirmDestructiveHandler
  data: AccountData
  mutate: MutationHandler
}) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollmentDisplay | null>(null)
  const mfaRequired = data.security?.policy.mfa.mode === 'required'

  return (
    <>
      <section className="settingsPanel">
        <h2>MFA</h2>
        <p className="muted">{data.security?.mfa.enabled ? 'Enabled' : 'No factor enrolled'}</p>
        <form
          className="formStack"
          onSubmit={(event) => {
            event.preventDefault()
            return mutate(
              'TOTP enrollment started.',
              async () => {
                const enrollment = await startTotpEnrollment({ password })
                setTotpEnrollment(readTotpEnrollment(enrollment))
                return enrollment
              },
              { reload: false },
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
        {totpEnrollment ? <TotpEnrollmentDetails enrollment={totpEnrollment} /> : null}
        <form
          className="formStack compactForm"
          onSubmit={(event) => {
            event.preventDefault()
            return mutate('MFA challenge verified.', () => verifyTotp({ code, trustDevice: true }))
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
            confirm({
              title: 'Disable MFA',
              description: 'This removes authenticator app protection from your account.',
              actionLabel: 'Disable authenticator app',
              onConfirm: () => mutate('MFA disabled.', () => disableTotp({ password })),
            })
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
            return mutate('Passkey enrolled.', () => enrollPasskey(passkeyName))
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
                  confirm({
                    title: 'Remove passkey',
                    description: 'This passkey will no longer sign in to your account.',
                    actionLabel: 'Remove passkey',
                    onConfirm: () => mutate('Passkey removed.', () => deletePasskey(passkey.id)),
                  })
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
    </>
  )
}

function ConnectionsSection({
  accounts,
  confirm,
  mutate,
}: {
  accounts: LinkedAccount[]
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
}) {
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
                confirm({
                  title: 'Unlink account',
                  description: `${account.providerId} will no longer be connected to your account.`,
                  actionLabel: 'Unlink account',
                  onConfirm: () =>
                    mutate('Linked account removed.', () => unlinkAccount(account.providerId, account.accountId)),
                })
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

function SessionsSection({
  confirm,
  sessions,
  mutate,
}: {
  confirm: ConfirmDestructiveHandler
  sessions: UserSessionDevice[]
  mutate: MutationHandler
}) {
  return (
    <section className="settingsPanel">
      <div className="panelHeader">
        <h2>Sessions and devices</h2>
        <Button
          onClick={() =>
            confirm({
              title: 'Revoke other sessions',
              description: 'Every other active session for this account will be signed out.',
              actionLabel: 'Revoke sessions',
              onConfirm: () => mutate('Other sessions revoked.', revokeOtherSessions),
            })
          }
          type="button"
          variant="secondary"
        >
          Revoke other sessions
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
                confirm({
                  title: 'Revoke session',
                  description: 'This device session will be signed out.',
                  actionLabel: 'Revoke session',
                  onConfirm: () => mutate('Session revoked.', () => revokeSession(session.id)),
                })
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

function ApplicationsSection({
  applications,
  confirm,
  mutate,
}: {
  applications: ConsentedApplication[]
  confirm: ConfirmDestructiveHandler
  mutate: MutationHandler
}) {
  return (
    <section className="settingsPanel">
      <h2>Authorized apps</h2>
      <ItemList
        empty="No application consents."
        items={applications.map((application) => ({
          id: application.id,
          title: application.applicationName,
          meta: `${application.scopes.join(', ')} / granted ${formatDate(application.grantedAt)}`,
          action: (
            <Button
              onClick={() =>
                confirm({
                  title: 'Revoke application access',
                  description: `${application.applicationName} will lose access to this account until you approve it again.`,
                  actionLabel: 'Revoke access',
                  onConfirm: () =>
                    mutate('Application access revoked.', () => revokeApplicationConsent(application.id)),
                })
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

type MutationHandler = <T>(
  label: string,
  operation: () => Promise<T>,
  options?: { reload?: boolean },
) => Promise<T | undefined>

type DestructiveConfirmation = {
  title: string
  description: string
  actionLabel: string
  onConfirm: () => unknown
}

type ConfirmDestructiveHandler = (confirmation: DestructiveConfirmation) => void

function DestructiveConfirmationDialog({
  confirmation,
  onClose,
}: {
  confirmation: DestructiveConfirmation | null
  onClose: () => void
}) {
  if (!confirmation) return null

  return (
    <Dialog open={true}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmation.title}</DialogTitle>
          <DialogDescription>{confirmation.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button
            onClick={() => {
              const confirmed = confirmation
              onClose()
              void confirmed.onConfirm()
            }}
            type="button"
            variant="danger"
          >
            {confirmation.actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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

function TotpEnrollmentDetails({ enrollment }: { enrollment: TotpEnrollmentDisplay }) {
  return (
    <div className="setupPanel">
      <h3>Authenticator setup</h3>
      {enrollment.qrCode ? (
        <img className="setupQr" src={enrollment.qrCode} alt="Authenticator app QR code" width="168" height="168" />
      ) : null}
      {enrollment.otpAuthUri ? (
        <p>
          <strong>Enrollment URI</strong>
          <code>{enrollment.otpAuthUri}</code>
        </p>
      ) : null}
      {enrollment.secret ? (
        <p>
          <strong>Secret</strong>
          <code>{enrollment.secret}</code>
        </p>
      ) : null}
    </div>
  )
}

function readTotpEnrollment(value: unknown): TotpEnrollmentDisplay {
  const record = asRecord(value)
  return {
    qrCode: readString(record.qrCode) ?? readString(record.qrCodeUrl) ?? readString(record.qr),
    otpAuthUri:
      readString(record.otpAuthUri) ??
      readString(record.otpAuthURI) ??
      readString(record.totpURI) ??
      readString(record.totpUri) ??
      readString(record.uri),
    secret: readString(record.secret),
  }
}

async function enrollPasskey(name: string) {
  const options = await createPasskeyRegistrationOptions({ name: name || undefined })
  const credential = await createPasskeyCredential(options)
  return verifyPasskeyRegistration({ response: credential, name: name || undefined })
}

async function createPasskeyCredential(optionsResponse: unknown) {
  if (!navigator.credentials?.create) {
    throw new Error('Passkey registration is not supported by this browser.')
  }

  const credential = await navigator.credentials.create({
    publicKey: passkeyCreationOptions(optionsResponse),
  })

  if (!credential) {
    throw new Error('Passkey registration was cancelled.')
  }

  return serializePasskeyCredential(credential)
}

function passkeyCreationOptions(optionsResponse: unknown): PublicKeyCredentialCreationOptions {
  const response = asRecord(optionsResponse)
  const options = asRecord(
    response.publicKey ?? asRecord(response.options).publicKey ?? response.options ?? optionsResponse,
  )
  const user = asRecord(options.user)

  return {
    ...options,
    challenge: base64UrlToBuffer(readRequiredString(options.challenge, 'challenge')),
    user: {
      ...user,
      id: base64UrlToBuffer(readRequiredString(user.id, 'user.id')),
      name: readRequiredString(user.name, 'user.name'),
      displayName: readRequiredString(user.displayName, 'user.displayName'),
    },
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map((credential) => {
          const credentialRecord = asRecord(credential)
          return {
            ...credentialRecord,
            id: base64UrlToBuffer(readRequiredString(credentialRecord.id, 'excludeCredentials.id')),
          } as PublicKeyCredentialDescriptor
        })
      : undefined,
  } as PublicKeyCredentialCreationOptions
}

function serializePasskeyCredential(credential: Credential) {
  const publicKeyCredential = credential as PublicKeyCredential
  const response = publicKeyCredential.response as AuthenticatorAttestationResponse
  return {
    id: publicKeyCredential.id,
    rawId: bufferToBase64Url(publicKeyCredential.rawId),
    type: publicKeyCredential.type,
    response: {
      attestationObject: bufferToBase64Url(response.attestationObject),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: publicKeyCredential.getClientExtensionResults?.() ?? {},
  }
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function bufferToBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function readString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readRequiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Passkey registration option ${field} is required.`)
  }
  return value
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
