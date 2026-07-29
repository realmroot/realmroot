export interface ProtocolAgentSession {
  agentId: string
  agent: {
    id: string
    hostId: string
    mode: string
    capabilityGrants?: Array<{
      capability: string
      status: string
    }>
  }
  host: { id: string; userId: string | null; status: string } | null
}
