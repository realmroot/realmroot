import { type ExecFileSyncOptionsWithStringEncoding, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PluginIdentityResult {
  authenticated?: boolean
  agent: {
    id: string
    issuer: string
    subject: string
    name: string
  }
  local_agent: string
}

export interface PendingWhoami {
  approvalUrl: Promise<string>
  nextApprovalUrl(): Promise<string>
  result: Promise<PluginIdentityResult>
}

export interface PendingResourceAccess<T> {
  approvalUrl: Promise<string>
  result: Promise<T>
}

export interface RestishAgentPlugin {
  login(name: string): PendingWhoami
  logout(): { loggedIn: boolean; remoteIdentityChanged: boolean }
  status(): { hosts: Array<{ accounts: Array<{ runtime: string; current: boolean; loggedIn: boolean }> }> }
  whoami(): PluginIdentityResult
  listResourceServers<T>(): T
  listResources<T>(resourceServerId: string): T
  connectResource<T>(resourceId: string, input: unknown): PendingResourceAccess<T>
  requestResourceAccess<T>(input: unknown): PendingResourceAccess<T>
  connectTarget(apiName: string, resourceUrl: string): void
  targetRequest<T>(apiName: string, path: string): T
  dispose(): void
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const pluginRoot = join(repoRoot, 'plugins', 'restish-realmroot')

export function createRestishAgentPlugin(origin: string): RestishAgentPlugin {
  const root = mkdtempSync(join(tmpdir(), 'realmroot-restish-e2e-'))
  const configDir = join(root, 'config')
  const stateDir = join(root, 'state')
  const binary = join(root, 'restish-realmroot')
  const apiName = 'realmroot'
  const approvalFile = join(root, 'approval-url')
  const targetURLs = new Map<string, string>()
  mkdirSync(configDir)
  mkdirSync(stateDir)

  execFileSync('go', ['build', '-o', binary, '.'], {
    cwd: pluginRoot,
    encoding: 'utf8',
  })

  const environment = {
    ...process.env,
    RSH_CONFIG_DIR: configDir,
    REALMROOT_PLUGIN_STATE_DIR: stateDir,
    REALMROOT_PLUGIN_APPROVAL_FILE: approvalFile,
    AGENT: 'e2e',
  }
  execFileSync('restish', ['plugin', 'install', binary, '--yes'], {
    cwd: repoRoot,
    env: environment,
    encoding: 'utf8',
  })
  execFileSync('restish', ['api', 'connect', apiName, `${origin}/api`, '--replace', '--yes'], {
    cwd: repoRoot,
    env: environment,
    encoding: 'utf8',
  })
  const invoke = <T>(command: string[], input?: unknown): T => {
    const options: ExecFileSyncOptionsWithStringEncoding = {
      cwd: repoRoot,
      env: environment,
      encoding: 'utf8',
      ...(input === undefined ? {} : { input: JSON.stringify(input) }),
    }
    try {
      return JSON.parse(execFileSync('restish', [apiName, ...command, '--rsh-output-format', 'json'], options)) as T
    } catch (error) {
      const failed = error as Error & { stdout?: string; stderr?: string; status?: number }
      throw new Error(
        `Restish ${command.join(' ')} exited with ${failed.status ?? 'unknown'}: ${failed.stderr ?? ''}${failed.stdout ?? ''}`,
        { cause: error },
      )
    }
  }

  const get = <T>(url: string): T => {
    try {
      return JSON.parse(
        execFileSync('restish', ['get', url, '--rsh-output-format', 'json'], {
          cwd: repoRoot,
          env: environment,
          encoding: 'utf8',
        }),
      ) as T
    } catch (error) {
      const failed = error as Error & { stdout?: string; stderr?: string; status?: number }
      throw new Error(
        `Restish GET ${url} exited with ${failed.status ?? 'unknown'}: ${failed.stderr ?? ''}${failed.stdout ?? ''}`,
        { cause: error },
      )
    }
  }

  const invokePending = <T>(command: string[], input?: unknown, env?: Record<string, string>) => {
    rmSync(approvalFile, { force: true })
    const child = spawn('restish', [apiName, ...command, '--rsh-output-format', 'json'], {
      cwd: repoRoot,
      env: { ...environment, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (input === undefined) {
      child.stdin.end()
    } else {
      child.stdin.end(JSON.stringify(input))
    }
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    let resolveApprovalUrl: (value: string) => void
    let rejectApprovalUrl: (reason: Error) => void
    const approvalUrl = new Promise<string>((resolve, reject) => {
      resolveApprovalUrl = resolve
      rejectApprovalUrl = reject
    })
    let approvalResolved = false
    const approvalTimer = setInterval(() => {
      if (approvalResolved || !existsSync(approvalFile)) return
      const value = readFileSync(approvalFile, 'utf8').trim()
      if (!value) return
      approvalResolved = true
      clearInterval(approvalTimer)
      resolveApprovalUrl(value)
    }, 50)
    const result = new Promise<T>((resolve, reject) => {
      child.on('error', (error) => {
        clearInterval(approvalTimer)
        if (!approvalResolved) rejectApprovalUrl(error)
        reject(error)
      })
      child.on('close', (code) => {
        clearInterval(approvalTimer)
        if (code !== 0) {
          const error = new Error(`Realmroot ${command.join(' ')} exited with ${code}: ${stderr}${stdout}`)
          if (!approvalResolved) rejectApprovalUrl(error)
          reject(error)
          return
        }
        try {
          resolve(JSON.parse(stdout) as T)
        } catch (error) {
          reject(error)
        }
      })
    })
    const nextApprovalUrl = () =>
      approvalUrl.then(
        (previous) =>
          new Promise<string>((resolve, reject) => {
            const timer = setInterval(() => {
              if (!existsSync(approvalFile)) return
              const value = readFileSync(approvalFile, 'utf8').trim()
              if (!value || value === previous) return
              clearInterval(timer)
              resolve(value)
            }, 50)
            result.catch((error) => {
              clearInterval(timer)
              reject(error)
            })
          }),
      )
    return { approvalUrl, nextApprovalUrl, result }
  }

  const invokeAuth = <T>(command: string[]): T => {
    try {
      return JSON.parse(
        execFileSync('restish', ['auth', ...command, '--rsh-output-format', 'json'], {
          cwd: repoRoot,
          env: environment,
          encoding: 'utf8',
        }),
      ) as T
    } catch (error) {
      const failed = error as Error & { stdout?: string; stderr?: string; status?: number }
      throw new Error(
        `Restish auth ${command.join(' ')} exited with ${failed.status ?? 'unknown'}: ${failed.stderr ?? ''}${failed.stdout ?? ''}`,
        { cause: error },
      )
    }
  }

  const invokePendingAuth = <T>(command: string[], env?: Record<string, string>) => {
    rmSync(approvalFile, { force: true })
    const child = spawn('restish', ['auth', ...command, '--rsh-output-format', 'json'], {
      cwd: repoRoot,
      env: { ...environment, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    let previous = ''
    const nextApproval = () =>
      new Promise<string>((resolve, reject) => {
        const timer = setInterval(() => {
          if (!existsSync(approvalFile)) return
          const value = readFileSync(approvalFile, 'utf8').trim()
          if (!value || value === previous) return
          previous = value
          clearInterval(timer)
          resolve(value)
        }, 50)
        child.once('close', (code) => {
          clearInterval(timer)
          if (code !== 0)
            reject(new Error(`Realmroot auth ${command.join(' ')} exited with ${code}: ${stderr}${stdout}`))
        })
      })
    const approvalUrl = nextApproval()
    const result = new Promise<T>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Realmroot auth ${command.join(' ')} exited with ${code}: ${stderr}${stdout}`))
          return
        }
        try {
          resolve(JSON.parse(stdout) as T)
        } catch (error) {
          reject(error)
        }
      })
    })
    return { approvalUrl, nextApprovalUrl: nextApproval, result }
  }

  return {
    login: (name) =>
      invokePendingAuth<PluginIdentityResult>(['login', '--runtime', 'e2e'], { REALMROOT_AGENT_NAME: name }),
    logout: () => invokeAuth(['logout', '--runtime', 'e2e']),
    status: () => invokeAuth(['status', '--runtime', 'e2e']),
    whoami: () => invoke<PluginIdentityResult>(['whoami']),
    listResourceServers: <T>() => get<T>(`${origin}/api/resource-servers?limit=100&offset=0`),
    listResources: <T>(resourceServerId: string) =>
      get<T>(`${origin}/api/resource-servers/${encodeURIComponent(resourceServerId)}/resources?limit=100&offset=0`),
    connectResource: <T>(resourceId: string, input: unknown) => invokePending<T>(['connect', resourceId], input),
    requestResourceAccess: <T>(input: unknown) => invokePending<T>(['access'], input),
    connectTarget: (targetAPIName, resourceUrl) => {
      execFileSync('restish', ['api', 'connect', targetAPIName, resourceUrl, '--no-discover', '--replace', '--yes'], {
        cwd: repoRoot,
        env: environment,
        encoding: 'utf8',
      })
      execFileSync(
        'restish',
        [
          'api',
          'set',
          targetAPIName,
          'profiles.default.auth.type: bearer',
          'profiles.default.auth.params.token: realmroot-plugin-managed',
          'profiles.default.auth.params.provider: realmroot-target',
          `profiles.default.auth.params.issuer: ${origin}/api/auth`,
        ],
        { cwd: repoRoot, env: environment, encoding: 'utf8' },
      )
      targetURLs.set(targetAPIName, resourceUrl.replace(/\/$/, ''))
    },
    targetRequest: <T>(targetAPIName: string, path: string) => {
      const resourceURL = targetURLs.get(targetAPIName)
      if (!resourceURL) throw new Error(`Target API "${targetAPIName}" is not connected`)
      try {
        return JSON.parse(
          execFileSync('restish', ['get', `${resourceURL}/${path}`, '--rsh-output-format', 'json'], {
            cwd: repoRoot,
            env: environment,
            encoding: 'utf8',
          }),
        ) as T
      } catch (error) {
        const failed = error as Error & { stdout?: string; stderr?: string; status?: number }
        throw new Error(
          `Restish ${targetAPIName}/${path} exited with ${failed.status ?? 'unknown'}: ${failed.stderr ?? ''}${failed.stdout ?? ''}`,
          { cause: error },
        )
      }
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}
