import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceVerification } from '@/features/auth/device-authorization'
import { approveDeviceCode, denyDeviceCode, verifyDeviceCode } from '@/lib/auth-client'

vi.mock('@/lib/auth-client', () => ({
  approveDeviceCode: vi.fn().mockResolvedValue({ success: true }),
  denyDeviceCode: vi.fn().mockResolvedValue({ success: true }),
  verifyDeviceCode: vi.fn().mockResolvedValue({ user_code: 'ABCD2345', status: 'pending' }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  window.history.pushState(null, '', '/')
})

describe('DeviceVerification', () => {
  it('sends entered codes to the authenticated approval route', () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<DeviceVerification mode="entry" />)

    fireEvent.change(screen.getByLabelText('Device code'), { target: { value: 'abcd-2345' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!)

    expect(assign).toHaveBeenCalledWith('/device/approve?user_code=ABCD2345')
  })

  it('claims and approves a verified device code [spec: hosted-auth/better-auth-device-approval]', async () => {
    render(<DeviceVerification mode="approval" userCode="ABCD-2345" />)

    await waitFor(() => expect(verifyDeviceCode).toHaveBeenCalledWith({ userCode: 'ABCD-2345' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(approveDeviceCode).toHaveBeenCalledWith({ userCode: 'ABCD2345' }))
    expect(await screen.findByText('Device approved.')).toBeTruthy()
  })

  it('denies a verified device code', async () => {
    render(<DeviceVerification mode="approval" userCode="ABCD-2345" />)

    await waitFor(() => expect(verifyDeviceCode).toHaveBeenCalledWith({ userCode: 'ABCD-2345' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(denyDeviceCode).toHaveBeenCalledWith({ userCode: 'ABCD2345' }))
    expect(await screen.findByText('Device denied.')).toBeTruthy()
  })

  it('keeps approval actions disabled when no user code is available', () => {
    render(<DeviceVerification mode="approval" />)

    expect(screen.getByText('Missing code')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Approve' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Deny' }).disabled).toBe(true)
    expect(verifyDeviceCode).not.toHaveBeenCalled()
  })

  it('surfaces device verification failures before approval', async () => {
    vi.mocked(verifyDeviceCode).mockRejectedValueOnce(new Error('Device code expired.'))

    render(<DeviceVerification mode="approval" userCode="EXPIRED1" />)

    expect(await screen.findByText('Device code expired.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Approve' }).disabled).toBe(true)
  })

  it('surfaces approval failures and allows retry', async () => {
    vi.mocked(approveDeviceCode).mockRejectedValueOnce(new Error('Approval failed.'))
    render(<DeviceVerification mode="approval" userCode="ABCD-2345" />)

    await waitFor(() => expect(verifyDeviceCode).toHaveBeenCalledWith({ userCode: 'ABCD-2345' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Approval failed.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Approve' }).disabled).toBe(false)
  })

  it('surfaces denial failures and allows retry', async () => {
    vi.mocked(denyDeviceCode).mockRejectedValueOnce(new Error('Denial failed.'))
    render(<DeviceVerification mode="approval" userCode="ABCD-2345" />)

    await waitFor(() => expect(verifyDeviceCode).toHaveBeenCalledWith({ userCode: 'ABCD-2345' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    expect(await screen.findByText('Denial failed.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Deny' }).disabled).toBe(false)
  })

  it('uses a generic message for non-Error verification rejections', async () => {
    vi.mocked(verifyDeviceCode).mockRejectedValueOnce('boom')

    render(<DeviceVerification mode="approval" userCode="EXPIRED1" />)

    expect(await screen.findByText('Device code is invalid or expired.')).toBeTruthy()
  })

  it('uses a generic message for non-Error approval rejections', async () => {
    vi.mocked(approveDeviceCode).mockRejectedValueOnce('boom')
    render(<DeviceVerification mode="approval" userCode="ABCD-2345" />)

    await waitFor(() => expect(verifyDeviceCode).toHaveBeenCalledWith({ userCode: 'ABCD-2345' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Unable to update device access.')).toBeTruthy()
  })

  it('does not navigate when the entry code is blank', () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<DeviceVerification mode="entry" />)

    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!)

    expect(assign).not.toHaveBeenCalled()
  })

  it('ignores verification results after the component unmounts', async () => {
    let resolveVerify: ((value: { user_code: string; status: string }) => void) | undefined
    vi.mocked(verifyDeviceCode).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVerify = resolve as typeof resolveVerify
      }) as ReturnType<typeof verifyDeviceCode>,
    )

    const { unmount } = render(<DeviceVerification mode="approval" userCode="ABCD-2345" />)
    await waitFor(() => expect(verifyDeviceCode).toHaveBeenCalled())
    unmount()
    resolveVerify?.({ user_code: 'ABCD2345', status: 'pending' })

    // The resolved code must not appear after unmount; no assertion errors thrown.
    expect(screen.queryByText('ABCD2345')).toBeNull()
  })
})
