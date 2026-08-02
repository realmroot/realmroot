import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccountStore } from './account.test-utils'
import { ProfileDialogs } from './profile-dialogs'

afterEach(cleanup)

function dialogProps(
  overrides: Partial<ComponentProps<typeof ProfileDialogs>> = {},
): ComponentProps<typeof ProfileDialogs> {
  const store = createAccountStore()
  return {
    avatarPreview: '',
    changeEmail: vi.fn((event) => event.preventDefault()),
    changePassword: vi.fn((event) => event.preventDefault()),
    closeDialog: vi.fn(),
    confirmPassword: 'new-password',
    currentPassword: 'old-password',
    dialog: null,
    displayName: 'Jane',
    email: 'new@example.com',
    emailOtp: '123456',
    emailStep: 'request',
    newPassword: 'new-password',
    passwordError: null,
    profile: store.profile,
    saveProfile: vi.fn((event) => event.preventDefault()),
    setConfirmPassword: vi.fn(),
    setCurrentPassword: vi.fn(),
    setDisplayName: vi.fn(),
    setEmail: vi.fn(),
    setEmailOtp: vi.fn(),
    setEmailStep: vi.fn(),
    setNewPassword: vi.fn(),
    setUsername: vi.fn(),
    uploadAvatar: vi.fn(),
    username: 'jane',
    ...overrides,
  }
}

describe('ProfileDialogs', () => {
  it('operates the avatar, display name, and username editors', () => {
    const avatar = dialogProps({ dialog: 'avatar', avatarPreview: 'https://cdn.example.com/avatar.png' })
    const view = render(<ProfileDialogs {...avatar} />)
    expect(screen.getByRole('heading', { name: 'Change avatar' })).toBeTruthy()
    expect(document.querySelector('img')?.getAttribute('src')).toBe(avatar.avatarPreview)
    fireEvent.change(screen.getByLabelText('Avatar image'), {
      target: { files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })] },
    })
    expect(avatar.uploadAvatar).toHaveBeenCalledOnce()
    fireEvent.submit(screen.getByRole('button', { name: 'Save avatar' }).closest('form')!)
    expect(avatar.saveProfile).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(avatar.closeDialog).toHaveBeenCalledOnce()

    const emptyAvatar = dialogProps({ dialog: 'avatar' })
    view.rerender(<ProfileDialogs {...emptyAvatar} />)
    expect(document.querySelector('img')).toBeNull()
    fireEvent.change(screen.getByLabelText('Avatar image'), { target: { files: [] } })
    expect(emptyAvatar.uploadAvatar).toHaveBeenCalledWith(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(emptyAvatar.closeDialog).toHaveBeenCalledOnce()

    const displayName = dialogProps({ dialog: 'displayName' })
    view.rerender(<ProfileDialogs {...displayName} />)
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jane Updated' } })
    expect(displayName.setDisplayName).toHaveBeenCalledWith('Jane Updated')
    fireEvent.submit(screen.getByLabelText('Display name').closest('form')!)
    expect(displayName.saveProfile).toHaveBeenCalledOnce()

    const username = dialogProps({ dialog: 'username' })
    view.rerender(<ProfileDialogs {...username} />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jane-new' } })
    expect(username.setUsername).toHaveBeenCalledWith('jane-new')
    fireEvent.click(screen.getByRole('button', { name: 'Save identifiers' }))
    expect(username.saveProfile).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(username.closeDialog).toHaveBeenCalledOnce()
  })

  it('operates both email steps and the password editor', () => {
    const request = dialogProps({ dialog: 'email' })
    const view = render(<ProfileDialogs {...request} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'next@example.com' } })
    expect(request.setEmail).toHaveBeenCalledWith('next@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect(request.changeEmail).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(request.closeDialog).toHaveBeenCalledOnce()

    const confirm = dialogProps({ dialog: 'email', emailStep: 'confirm' })
    view.rerender(<ProfileDialogs {...confirm} />)
    expect(screen.getByText(/sent to new@example.com/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '654321' } })
    expect(confirm.setEmailOtp).toHaveBeenCalledWith('654321')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(confirm.setEmailStep).toHaveBeenCalledWith('request')
    expect(confirm.setEmailOtp).toHaveBeenCalledWith('')
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(confirm.changeEmail).toHaveBeenCalledOnce()

    const password = dialogProps({ dialog: 'password', passwordError: 'Passwords do not match.' })
    view.rerender(<ProfileDialogs {...password} />)
    expect(screen.getByText('Passwords do not match.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'next-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'next-password' } })
    expect(password.setCurrentPassword).toHaveBeenCalledWith('current')
    expect(password.setNewPassword).toHaveBeenCalledWith('next-password')
    expect(password.setConfirmPassword).toHaveBeenCalledWith('next-password')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(password.changePassword).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(password.closeDialog).toHaveBeenCalledOnce()
  })
})
