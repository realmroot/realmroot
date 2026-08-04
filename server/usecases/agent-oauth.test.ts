import { createTestDeps } from '@server/http/test-deps'
import { issueAgentBootstrapAccessToken } from '@server/usecases/agent-oauth'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

describe('Agent OAuth token issuance', () => {
  it('exchanges an Agent assertion context for a short-lived DPoP-bound Resource token [spec: management-api/management-standard-agent-oauth]', async () => {
    const deps = createTestDeps()
    const endpoint = 'https://auth.example.com/api/auth/oauth2/token'
    const proof = await dpopProof(endpoint)
    const sign = vi.fn().mockResolvedValue('signed-access-token')

    await expect(
      issueAgentBootstrapAccessToken(
        deps,
        {
          scope: 'agent:read resource-servers:read',
          resource: 'https://auth.example.com/api',
          expectedResource: 'https://auth.example.com/api',
          dpopProof: proof,
          tokenEndpoint: endpoint,
        },
        {
          issuer: 'https://auth.example.com/api/auth',
          subject: 'agt_1',
          identityId: 'identity-1',
          protocolAgentId: 'protocol-agent-1',
          hostId: 'host-1',
        },
        { issuer: 'https://auth.example.com/api/auth', sign },
      ),
    ).resolves.toMatchObject({
      access_token: 'signed-access-token',
      token_type: 'DPoP',
      expires_in: 300,
      scope: 'agent:read resource-servers:read',
    })

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'agt_1',
        aud: 'https://auth.example.com/api',
        client_id: 'protocol-agent-1',
        host_id: 'host-1',
        scope: 'agent:read resource-servers:read',
        cnf: { jkt: expect.any(String) },
      }),
      'at+jwt',
    )
  })

  it('rejects management scopes and another Resource indicator at the bootstrap boundary', async () => {
    const deps = createTestDeps()
    const endpoint = 'https://auth.example.com/api/auth/oauth2/token'
    const signer = { issuer: 'https://auth.example.com/api/auth', sign: vi.fn() }
    const principal = {
      issuer: signer.issuer,
      subject: 'agt_1',
      identityId: 'identity-1',
      protocolAgentId: 'protocol-agent-1',
      hostId: 'host-1',
    }

    await expect(
      issueAgentBootstrapAccessToken(
        deps,
        {
          scope: 'users:read',
          resource: 'https://auth.example.com/api',
          expectedResource: 'https://auth.example.com/api',
          dpopProof: await dpopProof(endpoint),
          tokenEndpoint: endpoint,
        },
        principal,
        signer,
      ),
    ).rejects.toMatchObject({ error: 'invalid_scope' })
    await expect(
      issueAgentBootstrapAccessToken(
        deps,
        {
          scope: 'agent:read',
          resource: 'https://other.example.com/api',
          expectedResource: 'https://auth.example.com/api',
          dpopProof: await dpopProof(endpoint),
          tokenEndpoint: endpoint,
        },
        principal,
        signer,
      ),
    ).rejects.toMatchObject({ error: 'invalid_target' })
  })
})

async function dpopProof(endpoint: string) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const jwk = await exportJWK(publicKey)
  return new SignJWT({ htm: 'POST', htu: endpoint, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk })
    .sign(privateKey)
}
