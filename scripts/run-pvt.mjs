import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'realmroot-pvt-'))
const playwrightCli = join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js')

try {
  const result = spawnSync(process.execPath, [playwrightCli, 'test', '--config', 'playwright.pvt.config.ts'], {
    env: {
      ...process.env,
      REALMROOT_PVT_STORAGE_STATE_PATH: join(temporaryDirectory, 'storage-state.json'),
    },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
