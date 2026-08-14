import type { ConsentRequestResponse } from '@shared/api/applications'
import { ChevronRight, CircleAlert, Globe2, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AuthLayout, authLegalLinks, BrandIdentity, HostedPageLayout } from '@/components/layout/auth-layout'
import { SpaLink } from '@/components/spa-link'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { createConsent, getConsentRequest } from '@/lib/api'
import { completeOAuthConsent, signOut } from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { deduplicateRequest } from '@/lib/request-deduplication'
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
    deduplicateRequest(`consent:${search}`, () => getConsentRequest(search))
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
        resourceServerId: consent.resourceServerId,
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

  if (!consent) {
    const signInHref = `/auth/sign-in${search}`
    return (
      <AuthLayout
        backHref={!loading ? signInHref : undefined}
        config={config}
        icon={!loading ? <CircleAlert aria-hidden="true" size={28} /> : undefined}
        layout="focused"
        title={tt('Review application access')}
        description={tt('Approve only the access you recognize and expect.')}
        variant={!loading ? 'message' : 'form'}
      >
        {loading ? <Status>{tt('Loading consent request')}</Status> : null}
        {error ? <Status tone="error">{error}</Status> : null}
        {!loading && !error ? (
          <Status tone="warning">
            {tt('This consent request is no longer available. Start sign-in again from the application.')}
          </Status>
        ) : null}
      </AuthLayout>
    )
  }

  const disabled = submitting || switchingAccount
  return (
    <HostedPageLayout className="consentPage" config={config}>
      <BrandIdentity config={config} />

      <div className="consentFrame">
        <article aria-labelledby="consent-title" className="consentCard">
          <div className="consentContext">
            <header className="consentApplication">
              <span className="consentApplicationMark">
                <ConsentApplicationLogo consent={consent} />
              </span>
              <div className="consentApplicationIdentity">
                <h1 id="consent-title">{consent.application.name}</h1>
                <ApplicationHost consent={consent} />
              </div>
              <p className="consentRequestSummary">{consentRequestSummary(consent)}</p>
            </header>

            <section aria-label={tt('Account used for authorization')} className="consentAccount">
              {consent.user.image ? (
                <img src={consent.user.image} alt="" width="40" height="40" />
              ) : (
                <span className="consentAvatarFallback" aria-hidden="true">
                  <UserRound size={20} />
                </span>
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
                disabled={disabled}
                onClick={switchAccount}
                type="button"
                variant="ghost"
              >
                {tt('Change')}
              </Button>
            </section>
          </div>

          <div className="consentDecision">
            <div className="consentDecisionBody">
              {error ? <Status tone="error">{error}</Status> : null}
              <ConsentPermissions consent={consent} />
              <p className="consentControlNote">
                <ShieldCheck aria-hidden="true" />
                <span>
                  {tt("You can remove {{application}}'s access at any time from Account Center.", {
                    application: consent.application.name,
                  })}
                </span>
              </p>
            </div>

            <footer className="consentActions">
              <Button disabled={disabled} onClick={deny} type="button" variant="ghost">
                {tt('Cancel')}
              </Button>
              <Button disabled={disabled} onClick={approve} type="button">
                {tt('Authorize')}
              </Button>
            </footer>
          </div>
        </article>
        <ConsentFooter links={authLegalLinks(config)} />
      </div>
    </HostedPageLayout>
  )
}

function ConsentApplicationLogo({ consent }: { consent: ConsentRequestResponse }) {
  if (consent.application.iconUrl) {
    return <img className="consentApplicationLogo" src={consent.application.iconUrl} alt="" width="48" height="48" />
  }
  return (
    <span className="consentApplicationFallback" aria-hidden="true">
      {consent.application.name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

function ApplicationHost({ consent }: { consent: ConsentRequestResponse }) {
  const host = applicationHost(consent)
  if (!host) return null
  return (
    <span className="consentApplicationOrigin">
      <Globe2 aria-hidden="true" />
      <span>{host}</span>
    </span>
  )
}

function ConsentFooter({ links }: { links: Array<[string, string]> }) {
  return (
    <footer className="consentFooter">
      <span>{tt('Protected by Realmroot')}</span>
      {links.map(([label, href]) => (
        <span className="consentFooterLink" key={label}>
          <span aria-hidden="true">·</span>
          {href.startsWith('/') && !href.startsWith('//') ? (
            <SpaLink to={href}>{tt(label)}</SpaLink>
          ) : (
            <a href={href}>{tt(label)}</a>
          )}
        </span>
      ))}
    </footer>
  )
}

function ConsentPermissions({ consent }: { consent: ConsentRequestResponse }) {
  const requested = consent.requestedPermissions
  const added = new Set(consent.addedScopes)
  const previouslyApproved = new Set(consent.previouslyApprovedScopes)
  const newPermissions = requested.filter((permission) => added.has(permission.value))
  const existingPermissions = requested.filter((permission) => previouslyApproved.has(permission.value))

  if (consent.consentReason === 'expanded') {
    return (
      <section className="consentPermissions" aria-labelledby="consent-permissions-title">
        <PermissionHeading
          count={tt('{{count}} added', { count: newPermissions.length })}
          title={tt('New permissions')}
        />
        <PermissionTable permissions={newPermissions} />
        <details className="consentExistingAccess">
          <summary>
            <ChevronRight aria-hidden="true" />
            <span>{tt('Previously approved access')}</span>
            <small>{tt('{{count}} permissions', { count: existingPermissions.length })}</small>
          </summary>
          <PermissionTable permissions={existingPermissions} />
        </details>
      </section>
    )
  }

  if (consent.consentReason === 'reauthorization') {
    return (
      <section className="consentPermissions" aria-labelledby="consent-permissions-title">
        <PermissionHeading
          count={tt('{{count}} permissions', { count: requested.length })}
          title={tt('Confirm existing access')}
        />
        <p className="consentPermissionsIntro">{tt('No new permissions are being requested.')}</p>
        <PermissionTable permissions={requested} />
      </section>
    )
  }

  return (
    <section className="consentPermissions" aria-labelledby="consent-permissions-title">
      <PermissionHeading
        count={tt('{{count}} total', { count: requested.length })}
        title={tt('Permissions requested')}
      />
      <PermissionTable permissions={requested} />
    </section>
  )
}

function PermissionHeading({ count, title }: { count: string; title: string }) {
  return (
    <div className="consentPermissionsHeader">
      <h2 id="consent-permissions-title">{title}</h2>
      <span>{count}</span>
    </div>
  )
}

function PermissionTable({ permissions }: { permissions: ConsentRequestResponse['requestedPermissions'] }) {
  return (
    <ul className="consentPermissionTable" aria-label={tt('Requested permissions')}>
      {permissions.map((permission) => (
        <li className="consentPermissionRow" key={permission.value}>
          <code>{permission.value}</code>
          {permission.description ? <span>{tt(permission.description)}</span> : null}
        </li>
      ))}
    </ul>
  )
}

export function signInWithReturnTo() {
  const current = `${window.location.pathname}${window.location.search}`
  return `/auth/sign-in?return_to=${encodeURIComponent(current)}`
}

function consentRequestSummary(consent: ConsentRequestResponse) {
  if (consent.consentReason === 'expanded') return tt('Wants additional access to your Realmroot account')
  if (consent.consentReason === 'reauthorization') return tt('Wants to continue accessing your Realmroot account')
  return tt('Wants access to your Realmroot account')
}

function applicationHost(consent: ConsentRequestResponse) {
  return consent.application.homepageUrl ? new URL(consent.application.homepageUrl).host : undefined
}
