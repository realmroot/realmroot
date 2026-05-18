const HASH_ALGORITHM = 'PBKDF2'
const DIGEST = 'SHA-256'
const ITERATIONS = 100_000
const MAX_ITERATIONS = 210_000
const KEY_BYTES = 32
const SALT_BYTES = 16
const FORMAT = 'pbkdf2-sha256'

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await deriveKey(password, salt)
  return [FORMAT, ITERATIONS.toString(), encodeBase64Url(salt), encodeBase64Url(key)].join(':')
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const [format, iterations, encodedSalt, encodedKey] = hash.split(':')
  if (format !== FORMAT) throw new Error(`Unsupported password hash format: ${format}`)
  const iterationCount = parseIterations(iterations)

  const salt = decodeBase64Url(encodedSalt)
  const expectedKey = decodeBase64Url(encodedKey)
  const actualKey = await deriveKey(password, salt, iterationCount)

  return timingSafeEqual(actualKey, expectedKey)
}

function parseIterations(value: string): number {
  const iterations = Number(value)
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new Error(`Unsupported password hash iterations: ${value}`)
  }
  return iterations
}

async function deriveKey(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<Uint8Array> {
  const passwordKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), HASH_ALGORITHM, false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: HASH_ALGORITHM, hash: DIGEST, salt: toArrayBuffer(salt), iterations },
    passwordKey,
    KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }
  return result === 0
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}
