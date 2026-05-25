import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { approveAgentCapability } from '@/lib/auth-client'

export function AgentApproveRoute() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const agentId = params.get('agent_id') ?? ''
  const code = params.get('code') ?? ''
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      await approveAgentCapability({
        agentId,
        userCode: code,
        capabilities: ['account.profile.read', 'account.sessions.list', 'account.authorized_apps.list'],
      })
      setMessage('Agent access approved.')
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to update agent access.')
    } finally {
      setSubmitting(false)
    }
  }

  const missingRequest = !agentId || !code

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-12">
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Delegated agent access</p>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">Approve account access</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            This agent is requesting read-only access to your profile, sessions, and authorized apps.
          </p>
        </div>

        <dl className="grid gap-3 rounded-md border border-border bg-card p-4 text-sm">
          <div className="grid gap-1">
            <dt className="font-medium text-muted-foreground">Agent</dt>
            <dd className="break-all text-foreground">{agentId || 'Missing agent id'}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-medium text-muted-foreground">Code</dt>
            <dd className="font-mono text-foreground">{code || 'Missing code'}</dd>
          </div>
        </dl>

        {error ? <Status tone="error">{error}</Status> : null}
        {message ? <Status tone="success">{message}</Status> : null}

        <div className="flex flex-wrap gap-3">
          <Button disabled={missingRequest || submitting} onClick={submit} type="button">
            {submitting ? 'Approving...' : 'Approve'}
          </Button>
        </div>
      </div>
    </main>
  )
}
