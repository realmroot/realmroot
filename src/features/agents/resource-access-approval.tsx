import type {
  AccessRequestApproval,
  AccountConnection,
  AuthorizationDetailCatalogEntry,
  DecideAccessRequest,
} from '@shared/api/agent-api'
import { CheckCircle2, CircleAlert, XCircle } from 'lucide-react'
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
} from '@/lib/api/account'
import { toLocalDateTimeValue } from '@/lib/date-time'
import { deduplicateRequest } from '@/lib/request-deduplication'

type ApprovalMode = NonNullable<DecideAccessRequest['mode']>
const approvalTokenStorageKey = 'realmroot.resource-access-approval-token'

export function ResourceAccessApproval() {
  const { data: config } = useConfigz()
  const [token, setToken] = useState(readApprovalToken)
  const callback = useMemo(() => new URLSearchParams(window.location.search), [])
  const callbackError =
    callback.get('resource_connection') === 'failed'
      ? (callback.get('error_description') ?? callback.get('error') ?? 'The provider rejected the account connection.')
      : null
  const [request, setRequest] = useState<AccessRequestApproval | null>(null)
  const [connection, setConnection] = useState<AccountConnection | null>(null)
  const [authorizationDetailCatalog, setAuthorizationDetailCatalog] = useState<AuthorizationDetailCatalogEntry[]>([])
  const [authorizationDetailSelections, setAuthorizationDetailSelections] = useState<Record<number, string>>({})
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [agentName, setAgentName] = useState<string | null>(null)
  const [mode, setMode] = useState<ApprovalMode>('once')
  const [expiresAt, setExpiresAt] = useState('')
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(callbackError)

  useEffect(() => {
    const consumeCurrentHash = () => {
      const hashToken = readHashApprovalToken()
      if (!hashToken) return
      window.sessionStorage.setItem(approvalTokenStorageKey, hashToken)
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
      setToken(hashToken)
    }
    consumeCurrentHash()
    window.addEventListener('hashchange', consumeCurrentHash)
    return () => window.removeEventListener('hashchange', consumeCurrentHash)
  }, [])

  useEffect(() => {
    setRequest(null)
    setConnection(null)
    setAuthorizationDetailCatalog([])
    setAuthorizationDetailSelections({})
    setCatalogError(null)
    setAgentName(null)
    setDecision(null)
    setError(callbackError)
    if (!token) {
      setError('This resource access request is incomplete. Start again from the requesting Agent.')
      return
    }
    let active = true
    void deduplicateRequest(`resource-access-approval:${token}`, async () => {
      const accessRequest = await getAgentResourceApproval(token)
      const availableConnections = await listApprovalAccountConnections(token)
      if (availableConnections.items.length > 1) {
        throw new Error('This resource has more than one connected account.')
      }
      const availableConnection = availableConnections.items[0] ?? null
      let catalog: AuthorizationDetailCatalogEntry[] = []
      let authorizationCatalogError: string | null = null
      if (
        availableConnection &&
        accessRequest.authorizationDetails.length > 0 &&
        accessRequest.scopes.every((scope) => availableConnection.scopes.includes(scope))
      ) {
        await loadApprovalAuthorizationDetailCatalog(accessRequest.id, token)
          .then((items) => {
            catalog = items
          })
          .catch((cause: unknown) => {
            authorizationCatalogError =
              cause instanceof Error ? cause.message : 'Unable to load authorization contexts.'
          })
      }
      return { accessRequest, authorizationCatalogError, availableConnection, catalog }
    })
      .then(({ accessRequest, authorizationCatalogError, availableConnection, catalog }) => {
        if (!active) return
        setRequest(accessRequest)
        setConnection(availableConnection)
        setAgentName(accessRequest.agent.name)
        setAuthorizationDetailCatalog(catalog)
        setCatalogError(authorizationCatalogError)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : 'Unable to load the Agent resource request.')
        setSubmitting(false)
      })
    return () => {
      active = false
    }
  }, [callbackError, token])

  async function submit(nextDecision: 'approve' | 'deny') {
    if (!request) {
      setError('This resource access request is not ready.')
      return
    }
    if (nextDecision === 'approve' && mode === 'until' && !isFutureExpiry(expiresAt)) {
      setError('Choose a future expiry date and time.')
      return
    }
    let input: DecideAccessRequest
    if (nextDecision === 'deny') {
      input = { decision: 'deny' }
    } else {
      if (approvedAuthorizationDetails === null) {
        setError('Resolve every authorization detail before approving.')
        return
      }
      input = {
        decision: 'approve',
        mode,
        authorizationDetails: approvedAuthorizationDetails,
        ...(mode === 'until' ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      }
    }
    setSubmitting(true)
    setError(null)
    try {
      await decideAgentResourceApproval(request.id, token, input)
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

  const requiresAccountConnection = request?.requiresAccountConnection ?? true
  const authorizationDetailResolution = resolveAuthorizationDetails(
    request?.authorizationDetails ?? [],
    request?.authorizationDetail?.authorizationDetailTemplates ?? [],
    connection?.authorizationDetails ?? [],
    authorizationDetailCatalog,
    authorizationDetailSelections,
    requiresAccountConnection,
  )
  const approvedAuthorizationDetails = authorizationDetailResolution.approved
  const connectionCoversRequest =
    request !== null &&
    connection !== null &&
    request.scopes.every((scope) => connection.scopes.includes(scope)) &&
    catalogError === null &&
    authorizationDetailResolution.accountAuthorized
  const expiryIsValid = mode !== 'until' || isFutureExpiry(expiresAt)
  const accountAuthorizationStep =
    request && requiresAccountConnection ? (connectionCoversRequest ? null : connection ? 'update' : 'connect') : null

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
      description={
        accountAuthorizationStep === 'update'
          ? `Update the connected ${request!.resourceServer.name} account before reviewing this Agent request.`
          : accountAuthorizationStep === 'connect'
            ? `Connect a ${request!.resourceServer.name} account before reviewing this Agent request.`
            : 'Confirm the Agent, target resource, exact permissions, account, and lifetime before granting access.'
      }
      eyebrow="API authorization"
      layout="decision"
      title="Agent resource access"
    >
      <div className="decisionStack">
        {request ? (
          <dl className="decisionFacts">
            <RequestField id={request.agentId} label="Agent" name={agentName ?? request.agentId} />
            <RequestField id={request.resourceServerId} label="Resource Server" name={request.resourceServer.name} />
            {request.authorizationDetail ? (
              <RequestField
                id={authorizationDetailId(request)}
                label={request.authorizationDetail.metadata.authority ? 'Authority' : 'Context'}
                name={request.authorizationDetail.name}
              />
            ) : null}
            {request.reason ? <RequestField label="Reason" value={request.reason} /> : null}
          </dl>
        ) : null}
        {request ? (
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
        {request && accountAuthorizationStep ? (
          <AccountAuthorizationStep
            connection={connection}
            error={error ?? catalogError}
            onContinue={() => void connectAccount()}
            resourceName={request.resourceServer.name}
            step={accountAuthorizationStep}
            submitting={submitting}
          />
        ) : (
          <>
            {request &&
            authorizationDetailResolution.requirements.some((requirement) => requirement.kind !== 'fixed') ? (
              <section className="decisionPermissions" aria-label="Requested authorization details">
                <h2>Authorization details</h2>
                <div className="grid gap-4">
                  {authorizationDetailResolution.requirements.map((requirement) =>
                    requirement.kind === 'fixed' ? null : (
                      <Field
                        help={
                          requirement.options.length === 0
                            ? 'No matching concrete context is available from this resource.'
                            : undefined
                        }
                        key={requirement.index}
                        label={`Authorization detail ${requirement.index + 1}`}
                      >
                        <SelectInput
                          aria-label={`Authorization detail ${requirement.index + 1}`}
                          onChange={(event) =>
                            setAuthorizationDetailSelections((current) => ({
                              ...current,
                              [requirement.index]: event.target.value,
                            }))
                          }
                          value={authorizationDetailSelections[requirement.index] ?? ''}
                        >
                          <option value="">Select an authorization detail</option>
                          {requirement.options.map((option) => (
                            <option
                              disabled={option.connectionStatus !== 'authorized'}
                              key={canonicalJson(option.authorizationDetail)}
                              value={canonicalJson(option.authorizationDetail)}
                            >
                              {option.display.label}
                            </option>
                          ))}
                        </SelectInput>
                      </Field>
                    ),
                  )}
                </div>
              </section>
            ) : null}
            {request && requiresAccountConnection && connection ? (
              <section className="decisionSection">
                <h2>{request.resourceServer.name} account</h2>
                <p className="font-medium">{connection.displayName}</p>
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
          </>
        )}
        {!request && !error ? <Status>Loading resource access request…</Status> : null}
        {error && !accountAuthorizationStep ? <Status tone="error">{error}</Status> : null}
        {!accountAuthorizationStep ? (
          <div className="decisionActions">
            <Button disabled={!request || submitting} onClick={() => void submit('deny')} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!request || submitting || approvedAuthorizationDetails === null || !expiryIsValid}
              onClick={() => void submit('approve')}
            >
              {submitting ? 'Authorizing…' : 'Authorize'}
            </Button>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  )
}

function AccountAuthorizationStep({
  connection,
  error,
  onContinue,
  resourceName,
  step,
  submitting,
}: {
  connection: AccountConnection | null
  error: string | null
  onContinue: () => void
  resourceName: string
  step: 'connect' | 'update'
  submitting: boolean
}) {
  const updating = step === 'update'
  return (
    <section className="decisionPrerequisite" aria-labelledby="account-authorization-title">
      <div className="decisionPrerequisiteCopy">
        <p className="decisionPrerequisiteEyebrow">
          {updating ? 'Additional permission required' : 'Account required'}
        </p>
        <h2 id="account-authorization-title">
          {updating ? `Update ${resourceName} permissions to continue` : `Connect your ${resourceName} account`}
        </h2>
        <p>
          {updating
            ? `${resourceName} must approve the additional permissions before you can review and authorize this Agent request.`
            : `Realmroot needs a connected ${resourceName} account before you can review and authorize this Agent request.`}
        </p>
      </div>
      {connection ? (
        <div className="decisionAccountSummary">
          <span>Connected account</span>
          <strong>{connection.displayName}</strong>
        </div>
      ) : null}
      {error ? <Status tone="error">{error}</Status> : null}
      <Button disabled={submitting} onClick={onContinue} type="button">
        {submitting ? 'Opening provider…' : updating ? 'Update permissions' : 'Connect account'}
      </Button>
      <p className="decisionPrerequisiteHint">
        You’ll return here automatically after {resourceName} confirms the change.
      </p>
    </section>
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

function readApprovalToken() {
  return readHashApprovalToken() || window.sessionStorage.getItem(approvalTokenStorageKey) || ''
}

function readHashApprovalToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
}

function resolveAuthorizationDetails(
  requested: AccessRequestApproval['authorizationDetails'],
  templates: NonNullable<AccessRequestApproval['authorizationDetail']>['authorizationDetailTemplates'],
  connected: AccountConnection['authorizationDetails'],
  catalog: AuthorizationDetailCatalogEntry[],
  selections: Record<number, string>,
  requiresAccountConnection: boolean,
) {
  if (!requiresAccountConnection) {
    return {
      requirements: requested.map((detail, index) => ({
        index,
        kind: 'fixed' as const,
        requested: detail,
        authorized: true,
      })),
      accountAuthorized: true,
      approved: requested,
    }
  }
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
    accountAuthorized &&= requirement.options.some((option) => option.connectionStatus === 'authorized')
    const selected = requirement.options.find(
      (option) => canonicalJson(option.authorizationDetail) === selections[requirement.index],
    )
    if (selected?.connectionStatus === 'authorized') approved.push(selected.authorizationDetail)
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

function authorizationDetailId(request: AccessRequestApproval) {
  const metadata = request.authorizationDetail?.metadata
  return metadata?.organizationId ?? metadata?.userId ?? String(request.authorizationDetails[0]?.id ?? '')
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
