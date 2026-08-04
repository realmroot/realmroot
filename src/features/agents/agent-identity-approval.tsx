import type { Agent, AgentEnrollment } from '@shared/api/agent-api'
import { CircleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Button } from '@/components/ui/button'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import { approveAgentEnrollment, getAgentEnrollment } from '@/lib/api/account'

export function AgentIdentityApproval() {
  const { data: config } = useConfigz()
  const intentId = useMemo(() => new URLSearchParams(window.location.search).get('intent_id') ?? '', [])
  const [intent, setIntent] = useState<AgentEnrollment | null>(null)
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(Boolean(intentId))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!intentId) return
    let active = true
    getAgentEnrollment(intentId)
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
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to approve Agent identity.')
    } finally {
      setSubmitting(false)
    }
  }

  const canApprove = Boolean(intent && intent.status === 'pending' && !agent)
  const isAdditionalHost = intent?.kind === 'additional_host'
  const isRecovery = intent?.kind === 'recovery'

  if (!loading && !intent && !agent) {
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

  return (
    <AuthLayout
      config={config}
      description={
        agent
          ? 'The Agent can now continue. You can close this page.'
          : isRecovery
            ? 'Approve recovery only if every previous installation should be revoked and external Resource access frozen.'
            : isAdditionalHost
              ? 'Review the Agent before trusting this new host.'
              : 'Review the request before creating this Agent identity.'
      }
      eyebrow="Agent enrollment"
      layout={agent ? 'focused' : 'decision'}
      title={
        agent
          ? 'Agent enrollment approved.'
          : isRecovery
            ? 'Recover Agent identity'
            : isAdditionalHost
              ? 'Add trusted host'
              : 'Approve Agent identity'
      }
    >
      <div className="decisionStack">
        {loading ? <Status>Loading Agent enrollment…</Status> : null}
        {!intentId ? (
          <Status tone="warning">
            This Agent enrollment request is incomplete. Start again from the Agent client.
          </Status>
        ) : null}
        {error ? <Status tone="error">{error}</Status> : null}

        {intent ? (
          <dl className="decisionFacts">
            <div>
              <dt>Agent</dt>
              <dd>{intent.name}</dd>
            </div>
            <div>
              <dt>Request</dt>
              <dd>
                {isRecovery
                  ? 'Revoke old installations and recover access'
                  : isAdditionalHost
                    ? 'Add a trusted host'
                    : 'Create a stable identity'}
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{formatHomeSpace(intent)}</dd>
            </div>
          </dl>
        ) : null}

        {agent ? <Status tone="success">{agent.name} is ready on this host.</Status> : null}

        {!agent ? (
          <div className="decisionActions decisionActions-single">
            <Button disabled={!canApprove || submitting} onClick={() => void approve()} type="button">
              {submitting
                ? 'Approving…'
                : isRecovery
                  ? 'Recover Agent'
                  : isAdditionalHost
                    ? 'Add trusted host'
                    : 'Approve Agent identity'}
            </Button>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  )
}

function formatHomeSpace(intent: AgentEnrollment) {
  return intent.homeSpace.type === 'personal' ? 'Personal account' : 'Organization'
}
