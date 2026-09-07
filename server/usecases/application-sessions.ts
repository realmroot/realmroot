import { notFound } from '@server/domain/errors'
import { type PaginationInput, paginationMetadata } from '@shared/api/pagination'
import type { Deps } from './deps'

export async function listApplicationSessions(deps: Deps, userId: string, clientId: string, page: PaginationInput) {
  const application = await deps.applications.findByClientId(clientId)
  if (!application) throw notFound('Application was not found.')
  const sessions = await deps.applicationSessions.list(userId, clientId, page)
  return {
    application: { clientId: application.clientId!, name: application.name },
    items: sessions.items,
    pagination: paginationMetadata(sessions),
  }
}

export async function revokeApplicationSession(deps: Deps, userId: string, clientId: string, sessionId: string) {
  if (!(await deps.applicationSessions.revoke(userId, clientId, sessionId))) {
    throw notFound('Application login session was not found.')
  }
}
