import { isPlatformOrganization } from '@server/domain/platform-organization'
import { isRealmrootResourceServer } from '@server/domain/realmroot-resource-server'
import type { Deps } from '@server/usecases/deps'

const pageSize = 100

export async function findPlatformOrganization(deps: Pick<Deps, 'authorization'>) {
  for (let offset = 0; ; offset += pageSize) {
    const page = await deps.authorization.listOrganizations({ limit: pageSize, offset })
    const organization = page.items.find(isPlatformOrganization)
    if (organization) return organization
    if (page.pagination.page >= page.pagination.totalPages) return null
  }
}

export async function requirePlatformOrganization(deps: Pick<Deps, 'authorization'>) {
  const organization = await findPlatformOrganization(deps)
  if (!organization) throw new Error('The built-in platform Organization is unavailable.')
  return organization
}

export async function findRealmrootResourceServer(deps: Pick<Deps, 'authorization'>) {
  for (let offset = 0; ; offset += pageSize) {
    const page = await deps.authorization.listResources({ limit: pageSize, offset })
    const resource = page.items.find(isRealmrootResourceServer)
    if (resource) return resource
    if (page.pagination.page >= page.pagination.totalPages) return null
  }
}
