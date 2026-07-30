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
  result: Promise<PluginIdentityResult>
}

export interface CapabilityRequestResult {
  agent_id: string
  status: 'active'
  agent_capability_grants: Array<{ capability: string; status: string }>
}

export interface PendingCapabilityRequest {
  approvalUrl: Promise<string>
  result: Promise<CapabilityRequestResult>
}

export interface PendingResourceAccess<T> {
  approvalUrl: Promise<string>
  result: Promise<T>
}

export interface RestishAgentPlugin {
  firstWhoami(name: string): PendingWhoami
  whoami(): PluginIdentityResult
  requestCapabilities(capabilities: string[], reason: string): PendingCapabilityRequest
  listAgentApiResources<T>(): T
  requestResourceAccess<T>(input: unknown): PendingResourceAccess<T>
  issueTargetAccessToken(grantId: string): {
    tokenType: 'DPoP'
    scopes: string[]
    resourceUrl: string
  }
  connectTarget(apiName: string, resourceUrl: string): void
  targetRequest<T>(apiName: string, operation: string): T
  listApplications(): { applications: unknown[] }
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

  const invoke = <T>(operation: string, input?: unknown): T => {
    const options: ExecFileSyncOptionsWithStringEncoding = {
      cwd: repoRoot,
      env: environment,
      encoding: 'utf8',
      ...(input === undefined ? {} : { input: JSON.stringify(input) }),
    }
    try {
      return JSON.parse(execFileSync('restish', [apiName, operation, '--rsh-output-format', 'json'], options)) as T
    } catch (error) {
      const failed = error as Error & { stdout?: string; stderr?: string; status?: number }
      throw new Error(
        `Restish ${operation} exited with ${failed.status ?? 'unknown'}: ${failed.stderr ?? ''}${failed.stdout ?? ''}`,
        { cause: error },
      )
    }
  }

  const invokeWithArguments = <T>(operation: string, args: string[]): T => {
    try {
      return JSON.parse(
        execFileSync('restish', [apiName, operation, ...args, '--rsh-output-format', 'json'], {
          cwd: repoRoot,
          env: environment,
          encoding: 'utf8',
        }),
      ) as T
    } catch (error) {
      const failed = error as Error & { stdout?: string; stderr?: string; status?: number }
      throw new Error(
        `Restish ${operation} exited with ${failed.status ?? 'unknown'}: ${failed.stderr ?? ''}${failed.stdout ?? ''}`,
        { cause: error },
      )
    }
  }

  const invokePending = <T>(operation: string, input?: unknown, env?: Record<string, string>) => {
    rmSync(approvalFile, { force: true })
    const child = spawn('restish', [apiName, operation, '--rsh-output-format', 'json'], {
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
          const error = new Error(`Realmroot ${operation} exited with ${code}: ${stderr}${stdout}`)
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
    return { approvalUrl, result }
  }

  return {
    firstWhoami: (name) =>
      invokePending<PluginIdentityResult>('get-current-agent', undefined, { REALMROOT_AGENT_NAME: name }),
    whoami: () => invoke<PluginIdentityResult>('get-current-agent'),
    requestCapabilities: (capabilities, reason) =>
      invokePending<CapabilityRequestResult>('request-agent-capabilities', { capabilities, reason }),
    listAgentApiResources: <T>() => invoke<T>('list-agent-api-resources'),
    requestResourceAccess: <T>(input: unknown) => invokePending<T>('create-agent-access-request', input),
    issueTargetAccessToken: (grantId) =>
      invokeWithArguments<{
        tokenType: 'DPoP'
        scopes: string[]
        resourceUrl: string
      }>('issue-target-access-token', [grantId]),
    connectTarget: (targetAPIName, resourceUrl) => {
      execFileSync('restish', ['api', 'connect', targetAPIName, resourceUrl, '--replace', '--yes'], {
        cwd: repoRoot,
        env: environment,
        encoding: 'utf8',
      })
    },
    targetRequest: <T>(targetAPIName: string, operation: string) => {
      try {
        return JSON.parse(
          execFileSync('restish', [targetAPIName, operation, '--rsh-output-format', 'json'], {
            cwd: repoRoot,
            env: environment,
            encoding: 'utf8',
          }),
        ) as T
      } catch (error) {
        const failed = error as Error & { stdout?: string; stderr?: string; status?: number }
        throw new Error(
          `Restish ${targetAPIName} ${operation} exited with ${failed.status ?? 'unknown'}: ${failed.stderr ?? ''}${failed.stdout ?? ''}`,
          { cause: error },
        )
      }
    },
    listApplications: () => invoke<{ applications: unknown[] }>('list-applications'),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}
