export const realmrootCliClientId = 'realmroot-cli'
export const realmrootTenantClaim = 'urn:realmroot:params:oauth:tenant'
export const realmrootAgentBindingClaim = 'urn:realmroot:params:agent:binding'

export interface RealmrootTenantClaim {
  type: 'user' | 'organization'
  id: string
}

export interface RealmrootAgentBindingClaim {
  protocol_agent_id: string
  host_id: string
}
