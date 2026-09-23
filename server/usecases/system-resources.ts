import { platformOrganization } from '@server/domain/platform-organization'
import { realmrootResourceServer } from '@server/domain/realmroot-resource-server'
import type { Deps } from '@server/usecases/deps'

export function findPlatformOrganization(deps: Pick<Deps, 'authorization'>) {
  return deps.authorization.findOrganizationBySlug(platformOrganization.slug)
}

export async function requirePlatformOrganization(deps: Pick<Deps, 'authorization'>) {
  const organization = await findPlatformOrganization(deps)
  if (!organization) throw new Error('The built-in platform Organization is unavailable.')
  return organization
}

export function findRealmrootResourceServer(deps: Pick<Deps, 'authorization'>) {
  return deps.authorization.findResourceByIdentifier(realmrootResourceServer.identifier)
}
