import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runner-less BDD governance. Feature files document observable product
// behaviour; executable tests carry the stable scenario identity.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const specsDir = join(repoRoot, 'specs')
const breadcrumbDirs = [
  { directory: join(repoRoot, 'e2e'), proof: 'e2e' },
  { directory: join(repoRoot, 'server', 'integration'), proof: 'integration' },
  { directory: join(repoRoot, 'server'), proof: 'unit', exclude: new Set(['integration']) },
  { directory: join(repoRoot, 'src'), proof: 'unit' },
  { directory: join(repoRoot, 'shared'), proof: 'unit' },
]

const supportedEntrypoints = new Set(['agent-protocol', 'product-ui', 'restish'])
const supportedProofs = new Set(['unit', 'integration', 'e2e'])
const scenarios = readScenarios(specsDir)
const breadcrumbs = readBreadcrumbs(breadcrumbDirs)
const errors = []
const scenarioIds = new Map()

for (const scenario of scenarios) {
  const location = `specs/${scenario.file}:${scenario.line}`

  if (scenario.journeys.length !== 1) {
    errors.push(`${location} scenario must declare exactly one @journey:<id> tag.`)
  }
  if (scenario.entrypoints.length !== 1) {
    errors.push(`${location} scenario must declare exactly one @entrypoint:<id> tag.`)
  } else if (!supportedEntrypoints.has(scenario.entrypoints[0])) {
    errors.push(`${location} scenario declares unsupported entrypoint "${scenario.entrypoints[0]}".`)
  }
  if (scenario.proofs.length !== 1) {
    errors.push(`${location} scenario must declare exactly one @proof:<layer> tag.`)
  } else if (!supportedProofs.has(scenario.proofs[0])) {
    errors.push(`${location} scenario declares unsupported proof layer "${scenario.proofs[0]}".`)
  } else if (scenario.e2e !== (scenario.proofs[0] === 'e2e')) {
    errors.push(`${location} @e2e and @proof:e2e must be declared together.`)
  }

  if (scenario.journeys.length !== 1) continue
  const id = `${scenario.stem}/${scenario.journeys[0]}`
  const firstLocation = scenarioIds.get(id)
  if (firstLocation) {
    errors.push(`${location} duplicates scenario id "${id}" first declared at ${firstLocation}.`)
  } else {
    scenarioIds.set(id, location)
  }

  const proofLayers = breadcrumbs.get(id)
  if (!proofLayers) {
    errors.push(`${location} scenario is missing a "[spec: ${id}]" breadcrumb in the test tree.`)
  } else if (scenario.proofs.length === 1 && supportedProofs.has(scenario.proofs[0])) {
    const proof = scenario.proofs[0]
    if (!proofLayers.has(proof)) {
      errors.push(`${location} scenario declares @proof:${proof} but has no breadcrumb in that proof layer.`)
    }
  }
}

for (const id of breadcrumbs.keys()) {
  if (!scenarioIds.has(id)) errors.push(`Test breadcrumb "[spec: ${id}]" has no scenario in specs/.`)
}

if (errors.length > 0) {
  console.error(`Spec verification failed in ${repoRoot}:`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

const proofCounts = Object.fromEntries(
  [...supportedProofs].map((proof) => [proof, scenarios.filter((scenario) => scenario.proofs[0] === proof).length]),
)
console.log(`Spec verification passed: ${scenarios.length} scenarios, all traced bidirectionally.`)
console.log(
  `Canonical proof layers: ${proofCounts.unit} unit, ${proofCounts.integration} integration, ${proofCounts.e2e} e2e.`,
)

function readScenarios(directory) {
  const result = []
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
        result.push({
          file,
          stem,
          line: index + 1,
          journeys: matchingTags(pendingTags, /^@journey:([a-z0-9-]+)$/),
          entrypoints: matchingTags(pendingTags, /^@entrypoint:([a-z0-9-]+)$/),
          proofs: matchingTags(pendingTags, /^@proof:([a-z0-9-]+)$/),
          e2e: pendingTags.includes('@e2e'),
        })
      }
      if (trimmed && !trimmed.startsWith('@')) pendingTags = []
    }
  }
  return result
}

function readBreadcrumbs(directories) {
  const ids = new Map()
  const pattern = /\[spec:\s*([a-z0-9-]+\/[a-z0-9-]+)\]/g
  for (const { directory, proof, exclude = new Set() } of directories) {
    for (const file of readdirSync(directory, { recursive: true })) {
      if (typeof file !== 'string' || !(/\.(test|spec)\.[jt]sx?$/.test(file) || /_test\.go$/.test(file))) continue
      if (exclude.has(file.split(/[\\/]/)[0])) continue
      const source = readFileSync(join(directory, file), 'utf8')
      for (const match of source.matchAll(pattern)) {
        const layers = ids.get(match[1]) ?? new Set()
        layers.add(proof)
        ids.set(match[1], layers)
      }
    }
  }
  return ids
}

function matchingTags(tags, pattern) {
  return tags.map((tag) => tag.match(pattern)?.[1]).filter((value) => value !== undefined)
}
