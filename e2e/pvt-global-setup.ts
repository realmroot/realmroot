import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { platform } from 'node:process'
import { type Browser, chromium, type FullConfig } from '@playwright/test'
import { configzConfigResponseSchema } from '../shared/api/configz'
import { signIn } from './helpers/real-app'

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('PVT baseURL is required.')

  const storageStatePath = requiredEnvironmentVariable('REALMROOT_PVT_STORAGE_STATE_PATH')
  const account = {
    username: requiredEnvironmentVariable('PVT_USERNAME'),
    password: requiredEnvironmentVariable('PVT_PASSWORD'),
  }
  const profilePath = mkdtempSync(join(tmpdir(), 'realmroot-pvt-chrome-'))
  const debuggingPort = await availablePort()
  const chrome = spawn(
    chromeExecutable(),
    [
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${profilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
      `${baseURL}/auth/sign-in`,
    ],
    { stdio: 'ignore' },
  )
  await once(chrome, 'spawn')
  let browser: Browser | undefined

  try {
    browser = await connectToChrome(debuggingPort)
    const context = browser.contexts()[0]
    if (!context) throw new Error('PVT Chrome did not expose a browser context.')
    const page = context.pages()[0] ?? (await context.newPage())
    const configResponse = await context.request.get(`${baseURL}/api/configz`)
    if (!configResponse.ok()) throw new Error(`PVT config preflight failed with HTTP ${configResponse.status()}.`)
    const deploymentConfig = configzConfigResponseSchema.parse(await configResponse.json())
    await signIn(page, account, { baseURL, interactiveCaptcha: deploymentConfig.captcha.enabled })
    const cookies = await context.cookies()
    if (!cookies.some((cookie) => cookie.name.includes('session'))) {
      throw new Error('PVT login completed without a session cookie.')
    }
    await context.storageState({ path: storageStatePath })
  } finally {
    await browser?.close()
    if (chrome.exitCode === null) {
      chrome.kill()
      await once(chrome, 'exit')
    }
    rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

function chromeExecutable() {
  const configured = process.env.PVT_CHROME_EXECUTABLE
  const executable =
    configured ??
    (platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : platform === 'win32'
        ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
        : '/usr/bin/google-chrome')
  if (!existsSync(executable)) {
    throw new Error('Google Chrome was not found. Set PVT_CHROME_EXECUTABLE to its absolute path.')
  }
  return executable
}

async function availablePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to reserve a PVT Chrome debugging port.')
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

async function connectToChrome(port: number) {
  const endpoint = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await chromium.connectOverCDP(endpoint)
    } catch (error) {
      if (attempt === 39) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error('PVT Chrome did not become available.')
}

function requiredEnvironmentVariable(name: string) {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} is required for production verification.`)
  return value
}
