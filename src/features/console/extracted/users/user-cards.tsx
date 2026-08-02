import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  type FormState,
  type ManagementUserResponse,
  managementUpdateUserRequestSchema,
  SelectInput,
  SettingRow,
  TextInput,
  tt,
  useState,
  type z,
} from '../../console-shared'
import { MutationError, SummaryRow } from '../../helpers/helpers-dialogs'
import { formatDate, formatRole, nullableString, parseForm, setValue } from '../../helpers/helpers-utils'

export function UserProfileCard({
  error,
  onSubmit,
  pending,
  user,
}: {
  error: unknown
  onSubmit: (input: z.infer<typeof managementUpdateUserRequestSchema>) => void
  pending: boolean
  user: ManagementUserResponse
}) {
  const [form, setForm] = useState<FormState>({
    email: user.email ?? '',
    displayName: user.displayName ?? user.name ?? '',
    username: user.username ?? '',
    role: Array.isArray(user.role) ? '' : (user.role ?? 'user'),
    emailVerified: user.emailVerified ? 'true' : 'false',
  })
  const [validationError, setValidationError] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Profile and access')}</CardTitle>
        <CardDescription>{tt('Edit safe account fields and administrative access state.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="formStack"
          noValidate={true}
          onSubmit={(event) => {
            event.preventDefault()
            const submittedForm = new FormData(event.currentTarget)
            const submittedRole = String(submittedForm.get('role') ?? '')
            try {
              setValidationError(null)
              onSubmit(
                parseForm(managementUpdateUserRequestSchema, {
                  email: submittedForm.get('email'),
                  displayName: submittedForm.get('displayName'),
                  username: nullableString(submittedForm.get('username') as string),
                  ...(submittedRole
                    ? {
                        role: submittedRole,
                      }
                    : {}),
                  emailVerified: submittedForm.get('emailVerified') === 'true',
                }),
              )
            } catch (submitError) {
              setValidationError(submitError instanceof Error ? tt(submitError.message) : tt('Invalid form input.'))
            }
          }}
        >
          <Field label={tt('Email')}>
            <TextInput defaultValue={form.email} name="email" type="email" />
          </Field>
          <Field label={tt('Display name')}>
            <TextInput defaultValue={form.displayName} name="displayName" />
          </Field>
          <Field label={tt('Username')}>
            <TextInput defaultValue={form.username} name="username" />
          </Field>
          <Field label={tt('Role')}>
            <SelectInput
              disabled={Array.isArray(user.role)}
              name="role"
              onChange={(event) => setValue(setForm, 'role', event.target.value)}
              value={form.role}
            >
              {Array.isArray(user.role) ? (
                <option value="">
                  {tt('Multiple roles:')} {user.role.join(', ')}
                </option>
              ) : null}
              <option value="user">{tt('User')}</option>
              <option value="admin">{tt('Admin')}</option>
            </SelectInput>
          </Field>
          <Field label={tt('Email verification')}>
            <SelectInput
              name="emailVerified"
              onChange={(event) => setValue(setForm, 'emailVerified', event.target.value)}
              value={form.emailVerified}
            >
              <option value="true">{tt('Verified')}</option>
              <option value="false">{tt('Unverified')}</option>
            </SelectInput>
          </Field>
          {validationError ? <MutationError error={validationError} /> : null}
          <MutationError error={error} />
          <Button disabled={pending} type="submit">
            {pending ? tt('Saving…') : tt('Save profile')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
export function UserSecurityCard({
  error,
  onDeletePasskey,
  passkeys,
  security,
}: {
  error: unknown
  onDeletePasskey: (passkeyId: string) => void
  passkeys: Array<{
    id: string
    name: string | null
    deviceType: string
    backedUp: boolean
    createdAt: string | Date | null
  }>
  security?: {
    mfa: {
      enabled: boolean
      factors: Array<{
        id: string
        type: string
        verified: boolean | null
      }>
    }
    passkeys: {
      enabled: boolean
      count: number
    }
    policy: {
      mfa: {
        mode: string
      }
      passkeys: {
        enabled: boolean
        rpName: string
      }
    }
  }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('MFA and passkeys')}</CardTitle>
        <CardDescription>{tt('Overview only; no secret material is exposed.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('MFA state')} value={security?.mfa.enabled ? 'Enabled' : 'Disabled'} />
        <SettingRow label={tt('MFA policy')} value={security?.policy.mfa.mode ?? 'Unknown'} />
        <SettingRow label={tt('Passkey policy')} value={security?.policy.passkeys.enabled ? 'Enabled' : 'Disabled'} />
        <SettingRow label={tt('Passkey count')} value={String(security?.passkeys.count ?? passkeys.length)} />
        {security?.mfa.factors.length ? (
          <div className="grid gap-2">
            {security.mfa.factors.map((factor) => (
              <SummaryRow
                key={factor.id}
                meta={factor.verified ? 'Verified' : 'Unverified'}
                status={<Badge variant="secondary">{factor.type}</Badge>}
                title={factor.id}
              />
            ))}
          </div>
        ) : null}
        <div className="grid gap-2">
          {passkeys.length ? (
            passkeys.map((passkey) => (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                key={passkey.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{passkey.name ?? passkey.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {passkey.deviceType}; {passkey.backedUp ? 'backed up' : 'not backed up'};{' '}
                    {formatDate(passkey.createdAt ?? undefined)}
                  </p>
                </div>
                <Button onClick={() => onDeletePasskey(passkey.id)} type="button" variant="destructive">
                  {' '}
                  {tt('Delete')}{' '}
                </Button>
              </div>
            ))
          ) : (
            <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              {' '}
              {tt('No passkeys registered.')}{' '}
            </p>
          )}
        </div>
        <MutationError error={error} />
      </CardContent>
    </Card>
  )
}
export function UserSessionsCard({
  error,
  onRevokeAll,
  onRevokeSession,
  pending,
  sessions,
}: {
  error: unknown
  onRevokeAll: () => void
  onRevokeSession: (sessionId: string) => void
  pending: boolean
  sessions: Array<{
    id: string
    expiresAt: string | Date
    createdAt: string | Date
    ipAddress: string | null
    userAgent: string | null
  }>
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{tt('Sessions')}</CardTitle>
            <CardDescription>{tt('Revoke one session or require every device to sign in again.')}</CardDescription>
          </div>
          <Button disabled={pending || sessions.length === 0} onClick={onRevokeAll} type="button" variant="destructive">
            {' '}
            {tt('Revoke all')}{' '}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {sessions.length ? (
          sessions.map((session) => (
            <div
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              key={session.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{session.userAgent ?? session.id}</p>
                <p className="text-xs text-muted-foreground">
                  {session.ipAddress ?? 'Unknown IP'}
                  {tt('; expires')} {formatDate(session.expiresAt)}
                </p>
              </div>
              <Button
                disabled={pending}
                onClick={() => onRevokeSession(session.id)}
                type="button"
                variant="destructive"
              >
                {' '}
                {tt('Revoke')}{' '}
              </Button>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {' '}
            {tt('No active sessions.')}{' '}
          </p>
        )}
        <MutationError error={error} />
      </CardContent>
    </Card>
  )
}
export function UserLinkedAccountsCard({
  accounts,
  error,
}: {
  accounts: Array<{
    id: string
    accountId: string
    providerId: string
    createdAt: string | Date
  }>
  error: unknown
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Linked accounts')}</CardTitle>
        <CardDescription>{tt('External identity accounts connected to this user.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {accounts.length ? (
          accounts.map((account) => (
            <SummaryRow
              key={account.id}
              meta={`${account.accountId}; linked ${formatDate(account.createdAt)}`}
              status={<Badge variant="secondary">{account.providerId}</Badge>}
              title={account.providerId}
            />
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {' '}
            {tt('No linked accounts.')}{' '}
          </p>
        )}
        <MutationError error={error} />
      </CardContent>
    </Card>
  )
}
export function UserApplicationsCard({
  applications,
  error,
}: {
  applications: Array<{
    id: string
    applicationName: string
    applicationSlug: string
    scopes: string[]
    grantedAt: string | Date
  }>
  error: unknown
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Authorized applications')}</CardTitle>
        <CardDescription>{tt('OIDC clients with active user consent.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {applications.length ? (
          applications.map((application) => (
            <SummaryRow
              key={application.id}
              meta={`${application.scopes.join(' ')}; granted ${formatDate(application.grantedAt)}`}
              status={<Badge variant="outline">{application.applicationSlug}</Badge>}
              title={application.applicationName}
            />
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {' '}
            {tt('No authorized applications.')}{' '}
          </p>
        )}
        <MutationError error={error} />
      </CardContent>
    </Card>
  )
}
export function UserIdentitySummaryCard({
  applicationsCount,
  linkedAccountsCount,
  sessionsCount,
  user,
}: {
  applicationsCount: number
  linkedAccountsCount: number
  sessionsCount: number
  user: ManagementUserResponse
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('Identity summary')}</CardTitle>
        <CardDescription>{tt('Read-only context for the selected user tab.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SettingRow label={tt('User ID')} value={user.id} />
        <SettingRow label={tt('Email')} value={user.email ?? 'Not set'} />
        <SettingRow label={tt('Role')} value={formatRole(user.role)} />
        <SettingRow label={tt('Account status')} value={user.banned ? 'Banned' : 'Active'} />
        <SettingRow label={tt('Sessions')} value={String(sessionsCount)} />
        <SettingRow label={tt('Linked accounts')} value={String(linkedAccountsCount)} />
        <SettingRow label={tt('Authorized apps')} value={String(applicationsCount)} />
      </CardContent>
    </Card>
  )
}
