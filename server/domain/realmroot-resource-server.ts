import { platformOrganization } from './platform-organization'

export const realmrootResourceServer = {
  id: 'res_realmroot',
  identifier: 'realmroot',
  name: 'Realmroot',
  description: 'Realmroot identity, authorization, and administration API.',
  ownerOrganizationId: platformOrganization.id,
} as const

export function realmrootResourceUrl(origin: string) {
  return `${origin.replace(/\/$/, '')}/api`
}

export function isRealmrootResourceServer(id: string) {
  return id === realmrootResourceServer.id
}
