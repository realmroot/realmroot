import { forbidden } from '@server/domain/errors'
import type { Deps } from './deps'
import { revokeDeletedAccountConnection, revokeDeletedAccountLease } from './external-resources'
import { publishWebhookEvent } from './webhooks'

export async function deleteAccount(deps: Deps, userId: string) {
  await deps.accountDeletion.erase(userId, Date.now())
}

export function assertDeletionAuthentication(
  session: { createdAt: Date | string; impersonatedBy?: string | null } | null,
) {
  if (
    !session ||
    session.impersonatedBy ||
    Date.now() - new Date(session.createdAt).getTime() > 5 * 60_000 ||
    !Number.isFinite(new Date(session.createdAt).getTime())
  ) {
    throw forbidden('Sign in again before deleting your account. A sign-in within five minutes is required.')
  }
}

// Bounded work per invocation; jobs survive both process crashes and upstream outages.
export async function processAccountDeletionCleanup(deps: Deps) {
  const failures: unknown[] = []
  const cleanupDeps = {
    ...deps,
    externalHttp: {
      fetch: (request: Request) =>
        deps.externalHttp.fetch(new Request(request, { signal: AbortSignal.timeout(15_000) })),
    },
  }
  for (let index = 0; index < 10; index++) {
    const job = await deps.accountDeletion.claim(Date.now(), deps.ids.generate())
    if (!job) break
    try {
      const errors: unknown[] = []
      const attempt = async (operation: () => Promise<unknown>) => {
        try {
          await operation()
        } catch (cause) {
          errors.push(cause)
        }
      }
      // One unavailable provider must not prevent file erasure or other revocations.
      for (const key of job.assetKeys) await attempt(() => deps.assetStorage.delete(key))
      for (const id of await deps.accountDeletion.pendingLeases(job.userId)) {
        await attempt(async () => {
          await revokeDeletedAccountLease(cleanupDeps, id)
          await deps.accountDeletion.clearLease(id)
        })
      }
      for (const id of await deps.accountDeletion.pendingConnections(job.userId)) {
        await attempt(async () => {
          await revokeDeletedAccountConnection(cleanupDeps, id)
          await deps.accountDeletion.clearConnection(id)
        })
      }
      if (errors.length) throw new AggregateError(errors, 'External account cleanup is incomplete.')
      await publishWebhookEvent(
        cleanupDeps,
        'user.deleted',
        { user: { id: job.userId } },
        job.organizationIds,
        job.userId,
      )
      await deps.accountDeletion.finish(job)
    } catch (cause) {
      // Persist retry metadata, not provider responses that could contain personal data.
      await deps.accountDeletion.retry(job, Date.now())
      failures.push(cause)
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `Account deletion cleanup failed for ${failures.length} job(s); durable retries are scheduled.`,
    )
}
