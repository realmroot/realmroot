import { managementUpdateUserRequestSchema } from '@shared/api/management'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Field, SelectInput, TextInput } from '@/components/product-form'
import { TableEmptyRow } from '@/components/table-empty-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BanUserDialog, DangerConfirmDialog, ErrorState, LoadingState } from '@/features/management/dialogs'
import { navigateConsoleTab } from '@/features/management/resource-components'
import type { UserDetailSection } from '@/features/management/shared'
import {
  formatDate,
  formatRealmAccess,
  hasRealmAdminAccess,
  nullableString,
  parseForm,
  setRealmAdminAccess,
  useAdminMutation,
  userDisplayName,
} from '@/features/management/utils'
import { consoleQueryKeys } from '@/lib/api/console-query-keys'
import {
  banUser,
  deleteUser,
  deleteUserPasskey,
  getAgentInventory,
  getUser,
  listUserApplications,
  listUserLinkedAccounts,
  listUserPasskeys,
  listUserSessions,
  requestUserPasswordReset,
  revokeUserSession,
  revokeUserSessions,
  unbanUser,
  updateUser,
} from '@/lib/api/management'
import { tt } from '@/lib/i18n'

export function UserDetailPage({ userId, section = 'overview' }: { userId: string; section?: UserDetailSection }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [active, setActive] = useState<UserDetailSection>(section)
  const [editOpen, setEditOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [banOpen, setBanOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [revokeAllOpen, setRevokeAllOpen] = useState(false)
  const [sessionToRevoke, setSessionToRevoke] = useState<string | null>(null)
  const [passkeyToDelete, setPasskeyToDelete] = useState<string | null>(null)
  const userQuery = useQuery({ queryKey: [...consoleQueryKeys.users, userId], queryFn: () => getUser(userId) })
  const sessions = useQuery({
    queryKey: [...consoleQueryKeys.users, userId, 'sessions'],
    queryFn: () => listUserSessions(userId),
  })
  const linkedAccounts = useQuery({
    queryKey: [...consoleQueryKeys.users, userId, 'linked-accounts'],
    queryFn: () => listUserLinkedAccounts(userId),
  })
  const applications = useQuery({
    queryKey: [...consoleQueryKeys.users, userId, 'applications'],
    queryFn: () => listUserApplications(userId),
  })
  const passkeys = useQuery({
    queryKey: [...consoleQueryKeys.users, userId, 'passkeys'],
    queryFn: () => listUserPasskeys(userId),
  })
  const agents = useQuery({
    queryKey: [...consoleQueryKeys.agents, { purpose: 'user-detail' }],
    queryFn: () => getAgentInventory(),
  })
  const user = userQuery.data?.user
  const update = useAdminMutation({
    mutationFn: (input: Parameters<typeof updateUser>[1]) => updateUser(userId, input),
    onSuccess: async (result) => {
      queryClient.setQueryData([...consoleQueryKeys.users, userId], result)
      setEditOpen(false)
      await queryClient.invalidateQueries({ queryKey: consoleQueryKeys.users })
    },
  })
  const reset = useAdminMutation({
    mutationFn: () => requestUserPasswordReset(userId),
    onSuccess: async () => setResetOpen(false),
  })
  const ban = useAdminMutation({
    mutationFn: (input: { reason?: string }) => banUser(userId, input),
    onSuccess: async () => {
      setBanOpen(false)
      await queryClient.invalidateQueries({ queryKey: [...consoleQueryKeys.users, userId] })
    },
  })
  const unban = useAdminMutation({
    mutationFn: () => unbanUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...consoleQueryKeys.users, userId] }),
  })
  const remove = useMutation({
    mutationFn: () => deleteUser(userId),
    onSuccess: async () => {
      const detailKey = [...consoleQueryKeys.users, userId]
      await queryClient.cancelQueries({ queryKey: detailKey })
      await queryClient.invalidateQueries({
        queryKey: consoleQueryKeys.users,
        exact: true,
        refetchType: 'none',
      })
      await navigate({ to: '/console/users' })
      queryClient.removeQueries({ queryKey: detailKey })
    },
  })
  const revokeAll = useAdminMutation({
    mutationFn: () => revokeUserSessions(userId),
    onSuccess: async () => {
      setRevokeAllOpen(false)
      await sessions.refetch()
    },
  })
  const revokeSession = useAdminMutation({
    mutationFn: (id: string) => revokeUserSession(userId, id),
    onSuccess: async () => {
      setSessionToRevoke(null)
      await sessions.refetch()
    },
  })
  const deletePasskey = useAdminMutation({
    mutationFn: (id: string) => deleteUserPasskey(userId, id),
    onSuccess: async () => {
      setPasskeyToDelete(null)
      await Promise.all([passkeys.refetch(), userQuery.refetch()])
    },
  })
  useEffect(() => {
    setActive(section)
  }, [section])
  const loading = [userQuery, sessions, linkedAccounts, applications, passkeys, agents].some((item) => item.isLoading)
  const error =
    userQuery.error ?? sessions.error ?? linkedAccounts.error ?? applications.error ?? passkeys.error ?? agents.error
  if (loading) return <LoadingState label={tt('Loading user')} />
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() =>
          Promise.all([
            userQuery.refetch(),
            sessions.refetch(),
            linkedAccounts.refetch(),
            applications.refetch(),
            passkeys.refetch(),
            agents.refetch(),
          ])
        }
      />
    )
  if (!user) return <ErrorState error={new Error(tt('User not found.'))} />
  const userAgents = agents.data!.items.filter(
    (agent) => agent.homeSpace.type === 'personal' && agent.homeSpace.userId === userId,
  )
  return (
    <>
      <div className="consoleDetailStack">
        <Link className="consoleBackLink" to="/console/users">
          <ArrowLeft />
          {tt('Users')}
        </Link>
        <header className="consoleDetailHeader">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1>{userDisplayName(user)}</h1>
              <Badge variant={user.banned ? 'outline' : 'secondary'}>{user.banned ? tt('Banned') : tt('Active')}</Badge>
            </div>
            <p>{tt('Human identity with authentication, sessions, Agent identities, and application consent.')}</p>
            <span className="consoleDetailMeta">
              {user.id} · {user.email ?? tt('No email')}
            </span>
          </div>
          <Button onClick={() => setEditOpen(true)}>
            <Pencil />
            {tt('Edit user')}
          </Button>
        </header>
        <Tabs
          onValueChange={(value) => {
            const next = value as UserDetailSection
            setActive(next)
            navigateConsoleTab(navigate, `/console/users/${userId}/${next}`)
          }}
          value={active}
        >
          <TabsList className="w-full" variant="navigation">
            <TabsTrigger value="overview">{tt('Overview')}</TabsTrigger>
            <TabsTrigger value="authentication">{tt('Authentication')}</TabsTrigger>
            <TabsTrigger value="sessions">{tt('Sessions')}</TabsTrigger>
            <TabsTrigger value="agents">{tt('Agents')}</TabsTrigger>
            <TabsTrigger value="authorized-apps">{tt('Authorized apps')}</TabsTrigger>
            <TabsTrigger value="settings">{tt('Settings')}</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-5" value="overview">
            <UserOverview
              applications={applications.data!.applications.length}
              agents={userAgents.length}
              linked={linkedAccounts.data!.accounts.length}
              realmDetails
              sessions={sessions.data!.sessions.length}
              user={user}
            />
          </TabsContent>
          <TabsContent className="mt-5" value="authentication">
            <UserAuthentication
              accounts={linkedAccounts.data!.accounts}
              onDeletePasskey={setPasskeyToDelete}
              passkeys={passkeys.data!.passkeys}
              security={userQuery.data?.security}
            />
          </TabsContent>
          <TabsContent className="mt-5" value="sessions">
            <UserSessions
              onRevoke={setSessionToRevoke}
              onRevokeAll={() => setRevokeAllOpen(true)}
              sessions={sessions.data!.sessions}
            />
          </TabsContent>
          <TabsContent className="mt-5" value="agents">
            <UserAgents agents={userAgents} />
          </TabsContent>
          <TabsContent className="mt-5" value="authorized-apps">
            <UserApplications applications={applications.data!.applications} />
          </TabsContent>
          <TabsContent className="mt-5" value="settings">
            <UserSettings
              onBan={() => setBanOpen(true)}
              onDelete={() => setDeleteOpen(true)}
              onReset={() => setResetOpen(true)}
              onUnban={() => unban.mutate(undefined)}
              pending={reset.isPending || ban.isPending || unban.isPending}
              user={user}
            />
          </TabsContent>
        </Tabs>
      </div>
      <UserEditSheet
        error={update.errorMessage}
        onClose={() => setEditOpen(false)}
        onSave={(input) => update.mutate(input)}
        open={editOpen}
        pending={update.isPending}
        user={user}
      />
      <BanUserDialog
        error={ban.error}
        onClose={() => setBanOpen(false)}
        onConfirm={(reason) => ban.mutate(reason ? { reason } : {})}
        open={banOpen}
        pending={ban.isPending}
        userName={userDisplayName(user)}
      />
      <DangerConfirmDialog
        actionLabel={tt('Send password reset')}
        description={tt('Send a recovery message to {{email}}.', { email: user.email ?? tt('this user') })}
        error={reset.error}
        onClose={() => setResetOpen(false)}
        onConfirm={() => reset.mutate(undefined)}
        open={resetOpen}
        pending={reset.isPending}
        title={tt('Send password reset?')}
      />
      <DangerConfirmDialog
        actionLabel={tt('Delete user')}
        description={tt('Deleting {{name}} removes the account and cannot be undone.', { name: userDisplayName(user) })}
        error={remove.error}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => remove.mutate()}
        open={deleteOpen}
        pending={remove.isPending}
        title={tt('Delete user?')}
      />
      <DangerConfirmDialog
        actionLabel={tt('Revoke sessions')}
        description={tt('Revoke every active session for {{name}}.', { name: userDisplayName(user) })}
        error={revokeAll.error}
        onClose={() => setRevokeAllOpen(false)}
        onConfirm={() => revokeAll.mutate(undefined)}
        open={revokeAllOpen}
        pending={revokeAll.isPending}
        title={tt('Revoke all sessions?')}
      />
      <DangerConfirmDialog
        actionLabel={tt('Revoke session')}
        description={tt('This browser must sign in again.')}
        error={revokeSession.error}
        onClose={() => setSessionToRevoke(null)}
        onConfirm={() => {
          if (sessionToRevoke) revokeSession.mutate(sessionToRevoke)
        }}
        open={sessionToRevoke !== null}
        pending={revokeSession.isPending}
        title={tt('Revoke session?')}
      />
      <DangerConfirmDialog
        actionLabel={tt('Delete passkey')}
        description={tt('The user can no longer sign in with this passkey.')}
        error={deletePasskey.error}
        onClose={() => setPasskeyToDelete(null)}
        onConfirm={() => {
          if (passkeyToDelete) deletePasskey.mutate(passkeyToDelete)
        }}
        open={passkeyToDelete !== null}
        pending={deletePasskey.isPending}
        title={tt('Delete passkey?')}
      />
    </>
  )
}

