import type { Context } from 'hono'
import type { z } from 'zod'
import { badRequest } from '../lib/errors'

export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown

  try {
    body = await c.req.json()
  } catch {
    throw badRequest('Invalid JSON body.')
  }

  return parse(schema, body)
}

export function readQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parse(schema, c.req.query())
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw badRequest(result.error.issues[0]?.message ?? 'Invalid request.')
  }

  return result.data
}
