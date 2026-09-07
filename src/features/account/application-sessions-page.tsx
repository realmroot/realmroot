import type { ApplicationSession } from '@shared/api/application-sessions'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { DestructiveConfirmation } from '@/components/destructive-confirmation'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { listApplicationSessions, removeApplicationSession } from '@/lib/api/account'
import { tt } from '@/lib/i18n'
import { AccountEmptyState, AccountObjectSection, AccountPageHeader, AccountRow, AccountRows } from './account-page'
import { useAccountCenterLayout } from './account-surface'
import { readAccountTimeZone } from './utils'

export function ApplicationSessionsPage({ clientId }: { clientId: string }) {
  const { profile, accountCenter } = useAccountCenterLayout()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ApplicationSession | null>(null)
  const [removed, setRemoved] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const queryKey = ['account', 'application-sessions', profile.id, clientId]
  const sessions = useQuery({
    queryKey: [...queryKey, page],
    queryFn: () => listApplicationSessions(clientId, page),
    enabled: Boolean(clientId) && accountCenter.sessionsViewEnabled,
  })
  const remove = useMutation({
    mutationFn: (item: ApplicationSession) => removeApplicationSession(clientId, item.id),
    onSuccess: async () => {
      setSelected(null)
      setRemoved(true)
      if (sessions.data?.items.length === 1 && page > 1) setPage(page - 1)
      await queryClient.invalidateQueries({ queryKey })
      resultRef.current?.focus()
    },
  })
  const data = sessions.data
  return (
    <div className="space-y-6">
      <AccountPageHeader
        title={tt('Application devices')}
        description={tt(
          'Manage signed-in app installations. Logins without an installation ID appear separately as unidentified sessions.',
        )}
      />
      <AccountObjectSection
        surface
        title={tt('Managing account')}
        description={tt('This is the account signed in to this browser. It may differ from the account in your app.')}
      >
        <AccountRows>
          <AccountRow label={profile.displayName} value={profile.email} />
        </AccountRows>
      </AccountObjectSection>
      {!clientId ? <Status tone="error">{tt('Open this page from an application with a client_id.')}</Status> : null}
      {!accountCenter.sessionsViewEnabled ? (
        <Status tone="error">{tt('Session management is disabled for this account center.')}</Status>
      ) : null}
      {sessions.isPending && sessions.fetchStatus === 'fetching' ? (
        <Status>{tt('Loading application sessions…')}</Status>
      ) : null}
      {sessions.error ? (
        <Status tone="error">
          {sessions.error.message}{' '}
          <Button onClick={() => void sessions.refetch()} variant="outline">
            {tt('Retry')}
          </Button>
        </Status>
      ) : null}
      <div aria-live="polite" ref={resultRef} tabIndex={-1}>
        {removed ? (
          <Status>{tt('Login session removed. Existing access tokens may still work until they expire.')}</Status>
        ) : null}
      </div>
      {data ? (
        <AccountObjectSection
          surface
          title={data.application.name}
          description={tt('{{devices}} devices · {{sessions}} unidentified sessions', {
            devices: data.summary.devices,
            sessions: data.summary.unidentifiedSessions,
          })}
        >
          <div className="space-y-3 px-5 py-4">
            <p className="break-all text-sm text-muted-foreground">
              {tt('Application ID')}: {data.application.clientId}
            </p>
            <p className="text-sm text-muted-foreground">
              {tt(
                'Removing a session stops credential refresh. Access tokens already issued remain valid for up to 1 hour, plus any clock tolerance used by the resource server. Signing in again is still allowed.',
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {tt(
                'Device names and platforms are reported by the app. Last activity means the latest login or credential refresh, not app usage.',
              )}
            </p>
          </div>
          <AccountRows>
            {data.items.map((item) => (
              <AccountRow
                key={item.id}
                label={`${item.identified ? item.deviceName || tt('Unnamed device') : tt('Unidentified session')} · ${item.id.slice(-8)}`}
                description={
                  item.identified
                    ? item.devicePlatform || tt('Platform unavailable')
                    : tt('This app did not provide an installation ID.')
                }
                value={
                  <>
                    <span>
                      {tt('Signed in')}: {formatSessionTime(item.createdAt)}
                    </span>
                    <br />
                    <span>
                      {tt('Last activity')}: {formatSessionTime(item.lastActiveAt)}
                    </span>
                    {item.userAgent ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer">{tt('Client information')}</summary>
                        <p className="break-all text-xs">{item.userAgent}</p>
                      </details>
                    ) : null}
                  </>
                }
                action={
                  <Button
                    disabled={remove.isPending || sessions.isFetching}
                    variant="outline"
                    onClick={() => {
                      remove.reset()
                      setSelected(item)
                    }}
                  >
                    {tt(item.identified ? 'Remove device' : 'Remove session')}
                  </Button>
                }
              />
            ))}
            {!data.items.length ? (
              <AccountEmptyState
                title={tt('No active login sessions')}
                description={tt('Logins with valid refresh authorization will appear here.')}
              />
            ) : null}
          </AccountRows>
          {data.pagination.totalPages > 1 || page > 1 ? (
            <nav aria-label={tt('Login session pages')} className="flex items-center justify-between gap-3 p-4">
              <Button disabled={page === 1 || sessions.isFetching} onClick={() => setPage(page - 1)} variant="outline">
                {tt('Previous')}
              </Button>
              <span>{tt('Page {{page}} of {{total}}', { page, total: data.pagination.totalPages })}</span>
              <Button
                disabled={page >= data.pagination.totalPages || sessions.isFetching}
                onClick={() => setPage(page + 1)}
                variant="outline"
              >
                {tt('Next')}
              </Button>
            </nav>
          ) : null}
        </AccountObjectSection>
      ) : null}
      <DestructiveConfirmation
        open={Boolean(selected)}
        title={tt(selected?.identified ? 'Remove this device?' : 'Remove this login session?')}
        description={tt(
          'This login will no longer be able to refresh credentials. Other devices and applications remain signed in. Local files are not deleted.',
        )}
        confirmLabel={tt(selected?.identified ? 'Remove device' : 'Remove session')}
        cancelLabel={tt('Cancel')}
        pending={remove.isPending}
        error={remove.error ? <Status tone="error">{remove.error.message}</Status> : undefined}
        onClose={() => setSelected(null)}
        onConfirm={() => {
          if (selected) remove.mutate(selected)
        }}
      />
    </div>
  )
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'long',
    timeZone: readAccountTimeZone(),
  }).format(new Date(value))
}
