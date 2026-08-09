import { badRequest, conflict, notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { ProviderConnectionEvent } from '@shared/api/external-resources'

export async function applyProviderConnectionEvent(
  deps: Deps,
  id: string,
  event: ProviderConnectionEvent,
  rawBody: Uint8Array<ArrayBuffer>,
  now = new Date(),
) {
  const occurredAt = new Date(event.occurredAt)
  if (occurredAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw badRequest('Connection Event occurredAt cannot be more than five minutes in the future.')
  }
  const result = await deps.externalResources.applyProviderConnectionEvent({
    id,
    fingerprint: await sha256(rawBody),
    resource: event.resource,
    brokerReference: event.brokerReference,
    type: event.type,
    occurredAt,
    revision: event.revision,
    receivedAt: now,
    ...(event.scopes ? { scopes: event.scopes } : {}),
    ...(event.authorizationDetails ? { authorizationDetails: event.authorizationDetails } : {}),
    ...(event.affectedAuthorizationDetails ? { affectedAuthorizationDetails: event.affectedAuthorizationDetails } : {}),
  })
  if (result === 'conflict') throw conflict('Connection Event identity was already used for another representation.')
  if (result === 'not_found') throw notFound('The Connection referenced by this event was not found.')
}

async function sha256(value: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
