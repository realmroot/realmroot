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
  if (event.type === 'authorityChanged' || event.type === 'resourcesChanged' || event.type === 'restored') {
    validateConstraintScopes(event.scopes, event.authorityConstraints)
  }
  if (event.type === 'resourcesChanged' || event.type === 'restored') {
    validateConstraintCoverage(event.authorizationDetails, event.authorityConstraints)
  }
  if (event.type === 'authorityChanged') {
    const resultingScopes = authorityScopes(
      event.scopes,
      event.authorityConstraints,
      event.affectedAuthorizationDetails,
    )
    if (!sameStrings(resultingScopes, event.affectedScopes)) {
      throw badRequest('Connection Event affected scopes do not match its authority constraints.')
    }
  }
  const common = {
    id,
    fingerprint: await sha256(rawBody),
    resource: event.resource,
    brokerReference: event.brokerReference,
    occurredAt,
    revision: event.revision,
    receivedAt: now,
  }
  const result = await deps.externalResources.applyProviderConnectionEvent(
    event.type === 'authorityChanged'
      ? {
          ...common,
          type: event.type,
          scopes: event.scopes,
          affectedScopes: event.affectedScopes,
          affectedAuthorizationDetails: event.affectedAuthorizationDetails,
          authorityConstraints: event.authorityConstraints,
        }
      : event.type === 'resourcesChanged'
        ? {
            ...common,
            type: event.type,
            scopes: event.scopes,
            authorizationDetails: event.authorizationDetails,
            authorityConstraints: event.authorityConstraints,
          }
        : event.type === 'restored'
          ? {
              ...common,
              type: event.type,
              scopes: event.scopes,
              authorizationDetails: event.authorizationDetails,
              authorityConstraints: event.authorityConstraints,
            }
          : { ...common, type: event.type },
  )
  if (result === 'conflict') throw conflict('Connection Event identity was already used for another representation.')
  if (result === 'not_found') throw notFound('The Connection referenced by this event was not found.')
}

function validateConstraintScopes(
  grantedScopes: string[],
  constraints: Extract<ProviderConnectionEvent, { type: 'authorityChanged' }>['authorityConstraints'],
) {
  if (constraints.some((constraint) => constraint.scopes.some((scope) => !grantedScopes.includes(scope)))) {
    throw badRequest('Connection Event authority constraints exceed its connection scopes.')
  }
}

function validateConstraintCoverage(
  authorizationDetails: Extract<ProviderConnectionEvent, { type: 'resourcesChanged' }>['authorizationDetails'],
  constraints: Extract<ProviderConnectionEvent, { type: 'resourcesChanged' }>['authorityConstraints'],
) {
  if (
    authorizationDetails.some(
      (detail) =>
        !constraints.some((constraint) =>
          constraint.authorizationDetails.some((selector) => jsonSelectorCovers(detail, selector)),
        ),
    )
  ) {
    throw badRequest('Connection Event authority constraints do not cover its authorization details.')
  }
}

function authorityScopes(
  grantedScopes: string[],
  constraints: Extract<ProviderConnectionEvent, { type: 'authorityChanged' }>['authorityConstraints'],
  authorizationDetails: Extract<ProviderConnectionEvent, { type: 'authorityChanged' }>['affectedAuthorizationDetails'],
) {
  const scopesByDetail = authorizationDetails.map(
    (detail) =>
      new Set(
        constraints
          .filter((constraint) =>
            constraint.authorizationDetails.some((selector) => jsonSelectorCovers(detail, selector)),
          )
          .flatMap((constraint) => constraint.scopes),
      ),
  )
  if (scopesByDetail.some((scopes) => scopes.size === 0)) return []
  return grantedScopes.filter((scope) => scopesByDetail.every((scopes) => scopes.has(scope)))
}

function jsonSelectorCovers(requested: unknown, selector: unknown): boolean {
  if (requested === null || selector === null) return requested === selector
  if (Array.isArray(requested)) {
    return (
      Array.isArray(selector) &&
      requested.every((item) => selector.some((candidate) => jsonSelectorCovers(item, candidate)))
    )
  }
  if (typeof requested === 'object') {
    if (typeof selector !== 'object' || Array.isArray(selector)) return false
    return Object.entries(requested as Record<string, unknown>).every(([key, value]) =>
      jsonSelectorCovers(value, (selector as Record<string, unknown>)[key]),
    )
  }
  return requested === selector
}

function sameStrings(left: string[], right: string[]) {
  const expected = [...new Set(left)].sort()
  const actual = [...new Set(right)].sort()
  return expected.length === actual.length && expected.every((value, index) => value === actual[index])
}

async function sha256(value: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
