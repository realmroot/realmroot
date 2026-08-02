import { CheckCircle2, CircleAlert, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import { decideAgentCapability } from '@/lib/auth-client'

export function AgentApproval() {
  const { data: config } = useConfigz()
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
      <AuthLayout
        config={config}
        description={
          approved
            ? isCapabilityRequest
              ? 'The requested Agent permissions have been granted. The Agent can now retry its command.'
              : 'The Agent login has been approved. The client will continue automatically.'
            : isCapabilityRequest
              ? 'The requested Agent permissions were not granted.'
              : 'The Agent login was denied and no identity was created.'
        }
        eyebrow="Agent identity"
        icon={approved ? <CheckCircle2 /> : <XCircle />}
        layout="focused"
        title={approved ? 'Authorization successful' : 'Authorization denied'}
        variant="message"
      >
        <Status tone={approved ? 'success' : 'warning'}>You can safely close this page.</Status>
      </AuthLayout>
    )
  }

  if (missingRequest) {
    return (
      <AuthLayout
        config={config}
        description="Start again from the requesting Agent client."
        eyebrow="Agent identity"
        icon={<CircleAlert aria-hidden="true" />}
        layout="focused"
        title="Agent approval unavailable."
        variant="message"
      >
        <Status tone="warning">This Agent approval request is incomplete.</Status>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      config={config}
      description={
        isCapabilityRequest
          ? 'Grant only the listed account permissions to this existing Agent identity.'
          : 'Create a stable Agent identity and bind this Host. Login grants no external API access.'
      }
      eyebrow="Agent identity"
      layout="decision"
      title={isCapabilityRequest ? 'Approve Agent permissions' : 'Approve Agent login'}
    >
      <div className="decisionStack">
        <dl className="decisionFacts">
          <DecisionField label="Agent" value={agentId} />
          <DecisionField label="Host" value={host || 'Delegated AgentAuth host'} />
          <DecisionField label="Code" value={code} />
        </dl>
        <section className="decisionPermissions" aria-label="Requested capabilities">
          <h2>Requested capabilities</h2>
          {capabilities.length > 0 ? (
            <ul>
              {capabilities.map((capability) => (
                <li key={capability}>
                  <code>{capability}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p>No delegated capabilities are requested by login.</p>
          )}
        </section>
        {error ? <Status tone="error">{error}</Status> : null}
        <div className="decisionActions">
          <Button
            disabled={missingRequest || submitting}
            onClick={() => void submit('deny')}
            type="button"
            variant="outline"
          >
            Deny
          </Button>
          <Button disabled={missingRequest || submitting} onClick={() => void submit('approve')} type="button">
            {submitting ? 'Approving…' : isCapabilityRequest ? 'Approve permissions' : 'Approve login'}
          </Button>
        </div>
      </div>
    </AuthLayout>
  )
}

function DecisionField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function readCapabilities(params: URLSearchParams): string[] {
  const capabilities = params.getAll('capability')
  const scope = params.get('capabilities')
  if (scope) capabilities.push(...scope.split(/[,\s]+/).filter(Boolean))
  return capabilities
}
