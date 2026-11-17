import { resolveSilentOAuthAuthorizationContext } from '@server/usecases/applications'
import type { Deps } from '@server/usecases/deps'
import type { ApplicationAggregate, ApplicationRepository } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

const contexts = [{ id: 'user:u1' }, { id: 'organization:a' }, { id: 'organization:b' }]
const scopes = ['openid', 'notes:read']
const resources = ['https://api.example.com']

function setUp(input: {
  consentRequired: boolean
  consents?: Awaited<ReturnType<ApplicationRepository['listOAuthContextConsents']>>
  selection?: string | null
}) {
  const applications = {
    listOAuthContextConsents: vi.fn().mockResolvedValue(input.consents ?? []),
  }
  const deps = { applications } as unknown as Deps
  const application = { clientId: 'client-1', consentRequired: input.consentRequired } as ApplicationAggregate
  return {
    applications,
    resolve: () =>
      resolveSilentOAuthAuthorizationContext(deps, application, contexts, 'u1', {
        scopes,
        resources,
        remembered: input.selection ?? null,
      }),
  }
}

const covering = (referenceId: string) => ({
  referenceId,
  scopes: ['openid', 'notes:read', 'profile'],
  resources: ['https://api.example.com'],
})

describe('[spec: hosted-auth/oauth-silent-authorization-context] silent authorization Context', () => {
  it('uses the only Context whose consent covers the request', async () => {
    const flow = setUp({
      consentRequired: true,
      consents: [
        covering('organization:a'),
        { ...covering('organization:b'), scopes: ['openid'] },
        { ...covering('user:u1'), resources: [] },
      ],
    })
    await expect(flow.resolve()).resolves.toEqual({ contextId: 'organization:a' })
    expect(flow.applications.listOAuthContextConsents).toHaveBeenCalledWith('client-1', 'u1', [
      'user:u1',
      'organization:a',
      'organization:b',
    ])
  })

  it('needs consent when no Context covers the request', async () => {
    const flow = setUp({ consentRequired: true, consents: [{ ...covering('organization:a'), scopes: ['openid'] }] })
    await expect(flow.resolve()).resolves.toEqual({ error: 'consent_required' })
  })

  it('uses the remembered Context among several covering Contexts', async () => {
    const flow = setUp({
      consentRequired: true,
      consents: [covering('organization:a'), covering('organization:b')],
      selection: 'organization:b',
    })
    await expect(flow.resolve()).resolves.toEqual({ contextId: 'organization:b' })
  })

  it('needs the User when the remembered Context does not cover the request', async () => {
    const flow = setUp({
      consentRequired: true,
      consents: [covering('organization:a'), covering('organization:b')],
      selection: 'user:u1',
    })
    await expect(flow.resolve()).resolves.toEqual({ error: 'interaction_required' })
  })

  it('treats every Context as eligible for an Application without a consent step', async () => {
    const remembered = setUp({ consentRequired: false, selection: 'user:u1' })
    await expect(remembered.resolve()).resolves.toEqual({ contextId: 'user:u1' })
    expect(remembered.applications.listOAuthContextConsents).not.toHaveBeenCalled()

    const unknown = setUp({ consentRequired: false })
    await expect(unknown.resolve()).resolves.toEqual({ error: 'interaction_required' })
  })
})
