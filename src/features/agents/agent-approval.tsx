import { CheckCircle2, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { decideAgentCapability } from '@/lib/auth-client'

export function AgentApproval() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const agentId = params.get('agent_id') ?? ''
  const code = params.get('code') ?? ''
  const host = params.get('host') ?? params.get('host_id') ?? ''
  const capabilities = readCapabilities(params)
  const isCapabilityRequest = capabilities.length > 0
  const [submitting, setSubmitting] = useState(false)
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const missingRequest = !agentId || !code

  async function submit(action: 'approve' | 'deny') {
    setSubmitting(true)
    setError(null)
    try {
      await decideAgentCapability({
        agentId,
        userCode: code,
        action,
        capabilities: capabilities.length > 0 ? capabilities : undefined,
      })
      setDecision(action === 'approve' ? 'approved' : 'denied')
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to update agent access.')
    } finally {
      setSubmitting(false)
    }
  }

  if (decision) {
    const approved = decision === 'approved'
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-12">
        <section
          aria-labelledby="approval-complete-title"
          className="w-full rounded-xl border border-border bg-card px-6 py-10 text-center shadow-sm sm:px-10 sm:py-12"
          role="status"
        >
          <div
            className={`mx-auto flex size-16 items-center justify-center rounded-full ${
              approved ? 'status-success' : 'status-error'
            }`}
          >
            {approved ? (
              <CheckCircle2 aria-hidden="true" className="size-9" />
            ) : (
              <XCircle aria-hidden="true" className="size-9" />
            )}
          </div>
          <p className="mt-6 text-sm font-medium text-muted-foreground">Agent identity</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground" id="approval-complete-title">
            {approved ? 'Authorization successful' : 'Authorization denied'}
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">
            {approved
              ? isCapabilityRequest
                ? 'The requested Agent permissions have been granted. The Agent can now retry its Restish command.'
                : 'The Agent login has been approved. Restish will continue automatically.'
              : isCapabilityRequest
                ? 'The requested Agent permissions were not granted. Restish will stop waiting for this request.'
                : 'The Agent login was denied. Restish will stop waiting and the Agent identity will not be created.'}
          </p>
          <p className="mt-6 rounded-md bg-muted px-4 py-3 text-sm font-medium text-foreground">
            You can safely close this page.
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-12">
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Agent identity</p>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">
            {isCapabilityRequest ? 'Approve Agent permissions' : 'Approve Agent login'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isCapabilityRequest
              ? 'This grants the listed permissions to the existing Agent identity. It does not sign the Agent in as you.'
              : 'This creates a stable Agent identity and binds this Host to it. Login alone grants no external API resource access.'}
          </p>
        </div>

        <dl className="grid gap-3 rounded-md border border-border bg-card p-4 text-sm sm:grid-cols-2">
          <div className="grid gap-1">
            <dt className="font-medium text-muted-foreground">Agent</dt>
            <dd className="break-all text-foreground">{agentId || 'Missing agent id'}</dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-medium text-muted-foreground">Host</dt>
            <dd className="break-all text-foreground">{host || 'Delegated AgentAuth host'}</dd>
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <dt className="font-medium text-muted-foreground">Code</dt>
            <dd className="font-mono text-foreground">{code || 'Missing code'}</dd>
          </div>
        </dl>

        <section className="rounded-md border border-border bg-card p-4" aria-label="Requested capabilities">
          <h2 className="text-sm font-semibold tracking-normal text-foreground">Requested capabilities</h2>
          {capabilities.length > 0 ? (
            <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
              {capabilities.map((capability) => (
                <li className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground" key={capability}>
                  {capability}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No delegated capabilities are requested by login.</p>
          )}
        </section>

        {error ? <Status tone="error">{error}</Status> : null}
        <div className="flex flex-wrap gap-3">
          <Button disabled={missingRequest || submitting} onClick={() => void submit('approve')} type="button">
            {submitting ? 'Approving...' : isCapabilityRequest ? 'Approve permissions' : 'Approve login'}
          </Button>
          <Button
            disabled={missingRequest || submitting}
            onClick={() => void submit('deny')}
            type="button"
            variant="danger"
          >
            {submitting ? 'Updating...' : 'Deny'}
          </Button>
        </div>
      </div>
    </main>
  )
}

function readCapabilities(params: URLSearchParams): string[] {
  const capabilities = params.getAll('capability')
  const scope = params.get('capabilities')
  if (scope) capabilities.push(...scope.split(/[,\s]+/).filter(Boolean))
  return capabilities
}
