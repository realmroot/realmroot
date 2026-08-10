import type { IdentifierGenerator } from '@server/usecases/identifier-generator'
import { v7 } from 'uuid'

export function createUuidV7IdentifierGenerator(): IdentifierGenerator {
  return { generate: v7 }
}
