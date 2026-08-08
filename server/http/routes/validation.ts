import { ApiError, badRequest } from '@server/domain/errors'
import type { Context } from 'hono'
import type { z } from 'zod'

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
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }))
    throw new ApiError(
      400,
      'bad_request',
      issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join(' '),
      { issues },
    )
  }

  return result.data
}
