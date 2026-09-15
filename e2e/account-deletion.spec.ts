import { expect, test } from './fixtures'
import { signIn, signOut } from './helpers/real-app'

test.setTimeout(120_000)

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
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  await page.screenshot({
    path: 'test-results/account-profile-reference-desktop.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.goto('/security')
  await expect(page.getByRole('heading', { name: 'Sign-in & security' })).toBeVisible()
  await page.screenshot({
    path: 'test-results/account-security-reference-desktop.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.goto('/data-privacy')
  await expect(page.getByRole('heading', { name: 'Data & privacy' })).toBeVisible()
  const navigation = page.getByRole('navigation', { name: 'Account center' })
  const linkNames = await navigation
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.textContent?.trim() ?? ''))
  const securityLinkIndex = linkNames.indexOf('Sign-in & security')
  expect(linkNames.slice(securityLinkIndex, securityLinkIndex + 2)).toEqual(['Sign-in & security', 'Data & privacy'])
  await expect(navigation.getByRole('link', { name: 'Data & privacy' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Export account data')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Data & privacy' })).toBeVisible()
  await page.screenshot({
    path: 'test-results/account-data-privacy-desktop-en.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Open Account Center navigation' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
  await page.screenshot({
    path: 'test-results/account-profile-reference-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.goto('/security')
  await expect(page.getByRole('heading', { name: 'Sign-in & security' })).toBeVisible()
  await page.screenshot({
    path: 'test-results/account-security-reference-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.goto('/data-privacy')
  await page.getByRole('button', { name: 'Open Account Center navigation' }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Data & privacy' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.screenshot({
    path: 'test-results/account-data-privacy-mobile-en.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.evaluate(() => {
    window.localStorage.setItem('realmroot.language', 'zh')
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: '数据与隐私' })).toBeVisible()
  await expect(page.getByText('导出你的账户数据并管理永久删除。')).toBeVisible()
  await expect(page.getByRole('button', { name: '删除账户', exact: true })).toBeVisible()
  await page.screenshot({
    path: 'test-results/account-data-privacy-mobile-zh.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.evaluate(() => {
    window.localStorage.setItem('realmroot.language', 'en')
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Data & privacy' })).toBeVisible()
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
