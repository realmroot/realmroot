import { createTestDeps } from '@server/http/test-deps'
import { validateDpopResourceProof, validateDpopTokenProof } from '@server/usecases/dpop'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const endpoint = 'https://auth.example.com/api/auth/oauth2/token'
const resourceUrl = 'https://auth.example.com/api/users?limit=20#ignored'

describe('DPoP proof validation', () => {
  it('accepts token and Resource proofs and consumes each identifier once', async () => {
    const deps = createTestDeps()
    const key = await proofKey()
    const tokenProof = await signProof(key, { htm: 'POST', htu: endpoint })
    const thumbprint = await calculateJwkThumbprint(key.publicJwk)

    await expect(validateDpopTokenProof(deps, tokenProof, endpoint)).resolves.toBe(thumbprint)
    const accessToken = 'short-lived-access-token'
    const resourceProof = await signProof(key, {
      htm: 'GET',
      htu: 'https://auth.example.com/api/users',
      ath: await hash(accessToken),
    })
    await expect(
      validateDpopResourceProof(deps, {
        proof: resourceProof,
        accessToken,
        method: 'get',
        url: resourceUrl,
        confirmationJkt: thumbprint,
      }),
    ).resolves.toBeUndefined()
    expect(deps.agentTokens.consumeDpopJti).toHaveBeenCalledTimes(2)
  })

  it('normalizes query and fragment from the token endpoint htu comparison', async () => {
    const deps = createTestDeps()
    const key = await proofKey()
    const proof = await signProof(key, { htm: 'POST', htu: endpoint })

    await expect(validateDpopTokenProof(deps, proof, `${endpoint}?attempt=1#fragment`)).resolves.toBe(
      await calculateJwkThumbprint(key.publicJwk),
    )
    await expect(
      validateDpopTokenProof(
        deps,
        await signProof(key, { htm: 'POST', htu: `${endpoint}?attempt=1` }),
        `${endpoint}?attempt=1`,
      ),
    ).rejects.toThrow('not bound to the target token endpoint')
  })

  it('propagates an unknown token-endpoint replay-store failure while keeping a known proof failure at 400', async () => {
    const key = await proofKey()
    const storageFailure = new Error('D1 replay store unavailable')
    const unavailable = createTestDeps()
    vi.mocked(unavailable.agentTokens.consumeDpopJti).mockRejectedValue(storageFailure)

    await expect(
      validateDpopTokenProof(unavailable, await signProof(key, { htm: 'POST', htu: endpoint }), endpoint),
    ).rejects.toBe(storageFailure)

    const replayed = createTestDeps()
    vi.mocked(replayed.agentTokens.consumeDpopJti).mockResolvedValue(false)
    await expect(
      validateDpopTokenProof(replayed, await signProof(key, { htm: 'POST', htu: endpoint }), endpoint),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects malformed, private-key, unsupported, and invalid-signature proofs', async () => {
    const deps = createTestDeps()
    await expect(validateDpopTokenProof(deps, 'not-a-jwt', endpoint)).rejects.toThrow('malformed')

    const key = await proofKey()
    const privateJwk = await exportJWK(key.privateKey)
    await expect(
      validateDpopTokenProof(deps, await signProof(key, { htm: 'POST', htu: endpoint }, { jwk: privateJwk }), endpoint),
    ).rejects.toThrow('public-key')
    await expect(
      validateDpopTokenProof(deps, await signProof(key, { htm: 'POST', htu: endpoint }, { typ: 'JWT' }), endpoint),
    ).rejects.toThrow('public-key')
    const missingJwk = await new SignJWT(claims({ htm: 'POST', htu: endpoint }))
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256' })
      .sign(key.privateKey)
    await expect(validateDpopTokenProof(deps, missingJwk, endpoint)).rejects.toThrow('public-key')

    const edKeyPair = await generateKeyPair('EdDSA', { extractable: true })
    const edPublicJwk = await exportJWK(edKeyPair.publicKey)
    const edProof = await new SignJWT(claims({ htm: 'POST', htu: endpoint }))
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'EdDSA', jwk: edPublicJwk })
      .sign(edKeyPair.privateKey)
    await expect(validateDpopTokenProof(deps, edProof, endpoint)).resolves.toBe(
      await calculateJwkThumbprint(edPublicJwk),
    )

    const other = await proofKey()
    const forged = await new SignJWT(claims({ htm: 'POST', htu: endpoint }))
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk })
      .sign(other.privateKey)
    await expect(validateDpopTokenProof(deps, forged, endpoint)).rejects.toThrow('signature is invalid')
  })

  it('enforces target, token, key, time, identifier, and replay bindings', async () => {
    const deps = createTestDeps()
    const key = await proofKey()
    const thumbprint = await calculateJwkThumbprint(key.publicJwk)

    await expect(
      validateDpopTokenProof(deps, await signProof(key, { htm: 'GET', htu: endpoint }), endpoint),
    ).rejects.toThrow('target token endpoint')
    await expect(
      validateDpopTokenProof(deps, await signProof(key, { htm: 'POST', htu: endpoint, jti: undefined }), endpoint),
    ).rejects.toThrow('target token endpoint')
    await expect(
      validateDpopTokenProof(deps, await signProof(key, { htm: 'POST', htu: endpoint, iat: undefined }), endpoint),
    ).rejects.toThrow('time window')
    await expect(
      validateDpopTokenProof(
        deps,
        await signProof(key, { htm: 'POST', htu: endpoint, iat: Math.floor(Date.now() / 1000) - 301 }),
        endpoint,
      ),
    ).rejects.toThrow('time window')
    await expect(
      validateDpopTokenProof(
        deps,
        await signProof(key, { htm: 'POST', htu: endpoint, iat: Math.floor(Date.now() / 1000) + 301 }),
        endpoint,
      ),
    ).rejects.toThrow('time window')

    const accessToken = 'access-token'
    const base = { htm: 'GET', htu: 'https://auth.example.com/api/users', ath: await hash(accessToken) }
    await expect(
      validateDpopResourceProof(deps, {
        proof: await signProof(key, base),
        accessToken,
        method: 'GET',
        url: resourceUrl,
        confirmationJkt: 'another-key',
      }),
    ).rejects.toThrow('key does not match')
    await expect(
      validateDpopResourceProof(deps, {
        proof: await signProof(key, { ...base, htm: 'POST' }),
        accessToken,
        method: 'GET',
        url: resourceUrl,
        confirmationJkt: thumbprint,
      }),
    ).rejects.toThrow('not bound to this request')
    await expect(
      validateDpopResourceProof(deps, {
        proof: await signProof(key, { ...base, ath: 'wrong' }),
        accessToken,
        method: 'GET',
        url: resourceUrl,
        confirmationJkt: thumbprint,
      }),
    ).rejects.toThrow('not bound to the access token')

    vi.mocked(deps.agentTokens.consumeDpopJti).mockResolvedValueOnce(false)
    await expect(
      validateDpopResourceProof(deps, {
        proof: await signProof(key, base),
        accessToken,
        method: 'GET',
        url: resourceUrl,
        confirmationJkt: thumbprint,
      }),
    ).rejects.toThrow('already used')
  })
})

async function proofKey() {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  return { privateKey, publicJwk: await exportJWK(publicKey) }
}

function claims(overrides: Record<string, unknown>) {
  return {
    htm: 'POST',
    htu: endpoint,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    ...overrides,
  }
}

async function signProof(
  key: Awaited<ReturnType<typeof proofKey>>,
  overrides: Record<string, unknown>,
  header: { typ?: string; jwk?: JWK } = {},
) {
  return new SignJWT(claims(overrides))
    .setProtectedHeader({ typ: header.typ ?? 'dpop+jwt', alg: 'ES256', jwk: header.jwk ?? key.publicJwk })
    .sign(key.privateKey)
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(digest).toString('base64url')
}
