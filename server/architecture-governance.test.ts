import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('architecture governance', () => {
  it('rejects a forbidden unresolved framework import from a usecase', () => {
    const root = architectureFixture()
    writeFileSync(join(root, 'server', 'usecases', 'invalid.ts'), "import 'better-auth/oauth2'\n")

    expect(() => runDependencyCruiser(root)).toThrow(/usecases-no-framework-packages[\s\S]*better-auth\/oauth2/)
  })

  it('allows the frontend AppType contract import', () => {
    const root = frontendFixture()
    writeFileSync(join(root, 'src', 'api.ts'), "import type { AppType } from '@server/http/app'\n")

    expect(runFrontendBoundary(root)).toContain('Frontend dependency boundary valid (1 modules checked).')
  })

  it('rejects every other frontend import from the server', () => {
    const root = frontendFixture()
    writeFileSync(join(root, 'src', 'invalid.ts'), "import type { Deps } from '@server/usecases/deps'\n")

    expect(() => runFrontendBoundary(root)).toThrow(/src\/invalid\.ts -> @server\/usecases\/deps/)
  })
})

function architectureFixture() {
  const root = fixtureRoot('realmroot-architecture-')
  mkdirSync(join(root, 'server', 'usecases'), { recursive: true })
  mkdirSync(join(root, 'shared'), { recursive: true })
  writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"}}\n')
  cpSync(join(process.cwd(), '.dependency-cruiser.cjs'), join(root, '.dependency-cruiser.cjs'))
  return root
}

function frontendFixture() {
  const root = fixtureRoot('realmroot-frontend-boundary-')
  mkdirSync(join(root, 'src'), { recursive: true })
  return root
}

function fixtureRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  fixtureRoots.push(root)
  return root
}

function runDependencyCruiser(root: string) {
  return run(
    process.execPath,
    [
      join(process.cwd(), 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs'),
      'server/**/*.ts',
      'shared/**/*.ts',
      '--config',
      '.dependency-cruiser.cjs',
    ],
    root,
  )
}

function runFrontendBoundary(root: string) {
  return run(process.execPath, [join(process.cwd(), 'scripts', 'verify-frontend-boundary.mjs')], root)
}

function run(command: string, args: string[], cwd: string) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      throw new Error(`${String(error.stdout)}${String(error.stderr)}`)
    }
    throw error
  }
}
