import { KeyRound, Mail, Upload, UserRound } from 'lucide-react'
import type { FormEvent } from 'react'
import { Field, TextInput } from '@/components/product-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Status } from '@/components/ui/status'
import { tt } from '@/lib/i18n'
import type { UserProfile } from './types'

type ProfileDialog = 'avatar' | 'displayName' | 'username' | 'email' | 'password' | null

export function ProfileDialogs({
  avatarPreview,
  changeEmail,
  changePassword,
  closeDialog,
  confirmPassword,
  currentPassword,
  dialog,
  displayName,
  email,
  emailOtp,
  emailStep,
  newPassword,
  passwordError,
  profile,
  saveProfile,
  setConfirmPassword,
  setCurrentPassword,
  setDisplayName,
  setEmail,
  setEmailOtp,
  setEmailStep,
  setNewPassword,
  setUsername,
  uploadAvatar,
  username,
}: {
  avatarPreview: string
  changeEmail: (event: FormEvent) => void
  changePassword: (event: FormEvent) => void
  closeDialog: () => void
  confirmPassword: string
  currentPassword: string
  dialog: ProfileDialog
  displayName: string
  email: string
  emailOtp: string
  emailStep: 'request' | 'confirm'
  newPassword: string
  passwordError: string | null
  profile: UserProfile
  saveProfile: (event: FormEvent) => void
  setConfirmPassword: (value: string) => void
  setCurrentPassword: (value: string) => void
  setDisplayName: (value: string) => void
  setEmail: (value: string) => void
  setEmailOtp: (value: string) => void
  setEmailStep: (value: 'request' | 'confirm') => void
  setNewPassword: (value: string) => void
  setUsername: (value: string) => void
  uploadAvatar: (file: File | undefined) => void
  username: string
}) {
  return (
    <>
      <ProfileImageDialog
        avatarPreview={avatarPreview}
        closeDialog={closeDialog}
        dialog={dialog}
        displayName={displayName}
        saveProfile={saveProfile}
        setDisplayName={setDisplayName}
        uploadAvatar={uploadAvatar}
      />
      <UsernameDialog
        closeDialog={closeDialog}
        dialog={dialog}
        saveProfile={saveProfile}
        setUsername={setUsername}
        username={username}
      />
      <EmailDialog
        changeEmail={changeEmail}
        closeDialog={closeDialog}
        dialog={dialog}
        email={email}
        emailOtp={emailOtp}
        emailStep={emailStep}
        setEmail={setEmail}
        setEmailOtp={setEmailOtp}
        setEmailStep={setEmailStep}
      />
      <PasswordDialog
        changePassword={changePassword}
        closeDialog={closeDialog}
        confirmPassword={confirmPassword}
        currentPassword={currentPassword}
        dialog={dialog}
        newPassword={newPassword}
        passwordError={passwordError}
        profile={profile}
        setConfirmPassword={setConfirmPassword}
        setCurrentPassword={setCurrentPassword}
        setNewPassword={setNewPassword}
      />
    </>
  )
}

