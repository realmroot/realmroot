import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { unifiedOpenApi } from '@server/http/openapi/management'
import { describe, expect, it } from 'vitest'

const originMainContractDigest = '1709dd9a348d5059ac3b8b913eae6829743c667756f09ea613b4edb3baabd9a0'
const originMainOperationDigest = '084dbccdd5cd7f1eb50cc9e0a9112ebe50250fa34a6d67620f22ad7d0903f0bf'
const originMainClientAddressDigest = 'c03c88f323508fc2c7d79b250ab0fc0deb69be14be2a7e21a2d0f35e9c631451'

describe('origin/main API contract baseline', () => {
  it('keeps every OpenAPI path, operationId, schema, response, status, error, pagination, link, and canonical URI unchanged', () => {
    expect(digest(JSON.stringify(unifiedOpenApi))).toBe(originMainContractDigest)

    const operations = Object.entries(unifiedOpenApi.paths)
      .flatMap(([path, pathItem]) =>
        Object.entries(pathItem as Record<string, unknown>)
          .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method))
          .map(
            ([method, operation]) =>
              `${method.toUpperCase()} ${path} ${(operation as { operationId?: string }).operationId}`,
          ),
      )
      .sort()
    expect(operations).toHaveLength(129)
    expect(digest(JSON.stringify(operations))).toBe(originMainOperationDigest)
  })

  it('keeps production clients, Restish integration, E2E helpers, and skill API addresses unchanged', () => {
    const roots = [
      'src/lib/api',
      'src/lib/auth-client.ts',
      'plugins/restish-realmroot',
      'skills/realmroot/references',
      'e2e/helpers/restish-agent-plugin.ts',
    ]
    const files = roots
      .flatMap((root) =>
        statSync(root).isDirectory()
          ? readdirSync(root, { withFileTypes: true })
              .filter((entry) => entry.isFile() && !entry.name.includes('_test') && !entry.name.includes('.test.'))
              .map((entry) => `${root}/${entry.name}`)
          : [root],
      )
      .filter((file) => /\.(ts|go|md)$/.test(file))
    const addresses = files
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/(?:\/api|\/\.well-known)[A-Za-z0-9_?&=/:{}.$()-]*/g)].map(
          (match) => `${file}:${match[0]}`,
        ),
      )
      .sort()
    expect(digest(JSON.stringify(addresses))).toBe(originMainClientAddressDigest)
  })
})

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
