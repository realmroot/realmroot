import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { approveAgentCapability } from '@/lib/auth-client'

const delegatedAccountCapabilities = [
  'account.profile.read',
  'account.sessions.list',
  'account.authorized_apps.list',
] as const

export function AgentApproval() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const agentId = params.get('agent_id') ?? ''
  const code = params.get('code') ?? ''
  const host = params.get('host') ?? params.get('host_id') ?? ''
  const capabilities = readCapabilities(params)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const missingRequest = !agentId || !code

  async function submit() {
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      await approveAgentCapability({ agentId, userCode: code, capabilities })
      setMessage('Agent access approved.')
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to update agent access.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-12">
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Delegated agent access</p>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">Approve account access</h1>
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
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
            {capabilities.map((capability) => (
              <li className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground" key={capability}>
                {capability}
              </li>
            ))}
          </ul>
        </section>

        {error ? <Status tone="error">{error}</Status> : null}
        {message ? <Status tone="success">{message}</Status> : null}

        <div className="flex flex-wrap gap-3">
          <Button disabled={missingRequest || submitting} onClick={() => void submit()} type="button">
            {submitting ? 'Approving...' : 'Approve'}
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
  return capabilities.length > 0 ? capabilities : [...delegatedAccountCapabilities]
}
