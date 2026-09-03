import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export default function globalTeardown() {
  const temporaryStatePath = process.env.REALMROOT_E2E_TEMP_STATE_PATH
  if (!temporaryStatePath) return

  const resolvedPath = resolve(temporaryStatePath)
  const temporaryPrefix = join(resolve(tmpdir()), 'realmroot-e2e-')
  if (!resolvedPath.startsWith(temporaryPrefix)) {
    throw new Error(`Refusing to remove unexpected E2E state path: ${resolvedPath}`)
  }

  rmSync(resolvedPath, { recursive: true, force: true })
}
