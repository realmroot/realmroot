import type { AccessRequestApproval, AccountConnection, DecideAccessRequest } from '@shared/api/agent-api'
import { CheckCircle2, CircleAlert, Link2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Field, TextInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import {
  createAccountConnection,
  decideAgentResourceApproval,
  getAgentResourceApproval,
  listApprovalAccountConnections,
  listExternalApiResources,
} from '@/lib/api/account'
import { toLocalDateTimeValue } from '@/lib/date-time'

type ApprovalMode = NonNullable<DecideAccessRequest['mode']>
const approvalTokenStorageKey = 'realmroot.resource-access-approval-token'

export function ResourceAccessApproval() {
  const { data: config } = useConfigz()
  const token = useMemo(() => {
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get('token')
    if (hashToken) {
      window.sessionStorage.setItem(approvalTokenStorageKey, hashToken)
      return hashToken
    }
    return window.sessionStorage.getItem(approvalTokenStorageKey) ?? ''
  }, [])
  const [request, setRequest] = useState<AccessRequestApproval | null>(null)
  const [connection, setConnection] = useState<AccountConnection | null>(null)
  const [agentName, setAgentName] = useState<string | null>(null)
  const [resourceName, setResourceName] = useState<string | null>(null)
  const [requiresAccountConnection, setRequiresAccountConnection] = useState(false)
  const [mode, setMode] = useState<ApprovalMode>('once')
  const [expiresAt, setExpiresAt] = useState('')
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('This resource access request is incomplete. Start again from the requesting Agent.')
      return
    }
    void getAgentResourceApproval(token)
      .then(async (accessRequest) => {
        const [availableConnections, resources] = await Promise.all([
          listApprovalAccountConnections(token),
          listExternalApiResources(),
        ])
        if (availableConnections.items.length > 1) {
          throw new Error('This resource has more than one connected account.')
        }
        setRequest(accessRequest)
        setConnection(availableConnections.items[0] ?? null)
        setAgentName(accessRequest.agent.name)
        setResourceName(accessRequest.resource.name)
        setRequiresAccountConnection(resources.items.some((resource) => resource.id === accessRequest.resource.id))
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Unable to load the Agent resource request.')
        setSubmitting(false)
      })
  }, [token])

  async function submit(nextDecision: 'approve' | 'deny') {
    if (nextDecision === 'approve' && mode === 'until' && !isFutureExpiry(expiresAt)) {
      setError('Choose a future expiry date and time.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const input: DecideAccessRequest =
        nextDecision === 'deny'
          ? { decision: 'deny' }
          : {
              decision: 'approve',
              mode,
              authorizationDetails: approvedAuthorizationDetails!,
              ...(connection ? { accountConnectionId: connection.id } : {}),
              ...(mode === 'until' ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
            }
      await decideAgentResourceApproval(request!.id, token, input)
      clearStoredApproval()
      setDecision(nextDecision === 'approve' ? 'approved' : 'denied')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to decide the Agent resource request.')
    } finally {
      setSubmitting(false)
    }
  }

  async function connectAccount() {
    setSubmitting(true)
    setError(null)
    try {
      const connection = await createAccountConnection({
        context: 'access-request',
        accessRequestId: request!.id,
        approvalToken: token,
      })
      if (!connection.authorizationUrl) throw new Error('The authorization URL was not returned.')
      window.location.assign(connection.authorizationUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start account authorization.')
      setSubmitting(false)
    }
  }

  const approvedAuthorizationDetails =
    request && connection
      ? resolveAuthorizationDetails(request.authorizationDetails, connection.authorizationDetails)
      : request?.authorizationDetails
  const connectionCoversRequest =
    request !== null &&
    connection !== null &&
    request.scopes.every((scope) => connection.scopes.includes(scope)) &&
    approvedAuthorizationDetails !== null
  const expiryIsValid = mode !== 'until' || isFutureExpiry(expiresAt)

  if (decision) {
    const approved = decision === 'approved'
    return (
      <AuthLayout
        config={config}
        description={
          approved
            ? 'The Agent can continue with the approved authority.'
            : 'The Agent was not granted resource access.'
        }
        eyebrow="API authorization"
        icon={approved ? <CheckCircle2 /> : <XCircle />}
        layout="focused"
        title={approved ? 'Resource access approved' : 'Resource access denied'}
        variant="message"
      >
        <Status tone={approved ? 'success' : 'warning'}>You can safely close this page.</Status>
      </AuthLayout>
    )
  }

  if (error && !request) {
    return (
      <AuthLayout
        config={config}
        description="Start again from the requesting Agent."
        eyebrow="API authorization"
        icon={<CircleAlert aria-hidden="true" />}
        layout="focused"
        title="Resource access unavailable."
        variant="message"
      >
        <Status tone="error">{error}</Status>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      config={config}
      description="Confirm the Agent, target resource, exact permissions, account, and lifetime before granting access."
      eyebrow="API authorization"
      layout="decision"
      title="Approve Agent resource access"
    >
      <div className="decisionStack">
        {request?.target.type === 'api-resource' ? (
          <dl className="decisionFacts">
            <RequestField id={request.agentId} label="Agent" name={agentName ?? request.agentId} />
            <RequestField
              id={request.target.apiResourceId}
              label="Resource"
              name={resourceName ?? request.target.apiResourceId}
            />
            {request.reason ? <RequestField label="Reason" value={request.reason} /> : null}
          </dl>
        ) : null}
        {request?.target.type === 'api-resource' ? (
          <section className="decisionPermissions" aria-label="Requested permissions">
            <h2>Requested permissions</h2>
            <ul>
              {request.scopes.map((scope) => (
                <li key={scope}>
                  <code>{scope}</code>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {request?.target.type === 'api-resource' && request.authorizationDetails.length > 0 ? (
          <section className="decisionPermissions" aria-label="Requested authorization details">
            <h2>Authorization context</h2>
            <pre className="whitespace-pre-wrap break-all text-xs">
              <code>
                {(approvedAuthorizationDetails ?? request.authorizationDetails).map(canonicalJson).join('\n')}
              </code>
            </pre>
          </section>
        ) : null}
        {request?.target.type === 'api-resource' && resourceName && requiresAccountConnection && connection ? (
          <section className="decisionSection">
            <h2>{resourceName} account</h2>
            <div>
              <p className="font-medium">{connection.displayName}</p>
              <p className="text-xs text-muted-foreground">
                <code>{connection.scopes.join(' ')}</code>
              </p>
            </div>
            {!connectionCoversRequest ? (
              <>
                <p>This account needs expanded authorization before it can cover every requested scope.</p>
                <Button disabled={submitting} onClick={() => void connectAccount()} type="button" variant="outline">
                  <Link2 data-icon="inline-start" />
                  Expand {resourceName} account access
                </Button>
                <p>After OAuth, you will return here to approve the Agent’s exact scopes and lifetime separately.</p>
              </>
            ) : null}
          </section>
        ) : null}
        {request?.target.type === 'api-resource' && resourceName && requiresAccountConnection && !connection ? (
          <section className="decisionSection">
            <h2>{resourceName} account</h2>
            <p>Connect your {resourceName} account before deciding this Agent request.</p>
            <Button disabled={submitting} onClick={() => void connectAccount()} type="button" variant="outline">
              <Link2 data-icon="inline-start" />
              Connect {resourceName} account
            </Button>
            <p>
              The connection receives the resource’s current scope catalog. After OAuth, you will return here to approve
              the Agent’s exact scopes and lifetime separately.
            </p>
          </section>
        ) : null}
        <section className="decisionSection" aria-label="Grant lifetime">
          <h2>Grant lifetime</h2>
          <RadioGroup
            disabled={!request || submitting}
            onValueChange={(value) => setMode(value as ApprovalMode)}
            value={mode}
          >
            {(['once', 'until', 'persistent'] as const).map((value) => (
              <label className="decisionRadio" htmlFor={`grant-lifetime-${value}`} key={value}>
                <RadioGroupItem
                  aria-label={
                    value === 'once'
                      ? 'One target token'
                      : value === 'until'
                        ? 'Until a date and time'
                        : 'Persistent until revoked'
                  }
                  id={`grant-lifetime-${value}`}
                  value={value}
                />
                <span>
                  <strong>
                    {value === 'once'
                      ? 'One target token'
                      : value === 'until'
                        ? 'Until a date and time'
                        : 'Persistent until revoked'}
                  </strong>
                  <small>
                    {value === 'once'
                      ? 'Issue one target token for this approved operation.'
                      : value === 'until'
                        ? 'Permit access until the exact date and time below.'
                        : 'Keep access active until you explicitly revoke it.'}
                  </small>
                </span>
              </label>
            ))}
          </RadioGroup>
          {mode === 'until' ? (
            <Field label="Expiry date and time">
              <TextInput
                aria-label="Grant expiry"
                aria-invalid={expiresAt.length > 0 && !expiryIsValid}
                min={toLocalDateTimeValue()}
                onChange={(event) => setExpiresAt(event.target.value)}
                required
                type="datetime-local"
                value={expiresAt}
              />
            </Field>
          ) : null}
        </section>
        {!request && !error ? <Status>Loading resource access request…</Status> : null}
        {error ? <Status tone="error">{error}</Status> : null}
        <div className="decisionActions">
          <Button disabled={!request || submitting} onClick={() => void submit('deny')} variant="outline">
            Deny
          </Button>
          <Button
            disabled={
              !request || submitting || (requiresAccountConnection && !connectionCoversRequest) || !expiryIsValid
            }
            onClick={() => void submit('approve')}
          >
            {submitting ? 'Updating…' : 'Approve exact access'}
          </Button>
        </div>
      </div>
    </AuthLayout>
  )
}

function isFutureExpiry(value: string) {
  return value.length > 0 && new Date(value).getTime() > Date.now()
}

function clearStoredApproval() {
  window.sessionStorage.removeItem(approvalTokenStorageKey)
}

function resolveAuthorizationDetails(
  requested: AccessRequestApproval['authorizationDetails'],
  connected: AccountConnection['authorizationDetails'],
) {
  const matches = connected.filter((candidate) => requested.some((template) => matchesTemplate(candidate, template)))
  if (requested.some((template) => !matches.some((candidate) => matchesTemplate(candidate, template)))) return null
  return [...new Map(matches.map((detail) => [canonicalJson(detail), detail])).values()]
}

function matchesTemplate(candidate: Record<string, unknown>, template: Record<string, unknown>) {
  return Object.entries(template).every(([key, value]) => canonicalJson(candidate[key]) === canonicalJson(value))
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function RequestField({ label, value, name, id }: { label: string; value?: string; name?: string; id?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {name ? <span>{name}</span> : value}
        {id && id !== name ? <code>{id}</code> : null}
      </dd>
    </div>
  )
}
