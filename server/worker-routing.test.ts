import { describe, expect, it } from 'vitest'
import previewConfig from '../wrangler.preview.toml?raw'
import productionConfig from '../wrangler.toml?raw'

const wranglerConfigs = [
  ['wrangler.toml', productionConfig],
  ['wrangler.preview.toml', previewConfig],
] as const

describe('Workers Assets routing', () => {
  it.each(wranglerConfigs)('routes OAuth metadata well-known paths to the Worker in %s', (_path, config) => {
    const runWorkerFirst = config.match(/run_worker_first\s*=\s*\[([^\]]+)\]/)

    expect(runWorkerFirst?.[1]).toContain('"/api/*"')
    expect(runWorkerFirst?.[1]).toContain('"/.well-known/*"')
  })

  it.each(wranglerConfigs)('routes removed admin paths to the Worker 404 in %s', (_path, config) => {
    const runWorkerFirst = config.match(/run_worker_first\s*=\s*\[([^\]]+)\]/)

    expect(runWorkerFirst?.[1]).not.toContain('"/admin"')
    expect(runWorkerFirst?.[1]).not.toContain('"/admin/*"')
  })
})
