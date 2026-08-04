import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PluginIdentityResult {
  agent: {
    id: string
    issuer: string
    subject: string
    name: string
  }
  local: {
    status: string
    runtime: string
    session: string
    resourceCredentialCount: number
  }
}

export interface PendingLogin {
  approvalUrl: Promise<string>
  result: Promise<PluginIdentityResult>
}

export interface PendingRecovery extends PendingLogin {
  nextApprovalUrl(): Promise<string>
}

export interface PendingResourceAccess<T> {
  approvalUrl: Promise<string>
  result: Promise<T>
}

export interface RestishAgentPlugin {
  firstLogin(name: string): PendingLogin
  status(): PluginIdentityResult
  listAuth<T>(): T
  recover(): PendingRecovery
  retire(subject: string): { agentId: string; status: 'retired'; localState: 'removed' }
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
  const apiName = 'realmroot-e2e-plugin'
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
  const invokeRoot = <T>(command: string[]): T => {
    try {
      return JSON.parse(
        execFileSync('restish', [...command, '--rsh-output-format', 'json'], {
          cwd: repoRoot,
          env: environment,
          encoding: 'utf8',
        }),
      ) as T
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

  const invokePending = <T>(command: string[], input?: unknown, env?: Record<string, string>, rootCommand = false) => {
    rmSync(approvalFile, { force: true })
    const child = spawn('restish', [...(rootCommand ? [] : [apiName]), ...command, '--rsh-output-format', 'json'], {
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
            child.once('close', (code) => {
              clearInterval(timer)
              reject(new Error(`Realmroot ${command.join(' ')} exited with ${code} before the next approval`))
            })
          }),
      )
    return { approvalUrl, nextApprovalUrl, result }
  }

  return {
    firstLogin: (name) =>
      invokePending<PluginIdentityResult>(
        ['auth', 'login', 'default', '--api', apiName, '--api-profile', 'default', '--agent-name', name],
        undefined,
        undefined,
        true,
      ),
    status: () => invokeRoot<PluginIdentityResult>(['auth', 'status']),
    listAuth: <T>() => invokeRoot<T>(['auth', 'list']),
    recover: () => invokePending<PluginIdentityResult>(['auth', 'recover', '--yes'], undefined, undefined, true),
    retire: (subject) =>
      invokeRoot<{ agentId: string; status: 'retired'; localState: 'removed' }>([
        'auth',
        'retire',
        '--confirm',
        subject,
      ]),
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
