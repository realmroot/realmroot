import type { Deps } from '@server/usecases/deps'
import type { Context, MiddlewareHandler } from 'hono'

declare module 'hono' {
  interface ContextVariableMap {
    deps: Deps
  }
}

export function depsMiddleware(deps: Deps | ((c: Context) => Deps)): MiddlewareHandler {
  return async (c, next) => {
    c.set('deps', typeof deps === 'function' ? deps(c) : deps)
    await next()
  }
}

export function getDeps(c: Context): Deps {
  return c.get('deps')
}
