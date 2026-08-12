import { oauthError } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { validateDpopTokenProof } from '@server/usecases/dpop'
import type { AgentAssertionSigner } from '@server/usecases/external-resources'
import { authenticateApplicationClient } from '@server/usecases/oauth-client-authentication'
import { applicationEffectiveResourceScopes } from '@server/usecases/resource-scope-entitlements'
import { findRealmrootResourceServer } from '@server/usecases/system-resources'

const accessTokenLifetimeSeconds = 5 * 60

export async function issueApplicationAccessToken(
  deps: Deps,
  input: {
    clientId: string
    clientSecret: string | null
    scope?: string
    resource: string
    expectedResource: string
    dpopProof: string
    tokenEndpoint: string
  },
  signer: AgentAssertionSigner,
) {
  if (input.resource !== input.expectedResource) throw oauthError('invalid_target', 'Unknown OAuth resource.')
  const { application } = await authenticateApplicationClient(deps, input.clientId, input.clientSecret)
  if (!application.allowedGrantTypes.includes('client_credentials')) {
    throw oauthError('unauthorized_client', 'Application is not allowed to use client credentials.')
  }
  const resource = await findRealmrootResourceServer(deps)
  if (!resource || resource.resourceUrl !== input.resource) {
    throw oauthError('invalid_target', 'Realmroot Resource Server is unavailable.')
  }
  const configuredScopes = new Set(
    application.resourceScopes.find((candidate) => candidate.resourceServerId === resource.id)?.scopes ?? [],
  )
  const effectiveScopes = new Set(await applicationEffectiveResourceScopes(deps, application, resource))
  const scopes = normalizeScopes(input.scope)
  if (scopes.some((scope) => !configuredScopes.has(scope) || !effectiveScopes.has(scope))) {
    throw oauthError('invalid_scope', 'Requested scope is not allowed for this Application.')
  }
  const confirmationJkt = await validateDpopTokenProof(deps, input.dpopProof, input.tokenEndpoint).catch(
    (error: Error) => {
      throw oauthError('invalid_dpop_proof', error.message)
    },
  )
  const now = Math.floor(Date.now() / 1000)
  const accessToken = await signer.sign(
    {
      iss: signer.issuer,
      sub: application.id,
      sub_profile: 'application',
      aud: input.resource,
      client_id: application.clientId,
      organization_id: application.ownerOrganizationId,
      scope: scopes.join(' '),
      cnf: { jkt: confirmationJkt },
      iat: now,
      exp: now + accessTokenLifetimeSeconds,
      jti: crypto.randomUUID(),
    },
    'at+jwt',
  )
  return {
    access_token: accessToken,
    token_type: 'DPoP' as const,
    expires_in: accessTokenLifetimeSeconds,
    scope: scopes.join(' '),
  }
}

function normalizeScopes(value?: string) {
  const scopes = [...new Set((value ?? '').split(/\s+/).filter(Boolean))].sort()
  if (scopes.length === 0) throw oauthError('invalid_scope', 'At least one scope is required.')
  return scopes
}
