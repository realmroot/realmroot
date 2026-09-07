export function isBrowserNavigation(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'POST') return false
  const mode = request.headers.get('Sec-Fetch-Mode')
  if (mode !== null) return mode === 'navigate'
  return request.headers.get('Accept')?.includes('text/html') ?? false
}
