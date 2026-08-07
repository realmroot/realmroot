export interface MutationActor {
  controllerUserId: string | null
  agent: {
    issuer: string
    subject: string
    identityId: string
    hostId: string
  } | null
}
