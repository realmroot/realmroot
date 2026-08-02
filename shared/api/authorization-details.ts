import { z } from 'zod'

const nonEmptyString = z.string().trim().min(1)

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const jsonValueSchema = z.custom<JsonValue>(isJsonValue, 'Expected a JSON value.').meta({
  id: 'AuthorizationDetailJsonValue',
  type: ['string', 'number', 'boolean', 'null', 'array', 'object'],
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', items: { $ref: '#/components/schemas/AuthorizationDetailJsonValue' } },
    {
      type: 'object',
      additionalProperties: { $ref: '#/components/schemas/AuthorizationDetailJsonValue' },
    },
  ],
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
