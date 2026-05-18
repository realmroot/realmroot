import type { Context } from 'hono'
import type { z } from 'zod'
import { badRequest } from '../lib/errors'

export function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  return c.req.json().then((body) => parse(schema, body))
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
