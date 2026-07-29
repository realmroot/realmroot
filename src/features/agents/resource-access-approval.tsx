import type { AccessRequest, DecideAccessRequest } from '@shared/api/agent-api'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { decideAgentResourceApproval, getAgentResourceApproval } from '@/lib/api/account'

type ApprovalMode = NonNullable<DecideAccessRequest['mode']>

export function ResourceAccessApproval() {
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '', [])
  const [request, setRequest] = useState<AccessRequest | null>(null)
  const [mode, setMode] = useState<ApprovalMode>('once')
  const [expiresAt, setExpiresAt] = useState('')
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('Approval token is missing.')
      return
    }
    void getAgentResourceApproval(token)
      .then(setRequest)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Unable to load the Agent resource request.')
      })
  }, [token])

  async function submit(nextDecision: 'approve' | 'deny') {
    setSubmitting(true)
    setError(null)
    try {
      const input: DecideAccessRequest =
        nextDecision === 'deny'
          ? { decision: 'deny' }
          : {
              decision: 'approve',
              mode,
              ...(mode === 'until' ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
            }
      await decideAgentResourceApproval(request!.id, token, input)
      setDecision(nextDecision === 'approve' ? 'approved' : 'denied')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to decide the Agent resource request.')
    } finally {
      setSubmitting(false)
    }
  }

  if (decision) {
    const approved = decision === 'approved'
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-12">
        <section
          className="w-full rounded-xl border border-border bg-card px-6 py-10 text-center shadow-sm"
          role="status"
        >
          {approved ? <CheckCircle2 className="mx-auto size-12" /> : <XCircle className="mx-auto size-12" />}
          <h1 className="mt-5 text-2xl font-semibold">
            {approved ? 'Resource access approved' : 'Resource access denied'}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The Agent can now continue polling. You can close this page.
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-12">
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">API authorization</p>
          <h1 className="text-2xl font-semibold">Approve Agent resource access</h1>
          <p className="text-sm text-muted-foreground">
            Confirm the exact resource, permissions, Agent, and host before granting access.
          </p>
        </div>
        {request?.target.type === 'api-resource' ? (
          <dl className="grid gap-3 rounded-md border border-border bg-card p-4 text-sm sm:grid-cols-2">
            <RequestField label="Agent" value={request.agentId} />
            {request.target.accountConnectionId ? (
              <RequestField label="Resource account" value={request.target.accountConnectionId} />
            ) : null}
            <RequestField label="Resource" value={request.target.apiResourceId} />
            <RequestField label="Exact permissions" value={request.permissions.join(' ')} wide />
            {request.reason ? <RequestField label="Reason" value={request.reason} wide /> : null}
          </dl>
        ) : null}
        <fieldset className="space-y-3 rounded-md border border-border bg-card p-4" disabled={!request || submitting}>
          <legend className="px-1 text-sm font-semibold">Grant lifetime</legend>
          {(['once', 'until', 'persistent'] as const).map((value) => (
            <label className="flex items-center gap-2 text-sm" key={value}>
              <input checked={mode === value} name="mode" onChange={() => setMode(value)} type="radio" />
              {value === 'once'
                ? 'One target token'
                : value === 'until'
                  ? 'Until a date and time'
                  : 'Persistent until revoked'}
            </label>
          ))}
          {mode === 'until' ? (
            <input
              aria-label="Grant expiry"
              className="uiInput"
              min={new Date().toISOString().slice(0, 16)}
              onChange={(event) => setExpiresAt(event.target.value)}
              required
              type="datetime-local"
              value={expiresAt}
            />
          ) : null}
        </fieldset>
        {error ? <Status tone="error">{error}</Status> : null}
        <div className="flex gap-3">
          <Button
            disabled={!request || submitting || (mode === 'until' && !expiresAt)}
            onClick={() => void submit('approve')}
          >
            {submitting ? 'Updating…' : 'Approve exact access'}
          </Button>
          <Button disabled={!request || submitting} onClick={() => void submit('deny')} variant="danger">
            Deny
          </Button>
        </div>
      </div>
    </main>
  )
}

function RequestField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`grid gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs text-foreground">{value}</dd>
    </div>
  )
}
