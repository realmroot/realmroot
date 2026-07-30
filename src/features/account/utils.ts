import { createSiweMessage } from 'viem/siwe'
import { createPasskeyRegistrationOptions, linkWalletAddress, verifyPasskeyRegistration } from '@/lib/api/account'
import { requestWalletNonce } from '@/lib/auth-client'

export type TotpEnrollmentDisplay = {
  qrCode: string | null
  otpAuthUri: string | null
  secret: string | null
  backupCodes: string[]
}

export function readTotpEnrollment(value: unknown): TotpEnrollmentDisplay {
  const record = asRecord(value)
  return {
    qrCode: readString(record.qrCode) ?? readString(record.qrCodeUrl) ?? readString(record.qr),
    otpAuthUri:
      readString(record.otpAuthUri) ??
      readString(record.otpAuthURI) ??
      readString(record.totpURI) ??
      readString(record.totpUri) ??
      readString(record.uri),
    secret: readString(record.secret),
    backupCodes: readStringArray(record.backupCodes),
  }
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

export async function enrollPasskey(name: string) {
  const options = await createPasskeyRegistrationOptions({ name: name || undefined })
  const credential = await createPasskeyCredential(options)
  return verifyPasskeyRegistration({
    response: credential,
    name: name || undefined,
  })
}

export async function enrollWallet(enabledChains: number[]) {
  const ethereum = window.ethereum
  if (!ethereum) throw new Error('No wallet provider was found in this browser.')
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
  const walletAddress = readFirstString(accounts)
  if (!walletAddress) throw new Error('No wallet account was selected.')
  const chainId = readChainId(await ethereum.request({ method: 'eth_chainId' }))
  if (!enabledChains.includes(chainId)) {
    throw new Error(`This wallet network is not enabled. Switch to chain ${enabledChains[0]}.`)
  }
  const { nonce } = await requestWalletNonce({ walletAddress, chainId })
  const message = createSiweMessage({
    address: walletAddress as `0x${string}`,
    chainId,
    domain: window.location.host,
    nonce,
    statement: 'Link this wallet to Realmroot.',
    uri: window.location.origin,
    version: '1',
  })
  const signature = readString(await ethereum.request({ method: 'personal_sign', params: [message, walletAddress] }))
  if (!signature) throw new Error('Wallet did not return a signature.')
  return linkWalletAddress({ message, signature, walletAddress, chainId })
}

async function createPasskeyCredential(optionsResponse: unknown) {
  if (!navigator.credentials?.create) throw new Error('Passkey registration is not supported by this browser.')
  const credential = await navigator.credentials.create({ publicKey: passkeyCreationOptions(optionsResponse) })
  if (!credential) throw new Error('Passkey registration was cancelled.')
  return serializePasskeyCredential(credential)
}

function passkeyCreationOptions(optionsResponse: unknown): PublicKeyCredentialCreationOptions {
  const response = asRecord(optionsResponse)
  const options = asRecord(
    response.publicKey ?? asRecord(response.options).publicKey ?? response.options ?? optionsResponse,
  )
  const user = asRecord(options.user)
  return {
    ...options,
    challenge: base64UrlToBuffer(readRequiredString(options.challenge, 'challenge')),
    user: {
      ...user,
      id: base64UrlToBuffer(readRequiredString(user.id, 'user.id')),
      name: readRequiredString(user.name, 'user.name'),
      displayName: readRequiredString(user.displayName, 'user.displayName'),
    },
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map((credential) => {
          const credentialRecord = asRecord(credential)
          return {
            ...credentialRecord,
            id: base64UrlToBuffer(readRequiredString(credentialRecord.id, 'excludeCredentials.id')),
          } as PublicKeyCredentialDescriptor
        })
      : undefined,
  } as PublicKeyCredentialCreationOptions
}

function serializePasskeyCredential(credential: Credential) {
  const publicKeyCredential = credential as PublicKeyCredential
  const response = publicKeyCredential.response as AuthenticatorAttestationResponse
  return {
    id: publicKeyCredential.id,
    rawId: bufferToBase64Url(publicKeyCredential.rawId),
    type: publicKeyCredential.type,
    response: {
      attestationObject: bufferToBase64Url(response.attestationObject),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: publicKeyCredential.getClientExtensionResults?.() ?? {},
  }
}

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

export function bufferToBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function readString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function readFirstString(value: unknown) {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null
}

export function readChainId(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.startsWith('0x')) return Number.parseInt(value, 16)
  if (typeof value === 'string') return Number(value)
  throw new Error('Wallet did not return a chain ID.')
}

export function readRequiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Passkey registration option ${field} is required.`)
  }
  return value
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export function readRedirectUrl(response: unknown) {
  if (typeof response !== 'object' || response === null) return null
  if ('url' in response && typeof response.url === 'string') return response.url
  if ('redirectTo' in response && typeof response.redirectTo === 'string') return response.redirectTo
  if ('callbackURL' in response && typeof response.callbackURL === 'string') return response.callbackURL
  return null
}

export function formatSessionDevice(userAgent: string | null) {
  if (!userAgent) return 'Unknown device'
  if (!userAgent.includes('/')) return userAgent
  const browser = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('Chrome/')
      ? 'Chrome'
      : userAgent.includes('Firefox/')
        ? 'Firefox'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Browser'
  const platform = userAgent.includes('Mac OS X')
    ? 'macOS'
    : userAgent.includes('Windows')
      ? 'Windows'
      : userAgent.includes('Android')
        ? 'Android'
        : userAgent.includes('iPhone') || userAgent.includes('iPad')
          ? 'iOS'
          : null
  return platform ? `${browser} on ${platform}` : `${browser} session`
}
