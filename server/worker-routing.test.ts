import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json?raw'
import forkDeploymentScript from '../scripts/deploy-cloudflare-fork.mjs?raw'
import wranglerConfig from '../wrangler.toml?raw'
import worker from './worker'

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

  it('serves a verifiable Realmroot Skill archive [spec: management-api/agent-skills-discovery]', async () => {
    const directory = path.join(process.cwd(), 'public', '.well-known', 'agent-skills')
    const indexBytes = readFileSync(path.join(directory, 'index.json'))
    const archiveBytes = readFileSync(path.join(directory, 'realmroot.tar.gz'))
    const assetsFetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname
      const artifact = pathname.endsWith('/index.json') ? indexBytes : archiveBytes
      const contentType = pathname.endsWith('/index.json') ? 'application/json' : 'application/gzip'
      return new Response(request.method === 'HEAD' ? null : artifact, { headers: { 'content-type': contentType } })
    })
    const env = { ASSETS: { fetch: assetsFetch } } as unknown as Env
    const executionContext = {} as ExecutionContext

    const response = await worker.fetch(
      new Request('https://id.realmroot.dev/.well-known/agent-skills/index.json'),
      env,
      executionContext,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const index = (await response.json()) as {
      $schema: string
      skills: Array<{ name: string; type: string; url: string; digest: string }>
    }
    expect(index).toEqual({
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: [
        expect.objectContaining({
          name: 'realmroot',
          type: 'archive',
          url: '/.well-known/agent-skills/realmroot.tar.gz',
          digest: `sha256:${createHash('sha256').update(archiveBytes).digest('hex')}`,
        }),
      ],
    })
    expect(listTarEntries(gunzipSync(archiveBytes))).toEqual([
      'SKILL.md',
      'references/management.md',
      'references/setup.md',
      'references/toolbox-commands.md',
      'references/x402.md',
    ])

    const head = await worker.fetch(
      new Request('https://id.realmroot.dev/.well-known/agent-skills/realmroot.tar.gz', { method: 'HEAD' }),
      env,
      executionContext,
    )
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toContain('application/gzip')
    expect((await head.arrayBuffer()).byteLength).toBe(0)
    expect(assetsFetch).toHaveBeenCalledTimes(2)

    const check = spawnSync('node', ['scripts/build-agent-skills.mjs', '--check'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(check.status, check.stderr).toBe(0)
  })
})

function listTarEntries(tar: Buffer) {
  const entries = []
  for (let offset = 0; offset < tar.length; ) {
    const name = tar
      .subarray(offset, offset + 100)
      .toString('utf8')
      .replace(/\0.*$/, '')
    if (!name) break
    entries.push(name)
    const size = Number.parseInt(
      tar
        .subarray(offset + 124, offset + 136)
        .toString('ascii')
        .replace(/\0.*$/, ''),
      8,
    )
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

describe('Cloudflare deployment configuration', () => {
  it('deploys the exact Worker artifact produced by Vite [spec: platform-onboarding/cloudflare-deployment-isolation]', () => {
    const scripts = JSON.parse(packageJson).scripts as Record<string, string>

    expect(scripts.deploy).toContain('wrangler deploy --config dist/realmroot/wrangler.json')
    expect(forkDeploymentScript).toContain(
      "const deployArguments = ['exec', 'wrangler', 'deploy', '--config', 'dist/realmroot/wrangler.json']",
    )
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
