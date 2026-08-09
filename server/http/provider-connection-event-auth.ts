import { unauthorized } from '@server/domain/errors'

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
  if (!constantTimeEqual(authorization.slice('Bearer '.length), secret)) {
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
  if (!constantTimeEqual(signatureValue, `sha256=${expected}`)) {
    throw unauthorized('Connection Event signature is invalid.')
  }
}

async function hmacSha256(secret: string, value: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = await crypto.subtle.sign('HMAC', key, value)
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}
