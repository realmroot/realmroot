export const initializationDeadlineMs = 5_000

export class InitializationTimeoutError extends Error {
  constructor(phase: string) {
    super(`Authentication initialization timed out: ${phase}`)
    this.name = 'InitializationTimeoutError'
  }
}

// D1 cannot cancel an in-flight query. Callers publish cache values only after
// this await succeeds, so late results cannot poison subsequent requests.
export async function withinInitializationDeadline<T>(operation: Promise<T>, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new InitializationTimeoutError(phase)), initializationDeadlineMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
