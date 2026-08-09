const inFlightRequests = new Map<string, Promise<unknown>>()

export function resetRequestDeduplicationForTests() {
  inFlightRequests.clear()
}

export function deduplicateRequest<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined
  if (existing) return existing

  const current = request()
  inFlightRequests.set(key, current)
  void current.then(
    () => inFlightRequests.delete(key),
    () => inFlightRequests.delete(key),
  )
  return current
}
