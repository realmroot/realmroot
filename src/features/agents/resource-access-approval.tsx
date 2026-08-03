import type {
  AccessRequestApproval,
  AccountConnection,
  AuthorizationDetailCatalogEntry,
  DecideAccessRequest,
} from '@shared/api/agent-api'
import { CheckCircle2, CircleAlert, Link2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AuthLayout } from '@/components/layout/auth-layout'
import { Field, SelectInput, TextInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Status } from '@/components/ui/status'
import { useConfigz } from '@/features/auth/hooks'
import {
  createAccountConnection,
  decideAgentResourceApproval,
  getAgentResourceApproval,
  listApprovalAccountConnections,
  listApprovalAuthorizationDetailCatalog,
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
  const [authorizationDetailCatalog, setAuthorizationDetailCatalog] = useState<AuthorizationDetailCatalogEntry[]>([])
  const [authorizationDetailSelections, setAuthorizationDetailSelections] = useState<Record<number, string>>({})
  const [catalogError, setCatalogError] = useState<string | null>(null)
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
        const availableConnection = availableConnections.items[0] ?? null
        setRequest(accessRequest)
        setConnection(availableConnection)
        setAgentName(accessRequest.agent.name)
        setResourceName(accessRequest.resource.name)
        setRequiresAccountConnection(resources.items.some((resource) => resource.id === accessRequest.resource.id))
        if (
          availableConnection &&
          accessRequest.authorizationDetails.length > 0 &&
          accessRequest.scopes.every((scope) => availableConnection.scopes.includes(scope))
        ) {
          await loadApprovalAuthorizationDetailCatalog(accessRequest.id, token)
            .then(setAuthorizationDetailCatalog)
            .catch((cause: unknown) => {
              setCatalogError(cause instanceof Error ? cause.message : 'Unable to load authorization contexts.')
            })
        }
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

  const authorizationDetailResolution = resolveAuthorizationDetails(
    request?.authorizationDetails ?? [],
    request?.resource.authorizationDetailTemplates ?? [],
    connection?.authorizationDetails ?? [],
    authorizationDetailCatalog,
    authorizationDetailSelections,
  )
  const approvedAuthorizationDetails = authorizationDetailResolution.approved
  const connectionCoversRequest =
    request !== null &&
    connection !== null &&
    request.scopes.every((scope) => connection.scopes.includes(scope)) &&
    catalogError === null &&
    authorizationDetailResolution.accountAuthorized
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
            <div className="grid gap-4">
              {authorizationDetailResolution.requirements.map((requirement) =>
                requirement.kind === 'fixed' ? (
                  <div className="grid gap-1" key={requirement.index}>
                    <strong className="text-sm">Fixed context</strong>
                    <code className="break-all text-xs">{canonicalJson(requirement.requested)}</code>
                  </div>
                ) : (
                  <Field
                    help={
                      requirement.options.length === 0
                        ? 'No matching concrete context is available from this resource.'
                        : undefined
                    }
                    key={requirement.index}
                    label={`Authorization context ${requirement.index + 1}`}
                  >
                    <SelectInput
                      aria-label={`Authorization context ${requirement.index + 1}`}
                      onChange={(event) =>
                        setAuthorizationDetailSelections((current) => ({
                          ...current,
                          [requirement.index]: event.target.value,
                        }))
                      }
                      value={authorizationDetailSelections[requirement.index] ?? ''}
                    >
                      <option value="">Select one context</option>
                      {requirement.options.map((option) => (
                        <option
                          disabled={!option.connectionAuthorized}
                          key={canonicalJson(option.authorizationDetail)}
                          value={canonicalJson(option.authorizationDetail)}
                        >
                          {option.display.label}
                          {option.agentGrants.length > 0 ? ' — already granted' : ''}
                          {!option.connectionAuthorized ? ' — reconnect account to authorize' : ''}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                ),
              )}
            </div>
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
                {catalogError ? <Status tone="error">{catalogError}</Status> : null}
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
              !request ||
              submitting ||
              (requiresAccountConnection && (!connectionCoversRequest || approvedAuthorizationDetails === null)) ||
              !expiryIsValid
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

async function loadApprovalAuthorizationDetailCatalog(requestId: string, token: string) {
  const items: AuthorizationDetailCatalogEntry[] = []
  let nextOffset: number | null = 0
  while (nextOffset !== null) {
    const page = await listApprovalAuthorizationDetailCatalog(requestId, token, { limit: 100, offset: nextOffset })
    items.push(...page.items)
    nextOffset = page.pagination.nextOffset
  }
  return items
}

function clearStoredApproval() {
  window.sessionStorage.removeItem(approvalTokenStorageKey)
}

function resolveAuthorizationDetails(
  requested: AccessRequestApproval['authorizationDetails'],
  templates: AccessRequestApproval['resource']['authorizationDetailTemplates'],
  connected: AccountConnection['authorizationDetails'],
  catalog: AuthorizationDetailCatalogEntry[],
  selections: Record<number, string>,
) {
  const requirements = requested.map((detail, index) => {
    const exactConnected = connected.some((candidate) => canonicalJson(candidate) === canonicalJson(detail))
    const generic = templates.some((template) => canonicalJson(template) === canonicalJson(detail))
    if (!generic) {
      return { index, kind: 'fixed' as const, requested: detail, authorized: exactConnected }
    }
    return {
      index,
      kind: 'selection' as const,
      requested: detail,
      options: catalog.filter((candidate) => matchesTemplate(candidate.authorizationDetail, detail)),
    }
  })
  const approved: AccessRequestApproval['authorizationDetails'] = []
  let accountAuthorized = true
  for (const requirement of requirements) {
    if (requirement.kind === 'fixed') {
      accountAuthorized &&= requirement.authorized
      if (requirement.authorized) approved.push(requirement.requested)
      continue
    }
    accountAuthorized &&= requirement.options.some((option) => option.connectionAuthorized)
    const selected = requirement.options.find(
      (option) => canonicalJson(option.authorizationDetail) === selections[requirement.index],
    )
    if (selected?.connectionAuthorized) approved.push(selected.authorizationDetail)
  }
  return {
    requirements,
    accountAuthorized,
    approved: approved.length === requested.length ? approved : null,
  }
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
