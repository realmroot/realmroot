import type { ResourceConnectionApproval } from '@shared/api/agent-api'
import { CheckCircle2, CircleAlert, Link2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import { createAccountConnection, getResourceConnectionApproval } from '@/lib/api/account'
import { deduplicateRequest } from '@/lib/request-deduplication'

const approvalTokenStorageKey = 'realmroot.resource-connection-approval-token'

export function ResourceConnectionApprovalPage() {
  const { data: config } = useConfigz()
  const token = useMemo(() => {
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get('token')
    if (hashToken) {
      window.sessionStorage.setItem(approvalTokenStorageKey, hashToken)
      return hashToken
    }
    return window.sessionStorage.getItem(approvalTokenStorageKey) ?? ''
  }, [])
  const callback = useMemo(() => new URLSearchParams(window.location.search), [])
  const callbackError =
    callback.get('resource_connection') === 'failed'
      ? (callback.get('error_description') ?? callback.get('error') ?? 'The provider rejected the account connection.')
      : null
  const [approval, setApproval] = useState<ResourceConnectionApproval | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(callbackError)
  const completedConnectionId = callback.get('account_connection_id')
  const callbackCompleted = callback.get('resource_connection') === 'connected'
  const connected =
    callbackCompleted &&
    Boolean(completedConnectionId) &&
    (approval === null || approval.accountConnection?.id === completedConnectionId)
  const callbackMismatch = callbackCompleted && approval !== null && !connected

  useEffect(() => {
    if (!token && callbackCompleted && completedConnectionId) return
    if (!token) {
      setError('This resource connection request is incomplete. Start again from the requesting Agent.')
      return
    }
    let active = true
    void deduplicateRequest(`resource-connection-approval:${token}`, () => getResourceConnectionApproval(token))
      .then((nextApproval) => {
        if (active) setApproval(nextApproval)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : 'Unable to load the resource connection request.')
      })
    return () => {
      active = false
    }
  }, [callbackCompleted, completedConnectionId, token])

  async function connect() {
    setSubmitting(true)
    setError(null)
    try {
      const connection = await createAccountConnection({ context: 'connection-request', approvalToken: token })
      if (!connection.authorizationUrl) throw new Error('The authorization URL was not returned.')
      window.location.assign(connection.authorizationUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start account authorization.')
      setSubmitting(false)
    }
  }

  if (connected) {
    window.sessionStorage.removeItem(approvalTokenStorageKey)
    return (
      <AuthLayout
        config={config}
        description="The Agent can now discover authorized contexts and request exact access separately."
        eyebrow="Account connection"
        icon={<CheckCircle2 />}
        layout="focused"
        title="Account connected"
        variant="message"
      >
        <Status tone="success">Resource access remains a separate approval.</Status>
      </AuthLayout>
    )
  }

  if (error && !approval) {
    return (
      <AuthLayout
        config={config}
        description="Start again from the requesting Agent."
        eyebrow="Account connection"
        icon={<CircleAlert />}
        layout="focused"
        title="Connection request unavailable"
        variant="message"
      >
        <Status tone="error">{error}</Status>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      config={config}
      description="Connect or update the provider account and choose the resource contexts that this account may expose."
      eyebrow="Account connection"
      icon={<Link2 />}
      layout="decision"
      title="Connect external resource"
    >
      {approval ? (
        <div className="decisionStack">
          <dl className="decisionFacts">
            <div>
              <dt>Agent</dt>
              <dd>{approval.agent.name}</dd>
            </div>
            <div>
              <dt>Resource</dt>
              <dd>{approval.resource.name}</dd>
            </div>
            {approval.reason ? (
              <div>
                <dt>Reason</dt>
                <dd>{approval.reason}</dd>
              </div>
            ) : null}
          </dl>
          <section className="decisionPermissions" aria-label="Provider connection permissions">
            <h2>Provider scopes</h2>
            <ul>
              {approval.scopes.map((scope) => (
                <li key={scope}>
                  <code>{scope}</code>
                </li>
              ))}
            </ul>
          </section>
          {callbackMismatch ? (
            <Status tone="error">The completed account connection does not match this request.</Status>
          ) : error ? (
            <Status tone="error">{error}</Status>
          ) : null}
          <Button disabled={submitting} onClick={() => void connect()} type="button">
            {approval.accountConnection ? 'Update account connection' : 'Connect account'}
          </Button>
          <Status tone="info">This step only connects the account. Agent access is approved separately.</Status>
        </div>
      ) : null}
    </AuthLayout>
  )
}
