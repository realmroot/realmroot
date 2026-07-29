import type { AgentEnrollmentIntent, AgentIdentity } from '@shared/api/agents'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { approveAgentEnrollmentIntent, getAgentEnrollmentIntent } from '@/lib/api/account'

export function AgentIdentityApproval() {
  const intentId = useMemo(() => new URLSearchParams(window.location.search).get('intent_id') ?? '', [])
  const [intent, setIntent] = useState<AgentEnrollmentIntent | null>(null)
  const [identity, setIdentity] = useState<AgentIdentity | null>(null)
  const [loading, setLoading] = useState(Boolean(intentId))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!intentId) return
    let active = true
    getAgentEnrollmentIntent(intentId)
      .then((result) => {
        if (active) setIntent(result)
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load Agent enrollment.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [intentId])

  async function approve() {
    setSubmitting(true)
    setError(null)
    try {
      const result = await approveAgentEnrollmentIntent(intentId)
      setIdentity(result.identity)
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to approve Agent identity.')
    } finally {
      setSubmitting(false)
    }
  }

  const canApprove = Boolean(intent && intent.status === 'pending' && !identity)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-12">
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Stable Agent identity</p>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">Approve Agent identity</h1>
          <p className="text-sm text-muted-foreground">
            This binds an approved AgentAuth registration to a durable issuer and subject.
          </p>
        </div>

        {loading ? <Status>Loading Agent enrollment...</Status> : null}
        {!intentId ? <Status tone="error">Missing enrollment intent.</Status> : null}
        {error ? <Status tone="error">{error}</Status> : null}

        {intent ? (
          <dl className="grid gap-3 rounded-md border border-border bg-card p-4 text-sm sm:grid-cols-2">
            <div className="grid gap-1">
              <dt className="font-medium text-muted-foreground">Agent</dt>
              <dd className="break-all text-foreground">{intent.requestedName}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="font-medium text-muted-foreground">Home space</dt>
              <dd className="break-all text-foreground">{formatHomeSpace(intent)}</dd>
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <dt className="font-medium text-muted-foreground">Protocol registration</dt>
              <dd className="break-all font-mono text-xs text-foreground">{intent.protocolAgentId}</dd>
            </div>
          </dl>
        ) : null}

        {identity ? (
          <Status tone="success">
            Agent identity approved: {identity.issuer} · {identity.subject}
          </Status>
        ) : null}

        <Button disabled={!canApprove || submitting} onClick={() => void approve()} type="button">
          {submitting ? 'Approving...' : 'Approve stable identity'}
        </Button>
      </div>
    </main>
  )
}

function formatHomeSpace(intent: AgentEnrollmentIntent) {
  return intent.homeSpace.type === 'personal'
    ? `Personal · ${intent.homeSpace.userId}`
    : `Organization · ${intent.homeSpace.organizationId}`
}
