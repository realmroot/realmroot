export const platformOrganization = {
  slug: 'realmroot',
  name: 'Realmroot Platform',
  metadata: { realmroot: { platform: true } },
} as const

export function isPlatformOrganization(organization: { slug: string }) {
  return organization.slug === platformOrganization.slug
}
