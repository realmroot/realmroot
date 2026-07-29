import { issueAgentAccessToken } from '@server/usecases/agent-tokens'
import type { Deps } from '@server/usecases/deps'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const tokenIssuer = 'https://auth.example.com/api/auth'
const signer = { issuer: tokenIssuer, sign: vi.fn().mockResolvedValue('signed-agent-token') }

describe('Agent token profile', () => {
  it('issues an Agent-subject, host-actor DPoP token [spec: agent-identity/agent-autonomous-authority]', async () => {
    const deps = await tokenDeps('autonomous')
    const request = await tokenRequest('autonomous-proof')

    const response = await issueAgentAccessToken(deps, request, { grantId: 'grant-1' }, session(), signer)

    expect(response).toMatchObject({ token_type: 'DPoP', expires_in: 300, scope: 'repo:read repo:write' })
    expect(deps.agentTokens.storeAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectIssuer: tokenIssuer,
        subject: 'agt_stable',
        audience: 'https://api.example.com',
        scopes: ['repo:read', 'repo:write'],
        actor: {
          iss: tokenIssuer,
          sub: 'host-1',
          actor_type: 'host',
        },
      }),
    )
  })

  it('issues an owner-subject token with Agent and host actor chain [spec: agent-identity/agent-delegated-authority]', async () => {
    const deps = await tokenDeps('delegated')
    const request = await tokenRequest('delegated-proof')

    await issueAgentAccessToken(deps, request, { grantId: 'grant-1', scope: 'repo:read' }, session(), signer)

    expect(deps.agentTokens.storeAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'user-1',
        scopes: ['repo:read'],
        actor: {
          iss: tokenIssuer,
          sub: 'host-1',
          actor_type: 'host',
          act: { iss: tokenIssuer, sub: 'agt_stable', actor_type: 'agent' },
        },
      }),
    )
  })

  it('rejects replayed DPoP proofs and scope escalation', async () => {
    const replayDeps = await tokenDeps('autonomous')
    replayDeps.agentTokens.consumeDpopJti.mockResolvedValue(false)
    await expect(
      issueAgentAccessToken(replayDeps, await tokenRequest('replay'), { grantId: 'grant-1' }, session(), signer),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_dpop_proof' })

    const scopeDeps = await tokenDeps('autonomous')
    await expect(
      issueAgentAccessToken(
        scopeDeps,
        await tokenRequest('scope'),
        { grantId: 'grant-1', scope: 'admin' },
        session(),
        signer,
      ),
    ).rejects.toMatchObject({ status: 400, error: 'invalid_scope' })
    expect(scopeDeps.agentTokens.consumeDpopJti).not.toHaveBeenCalled()
  })
})

async function tokenDeps(mode: 'autonomous' | 'delegated') {
  return {
    agentIdentities: {
      findActiveByProtocolAgent: vi.fn().mockResolvedValue({
        identity: {
          id: 'identity-1',
          issuer: tokenIssuer,
          subject: 'agt_stable',
          name: 'Agent',
          ownerUserId: 'user-1',
          ownerOrganizationId: null,
          status: 'active',
        },
        bindings: [
          {
            id: 'binding-1',
            protocolAgentId: 'protocol-agent-1',
            hostId: 'host-1',
            status: 'active',
          },
        ],
      }),
    },
    agentTokens: {
      findGrant: vi.fn().mockResolvedValue({
        id: 'grant-1',
        agentIdentityId: 'identity-1',
        mode,
        subjectType: mode === 'autonomous' ? 'agent' : 'user',
        subjectId: mode === 'autonomous' ? 'agt_stable' : 'user-1',
        audience: 'https://api.example.com',
        scopes: ['repo:read', 'repo:write'],
        constraints: null,
        status: 'active',
        expiresAt: null,
      }),
      consumeDpopJti: vi.fn().mockResolvedValue(true),
      storeAccessToken: vi.fn(),
    },
  } as unknown as Deps & {
    agentTokens: {
      findGrant: ReturnType<typeof vi.fn>
      consumeDpopJti: ReturnType<typeof vi.fn>
      storeAccessToken: ReturnType<typeof vi.fn>
    }
  }
}

function session() {
  return {
    agentId: 'protocol-agent-1',
    agent: { id: 'protocol-agent-1', hostId: 'host-1', mode: 'delegated' },
    host: { id: 'host-1', userId: 'user-1', status: 'active' },
  }
}

async function tokenRequest(jti: string) {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  const url = 'https://auth.example.com/api/auth/oauth2/token'
  const proof = await new SignJWT({
    jti,
    htm: 'POST',
    htu: url,
    iat: Math.floor(Date.now() / 1000),
  })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk })
    .sign(privateKey)
  return new Request(url, { method: 'POST', headers: { dpop: proof } })
}
