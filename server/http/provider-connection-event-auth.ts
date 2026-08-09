import { unauthorized } from '@server/domain/errors'
// biome-ignore lint/style/useNodejsImportProtocol: TypeScript 6 bundler resolution does not resolve the node:crypto declaration in the Worker configs.
import { timingSafeEqual } from 'crypto'

const signatureWindowSeconds = 5 * 60
const encoder = new TextEncoder()

export async function authenticateProviderConnectionEvent(
  request: Request,
  rawBody: Uint8Array<ArrayBuffer>,
  secret: string,
  now = new Date(),
) {
  const authorization = request.headers.get('authorization')
  const timestampValue = request.headers.get('realmroot-timestamp')
  const signatureValue = request.headers.get('realmroot-signature')
  if (!authorization?.startsWith('Bearer ') || !timestampValue || !signatureValue?.startsWith('sha256=')) {
    throw unauthorized('Connection Event authentication is required.')
  }
  const [candidateCredential, expectedCredential] = await Promise.all([
    sha256(authorization.slice('Bearer '.length)),
    sha256(secret),
  ])
  if (!timingSafeEqual(candidateCredential, expectedCredential)) {
    throw unauthorized('Connection Event credentials are invalid.')
  }

  const timestamp = Number(timestampValue)
  if (!Number.isInteger(timestamp) || Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > signatureWindowSeconds) {
    throw unauthorized('Connection Event timestamp is stale or invalid.')
  }

  const pathname = new URL(request.url).pathname
  const prefix = encoder.encode(`${timestampValue}\n${request.method}\n${pathname}\n`)
  const signedContent = new Uint8Array(prefix.length + rawBody.length)
  signedContent.set(prefix)
  signedContent.set(rawBody, prefix.length)
  const expected = await hmacSha256(secret, signedContent)
  const candidate = decodeSha256Signature(signatureValue)
  if (!candidate || !timingSafeEqual(candidate, expected)) {
    throw unauthorized('Connection Event signature is invalid.')
  }
}

async function hmacSha256(secret: string, value: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = await crypto.subtle.sign('HMAC', key, value)
  return new Uint8Array(signature)
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

function decodeSha256Signature(value: string) {
  const hex = value.slice('sha256='.length)
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return undefined

  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}
