import { forbidden } from '@server/domain/errors'
import { listApplications } from '@server/usecases/applications'
import { type ConfigzOptions, getConfig } from '@server/usecases/configz'
import type { WalletRepository } from '@server/usecases/ports'
import type { Context } from 'hono'
import { getAddress } from 'viem'
import type { AgentConfiguration } from './app-types'
import { getDeps } from './middleware/deps'

export function mountAgentConfiguration(configuration: AgentConfiguration): AgentConfiguration {
  const issuer = mountAgentIssuer(configuration.issuer)
  return {
    ...configuration,
    issuer,
    default_location: mountAgentUrl(configuration.default_location, issuer),
    endpoints: Object.fromEntries(
      Object.entries(configuration.endpoints).map(([key, value]) => [key, mountAgentUrl(value, issuer)]),
    ),
  }
}

export function mountAgentIssuer(issuer: string) {
  const url = new URL(issuer)
  if (url.pathname === '/api/auth' || url.pathname.endsWith('/api/auth')) return issuer
  return `${issuer.replace(/\/$/, '')}/api/auth`
}

export function mountAgentUrl(value: string, issuer: string) {
  const url = new URL(value)
  const path = url.pathname.startsWith('/api/auth/') ? url.pathname.slice('/api/auth'.length) : url.pathname
  return `${issuer}${path}${url.search}`
}

export function oauthClientCorsOrigins() {
  return async ({ path, context }: { path: string; context: Context }) => {
    if (!isOAuthClientCorsPath(path)) return []

    const deps = getDeps(context)
    const issuer = new URL(context.req.url).origin
    const origins = new Set<string>()
    let offset = 0

    for (;;) {
      const result = await listApplications(deps, issuer, {
        limit: 100,
        offset,
      })
      for (const application of result.applications) {
        if (application.disabled) continue
        for (const origin of application.corsOrigins) origins.add(origin)
      }
      if (!result.pagination.hasMore || result.pagination.nextOffset === null) break
      offset = result.pagination.nextOffset
    }

    return [...origins]
  }
}

export function isOAuthClientCorsPath(path: string) {
  return oauthClientCorsPaths.has(path)
}

export function isPublicOAuthMetadataPath(path: string) {
  return publicOAuthMetadataPaths.has(path)
}

const publicOAuthMetadataPaths = new Set([
  '/api/auth/.well-known/openid-configuration',
  '/api/auth/.well-known/oauth-authorization-server',
  '/api/auth/jwks',
])

const oauthClientCorsPaths = new Set([
  '/api/auth/.well-known/openid-configuration',
  '/api/auth/.well-known/oauth-authorization-server',
  '/api/auth/jwks',
  '/api/auth/oauth2/token',
  '/api/auth/oauth2/userinfo',
  '/api/auth/oauth2/revoke',
  '/api/auth/oauth2/introspect',
])

export async function requireHostedAuthMethodEnabled(c: Context, options: ConfigzOptions) {
  const path = c.req.path
  if (!isManagedHostedAuthPath(path)) return

  const config = await getConfig(getDeps(c), options)
  if (!config.signIn.passwordEnabled && passwordAuthPaths.has(path)) {
    throw forbidden('Password authentication is disabled.')
  }
  if (!config.signIn.signupEnabled && path === '/api/auth/sign-up/email') {
    throw forbidden('Sign up is disabled.')
  }
  if (!config.signIn.emailOtpEnabled && (emailOtpAuthPaths.has(path) || (await isBlockedEmailOtpRequest(c)))) {
    throw forbidden('Email code authentication is disabled.')
  }
  if (!config.signIn.socialLoginEnabled && path === '/api/auth/sign-in/social') {
    throw forbidden('Social authentication is disabled.')
  }
  if (web3WalletAuthPaths.has(path) && !config.builtInProviders.web3Wallet.enabled) {
    throw forbidden('Web3 wallet authentication is disabled.')
  }
}

const passwordAuthPaths = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/sign-in/username',
  '/api/auth/sign-up/email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/email-otp/request-password-reset',
  '/api/auth/email-otp/reset-password',
  '/api/auth/change-password',
])

const emailOtpAuthPaths = new Set(['/api/auth/sign-in/email-otp'])
const web3WalletAuthPaths = new Set(['/api/auth/siwe/nonce', '/api/auth/siwe/get-nonce', '/api/auth/siwe/verify'])

export function isManagedHostedAuthPath(path: string) {
  return (
    passwordAuthPaths.has(path) ||
    emailOtpAuthPaths.has(path) ||
    web3WalletAuthPaths.has(path) ||
    path === '/api/auth/email-otp/send-verification-otp' ||
    path === '/api/auth/sign-in/social'
  )
}

export async function requireLinkedSiweWallet(c: Context, wallets: WalletRepository) {
  if (c.req.path !== '/api/auth/siwe/verify') return

  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => null)
  if (!body || typeof body !== 'object') return

  const record = body as Record<string, unknown>
  const walletAddress = typeof record.walletAddress === 'string' ? toWalletAddress(record.walletAddress) : null
  const chainId = typeof record.chainId === 'number' ? record.chainId : 1
  if (!walletAddress) return

  const linked = await wallets.findWalletAddress(walletAddress, chainId)
  const linkedOnAnotherChain = linked ? null : await wallets.findAnyWalletAddress(walletAddress)
  if (!linked && !linkedOnAnotherChain) {
    throw forbidden('This wallet is not linked to an existing account.')
  }
}

export function toWalletAddress(value: string) {
  try {
    return getAddress(value)
  } catch {
    return null
  }
}

export async function isBlockedEmailOtpRequest(c: Context) {
  if (c.req.path !== '/api/auth/email-otp/send-verification-otp') return false

  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => null)
  return !(body && typeof body === 'object' && 'type' in body && body.type === 'email-verification')
}
