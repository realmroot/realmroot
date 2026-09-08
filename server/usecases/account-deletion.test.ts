import { createTestDeps } from '@server/http/test-deps'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertDeletionAuthentication, deleteAccount, processAccountDeletionCleanup } from './account-deletion'
import type { Deps } from './deps'
import { revokeDeletedAccountConnection, revokeDeletedAccountLease } from './external-resources'
import type { AccountDeletionJob, AccountDeletionRepository } from './ports'

// The cleanup scheduler owns retries and completion. Upstream revocation semantics
// are exercised separately through the real external-resource use cases.
vi.mock('./external-resources', () => ({
  revokeDeletedAccountConnection: vi.fn(),
  revokeDeletedAccountLease: vi.fn(),
}))

const now = new Date('2026-09-08T12:00:00Z')
const job: AccountDeletionJob = {
  userId: 'deleted-user',
  assetKeys: ['avatar/one'],
  organizationIds: ['org-1'],
  attempts: 0,
  claimId: 'claim-1',
}
function setup() {
  const repository: AccountDeletionRepository = {
    erase: vi.fn().mockResolvedValue(undefined),
    enqueueAssetCleanup: vi.fn(),
    claim: vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null),
    findLease: vi.fn(),
    pendingConnections: vi.fn().mockResolvedValue(['connection-1']),
    pendingLeases: vi.fn().mockResolvedValue(['lease-1']),
    clearConnection: vi.fn(),
    clearLease: vi.fn(),
    finish: vi.fn(),
    retry: vi.fn(),
  }
  const deps = createTestDeps({ accountDeletion: repository })
  deps.assetStorage.delete = vi.fn().mockResolvedValue(undefined)
  return { deps, repository }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.resetAllMocks()
})
afterEach(() => vi.useRealTimers())

describe('permanent deletion orchestration', () => {
  it.each([
    null,
    { createdAt: new Date(now.getTime() - 300_001) },
    { createdAt: 'invalid' },
    { createdAt: now, impersonatedBy: 'admin' },
  ])('rejects missing, stale, invalid or impersonated authentication: %j', (session) => {
    expect(() => assertDeletionAuthentication(session)).toThrow('Sign in again')
  })
  it('accepts fresh non-impersonated authentication, including the five-minute boundary', () => {
    expect(() => assertDeletionAuthentication({ createdAt: now.toISOString() })).not.toThrow()
    expect(() =>
      assertDeletionAuthentication({ createdAt: new Date(now.getTime() - 300_000), impersonatedBy: null }),
    ).not.toThrow()
  })
  it('commits deletion at the repository boundary and propagates rejection', async () => {
    const { deps, repository } = setup()
    await deleteAccount(deps, job.userId)
    expect(repository.erase).toHaveBeenCalledWith(job.userId, now.getTime())
    const cause = new Error('last owner')
    vi.mocked(repository.erase).mockRejectedValue(cause)
    await expect(deleteAccount(deps, job.userId)).rejects.toBe(cause)
  })
  it('erases each external artifact before completing the job and constrains outbound requests', async () => {
    const { deps, repository } = setup()
    vi.mocked(deps.externalHttp.fetch).mockResolvedValue(new Response(null, { status: 200 }))
    vi.mocked(revokeDeletedAccountConnection).mockImplementation(async (cleanupDeps: Deps) => {
      await cleanupDeps.externalHttp.fetch(new Request('https://provider.example/revoke', { method: 'POST' }))
    })
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await processAccountDeletionCleanup(deps)
    expect(deps.assetStorage.delete).toHaveBeenCalledWith('avatar/one')
    expect(repository.clearLease).toHaveBeenCalledWith('lease-1')
    expect(repository.clearConnection).toHaveBeenCalledWith('connection-1')
    expect(repository.finish).toHaveBeenCalledWith(job)
    expect(repository.retry).not.toHaveBeenCalled()
    const request = vi.mocked(deps.externalHttp.fetch).mock.calls[0]![0]
    expect(request.method).toBe('POST')
    expect(request.signal.aborted).toBe(false)
    expect(timeout).toHaveBeenCalledWith(15_000)
    timeout.mockRestore()
  })
  it('preserves failed ciphertext, continues independent cleanup and retains the job for retry', async () => {
    const { deps, repository } = setup()
    const failure = new Error('provider offline')
    vi.mocked(revokeDeletedAccountLease).mockRejectedValue(failure)
    await expect(processAccountDeletionCleanup(deps)).rejects.toMatchObject({
      errors: [expect.objectContaining({ errors: [failure] })],
    })
    expect(repository.clearLease).not.toHaveBeenCalled()
    expect(repository.clearConnection).toHaveBeenCalledWith('connection-1')
    expect(repository.retry).toHaveBeenCalledWith(job, now.getTime())
    expect(repository.finish).not.toHaveBeenCalled()
    expect(deps.webhooks.listSubscribedEndpoints).not.toHaveBeenCalled()
  })
  it('retains cleanup work if publishing its deletion event fails', async () => {
    const { deps, repository } = setup()
    const failure = new Error('webhook storage offline')
    vi.mocked(deps.webhooks.listSubscribedEndpoints).mockRejectedValue(failure)
    await expect(processAccountDeletionCleanup(deps)).rejects.toMatchObject({ errors: [failure] })
    expect(repository.retry).toHaveBeenCalledWith(job, now.getTime())
    expect(repository.finish).not.toHaveBeenCalled()
  })
  it('bounds one invocation to ten claimed jobs', async () => {
    const { deps, repository } = setup()
    vi.mocked(repository.claim)
      .mockReset()
      .mockResolvedValue({ ...job, assetKeys: [] })
    vi.mocked(repository.pendingConnections).mockResolvedValue([])
    vi.mocked(repository.pendingLeases).mockResolvedValue([])
    await processAccountDeletionCleanup(deps)
    expect(repository.finish).toHaveBeenCalledTimes(10)
    expect(repository.claim).toHaveBeenCalledTimes(10)
  })
})
