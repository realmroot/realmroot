import { CircleAlert, CircleCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { LinkButton } from '@/components/link-button'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import { LoadingMessage } from '@/features/auth/pages/controls'
import { tt } from '@/lib/i18n'
import { deduplicateRequest } from '@/lib/request-deduplication'

const oidcStateStorageKey = 'realmroot.oidc.state'
const oidcVerifierStorageKey = 'realmroot.oidc.verifier'

export function OidcStartRoute({ startAuthorization }: { startAuthorization?: () => Promise<void> }) {
  const { data: config } = useConfigz()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const start = startAuthorization ?? (() => startOidcAuthorization((url) => window.location.assign(url)))
    void deduplicateRequest(`oidc-start:${window.location.href}`, start).catch((startError: unknown) => {
      setError(startError instanceof Error ? startError.message : tt('Unable to start client sign-in.'))
    })
  }, [startAuthorization])
  return (
    <AuthLayout
      backHref={error ? '/auth/sign-in' : undefined}
      config={config}
      eyebrow="OIDC client"
      icon={error ? <CircleAlert aria-hidden="true" size={28} /> : undefined}
      layout="focused"
      title={error ? tt('Client sign-in could not start.') : tt('Starting client sign-in')}
      description={
        error
          ? tt('Review the error below, then return to sign in.')
          : tt('Opening the authorization request for the configured callback.')
      }
      variant={error ? 'message' : 'form'}
    >
      {error ? <Status tone="error">{error}</Status> : <LoadingMessage label={tt('Opening authorization')} />}
    </AuthLayout>
  )
}

export function OidcCallbackRoute() {
  const { data: config } = useConfigz()
  const [callback] = useState(readOidcCallback)
  const { error: callbackError, valid } = callback
  useEffect(() => {
    if (!valid) return
    window.sessionStorage.removeItem(oidcStateStorageKey)
    window.sessionStorage.removeItem(oidcVerifierStorageKey)
  }, [valid])
  return (
    <AuthLayout
      backHref={valid ? undefined : '/auth/sign-in'}
      config={config}
      eyebrow="OIDC callback"
      icon={valid ? <CircleCheck aria-hidden="true" size={28} /> : <CircleAlert aria-hidden="true" size={28} />}
      layout="focused"
      title={valid ? tt('Authorization received.') : tt('Authorization could not continue.')}
      description={
        valid
          ? tt('The callback state is valid and the authorization response was received.')
          : tt('Review the error below, then return to sign in.')
      }
      variant={valid ? 'form' : 'message'}
    >
      {valid ? (
        <>
          <Status tone="success">{tt('Authorization code received securely.')}</Status>
          <LinkButton to="/">{tt('Open Account Center')}</LinkButton>
        </>
      ) : (
        <Status tone="error">{callbackError}</Status>
      )}
    </AuthLayout>
  )
}

function readOidcCallback() {
  const params = new URLSearchParams(window.location.search)
  const state = params.get('state')
  const expectedState = window.sessionStorage.getItem(oidcStateStorageKey)
  const error = params.get('error')
  const code = params.get('code')
  const valid = Boolean(!error && code && state && expectedState && state === expectedState)
  return {
    valid,
    error: error
      ? (params.get('error_description') ?? error)
      : tt('Authorization response is missing a valid code and state.'),
  }
}

export async function startOidcAuthorization(redirect: (url: URL) => void) {
  const currentUrl = new URL(window.location.href)
  const clientId = currentUrl.searchParams.get('client_id')
  if (!clientId) throw new Error(tt('A client ID is required to start OIDC sign-in.'))
  const state = randomUrlToken()
  const verifier = randomUrlToken()
  const authorizationUrl = new URL('/api/auth/oauth2/authorize', window.location.origin)
  window.sessionStorage.setItem(oidcStateStorageKey, state)
  window.sessionStorage.setItem(oidcVerifierStorageKey, verifier)
  authorizationUrl.searchParams.set('client_id', clientId)
  authorizationUrl.searchParams.set(
    'redirect_uri',
    currentUrl.searchParams.get('redirect_uri') ?? `${window.location.origin}/oidc/callback`,
  )
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', currentUrl.searchParams.get('scope') ?? 'openid profile')
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('code_challenge', await pkceChallenge(verifier))
  authorizationUrl.searchParams.set('code_challenge_method', 'S256')
  redirect(authorizationUrl)
}

function randomUrlToken() {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function pkceChallenge(verifier: string) {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
