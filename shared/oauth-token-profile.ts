export const realmrootCliClientId = 'realmroot-cli'
export const realmrootOrganizationClaim = 'urn:realmroot:params:oauth:org'
export const realmrootAgentBindingClaim = 'urn:realmroot:params:agent:binding'

export interface RealmrootAgentBindingClaim {
  protocol_agent_id: string
  host_id: string
}
