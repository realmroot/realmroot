import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import forkDeploymentWorkflow from '../deploy/realmroot-fork.yml?raw'
import forkDeploymentScript from '../scripts/deploy-cloudflare-fork.mjs?raw'
import wranglerConfig from '../wrangler.toml?raw'

describe('Workers Assets routing', () => {
  it('routes OAuth metadata well-known paths to the Worker', () => {
    const runWorkerFirst = wranglerConfig.match(/run_worker_first\s*=\s*\[([^\]]+)\]/)

    expect(runWorkerFirst?.[1]).toContain('"/api/*"')
    expect(runWorkerFirst?.[1]).toContain('"/.well-known/*"')
    expect(runWorkerFirst?.[1]).toContain('"/oauth/account-connection/*"')
  })

  it('routes removed admin paths to the Worker 404', () => {
    const runWorkerFirst = wranglerConfig.match(/run_worker_first\s*=\s*\[([^\]]+)\]/)

    expect(runWorkerFirst?.[1]).not.toContain('"/admin"')
    expect(runWorkerFirst?.[1]).not.toContain('"/admin/*"')
  })
})

describe('Cloudflare deployment configuration', () => {
  it('wires optional provider event secrets through fork deployment', () => {
    expect(forkDeploymentWorkflow).toMatch(
      /PROVIDER_CONNECTION_EVENT_SECRETS: \$\{\{ secrets\.PROVIDER_CONNECTION_EVENT_SECRETS \}\}/,
    )
    expect(forkDeploymentScript).toContain('process.env.PROVIDER_CONNECTION_EVENT_SECRETS?.trim()')
    expect(forkDeploymentScript).toContain(
      "'secret', 'put', 'PROVIDER_CONNECTION_EVENT_SECRETS', '--config', 'wrangler.deployment.toml'",
    )
    expect(forkDeploymentScript).toContain('Reusing existing PROVIDER_CONNECTION_EVENT_SECRETS.')
    expect(forkDeploymentScript).toContain('Provider Connection Events remain disabled.')
  })

  it('isolates fork resources and canonical origins [spec: platform-onboarding/cloudflare-deployment-isolation]', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'realmroot-deployment-'))
    try {
      const sourcePath = path.join(directory, 'source.toml')
      const outputPath = path.join(directory, 'deployment.toml')
      writeFileSync(sourcePath, wranglerConfig)

      const result = spawnSync('node', ['scripts/prepare-deployment-config.mjs', sourcePath, outputPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          REALMROOT_WORKER_NAME: 'realmroot-example',
          REALMROOT_D1_DATABASE: 'realmroot-example',
          REALMROOT_D1_DATABASE_ID: '00000000-0000-4000-8000-000000000001',
          REALMROOT_R2_BUCKET: 'realmroot-assets-example',
        },
      })

      expect(result.status, result.stderr).toBe(0)
      const deploymentConfig = readFileSync(outputPath, 'utf8')
      expect(deploymentConfig).toContain('name = "realmroot-example"')
      expect(deploymentConfig).toContain('database_name = "realmroot-example"')
      expect(deploymentConfig).toContain('bucket_name = "realmroot-assets-example"')
      expect(deploymentConfig).not.toContain('EMAIL_FROM')
      expect(deploymentConfig).toContain('keep_vars = true')
      expect(deploymentConfig).not.toContain('id.realmroot.dev')
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
})