function ProfileImageDialog({
  avatarPreview,
  closeDialog,
  dialog,
  displayName,
  saveProfile,
  setDisplayName,
  uploadAvatar,
}: {
  avatarPreview: string
  closeDialog: () => void
  dialog: ProfileDialog
  displayName: string
  saveProfile: (event: FormEvent) => void
  setDisplayName: (value: string) => void
  uploadAvatar: (file: File | undefined) => void
}) {
  return (
    <Dialog onOpenChange={(open) => !open && closeDialog()} open={dialog === 'avatar' || dialog === 'displayName'}>
      <DialogContent>
        <form onSubmit={saveProfile}>
          <DialogHeader>
            <DialogTitle>{dialog === 'avatar' ? tt('Change avatar') : tt('Edit display name')}</DialogTitle>
            <DialogDescription>{tt('Update the profile shown across trusted applications.')}</DialogDescription>
          </DialogHeader>
          <div className="dialogFormBody formStack">
            {dialog === 'avatar' ? (
              <div className="avatarUploadControl">
                {avatarPreview ? (
                  <img alt="" className="assetPreview" src={avatarPreview} width="56" height="56" />
                ) : (
                  <div className="assetPreview" aria-hidden="true">
                    <UserRound size={28} />
                  </div>
                )}
                <div className="avatarUploadMeta">
                  <span className="avatarUploadLabel">{tt('Avatar image')}</span>
                  <span className="avatarUploadHelp">{tt('PNG, JPEG, or WebP up to 2 MB.')}</span>
                  <button
                    className="avatarUploadButton"
                    onClick={() => document.getElementById('account-avatar-upload')?.click()}
                    type="button"
                  >
                    <Upload size={16} /> {tt('Upload image')}
                  </button>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    aria-label={tt('Avatar image')}
                    className="visuallyHidden"
                    id="account-avatar-upload"
                    name="avatar"
                    onChange={(event) => uploadAvatar(event.currentTarget.files?.[0])}
                    tabIndex={-1}
                    type="file"
                  />
                </div>
              </div>
            ) : (
              <Field label={tt('Display name')}>
                <TextInput
                  autoComplete="name"
                  name="display-name"
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  value={displayName}
                />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button onClick={closeDialog} type="button" variant="secondary">
              {tt('Cancel')}
            </Button>
            <Button type="submit">{dialog === 'avatar' ? tt('Save avatar') : tt('Save display name')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function UsernameDialog({
  closeDialog,
  dialog,
  saveProfile,
  setUsername,
  username,
}: {
  closeDialog: () => void
  dialog: ProfileDialog
  saveProfile: (event: FormEvent) => void
  setUsername: (value: string) => void
  username: string
}) {
  return (
    <Dialog onOpenChange={(open) => !open && closeDialog()} open={dialog === 'username'}>
      <DialogContent>
        <form onSubmit={saveProfile}>
          <DialogHeader>
            <DialogTitle>{tt('Edit username')}</DialogTitle>
            <DialogDescription>{tt('Choose the username associated with this hosted account.')}</DialogDescription>
          </DialogHeader>
          <div className="dialogFormBody formStack">
            <Field label={tt('Username')}>
              <TextInput
                autoComplete="username"
                name="username"
                onChange={(event) => setUsername(event.target.value)}
                value={username}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={closeDialog} type="button" variant="secondary">
              {tt('Cancel')}
            </Button>
            <Button type="submit" variant="secondary">
              {tt('Save identifiers')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EmailDialog({
  changeEmail,
  closeDialog,
  dialog,
  email,
  emailOtp,
  emailStep,
  setEmail,
  setEmailOtp,
  setEmailStep,
}: {
  changeEmail: (event: FormEvent) => void
  closeDialog: () => void
  dialog: ProfileDialog
  email: string
  emailOtp: string
  emailStep: 'request' | 'confirm'
  setEmail: (value: string) => void
  setEmailOtp: (value: string) => void
  setEmailStep: (value: 'request' | 'confirm') => void
}) {
  return (
    <Dialog onOpenChange={(open) => !open && closeDialog()} open={dialog === 'email'}>
      <DialogContent>
        <form onSubmit={changeEmail}>
          <DialogHeader>
            <DialogTitle>{tt('Change email')}</DialogTitle>
            <DialogDescription>
              {emailStep === 'request'
                ? tt('A verification code will be sent to the new email address.')
                : tt('Enter the verification code sent to {{email}}.', { email })}
            </DialogDescription>
          </DialogHeader>
          <div className="dialogFormBody formStack">
            {emailStep === 'request' ? (
              <Field label={tt('Email')}>
                <TextInput
                  autoComplete="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </Field>
            ) : (
              <Field label={tt('Verification code')}>
                <TextInput
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  name="email-otp"
                  onChange={(event) => setEmailOtp(event.target.value)}
                  required
                  value={emailOtp}
                />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button onClick={closeDialog} type="button" variant="secondary">
              {tt('Cancel')}
            </Button>
            {emailStep === 'confirm' ? (
              <Button
                onClick={() => {
                  setEmailStep('request')
                  setEmailOtp('')
                }}
                type="button"
                variant="secondary"
              >
                {tt('Back')}
              </Button>
            ) : null}
            <Button type="submit" variant="secondary">
              <Mail size={18} />
              {emailStep === 'request' ? tt('Send code') : tt('Verify code')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PasswordDialog({
  changePassword,
  closeDialog,
  confirmPassword,
  currentPassword,
  dialog,
  newPassword,
  passwordError,
  profile,
  setConfirmPassword,
  setCurrentPassword,
  setNewPassword,
}: {
  changePassword: (event: FormEvent) => void
  closeDialog: () => void
  confirmPassword: string
  currentPassword: string
  dialog: ProfileDialog
  newPassword: string
  passwordError: string | null
  profile: UserProfile
  setConfirmPassword: (value: string) => void
  setCurrentPassword: (value: string) => void
  setNewPassword: (value: string) => void
}) {
  return (
    <Dialog onOpenChange={(open) => !open && closeDialog()} open={dialog === 'password'}>
      <DialogContent>
        <form onSubmit={changePassword}>
          <DialogHeader>
            <DialogTitle>{tt('Change password')}</DialogTitle>
            <DialogDescription>
              {tt('Rotates the hosted sign-in password and revokes other sessions.')}
            </DialogDescription>
          </DialogHeader>
          <div className="dialogFormBody formStack">
            {passwordError ? <Status tone="error">{passwordError}</Status> : null}
            <input autoComplete="username" hidden name="username" readOnly type="text" value={profile.email} />
            <Field label={tt('Current password')}>
              <TextInput
                autoComplete="current-password"
                name="current-password"
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type="password"
                value={currentPassword}
              />
            </Field>
            <Field label={tt('New password')}>
              <TextInput
                autoComplete="new-password"
                minLength={8}
                name="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </Field>
            <Field label={tt('Confirm new password')}>
              <TextInput
                autoComplete="new-password"
                minLength={8}
                name="confirm-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={closeDialog} type="button" variant="secondary">
              {tt('Cancel')}
            </Button>
            <Button type="submit" variant="secondary">
              <KeyRound size={18} /> {tt('Change password')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
