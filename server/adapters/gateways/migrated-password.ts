import { scryptAsync } from '@noble/hashes/scrypt.js'
import { verifyPassword as verifyRealmrootPassword } from '@server/domain/password'

const LEGACY_FORMAT = 'better-auth-scrypt-v1'
const BUNDLE_FORMAT = 'realmroot-password-bundle-v1'
const LEGACY_SALT_HEX_LENGTH = 32
const LEGACY_KEY_HEX_LENGTH = 128
const LEGACY_SCRYPT = {
  N: 16_384,
  r: 16,
  p: 1,
  dkLen: 64,
  maxmem: 128 * 16_384 * 16 * 2,
} as const

export async function verifyStoredPassword(hash: string, password: string): Promise<boolean> {
  if (hash.startsWith(`${LEGACY_FORMAT}:`)) return verifyLegacyPassword(hash, password)
  if (hash.startsWith(`${BUNDLE_FORMAT}:`)) return verifyPasswordBundle(hash, password)
  return verifyRealmrootPassword(hash, password)
}

async function verifyLegacyPassword(hash: string, password: string): Promise<boolean> {
  const [format, salt, expectedKey, extra] = hash.split(':')
  if (
    format !== LEGACY_FORMAT ||
    extra !== undefined ||
    !isHex(salt, LEGACY_SALT_HEX_LENGTH) ||
    !isHex(expectedKey, LEGACY_KEY_HEX_LENGTH)
  ) {
    throw new Error('Invalid Better Auth password hash')
  }
  const actualKey = await scryptAsync(password.normalize('NFKC'), salt, LEGACY_SCRYPT)
  return timingSafeEqual(actualKey, decodeHex(expectedKey))
}

async function verifyPasswordBundle(hash: string, password: string): Promise<boolean> {
  const [format, ...encodedHashes] = hash.split(':')
  if (
    format !== BUNDLE_FORMAT ||
    encodedHashes.length < 2 ||
    encodedHashes.length > 4 ||
    encodedHashes.some((value) => !value)
  ) {
    throw new Error('Invalid password bundle')
  }
  for (const encodedHash of encodedHashes) {
    if (await verifyStoredPassword(decodeString(encodedHash), password)) return true
  }
  return false
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let index = 0; index < a.length; index++) result |= a[index] ^ b[index]
  return result === 0
}

function decodeString(value: string): string {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)))
}

function isHex(value: string | undefined, length: number): value is string {
  return typeof value === 'string' && value.length === length && /^[0-9a-f]+$/i.test(value)
}

function decodeHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))
}
