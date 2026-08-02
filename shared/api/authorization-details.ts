import { z } from 'zod'

const nonEmptyString = z.string().trim().min(1)

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const jsonValueSchema = z.custom<JsonValue>(isJsonValue, 'Expected a JSON value.').meta({
  type: ['string', 'number', 'boolean', 'null', 'array', 'object'],
})

export const authorizationDetailSchema = z.object({ type: nonEmptyString }).catchall(jsonValueSchema)

export const authorizationDetailsSchema = z.array(authorizationDetailSchema)

export type AuthorizationDetail = z.infer<typeof authorizationDetailSchema>

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).every(isJsonValue)
}
