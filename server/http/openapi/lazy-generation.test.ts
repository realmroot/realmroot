import { expect, it, vi } from 'vitest'

const constructed = vi.hoisted(() => vi.fn())
vi.mock('@hono/zod-openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hono/zod-openapi')>()
  return {
    ...actual,
    OpenAPIHono: class extends actual.OpenAPIHono {
      constructor() {
        super()
        constructed()
      }
    },
  }
})

it('generates only on first access [spec: management-api/lazy-openapi-generation]', async () => {
  const { getUnifiedOpenApi } = await import('./management')
  expect(constructed).not.toHaveBeenCalled()
  const document = getUnifiedOpenApi()
  expect(document.paths).toHaveProperty('/applications')
  expect(getUnifiedOpenApi()).toBe(document)
  expect(constructed).toHaveBeenCalledOnce()
})
