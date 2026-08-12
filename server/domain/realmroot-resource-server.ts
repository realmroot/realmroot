export const realmrootResourceServer = {
  identifier: 'realmroot',
  name: 'Realmroot',
  description: 'Realmroot identity, authorization, and administration API.',
} as const

export function realmrootResourceUrl(origin: string) {
  return `${origin.replace(/\/$/, '')}/api`
}

export function isRealmrootResourceServer(resource: { identifier: string }) {
  return resource.identifier === realmrootResourceServer.identifier
}
