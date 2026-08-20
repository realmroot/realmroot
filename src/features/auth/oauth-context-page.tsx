import type { ConsentRequestResponse } from '@shared/api/applications'
import { Building2, UserRound } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { getConsentRequest } from '@/lib/api'
import { completeOAuthConsent, completeOAuthPostLogin, signOut } from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { deduplicateRequest } from '@/lib/request-deduplication'
import { signInWithReturnTo } from './consent-page'
import { useConfigz } from './hooks'

export function OAuthContextPage() {
  const { data: config } = useConfigz()
  const [request, setRequest] = useState<ConsentRequestResponse | null>(null)
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const search = window.location.search

  useEffect(() => {
    let active = true
    const params = new URLSearchParams(search)
    if (!params.get('client_id') || !params.get('redirect_uri')) {
      setError(tt('This authorization request is incomplete. Start sign-in again from the application.'))
      setLoading(false)
      return () => {
        active = false
      }
    }
    deduplicateRequest(`oauth-context:${search}`, () => getConsentRequest(search))
      .then((result) => {
        if (!active) return
        setRequest(result)
        setSelectedContextId(null)
        setLoading(false)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setError(loadError instanceof Error ? tt(loadError.message) : tt('Unable to load authorization Contexts.'))
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [search])

  async function continueAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const context = request?.authorizationContexts.find((item) => item.id === selectedContextId)
    if (!context) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await completeOAuthPostLogin(search.slice(1), context.id)
      if (!result.url) throw new Error(tt('The authorization server did not return the next authorization step.'))
      window.location.assign(result.url)
    } catch (submitError) {
      setError(submitError instanceof Error ? tt(submitError.message) : tt('Unable to select this Context.'))
      setSubmitting(false)
    }
  }

  async function cancel() {
    setSubmitting(true)
    setError(null)
    try {
      const result = await completeOAuthConsent({ accept: false, oauthQuery: search.slice(1) })
      if (!result.url) throw new Error(tt('The authorization server did not return a callback URL.'))
      window.location.assign(result.url)
    } catch (cancelError) {
      setError(cancelError instanceof Error ? tt(cancelError.message) : tt('Unable to cancel authorization.'))
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

  const disabled = submitting || switchingAccount
  return (
    <AuthLayout
      config={config}
      description={tt('The selected Context determines which tenant the application can access.')}
      eyebrow={request?.application.name}
      layout="decision"
      title={tt('Choose an authorization Context')}
    >
      {loading ? <Status>{tt('Loading authorization Contexts')}</Status> : null}
      {error ? <Status tone="error">{error}</Status> : null}
      {request ? (
        <form className="oauthContextForm" onSubmit={continueAuthorization}>
          <fieldset className="oauthContextChoices" disabled={disabled}>
            <legend>{tt('Continue with')}</legend>
            {request.authorizationContexts.map((context) => (
              <label className="oauthContextChoice" key={context.id}>
                <input
                  checked={selectedContextId === context.id}
                  name="authorization-context"
                  onChange={() => setSelectedContextId(context.id)}
                  type="radio"
                  value={context.id}
                />
                <span className="oauthContextChoiceIcon" aria-hidden="true">
                  {context.type === 'user' ? <UserRound /> : <Building2 />}
                </span>
                <span className="oauthContextChoiceText">
                  <strong>{context.displayName}</strong>
                  <small>{tt(context.description)}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="oauthContextActions">
            <Button disabled={disabled} onClick={() => void cancel()} type="button" variant="ghost">
              {tt('Cancel')}
            </Button>
            <Button disabled={disabled || !selectedContextId} type="submit">
              {submitting ? tt('Continuing…') : tt('Continue')}
            </Button>
          </div>
          <button
            className="oauthContextSwitchAccount"
            disabled={disabled}
            onClick={() => void switchAccount()}
            type="button"
          >
            {tt('Use a different account')}
          </button>
        </form>
      ) : null}
    </AuthLayout>
  )
}
