import { expect, test } from './fixtures'
import { signIn, signOut } from './helpers/real-app'

test('permanent deletion through account settings [spec: account-center/account-deletion-browser]', async ({
  page,
  configuredRealm,
}) => {
  void configuredRealm
  await signIn(page)
  const created = await page.request.post('/api/users', {
    data: {
      email: 'delete-browser@example.com',
      username: 'delete-browser',
      displayName: 'Delete Browser',
      password: 'DeleteBrowser2026!',
    },
  })
  expect(created.status()).toBe(201)
  const result = await created.json()
  expect(
    (
      await page.request.patch(`/api/users/${result.user?.id ?? result.id}`, { data: { emailVerified: true } })
    ).status(),
  ).toBe(200)
  await signOut(page)
  await signIn(page, { username: 'delete-browser', password: 'DeleteBrowser2026!' })
  await page.goto('/security')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Delete account', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeFocused()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Delete account', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.screenshot({
    path: 'test-results/account-deletion-confirmation.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Permanently delete account', exact: true }).click()
  await expect(page).toHaveURL(/\/auth\/account-deleted$/)
  await expect(page.getByRole('heading', { name: 'Your account has been deleted' })).toBeVisible()
  expect((await page.request.get('/api/account/profile')).status()).toBe(401)
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
  await signIn(page)
  expect((await page.request.get('/api/account/profile')).status()).toBe(200)
  await signOut(page)
})
