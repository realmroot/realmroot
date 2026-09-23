import { readCorrelationId } from './correlation'

export async function withWorkerRequestMetrics(request: Request, handle: () => Promise<Response>) {
  const startedAt = Date.now()
  const response = await handle()
  const durationMs = Date.now() - startedAt
  const requestId =
    response.headers.get('Request-Id') ??
    response.headers.get('X-Request-Id') ??
    request.headers.get('cf-ray') ??
    crypto.randomUUID()
  const entry = JSON.stringify({
    event: 'worker.request.complete',
    requestId,
    correlationId: readCorrelationId(request.headers.get('x-correlation-id')) ?? requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    status: response.status,
    durationMs,
  })
  if (response.status >= 500) console.error(entry)
  else console.info(entry)
  const headers = new Headers(response.headers)
  headers.append('Server-Timing', `total;dur=${durationMs}`)
  headers.set('Request-Id', requestId)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
