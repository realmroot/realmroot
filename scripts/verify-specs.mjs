import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runner-less spec governance lint (sibling to lint:arch), per the
// hono-cf-clean-arch BDD-lite convention: specs/*.feature are behaviour-first
// docs, not a Cucumber suite. This verifies:
//   1. Every scenario carries a stable @journey:<id> tag (the id, never prose).
//   2. Every scenario declares exactly one @entrypoint:<id> tag.
//   3. EVERY scenario is traceable to a test via a `[spec: <id>]` breadcrumb,
//      where <id> is `<feature-stem>/<journey>`. The breadcrumb sits on the
//      home test that genuinely asserts the scenario's behaviour. @e2e marks the
//      hermetic Playwright crown; it does not change the tracing requirement.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const specsDir = join(repoRoot, 'specs')
// Tests are co-located beside source (server/, src/, shared/) and the Playwright
// crown lives in tests/; breadcrumbs can appear in any of them.
const breadcrumbDirs = ['tests', 'server', 'src', 'shared'].map((dir) => join(repoRoot, dir))

const supportedEntrypoints = new Set(['product-ui', 'restish'])
const scenarios = readScenarios(specsDir)
const breadcrumbs = readBreadcrumbs(breadcrumbDirs)
const errors = []

for (const scenario of scenarios) {
  const location = `specs/${scenario.file}:${scenario.line}`

  if (!scenario.journey) {
    errors.push(`${location} scenario is missing @journey:<id>.`)
  }
  if (scenario.entrypoints.length !== 1) {
    errors.push(`${location} scenario must declare exactly one @entrypoint:<id> tag.`)
  } else if (!supportedEntrypoints.has(scenario.entrypoints[0])) {
    errors.push(`${location} scenario declares unsupported entrypoint "${scenario.entrypoints[0]}".`)
  }

  if (scenario.journey) {
    const id = `${scenario.stem}/${scenario.journey}`
    if (!breadcrumbs.has(id)) {
      errors.push(`${location} scenario is missing a "[spec: ${id}]" breadcrumb in the test tree.`)
    }
  }
}

const e2eCount = scenarios.filter((scenario) => scenario.e2e).length

if (errors.length > 0) {
  console.error(`Spec verification failed in ${repoRoot}:`)
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log(
  `Spec verification passed: ${scenarios.length} scenarios, all traced to a [spec:] breadcrumb (${e2eCount} @e2e).`,
)

function readScenarios(directory) {
  const scenarios = []
  for (const file of readdirSync(directory, { recursive: true })) {
    if (typeof file !== 'string' || !file.endsWith('.feature')) continue
    const stem = file.replace(/\.feature$/, '')
    const source = readFileSync(join(directory, file), 'utf8')
    let pendingTags = []
    for (const [index, line] of source.split('\n').entries()) {
      const trimmed = line.trim()
      if (trimmed.startsWith('@')) {
        pendingTags = pendingTags.concat(trimmed.split(/\s+/))
        continue
      }
      if (/^Scenario:/.test(trimmed)) {
        scenarios.push({
          file,
          stem,
          line: index + 1,
          journey: matchTag(pendingTags, /^@journey:([a-z0-9-]+)$/),
          entrypoints: pendingTags
            .map((tag) => tag.match(/^@entrypoint:([a-z0-9-]+)$/)?.[1])
            .filter((value) => value !== undefined),
          e2e: pendingTags.includes('@e2e'),
        })
      }
      if (trimmed && !trimmed.startsWith('@')) pendingTags = []
    }
  }
  return scenarios
}

function readBreadcrumbs(directories) {
  const ids = new Set()
  const pattern = /\[spec:\s*([a-z0-9-]+\/[a-z0-9-]+)\]/g
  for (const directory of directories) {
    for (const file of readdirSync(directory, { recursive: true })) {
      if (typeof file !== 'string' || !/\.(test|spec)\.[jt]sx?$/.test(file)) continue
      const source = readFileSync(join(directory, file), 'utf8')
      for (const match of source.matchAll(pattern)) {
        ids.add(match[1])
      }
    }
  }
  return ids
}

function matchTag(tags, pattern) {
  for (const tag of tags) {
    const match = tag.match(pattern)
    if (match) return match[1]
  }
  return null
}
