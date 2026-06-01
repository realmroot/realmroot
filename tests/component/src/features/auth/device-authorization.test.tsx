import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceVerification } from '@/features/auth/device-authorization'
import { approveDeviceCode, denyDeviceCode, verifyDeviceCode } from '@/lib/auth-client'

vi.mock('../../../../../src/lib/auth-client', () => ({
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

  it('claims and approves a verified device code', async () => {
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
})
