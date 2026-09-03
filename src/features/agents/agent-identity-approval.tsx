import type { Agent, AgentEnrollment } from '@shared/api/agent-api'
import type { AgentApprovalPreview } from '@shared/api/agents'
import { CheckCircle2, CircleAlert, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import { approveAgentEnrollment, getAgentApprovalPreview, getAgentEnrollment } from '@/lib/api/account'
import { decideProtocolAgentEnrollment } from '@/lib/auth-client'
import { deduplicateRequest } from '@/lib/request-deduplication'

export function AgentIdentityApproval() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const intentId = params.get('intent_id') ?? ''
  const agentId = params.get('agent_id') ?? ''
  const code = params.get('code') ?? ''
  return intentId ? (
    <InstallationEnrollment intentId={intentId} />
  ) : (
    <ProtocolEnrollment agentId={agentId} code={code} />
  )
}

function ProtocolEnrollment({ agentId, code }: { agentId: string; code: string }) {
  const { data: config } = useConfigz()
  const missingRequest = !agentId || !code
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState<AgentApprovalPreview | null>(null)
  const [loading, setLoading] = useState(!missingRequest)
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (missingRequest) return
    let active = true
    getAgentApprovalPreview(agentId, code)
      .then((result) => {
        if (active) setPreview(result)
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
  }, [agentId, code, missingRequest])

  async function submit(action: 'approve' | 'deny') {
    setSubmitting(true)
    setError(null)
    try {
      await decideProtocolAgentEnrollment({ agentId, userCode: code, action })
      setDecision(action === 'approve' ? 'approved' : 'denied')
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to decide Agent enrollment.')
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
            ? 'The Agent is enrolled and the client will continue automatically.'
            : 'The enrollment was denied and no Agent identity was created.'
        }
        eyebrow="Agent enrollment"
        icon={approved ? <CheckCircle2 /> : <XCircle />}
        layout="focused"
        title={approved ? 'Agent enrollment approved.' : 'Agent enrollment denied.'}
        variant="message"
      >
        <Status tone={approved ? 'success' : 'warning'}>You can safely close this page.</Status>
      </AuthLayout>
    )
  }

  if (missingRequest) return <UnavailableEnrollment config={config} />

  return (
    <AuthLayout
      config={config}
      description="Create a stable Agent identity and trust this host. Enrollment grants no resource access."
      eyebrow="Agent enrollment"
      layout="decision"
      title="Approve Agent enrollment"
    >
      <div className="decisionStack">
        {loading ? <Status>Loading Agent enrollment…</Status> : null}
        {preview ? (
          <dl className="decisionFacts">
            <DecisionField id={preview.agent.id} label="Agent" value={preview.agent.name} />
            <DecisionField id={preview.host.id} label="Host" value={preview.host.name ?? 'Unnamed host'} />
            <DecisionField label="Verification code" value={code} />
          </dl>
        ) : null}
        {error ? <Status tone="error">{error}</Status> : null}
        <div className="decisionActions">
          <Button disabled={!preview || submitting} onClick={() => void submit('deny')} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={!preview || submitting} onClick={() => void submit('approve')} type="button">
            {submitting ? 'Authorizing…' : 'Authorize'}
          </Button>
        </div>
      </div>
    </AuthLayout>
  )
}

function InstallationEnrollment({ intentId }: { intentId: string }) {
  const { data: config } = useConfigz()
  const [intent, setIntent] = useState<AgentEnrollment | null>(null)
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    deduplicateRequest(`agent-enrollment:${intentId}`, () => getAgentEnrollment(intentId))
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
      const result = await approveAgentEnrollment(intentId)
      setAgent(result.agent)
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to approve Agent enrollment.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!loading && !intent && !agent) return <UnavailableEnrollment config={config} error={error} />

  const isAdditionalHost = intent?.kind === 'additional_host'
  return (
    <AuthLayout
      config={config}
      description={
        agent
          ? 'The Agent can now continue. You can close this page.'
          : isAdditionalHost
            ? 'Review the Agent before trusting this new host.'
            : 'Review the request before creating this Agent identity.'
      }
      eyebrow="Agent enrollment"
      layout={agent ? 'focused' : 'decision'}
      title={agent ? 'Agent enrollment approved.' : isAdditionalHost ? 'Add trusted host' : 'Approve Agent enrollment'}
    >
      <div className="decisionStack">
        {loading ? <Status>Loading Agent enrollment…</Status> : null}
        {error ? <Status tone="error">{error}</Status> : null}
        {intent ? (
          <dl className="decisionFacts">
            <DecisionField label="Agent" value={intent.nickname} />
            <DecisionField
              label="Request"
              value={isAdditionalHost ? 'Add a trusted host' : 'Create a stable identity'}
            />
            <DecisionField label="Owner" value="Personal account" />
          </dl>
        ) : null}
        {agent ? <Status tone="success">{agent.name} is ready on this host.</Status> : null}
        {!agent ? (
          <div className="decisionActions decisionActions-single">
            <Button
              disabled={!intent || intent.status !== 'pending' || submitting}
              onClick={() => void approve()}
              type="button"
            >
              {submitting ? 'Authorizing…' : 'Authorize'}
            </Button>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  )
}

function UnavailableEnrollment({
  config,
  error,
}: {
  config: Parameters<typeof AuthLayout>[0]['config']
  error?: string | null
}) {
  return (
    <AuthLayout
      config={config}
      description="Start again from the requesting Agent client."
      eyebrow="Agent enrollment"
      icon={<CircleAlert aria-hidden="true" />}
      layout="focused"
      title="Agent enrollment unavailable."
      variant="message"
    >
      <Status tone={error ? 'error' : 'warning'}>{error ?? 'This Agent enrollment request is incomplete.'}</Status>
    </AuthLayout>
  )
}

function DecisionField({ label, value, id }: { label: string; value: string; id?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        {id && id !== value ? <code>{id}</code> : null}
      </dd>
    </div>
  )
}
