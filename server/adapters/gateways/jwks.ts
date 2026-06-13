import { unauthorized } from '@server/domain/errors'
import type { JwksGateway } from '@server/usecases/ports'

export function createJwksGateway(): JwksGateway {
  return {
    async fetchKeys(jwksUrl: string) {
      const response = await fetch(jwksUrl)
      if (!response.ok) throw unauthorized('Trusted issuer JWKS is not available.')
      return response.json()
    },
  }
}
