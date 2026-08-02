import type { ConsentRequestResponse } from '@shared/api/applications'
import { CircleAlert, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { createConsent, getConsentRequest } from '@/lib/api'
import { completeOAuthConsent, signOut } from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { useConfigz } from './hooks'
export function ConsentPage() {
  const { data: config } = useConfigz()
  const [consent, setConsent] = useState<ConsentRequestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const search = window.location.search
  useEffect(() => {
    let active = true
    const params = new URLSearchParams(search)
    if (!params.get('client_id') || !params.get('redirect_uri')) {
      setError(tt('This consent request is incomplete. Start sign-in again from the application.'))
      setLoading(false)
      return () => {
        active = false
      }
    }
    getConsentRequest(search)
      .then((result) => {
        if (active) {
          setConsent(result)
          setLoading(false)
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? tt(loadError.message) : tt('Unable to load consent request.'))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [search])
  async function approve() {
    if (!consent) return
    setSubmitting(true)
    setError(null)
    try {
      await createConsent({
        clientId: consent.application.clientId,
        scopes: consent.requestedScopes,
      })
      const result = await completeOAuthConsent({
        accept: true,
        scope: consent.requestedScopes.join(' '),
        oauthQuery: search.slice(1),
      })
      if (!result.url) throw new Error(tt('The authorization server did not return a callback URL.'))
      window.location.assign(result.url)
    } catch (approveError) {
      setError(approveError instanceof Error ? tt(approveError.message) : tt('Unable to approve consent.'))
      setSubmitting(false)
    }
  }
  async function deny() {
    setSubmitting(true)
    setError(null)
    try {
      const result = await completeOAuthConsent({ accept: false, oauthQuery: search.slice(1) })
      if (!result.url) throw new Error(tt('The authorization server did not return a callback URL.'))
      window.location.assign(result.url)
    } catch (denyError) {
      setError(denyError instanceof Error ? tt(denyError.message) : tt('Unable to deny consent.'))
      setSubmitting(false)
    }
  }
  async function switchAccount() {
    setSwitchingAccount(true)
    setError(null)
    try {
      await signOut()
      window.location.assign(signInWithReturnTo())
    } catch (switchError) {
      setError(switchError instanceof Error ? tt(switchError.message) : tt('Unable to switch accounts.'))
      setSwitchingAccount(false)
    }
  }
  const messageState = error !== null || (!loading && !consent)
  const signInHref = `/auth/sign-in${search}`
  return (
    <AuthLayout
      backHref={messageState ? signInHref : undefined}
      config={config}
      eyebrow="OAuth consent"
      icon={messageState ? <CircleAlert aria-hidden="true" size={28} /> : undefined}
      layout={messageState ? 'focused' : 'decision'}
      title={
        consent
          ? tt('{{application}} wants to access your Realmroot account', { application: consent.application.name })
          : tt('Review application access')
      }
      description={
        consent ? consentApplicationDescription(consent) : tt('Approve only the access you recognize and expect.')
      }
      variant={messageState ? 'message' : 'form'}
    >
      {loading ? <Status>{tt('Loading consent request')}</Status> : null}
      {error ? <Status tone="error">{error}</Status> : null}
      {!loading && !error && !consent ? (
        <Status tone="warning">
          {' '}
          {tt('This consent request is no longer available. Start sign-in again from the application.')}{' '}
        </Status>
      ) : null}
      {consent ? (
        <div className="consentStack">
          <div className="consentAccount">
            {consent.user.image ? (
              <img src={consent.user.image} alt="" width="40" height="40" />
            ) : (
              <UserRound size={20} />
            )}
            <div>
              <span>{tt('Continue as')}</span>
              <strong>{consent.user.displayName ?? consent.user.email ?? tt('Current account')}</strong>
              {consent.user.displayName && consent.user.email && consent.user.email !== consent.user.displayName ? (
                <small>{consent.user.email}</small>
              ) : null}
            </div>
            <Button
              className="consentSwitchButton"
              disabled={submitting || switchingAccount}
              onClick={switchAccount}
              type="button"
              variant="ghost"
            >
              <LogOut size={16} /> {tt('Switch account')}
            </Button>
          </div>
          <section className="consentPermissions">
            <h2>{tt('This will allow {{application}} to:', { application: consent.application.name })}</h2>
            <ul className="scopeList" aria-label={tt('Requested permissions')}>
              {consent.requestedScopes.map((scope) => (
                <li className="scopeItem" key={scope}>
                  <ShieldCheck aria-hidden="true" />
                  <span>
                    <strong>{scopeTitle(scope)}</strong>
                    <small>{scopeDescription(scope)}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <details className="consentScopes">
            <summary>{tt('Requested scopes ({{count}})', { count: consent.requestedScopes.length })}</summary>
            <div>
              {consent.requestedScopes.map((scope) => (
                <code key={scope}>{scope}</code>
              ))}
            </div>
          </details>
          {consent.existingConsent ? (
            <Status tone="info">
              {tt('Previously approved on')} {formatDate(consent.existingConsent.grantedAt)}.
            </Status>
          ) : null}
          <div className="buttonRow">
            <Button disabled={submitting || switchingAccount} onClick={deny} type="button" variant="outline">
              {tt('Cancel')}
            </Button>
            <Button disabled={submitting || switchingAccount} onClick={approve} type="button">
              {tt('Allow')}
            </Button>
          </div>
          <p className="consentControlNote">{tt('You can revoke this access at any time in Account Center.')}</p>
        </div>
      ) : null}
    </AuthLayout>
  )
}

export function signInWithReturnTo() {
  const current = `${window.location.pathname}${window.location.search}`
  return `/auth/sign-in?return_to=${encodeURIComponent(current)}`
}

function scopeDescription(scope: string) {
  if (scope === 'openid') return tt('Confirm your identity with this provider.')
  if (scope === 'profile') return tt('Share basic profile details such as name and avatar.')
  if (scope === 'email') return tt('Share your email address and verification state.')
  if (scope === 'offline_access') return tt('Allow refresh tokens for continued access.')
  return tt('Allow this application to request this scope.')
}

function scopeTitle(scope: string) {
  if (scope === 'openid') return tt('Confirm your identity')
  if (scope === 'profile') return tt('See your basic profile')
  if (scope === 'email') return tt('See your verified email address')
  if (scope === 'offline_access') return tt('Keep access when you are away')
  return tt('Use {{scope}} permission', { scope })
}

function consentApplicationDescription(consent: ConsentRequestResponse) {
  const publisher = consent.application.firstParty ? tt('First-party application') : tt('Third-party application')
  if (!consent.application.homepageUrl) return publisher
  return `${publisher} · ${new URL(consent.application.homepageUrl).host}`
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(new Date(value))
}
