import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('spec governance', () => {
  it('accepts a unique scenario with a proof in its declared layer', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'specs', 'sample.feature'),
      `Feature: Sample

  @entrypoint:product-ui @journey:works @proof:unit
  Scenario: It works
    When the user acts
    Then the result is visible
`,
    )
    writeFileSync(join(root, 'server', 'sample.test.ts'), breadcrumbTest('sample/works'))

    expect(run(root)).toContain('1 scenarios, all traced bidirectionally')
  })

  it('rejects a proof that exists only in another layer', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'specs', 'sample.feature'),
      `Feature: Sample

  @entrypoint:product-ui @journey:works @proof:integration
  Scenario: It works
    When the user acts
    Then the result is visible
`,
    )
    writeFileSync(join(root, 'server', 'sample.test.ts'), breadcrumbTest('sample/works'))

    expect(() => run(root)).toThrow(/declares @proof:integration but has no breadcrumb in that proof layer/)
  })

  it('rejects duplicate scenario identities and orphan test breadcrumbs', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'specs', 'sample.feature'),
      `Feature: Sample

  @entrypoint:product-ui @journey:works @proof:unit
  Scenario: It works
    Then the result is visible

  @entrypoint:restish @journey:works @proof:unit
  Scenario: It also works
    Then another result is visible
`,
    )
    writeFileSync(join(root, 'server', 'sample.test.ts'), breadcrumbTest('sample/works', 'sample/orphan'))

    expect(() => run(root)).toThrow(/duplicates scenario id.*Test breadcrumb.*has no scenario/s)
  })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'realmroot-spec-governance-'))
  fixtureRoots.push(root)
  for (const directory of ['scripts', 'specs', 'e2e', 'server/integration', 'src', 'shared']) {
    mkdirSync(join(root, directory), { recursive: true })
  }
  cpSync(join(process.cwd(), 'scripts', 'verify-specs.mjs'), join(root, 'scripts', 'verify-specs.mjs'))
  return root
}

function run(root: string) {
  try {
    return execFileSync(process.execPath, [join(root, 'scripts', 'verify-specs.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'stderr' in error) {
      throw new Error(String(error.stderr))
    }
    throw error
  }
}

function breadcrumbTest(...ids: string[]) {
  const breadcrumbs = ids.map((id) => `[${'spec'}: ${id}]`).join(' ')
  return `it('${breadcrumbs}', () => {})\n`
}
