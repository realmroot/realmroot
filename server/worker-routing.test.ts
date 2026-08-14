import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import packageJson from '../package.json?raw'
import forkDeploymentScript from '../scripts/deploy-cloudflare-fork.mjs?raw'
import wranglerConfig from '../wrangler.toml?raw'

describe('Workers Assets routing', () => {
  it('routes only dynamic well-known endpoints to the Worker', () => {
    const routes = parseRunWorkerFirstRoutes(wranglerConfig)

    expect(routes).toEqual([
      '/api/*',
      '/.well-known/jwks.json',
      '/.well-known/agent-configuration',
      '/.well-known/openid-configuration/api/auth',
      '/.well-known/oauth-authorization-server/api/auth',
      '/.well-known/oauth-protected-resource/api',
      '/oauth/account-connection/*',
    ])
    expect(routes).not.toContain('/.well-known/*')
    expect(routes).not.toContain('/.well-known/agent-skills/*')
  })

  it('routes removed admin paths to the Worker 404', () => {
    const routes = parseRunWorkerFirstRoutes(wranglerConfig)

    expect(routes).not.toContain('/admin')
    expect(routes).not.toContain('/admin/*')
  })

  it('publishes every verifiable Realmroot Skill archive [spec: management-api/agent-skills-discovery]', () => {
    const directory = path.join(process.cwd(), 'public', '.well-known', 'agent-skills')
    const indexBytes = readFileSync(path.join(directory, 'index.json'))
    const skillNames = ['integrate-realmroot-application', 'integrate-realmroot-resource-server', 'realmroot']
    const archives = new Map(skillNames.map((name) => [name, readFileSync(path.join(directory, `${name}.tar.gz`))]))
    const index = JSON.parse(new TextDecoder().decode(indexBytes)) as {
      $schema: string
      skills: Array<{ name: string; type: string; url: string; digest: string }>
    }
    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json')
    expect(index.skills).toEqual(
      skillNames.map((name) =>
        expect.objectContaining({
          name,
          type: 'archive',
          url: `/.well-known/agent-skills/${name}.tar.gz`,
          digest: `sha256:${createHash('sha256').update(archives.get(name)!).digest('hex')}`,
        }),
      ),
    )
    for (const name of skillNames) {
      expect(archives.get(name)![9]).toBe(255)
      expect(listTarEntries(gunzipSync(archives.get(name)!))).toEqual(
        listSkillFiles(path.join(process.cwd(), 'skills', name)),
      )
    }

    const check = spawnSync('node', ['scripts/build-agent-skills.mjs', '--check'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(check.status, check.stderr).toBe(0)
  })
})

function parseRunWorkerFirstRoutes(config: string) {
  const match = config.match(/run_worker_first\s*=\s*\[([^\]]+)\]/s)
  return [...(match?.[1].matchAll(/"([^"]+)"/g) ?? [])].map((route) => route[1])
}

function listTarEntries(tar: Uint8Array) {
  const entries = []
  for (let offset = 0; offset < tar.length; ) {
    const name = new TextDecoder().decode(tar.subarray(offset, offset + 100)).replace(/\0.*$/, '')
    if (!name) break
    entries.push(name)
    const size = Number.parseInt(
      new TextDecoder().decode(tar.subarray(offset + 124, offset + 136)).replace(/\0.*$/, ''),
      8,
    )
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

function listSkillFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? listSkillFiles(path.join(directory, entry.name), name) : [name]
    })
    .sort()
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
