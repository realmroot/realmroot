import { type ExecFileSyncOptionsWithStringEncoding, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PluginIdentityResult {
  authenticated?: boolean
  identity: {
    id: string
    issuer: string
    subject: string
    name: string
    bindings: Array<{ protocolAgentId: string; hostId: string }>
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

export interface AgentTokenResult {
  access_token: string
  token_type: 'DPoP'
  expires_in: number
  scope: string
}

export interface RestishAgentPlugin {
  firstWhoami(name: string): PendingWhoami
  whoami(): PluginIdentityResult
  requestCapabilities(capabilities: string[], reason: string): PendingCapabilityRequest
  requestAgentToken(grantId: string, dpopProof: string): AgentTokenResult
  listApplications(): { applications: unknown[] }
  dispose(): void
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const pluginRoot = join(repoRoot, 'plugins', 'restish-flareauth')

export function createRestishAgentPlugin(origin: string): RestishAgentPlugin {
  const root = mkdtempSync(join(tmpdir(), 'flareauth-restish-e2e-'))
  const configDir = join(root, 'config')
  const stateDir = join(root, 'state')
  const binary = join(root, 'restish-flareauth')
  const apiName = 'flareauth-e2e-plugin'
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
    FLAREAUTH_PLUGIN_STATE_DIR: stateDir,
    FLAREAUTH_PLUGIN_APPROVAL_FILE: approvalFile,
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

  const invokeWithRequiredArgs = <T>(operation: string, requiredArgs: string[], input: unknown): T => {
    const options: ExecFileSyncOptionsWithStringEncoding = {
      cwd: repoRoot,
      env: environment,
      encoding: 'utf8',
      input: JSON.stringify(input),
    }
    const args = [apiName, operation, ...requiredArgs, '--rsh-output-format', 'json']
    try {
      return JSON.parse(execFileSync('restish', args, options)) as T
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
          const error = new Error(`FlareAuth ${operation} exited with ${code}: ${stderr}`)
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
    firstWhoami: (name) => invokePending<PluginIdentityResult>('whoami', undefined, { FLAREAUTH_AGENT_NAME: name }),
    whoami: () => invoke<PluginIdentityResult>('whoami'),
    requestCapabilities: (capabilities, reason) =>
      invokePending<CapabilityRequestResult>('request-agent-capabilities', { capabilities, reason }),
    requestAgentToken: (grantId, dpopProof) =>
      invokeWithRequiredArgs<AgentTokenResult>('issue-agent-access-token', [dpopProof], {
        grant_type: 'urn:flareauth:params:oauth:grant-type:agent-authority',
        grant_id: grantId,
      }),
    listApplications: () => invoke<{ applications: unknown[] }>('list-applications'),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}
