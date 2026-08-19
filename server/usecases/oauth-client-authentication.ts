import { oauthError } from '@server/domain/errors'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'

export async function authenticateApplicationClient(deps: Deps, clientId: string, clientSecret: string | null) {
  if (!clientId || !clientSecret) throw invalidClient('Client authentication is required.')
  const [client, application] = await Promise.all([
    deps.tokenExchange.findClient(clientId),
    deps.applications.findByClientId(clientId),
  ])
  if (!client || client.disabled || !application || application.disabled) {
    throw invalidClient('Invalid client credentials.')
  }
  const organization = await deps.authorization.findOrganization(application.ownerOrganizationId)
  if (!organization || organization.disabled) throw invalidClient('Invalid client credentials.')
  if (!client.clientSecret || client.clientSecret !== (await hashProviderSecret(clientSecret))) {
    throw invalidClient('Invalid client credentials.')
  }
  return { client, application }
}

function invalidClient(description: string) {
  return oauthError('invalid_client', description, 401, {}, { 'WWW-Authenticate': 'Basic realm="Realmroot OAuth"' })
}
