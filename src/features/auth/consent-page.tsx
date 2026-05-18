import type { ConsentRequestResponse } from '@shared/api/applications'
import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { createConsent, getConsentRequest } from '@/lib/api'
import { useExperienceConfig } from './hooks'

export function ConsentPage() {
  const { data: config } = useExperienceConfig()
  const [consent, setConsent] = useState<ConsentRequestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const search = window.location.search
  const authorizeUrl = `/api/auth/oauth2/authorize${search}`

  useEffect(() => {
    let active = true
    getConsentRequest(search)
      .then((result) => {
        if (active) {
          setConsent(result)
          setLoading(false)
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load consent request.')
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
      window.location.assign(authorizeUrl)
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : 'Unable to approve consent.')
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      config={config}
      eyebrow="OAuth consent"
      title="Review application access."
      description="Approve only the scopes this application should use with your account."
    >
      {loading ? <Status>Loading consent request</Status> : null}
      {error ? <Status tone="error">{error}</Status> : null}
      {consent ? (
        <div className="consentStack">
          <div className="applicationSummary">
            {consent.application.iconUrl ? <img src={consent.application.iconUrl} alt="" /> : <ShieldCheck size={28} />}
            <div>
              <h2>{consent.application.name}</h2>
              <p>{consent.application.description ?? consent.application.homepageUrl ?? 'OAuth client application'}</p>
            </div>
          </div>
          <ul className="scopeList" aria-label="Requested scopes">
            {consent.requestedScopes.map((scope) => (
              <li className="scopeItem" key={scope}>
                <strong>{scope}</strong>
                <span>{scopeDescription(scope)}</span>
              </li>
            ))}
          </ul>
          {consent.existingConsent ? (
            <Status tone="info">Previously approved on {formatDate(consent.existingConsent.grantedAt)}.</Status>
          ) : null}
          <div className="buttonRow">
            <Button disabled={submitting} onClick={approve} type="button">
              Approve access
            </Button>
            <Button onClick={() => window.history.back()} type="button" variant="secondary">
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </AuthLayout>
  )
}

function scopeDescription(scope: string) {
  if (scope === 'openid') return 'Confirm your identity with this provider.'
  if (scope === 'profile') return 'Share basic profile details such as name and avatar.'
  if (scope === 'email') return 'Share your email address and verification state.'
  if (scope === 'offline_access') return 'Allow refresh tokens for continued access.'
  return 'Allow this application to request this scope.'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
