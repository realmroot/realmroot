import type { IdentifierGenerator } from '@server/usecases/identifier-generator'

export function createIdentifierGeneratorFake(start = 0): IdentifierGenerator {
  let sequence = start
  return {
    generate() {
      const suffix = sequence.toString(16).padStart(12, '0')
      sequence += 1
      return `00000000-0000-7000-8000-${suffix}`
    },
  }
}
