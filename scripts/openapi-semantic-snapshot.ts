import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export interface OpenApiSemanticOperation {
  method: string
  path: string
  operationId: string
  semanticHash: string
}

export function openApiSemanticSnapshot(
  document: Record<string, unknown>,
  includePath: (path: string) => boolean = (path) => !isAllowedAuthorizationContractPath(path),
): OpenApiSemanticOperation[] {
  const paths = document.paths as Record<string, Record<string, unknown>>
  const components = document.components as Record<string, unknown>
  const operations: OpenApiSemanticOperation[] = []
  for (const [path, unresolvedPathItem] of Object.entries(paths)) {
    if (!includePath(path)) continue
    const pathItem = dereference(unresolvedPathItem, document, new Set()) as Record<string, unknown>
    for (const [method, unresolvedOperation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
      const operation = dereference(unresolvedOperation, { ...document, components }, new Set()) as Record<string, unknown>
      operations.push({
        method: method.toUpperCase(),
        path,
        operationId: String(operation.operationId),
        semanticHash: createHash('sha256').update(stableJson(operation)).digest('hex'),
      })
    }
  }
  return operations.sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`))
}

export function approvedAuthorizationSemanticSnapshot(document: Record<string, unknown>) {
  return openApiSemanticSnapshot(document, isAllowedAuthorizationContractPath)
}

export function isAllowedAuthorizationContractPath(path: string) {
  return (
    path.startsWith('/access/roles') ||
    path.startsWith('/access/assignments') ||
    /^\/organizations\/\{[^}]+\}\/(roles|members|invitations)(?:\/|$)/.test(path)
  )
}

function dereference(value: unknown, document: Record<string, unknown>, seen: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => dereference(item, document, seen))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (typeof record.$ref === 'string' && record.$ref.startsWith('#/')) {
    if (seen.has(record.$ref)) return { $ref: record.$ref }
    const resolved = record.$ref
      .slice(2)
      .split('/')
      .reduce<unknown>((current, segment) => (current as Record<string, unknown>)[segment], document)
    return dereference(resolved, document, new Set([...seen, record.$ref]))
  }
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, dereference(item, document, seen)]),
  )
}

function stableJson(value: unknown) {
  return JSON.stringify(value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const modulePath = process.argv[2]
  if (!modulePath) throw new Error('OpenAPI module path is required.')
  const imported = await import(pathToFileURL(modulePath).href)
  const snapshot = process.argv.includes('--approved')
    ? approvedAuthorizationSemanticSnapshot(imported.unifiedOpenApi)
    : openApiSemanticSnapshot(imported.unifiedOpenApi)
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
}
