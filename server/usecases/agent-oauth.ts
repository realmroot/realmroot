import { oauthError } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { validateDpopTokenProof } from '@server/usecases/dpop'
import type { AgentAssertionSigner, AgentResourcePrincipal } from '@server/usecases/external-resources'
import { agentBootstrapScopes } from '@shared/authz'
import { realmrootAgentBindingClaim, realmrootCliClientId } from '@shared/oauth-token-profile'

const accessTokenLifetimeSeconds = 5 * 60

export async function issueAgentBootstrapAccessToken(
  deps: Deps,
  input: {
    clientId: string
    scope?: string
    resource: string
    expectedResource: string
    dpopProof: string
    tokenEndpoint: string
  },
  principal: AgentResourcePrincipal,
  signer: AgentAssertionSigner,
) {
  // CLI releases predating the fixed public-client identifier omit client_id.
  // Continue accepting that wire shape while normalizing every issued token.
  if (input.clientId && input.clientId !== realmrootCliClientId) {
    throw oauthError('invalid_client', 'Unknown Agent OAuth client.', 401)
  }
  if (input.resource !== input.expectedResource) throw oauthError('invalid_target', 'Unknown OAuth resource.')
  const scopes = normalizeScopes(input.scope)
  const allowed = new Set<string>(agentBootstrapScopes)
  if (scopes.some((scope) => !allowed.has(scope))) {
    throw oauthError('invalid_scope', 'The requested scope requires controller-approved Resource access.')
  }
  const confirmationJkt = await validateDpopTokenProof(deps, input.dpopProof, input.tokenEndpoint).catch(
    (error: unknown) => {
      throw oauthError('invalid_dpop_proof', error instanceof Error ? error.message : 'The DPoP proof is invalid.')
    },
  )
  const now = Math.floor(Date.now() / 1000)
  const accessToken = await signer.sign(
    {
      iss: signer.issuer,
      sub: principal.subject,
      aud: input.resource,
      client_id: realmrootCliClientId,
      [realmrootAgentBindingClaim]: {
        protocol_agent_id: principal.protocolAgentId,
        host_id: principal.hostId,
      },
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
  const scopes = [...new Set((value ?? agentBootstrapScopes.join(' ')).split(/\s+/).filter(Boolean))]
  if (scopes.length === 0) throw oauthError('invalid_scope', 'At least one scope is required.')
  return scopes.sort()
}
