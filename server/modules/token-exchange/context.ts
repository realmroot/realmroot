import { createJwksGateway } from '@server/adapters/gateways/jwks'
import { createTokenExchangeRepository } from '@server/adapters/repos/token-exchange'
import { TokenExchangeService } from '@server/usecases/token-exchange'
import type { Context } from 'hono'
import { createDb } from '../../db/client'

export interface TokenExchangeBindings {
  DB: D1Database
}

export function createTokenExchangeService(c: Context<{ Bindings: TokenExchangeBindings }>) {
  return new TokenExchangeService(createTokenExchangeRepository(createDb(c.env.DB)), createJwksGateway())
}
