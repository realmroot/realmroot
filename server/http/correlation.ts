const correlationIdPattern = /^[0-9a-f]{32}$/

export function readCorrelationId(value: string | null | undefined): string | null {
  return value && correlationIdPattern.test(value) ? value : null
}
