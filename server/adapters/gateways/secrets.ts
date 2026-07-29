import type { SecretCipher } from '@server/usecases/ports'

const envelopeVersion = 'v1'

export function createSecretCipher(masterSecret: string): SecretCipher {
  if (masterSecret.length < 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters.')
  }

  const key = deriveKey(masterSecret)

  return {
    isSealed(value) {
      return value.startsWith(`${envelopeVersion}.`)
    },

    async seal(plaintext, context) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encode(context) },
        await key,
        encode(plaintext),
      )
      return `${envelopeVersion}.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`
    },

    async open(envelope, context) {
      const [version, encodedIv, encodedCiphertext, extra] = envelope.split('.')
      if (version !== envelopeVersion || !encodedIv || !encodedCiphertext || extra) {
        throw new Error('Encrypted secret envelope is invalid.')
      }
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromBase64Url(encodedIv),
          additionalData: encode(context),
        },
        await key,
        fromBase64Url(encodedCiphertext),
      )
      return new TextDecoder().decode(plaintext)
    },
  }
}

async function deriveKey(masterSecret: string) {
  const material = await crypto.subtle.digest('SHA-256', encode(`flareauth:credential-encryption:${masterSecret}`))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function encode(value: string) {
  return new TextEncoder().encode(value)
}

function base64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}