function UserOverview({
  agents,
  applications,
  linked,
  realmDetails,
  sessions,
  user,
}: {
  agents: number
  applications: number
  linked: number
  realmDetails: boolean
  sessions: number
  user: Awaited<ReturnType<typeof getUser>>['user']
}) {
  return (
    <div className="detailFlatRows">
      <DetailRow label="Primary email" value={user.email ?? '—'} />
      <DetailRow label="Email verification" value={user.emailVerified ? tt('Verified') : tt('Not verified')} />
      <DetailRow label="Realm access" value={formatRealmAccess(user.role)} />
      {realmDetails ? (
        <>
          <DetailRow label="Active sessions" value={String(sessions)} />
          <DetailRow label="Agent identities" value={String(agents)} />
          <DetailRow label="Authorized apps" value={String(applications)} />
          <DetailRow label="Sign-in identities" value={String(linked)} />
        </>
      ) : null}
      <DetailRow label="Created" value={formatDate(user.createdAt)} />
    </div>
  )
}

function UserAuthentication({
  accounts,
  onDeletePasskey,
  passkeys,
  security,
}: {
  accounts: Awaited<ReturnType<typeof listUserLinkedAccounts>>['accounts']
  onDeletePasskey: (id: string) => void
  passkeys: Awaited<ReturnType<typeof listUserPasskeys>>['passkeys']
  security?: Awaited<ReturnType<typeof getUser>>['security']
}) {
  return (
    <div className="detailSections">
      <Section title="Factors" description="Enrolled authentication and recovery methods for this user.">
        <DetailRow
          label="Multi-factor authentication"
          value={security?.mfa.enabled ? tt('Enabled') : tt('Not enabled')}
        />
        <DetailRow
          label="Enrolled factors"
          value={security?.mfa.factors.map((factor) => factor.type).join(', ') || tt('None')}
        />
      </Section>
      <Section title="Passkeys" description="WebAuthn credentials enrolled by this user.">
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tt('Passkey')}</TableHead>
                <TableHead>{tt('Device')}</TableHead>
                <TableHead>{tt('Backup')}</TableHead>
                <TableHead>{tt('Created')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {passkeys.length ? (
                passkeys.map((passkey) => (
                  <TableRow key={passkey.id}>
                    <TableCell>
                      <span className="font-medium">{passkey.name ?? tt('Unnamed passkey')}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{passkey.id}</span>
                    </TableCell>
                    <TableCell>{passkey.deviceType}</TableCell>
                    <TableCell>{passkey.backedUp ? tt('Backed up') : tt('Device only')}</TableCell>
                    <TableCell>{formatDate(passkey.createdAt ?? undefined)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        aria-label={tt('Delete {{name}}', { name: passkey.name ?? tt('passkey') })}
                        onClick={() => onDeletePasskey(passkey.id)}
                        size="sm"
                        variant="ghost"
                      >
                        {tt('Delete')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyRow
                  colSpan={5}
                  description={tt('This user has not enrolled a passkey.')}
                  title={tt('No passkeys')}
                />
              )}
            </TableBody>
          </Table>
        </div>
      </Section>
      <Section title="Sign-in identities" description="Local and external identities connected to this Realm account.">
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tt('Provider')}</TableHead>
                <TableHead>{tt('Provider account')}</TableHead>
                <TableHead>{tt('Linked')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length ? (
                accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">{identityProviderLabel(account.providerId)}</TableCell>
                    <TableCell>
                      {account.providerId === 'credential' ? (
                        tt('Local password credential')
                      ) : (
                        <code>{account.accountId}</code>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(account.createdAt)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyRow
                  colSpan={3}
                  description={tt('No sign-in identity is linked to this account.')}
                  title={tt('No sign-in identities')}
                />
              )}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  )
}

function UserSessions({
  onRevoke,
  onRevokeAll,
  sessions,
}: {
  onRevoke: (id: string) => void
  onRevokeAll: () => void
  sessions: Awaited<ReturnType<typeof listUserSessions>>['sessions']
}) {
  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button disabled={!sessions.length} onClick={onRevokeAll} variant="outline">
          {tt('Revoke all sessions')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">{tt('Session')}</TableHead>
              <TableHead>{tt('IP address')}</TableHead>
              <TableHead>{tt('Organization context')}</TableHead>
              <TableHead>{tt('Expires')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length ? (
              sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="max-w-0" title={session.userAgent ?? undefined}>
                    <span className="block truncate font-medium">{browserLabel(session.userAgent)}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{session.id}</span>
                  </TableCell>
                  <TableCell>{session.ipAddress ?? '—'}</TableCell>
                  <TableCell>{session.activeOrganizationId ?? tt('Personal')}</TableCell>
                  <TableCell>{formatDate(session.expiresAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      aria-label={tt('Revoke {{session}}', { session: browserLabel(session.userAgent) })}
                      onClick={() => onRevoke(session.id)}
                      size="sm"
                      variant="ghost"
                    >
                      {tt('Revoke')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyRow
                colSpan={5}
                description={tt('This user has no active browser sessions.')}
                title={tt('No active sessions')}
              />
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function UserAgents({ agents }: { agents: Awaited<ReturnType<typeof getAgentInventory>>['items'] }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Agent')}</TableHead>
            <TableHead>{tt('Status')}</TableHead>
            <TableHead>{tt('Issuer')}</TableHead>
            <TableHead>{tt('Updated')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.length ? (
            agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    params={{ agentId: agent.id }}
                    to="/console/agents/$agentId"
                  >
                    {agent.name}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">{agent.subject}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={agent.status === 'active' ? 'secondary' : 'outline'}>{agent.status}</Badge>
                </TableCell>
                <TableCell>
                  <code>{agent.issuer}</code>
                </TableCell>
                <TableCell>{formatDate(agent.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    <Link params={{ agentId: agent.id }} to="/console/agents/$agentId">
                      {tt('Open')}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={5}
              description={tt('User-owned Agent identities appear here after enrollment.')}
              title={tt('No Agent identities')}
            />
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function UserApplications({
  applications,
}: {
  applications: Awaited<ReturnType<typeof listUserApplications>>['applications']
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tt('Application')}</TableHead>
            <TableHead>{tt('Granted scopes')}</TableHead>
            <TableHead>{tt('Authorized')}</TableHead>
            <TableHead>{tt('Expires')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {applications.length ? (
            applications.map((application) => (
              <TableRow key={application.id}>
                <TableCell>
                  <span className="font-medium">{application.applicationName}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{application.applicationId}</span>
                </TableCell>
                <TableCell>
                  <code>{application.scopes.join(' · ')}</code>
                </TableCell>
                <TableCell>{formatDate(application.grantedAt)}</TableCell>
                <TableCell>{application.expiresAt ? formatDate(application.expiresAt) : tt('Never')}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableEmptyRow
              colSpan={4}
              description={tt('Applications appear after this user approves access.')}
              title={tt('No authorized apps')}
            />
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function UserSettings({
  onBan,
  onDelete,
  onReset,
  onUnban,
  pending,
  user,
}: {
  onBan: () => void
  onDelete: () => void
  onReset: () => void
  onUnban: () => void
  pending: boolean
  user: Awaited<ReturnType<typeof getUser>>['user']
}) {
  return (
    <div className="detailFlatRows">
      <DetailRow
        action={
          <Button disabled={pending} onClick={onReset} variant="outline">
            {tt('Send password reset')}
          </Button>
        }
        description="Send a password recovery message to the primary email."
        label="Password reset"
        value={user.email ?? tt('No email')}
      />
      <DetailRow
        action={
          <Button
            disabled={pending}
            onClick={user.banned ? onUnban : onBan}
            variant={user.banned ? 'outline' : 'destructive'}
          >
            {user.banned ? tt('Unban user') : tt('Ban user')}
          </Button>
        }
        description="Block new sessions and authentication while preserving identity history."
        label="Account status"
        value={
          user.banned
            ? [tt('Banned'), user.banReason, user.banExpires ? `${tt('until')} ${formatDate(user.banExpires)}` : null]
                .filter(Boolean)
                .join(' · ')
            : tt('Active')
        }
      />
      <DetailRow
        action={
          <Button onClick={onDelete} variant="destructive">
            <Trash2 />
            {tt('Delete user')}
          </Button>
        }
        description="Permanently remove this identity after dependencies are resolved."
        label="Delete user"
        value={tt('Permanent')}
      />
    </div>
  )
}

function UserEditSheet({
  error,
  onClose,
  onSave,
  open,
  pending,
  user,
}: {
  error?: string | null
  onClose: () => void
  onSave: (input: Parameters<typeof updateUser>[1]) => void
  open: boolean
  pending: boolean
  user: Awaited<ReturnType<typeof getUser>>['user']
}) {
  return (
    <Sheet
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open={open}
    >
      <SheetContent className="h-full overflow-hidden">
        <SheetHeader className="shrink-0">
          <SheetTitle>{tt('Edit user')}</SheetTitle>
          <SheetDescription>{tt('Update profile identity and Realm-level operator access.')}</SheetDescription>
        </SheetHeader>
        <form
          className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-5"
          id="user-edit"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const realmAccess = form.get('realmAccess') === 'admin'
            onSave(
              parseForm(managementUpdateUserRequestSchema, {
                displayName: form.get('displayName'),
                email: form.get('email'),
                username: nullableString(String(form.get('username') ?? '')),
                role: setRealmAdminAccess(user.role, realmAccess),
              }),
            )
          }}
        >
          <Field label={tt('Display name')}>
            <TextInput defaultValue={user.displayName ?? user.name ?? ''} name="displayName" required />
          </Field>
          <Field label={tt('Primary email')}>
            <TextInput defaultValue={user.email ?? ''} name="email" required type="email" />
          </Field>
          <Field label={tt('Username')}>
            <TextInput defaultValue={user.username ?? ''} name="username" />
          </Field>
          <Field label={tt('Realm access')}>
            <SelectInput defaultValue={hasRealmAdminAccess(user.role) ? 'admin' : 'user'} name="realmAccess">
              <option value="user">{tt('User')}</option>
              <option value="admin">{tt('Realm administrator')}</option>
            </SelectInput>
          </Field>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <SheetFooter className="shrink-0">
          <Button onClick={onClose} variant="outline">
            {tt('Cancel')}
          </Button>
          <Button disabled={pending} form="user-edit" type="submit">
            {pending ? tt('Saving…') : tt('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function Section({ children, description, title }: { children: ReactNode; description: string; title: string }) {
  return (
    <section className="detailSection">
      <header>
        <div>
          <h2>{tt(title)}</h2>
          <p>{tt(description)}</p>
        </div>
      </header>
      <div className="detailFlatRows">{children}</div>
    </section>
  )
}
function DetailRow({
  action,
  description,
  label,
  value,
}: {
  action?: ReactNode
  description?: string
  label: string
  value: ReactNode
}) {
  return (
    <div className="detailFlatRow">
      <div>
        <strong>{tt(label)}</strong>
        {description ? <span>{tt(description)}</span> : null}
      </div>
      <span>{value}</span>
      {action ?? <i />}
    </div>
  )
}

function browserLabel(userAgent: string | null) {
  if (!userAgent) return tt('Unknown browser')
  const browser = userAgent.includes('Firefox/')
    ? 'Firefox'
    : userAgent.includes('Edg/')
      ? 'Microsoft Edge'
      : userAgent.includes('Chrome/') || userAgent.includes('HeadlessChrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : tt('Browser')
  const platform = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : userAgent.includes('Mac OS X')
      ? 'macOS'
      : userAgent.includes('Windows')
        ? 'Windows'
        : userAgent.includes('Android')
          ? 'Android'
          : userAgent.includes('Linux')
            ? 'Linux'
            : null
  return platform ? `${browser} · ${platform}` : browser
}

function identityProviderLabel(providerId: string) {
  if (providerId === 'credential') return tt('Password')
  return providerId
}
