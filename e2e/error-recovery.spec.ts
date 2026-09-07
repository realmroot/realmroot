import { expect, test } from '@playwright/test'

const errorPath = '/auth/error?error=invalid_target&error_description=Resource%20access%20was%20denied.'

test.describe('[spec: hosted-auth/browser-fatal-recovery] independent browser recovery', () => {
  test('keeps recovery links usable with JavaScript disabled', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
    try {
      const page = await context.newPage()
      await page.goto(errorPath)
      await expect(page.locator('#page-recovery')).toBeVisible()
      await expect(page.getByText(/JavaScript is disabled/)).toBeVisible()
      await page.getByRole('link', { name: 'Back to sign in' }).click()
      await expect(page).toHaveURL(/\/auth\/sign-in$/)
    } finally {
      await context.close()
    }
  })

  test('handles a failed entry module before React exists', async ({ page }) => {
    await page.route('**/src/main.tsx', (route) => route.abort())
    await page.goto(errorPath)
    await expect(page.locator('#recovery-title [lang=en]')).toHaveText('Unable to continue')
    await expect(page.locator('#root')).toBeHidden()
    await expect(page.getByRole('link', { name: 'Reload page' })).toBeVisible()
  })

  test('catches a provider crash outside the router', async ({ page }) => {
    await page.route(/\/src\/lib\/theme\.tsx(?:\?|$)/, (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: 'export function ThemeProvider() { throw new Error("private provider failure") }; export function useTheme() { return {theme:"light",setTheme(){}} }',
      }),
    )
    await page.goto(errorPath)
    await expect(page.locator('#recovery-title [lang=en]')).toHaveText('Unable to continue')
    await expect(page.locator('#page-recovery')).not.toContainText('private provider failure')
  })

  test('survives a crash in the route error UI itself', async ({ page }) => {
    await page.route(/\/src\/features\/auth\/error-page\.tsx(?:\?|$)/, (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: 'function fail(){throw new Error("private error UI failure")}; export {fail as AuthErrorPage, fail as RouteErrorPage, fail as PageNotFound, fail as RoutePendingPage, fail as ConfigurationLoadPage}',
      }),
    )
    await page.goto(errorPath)
    await expect(page.locator('#recovery-title [lang=en]')).toHaveText('Unable to continue')
    await expect(page.locator('#root')).toBeHidden()
  })

  for (const failure of ['error', 'rejection'] as const) {
    test(`shows final recovery after an uncaught ${failure}`, async ({ page }) => {
      const decisions: string[] = []
      page.on('request', (request) => {
        if (request.method() === 'POST') decisions.push(request.url())
      })
      await page.goto(errorPath)
      await expect(page.locator('#root')).toBeVisible()
      await page.evaluate((kind) => {
        if (kind === 'error')
          setTimeout(() => {
            throw new Error('private runtime detail')
          }, 0)
        else void Promise.reject(new Error('private runtime detail'))
      }, failure)
      await expect(page.locator('#recovery-title [lang=en]')).toHaveText('Unable to continue')
      await expect(page.locator('#root')).toBeHidden()
      await expect(page.locator('#page-recovery')).not.toContainText('private runtime detail')
      expect(decisions).toEqual([])
    })
  }

  test('renders with preference storage denied', async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Storage denied', 'SecurityError')
        },
      }),
    )
    await page.goto(errorPath)
    await expect(page.locator('#root')).toBeVisible()
    await expect(page.locator('#root').getByRole('alert')).toHaveText('Resource access was denied.')
    await expect(page.locator('#page-recovery')).toBeHidden()
  })

  test('keeps recovery visible while the entry module is still loading', async ({ page }) => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/src/main.tsx', async (route) => {
      await gate
      await route.continue()
    })
    try {
      await page.goto(errorPath, { waitUntil: 'commit' })
      await expect(page.locator('#page-recovery')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Reload page' })).toBeVisible()
    } finally {
      release()
    }
    await expect(page.locator('#root')).toBeVisible()
    await expect(page.locator('#page-recovery')).toBeHidden()
  })
})
