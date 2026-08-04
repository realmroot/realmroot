import { badRequest, unauthorized } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { calculateJwkThumbprint, compactVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose'

export async function validateDpopTokenProof(deps: Deps, proof: string, tokenEndpoint: string) {
  const { header, payload } = await verifyDpopProof(proof)
  if (payload.htm !== 'POST' || payload.htu !== tokenEndpoint || typeof payload.jti !== 'string') {
    throw badRequest('DPoP proof is not bound to the target token endpoint.')
  }
  const thumbprint = await calculateJwkThumbprint(header.jwk as JWK)
  await consumeProof(deps, payload, thumbprint)
  return thumbprint
}

export async function validateDpopResourceProof(
  deps: Deps,
  input: {
    proof: string
    accessToken: string
    method: string
    url: string
    confirmationJkt: string
  },
) {
  const { header, payload } = await verifyDpopProof(input.proof)
  const thumbprint = await calculateJwkThumbprint(header.jwk as JWK)
  if (thumbprint !== input.confirmationJkt) throw unauthorized('DPoP proof key does not match the access token.')
  const target = new URL(input.url)
  target.hash = ''
  target.search = ''
  if (payload.htm !== input.method.toUpperCase() || payload.htu !== target.toString()) {
    throw unauthorized('DPoP proof is not bound to this request.')
  }
  if (payload.ath !== (await sha256(input.accessToken))) {
    throw unauthorized('DPoP proof is not bound to the access token.')
  }
  await consumeProof(deps, payload, thumbprint)
}

async function verifyDpopProof(proof: string) {
  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(proof)
  } catch {
    throw badRequest('DPoP proof is malformed.')
  }
  const jwk = header.jwk as JWK | undefined
  const supportedKey =
    (header.alg === 'ES256' && jwk?.kty === 'EC' && jwk.crv === 'P-256') ||
    (header.alg === 'EdDSA' && jwk?.kty === 'OKP' && jwk.crv === 'Ed25519')
  if (header.typ?.toLowerCase() !== 'dpop+jwt' || !jwk || !supportedKey || 'd' in jwk) {
    throw badRequest('A public-key DPoP proof is required.')
  }
  try {
    const key = await importJWK(jwk, header.alg)
    const verified = await compactVerify(proof, key)
    return {
      header,
      payload: JSON.parse(new TextDecoder().decode(verified.payload)) as Record<string, unknown>,
    }
  } catch {
    throw badRequest('DPoP proof signature is invalid.')
  }
}

async function consumeProof(deps: Deps, payload: Record<string, unknown>, keyThumbprint: string) {
  if (typeof payload.jti !== 'string') throw badRequest('DPoP proof has no JWT identifier.')
  if (typeof payload.iat !== 'number' || Math.abs(Date.now() / 1000 - payload.iat) > 300) {
    throw badRequest('DPoP proof is outside the accepted time window.')
  }
  if (
    !(await deps.agentTokens.consumeDpopJti({
      jtiHash: await sha256(payload.jti),
      keyThumbprint,
      expiresAt: new Date((payload.iat + 300) * 1000),
      createdAt: new Date(),
    }))
  ) {
    throw badRequest('DPoP proof was already used.')
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64Url(new Uint8Array(digest))
}

function base64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
