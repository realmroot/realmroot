import { createTestDeps } from '@server/http/test-deps'
import { applyProviderConnectionEvent } from '@server/usecases/provider-connection-events'
import type { ProviderConnectionEvent } from '@shared/api/external-resources'
import { describe, expect, it, vi } from 'vitest'

const now = new Date('2026-08-08T20:00:00.000Z')
const event: ProviderConnectionEvent = {
  type: 'authorityChanged',
  resource: 'https://adapter.example.com/github',
  brokerReference: 'installation-1',
  occurredAt: '2026-08-08T19:59:00.000Z',
  revision: 1,
}

describe('Provider Connection Events', () => {
  it('persists the event identity and includes optional authority constraints only when supplied', async () => {
    const deps = createTestDeps()

    await applyProviderConnectionEvent(deps, 'delivery-1', event, raw('{}'), now)
    await applyProviderConnectionEvent(
      deps,
      'delivery-2',
      {
        ...event,
        scopes: ['contents:read'],
        authorizationDetails: [{ type: 'provider_installation', resource_ids: ['repository-1'] }],
        affectedAuthorizationDetails: [{ type: 'provider_installation', installation_id: 'installation-1' }],
      },
      raw('{"scopes":["contents:read"]}'),
      now,
    )

    expect(deps.externalResources.applyProviderConnectionEvent).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({ scopes: expect.anything(), authorizationDetails: expect.anything() }),
    )
    expect(deps.externalResources.applyProviderConnectionEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'delivery-2',
        revision: 1,
        scopes: ['contents:read'],
        authorizationDetails: [{ type: 'provider_installation', resource_ids: ['repository-1'] }],
        affectedAuthorizationDetails: [{ type: 'provider_installation', installation_id: 'installation-1' }],
      }),
    )
  })

  it('rejects events dated more than five minutes in the future before persistence', async () => {
    const deps = createTestDeps()

    await expect(
      applyProviderConnectionEvent(
        deps,
        'delivery-1',
        { ...event, occurredAt: '2026-08-08T20:05:00.001Z' },
        raw('{}'),
        now,
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(deps.externalResources.applyProviderConnectionEvent).not.toHaveBeenCalled()
  })

  it.each([
    ['conflict', 409],
    ['not_found', 404],
  ] as const)('maps a %s repository result to HTTP %i', async (result, status) => {
    const deps = createTestDeps()
    vi.mocked(deps.externalResources.applyProviderConnectionEvent).mockResolvedValue(result)

    await expect(applyProviderConnectionEvent(deps, 'delivery-1', event, raw('{}'), now)).rejects.toMatchObject({
      status,
    })
  })
})

function raw(value: string) {
  return new TextEncoder().encode(value)
}
