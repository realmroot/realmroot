import { createTokenExchangeRepository } from '@server/adapters/repos/token-exchange'
import type { Context } from 'hono'
import { createDb } from '../../db/client'
import { TokenExchangeService } from './service'

export interface TokenExchangeBindings {
  DB: D1Database
}

export function createTokenExchangeService(c: Context<{ Bindings: TokenExchangeBindings }>) {
  return new TokenExchangeService(createTokenExchangeRepository(createDb(c.env.DB)))
}
