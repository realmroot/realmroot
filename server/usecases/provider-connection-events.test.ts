import { createTestDeps } from '@server/http/test-deps'
import { applyProviderConnectionEvent } from '@server/usecases/provider-connection-events'
import type { ProviderConnectionEvent } from '@shared/api/external-resources'
import { describe, expect, it, vi } from 'vitest'

const now = new Date('2026-08-08T20:00:00.000Z')
const resource = 'https://adapter.example.com/github'
const authorityDetail = { type: 'provider_installation', installation_id: 'installation-1' }
const event: ProviderConnectionEvent = {
  type: 'authorityChanged',
  brokerReference: 'installation-1',
  occurredAt: '2026-08-08T19:59:00.000Z',
  revision: 1,
  scopes: ['contents:read'],
  affectedScopes: ['contents:read'],
  affectedAuthorizationDetails: [authorityDetail],
  authorityConstraints: [{ authorizationDetails: [authorityDetail], scopes: ['contents:read'] }],
}

describe('Provider Connection Events', () => {
  it('persists connection-wide and affected-authority scopes independently', async () => {
    const deps = createTestDeps()

    await applyProviderConnectionEvent(deps, 'delivery-1', resource, event, raw('{}'), now)
    await applyProviderConnectionEvent(
      deps,
      'delivery-2',
      resource,
      {
        ...event,
        scopes: ['contents:read', 'issues:write'],
        affectedScopes: [],
        affectedAuthorizationDetails: [authorityDetail],
        authorityConstraints: [{ authorizationDetails: [authorityDetail], scopes: [] }],
      },
      raw('{"scopes":["contents:read"]}'),
      now,
    )

    expect(deps.externalResources.applyProviderConnectionEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        affectedScopes: ['contents:read'],
        affectedAuthorizationDetails: [{ type: 'provider_installation', installation_id: 'installation-1' }],
      }),
    )
    expect(deps.externalResources.applyProviderConnectionEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'delivery-2',
        revision: 1,
        scopes: ['contents:read', 'issues:write'],
        affectedScopes: [],
        affectedAuthorizationDetails: [{ type: 'provider_installation', installation_id: 'installation-1' }],
      }),
    )
  })

  it('maps resource snapshots and status-only events to their repository variants', async () => {
    const deps = createTestDeps()
    const authorizationDetails = [{ type: 'provider_repository', repository_id: 'repository-1' }]

    await applyProviderConnectionEvent(
      deps,
      'delivery-1',
      resource,
      {
        type: 'resourcesChanged',
        brokerReference: event.brokerReference,
        occurredAt: event.occurredAt,
        revision: event.revision,
        scopes: ['contents:read'],
        authorizationDetails,
        authorityConstraints: [{ authorizationDetails, scopes: ['contents:read'] }],
      },
      raw('{}'),
      now,
    )
    await applyProviderConnectionEvent(
      deps,
      'delivery-3',
      resource,
      {
        type: 'restored',
        brokerReference: event.brokerReference,
        occurredAt: event.occurredAt,
        revision: event.revision,
        scopes: ['contents:read'],
        authorizationDetails,
        authorityConstraints: [{ authorizationDetails, scopes: ['contents:read'] }],
      },
      raw('{}'),
      now,
    )
    await applyProviderConnectionEvent(
      deps,
      'delivery-2',
      resource,
      {
        type: 'suspended',
        brokerReference: event.brokerReference,
        occurredAt: event.occurredAt,
        revision: event.revision,
      },
      raw('{}'),
      now,
    )

    expect(deps.externalResources.applyProviderConnectionEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'resourcesChanged', authorizationDetails }),
    )
    expect(deps.externalResources.applyProviderConnectionEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'restored', authorizationDetails }),
    )
    expect(deps.externalResources.applyProviderConnectionEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ type: 'suspended' }),
    )
  })

  it('rejects events dated more than five minutes in the future before persistence', async () => {
    const deps = createTestDeps()

    await expect(
      applyProviderConnectionEvent(
        deps,
        'delivery-1',
        resource,
        { ...event, occurredAt: '2026-08-08T20:05:00.001Z' },
        raw('{}'),
        now,
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(deps.externalResources.applyProviderConnectionEvent).not.toHaveBeenCalled()
  })

  it('rejects authority scopes that disagree with the persisted authority constraints', async () => {
    const deps = createTestDeps()

    await expect(
      applyProviderConnectionEvent(
        deps,
        'delivery-1',
        resource,
        { ...event, affectedScopes: ['contents:read', 'issues:write'] },
        raw('{}'),
        now,
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      applyProviderConnectionEvent(
        deps,
        'delivery-2',
        resource,
        {
          ...event,
          scopes: ['contents:read'],
          authorityConstraints: [{ authorizationDetails: [authorityDetail], scopes: ['issues:write'] }],
        },
        raw('{}'),
        now,
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(deps.externalResources.applyProviderConnectionEvent).not.toHaveBeenCalled()
  })

  it.each([
    'resourcesChanged',
    'restored',
  ] as const)('rejects a %s snapshot whose authority constraints do not cover every authorization detail', async (type) => {
    const deps = createTestDeps()
    const authorizationDetails = [{ type: 'provider_repository', repository_id: 'repository-1' }]

    await expect(
      applyProviderConnectionEvent(
        deps,
        'delivery-1',
        resource,
        {
          type,
          brokerReference: event.brokerReference,
          occurredAt: event.occurredAt,
          revision: event.revision,
          scopes: ['contents:read'],
          authorizationDetails,
          authorityConstraints: [
            {
              authorizationDetails: [{ type: 'provider_repository', repository_id: 'repository-2' }],
              scopes: ['contents:read'],
            },
          ],
        },
        raw('{}'),
        now,
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(deps.externalResources.applyProviderConnectionEvent).not.toHaveBeenCalled()
  })

  it('matches nested array and null authorization-detail selectors', async () => {
    const deps = createTestDeps()
    const authorizationDetails = [
      {
        type: 'provider_repository_set',
        owner: null,
        repositories: [{ id: 'repository-1' }],
      },
    ]

    await applyProviderConnectionEvent(
      deps,
      'delivery-1',
      resource,
      {
        type: 'resourcesChanged',
        brokerReference: event.brokerReference,
        occurredAt: event.occurredAt,
        revision: event.revision,
        scopes: ['contents:read'],
        authorizationDetails,
        authorityConstraints: [
          {
            authorizationDetails: [
              {
                type: 'provider_repository_set',
                owner: null,
                repositories: [{ id: 'repository-other' }, { id: 'repository-1' }],
              },
            ],
            scopes: ['contents:read'],
          },
        ],
      },
      raw('{}'),
      now,
    )

    expect(deps.externalResources.applyProviderConnectionEvent).toHaveBeenCalledOnce()
  })

  it.each([
    ['conflict', 409],
    ['not_found', 404],
  ] as const)('maps a %s repository result to HTTP %i', async (result, status) => {
    const deps = createTestDeps()
    vi.mocked(deps.externalResources.applyProviderConnectionEvent).mockResolvedValue(result)

    await expect(
      applyProviderConnectionEvent(deps, 'delivery-1', resource, event, raw('{}'), now),
    ).rejects.toMatchObject({
      status,
    })
  })
})

function raw(value: string) {
  return new TextEncoder().encode(value)
}
