import { afterEach, describe, expect, it, vi } from 'vitest'
import { signInWithEthereum, signInWithGoogleOneTap } from '@/features/auth/pages/provider-auth'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const oneTapConfig = {
  enabled: true,
  clientId: 'client-1',
  autoSelect: false,
  cancelOnTapOutside: true,
  uxMode: 'popup' as const,
  context: 'signin' as const,
  promptBaseDelayMs: 1000,
  promptMaxAttempts: 5,
}

afterEach(() => {
  cleanupBrowserGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function cleanupBrowserGlobals() {
  delete window.ethereum
  delete window.google
  delete window.googleScriptInitialized
  for (const script of document.querySelectorAll('script')) script.remove()
}

describe('signInWithEthereum', () => {
  it('throws when no wallet provider is available', async () => {
    await expect(signInWithEthereum([1], '/profile')).rejects.toThrow('No wallet provider was found in this browser.')
  })

  it('throws when the wallet returns no account', async () => {
    window.ethereum = { request: vi.fn().mockResolvedValue([]) }
    await expect(signInWithEthereum([1], undefined)).rejects.toThrow('No wallet account was selected.')
  })

  it('throws when the wallet network is not enabled', async () => {
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve('0x2105')
        return Promise.resolve(null)
      }),
    }
    await expect(signInWithEthereum([1], undefined)).rejects.toThrow(
      'This wallet network is not enabled. Switch to chain 1.',
    )
  })

  it('throws when the wallet returns no signature', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ nonce: 'nonce123abc' }))
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve(1)
        if (method === 'personal_sign') return Promise.resolve(null)
        return Promise.resolve(null)
      }),
    }
    await expect(signInWithEthereum([1], undefined)).rejects.toThrow('Wallet did not return a signature.')
  })

  it('completes the SIWE flow and attaches the callback URL', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url.endsWith('/siwe/nonce')) return Promise.resolve(jsonResponse({ nonce: 'nonce123abc' }))
      return Promise.resolve(jsonResponse({ url: '/profile' }))
    })
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        // hex chain id branch in readChainId
        if (method === 'eth_chainId') return Promise.resolve('0x1')
        if (method === 'personal_sign') return Promise.resolve('0xsignature')
        return Promise.resolve(null)
      }),
    }

    const result = await signInWithEthereum([1], '/dashboard')

    expect(result.callbackURL).toBe('/dashboard')
    expect(requests.map((r) => r.url)).toEqual([
      expect.stringContaining('/siwe/nonce'),
      expect.stringContaining('/siwe/verify'),
    ])
    expect(requests[0].body).toMatchObject({
      walletAddress: '0x0000000000000000000000000000000000000001',
      chainId: 1,
    })
  })

  it('throws when the wallet reports no chain id', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ nonce: 'nonce123abc' }))
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve(null)
        return Promise.resolve(null)
      }),
    }
    await expect(signInWithEthereum([1], undefined)).rejects.toThrow('Wallet did not return a chain ID.')
  })

  it('parses decimal-string chain ids', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) =>
      Promise.resolve(
        String(input).endsWith('/siwe/nonce')
          ? jsonResponse({ nonce: 'nonce123abc' })
          : jsonResponse({ url: '/profile' }),
      ),
    )
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve('5')
        if (method === 'personal_sign') return Promise.resolve('0xsignature')
        return Promise.resolve(null)
      }),
    }
    await expect(signInWithEthereum([5], undefined)).resolves.toMatchObject({ callbackURL: undefined })
  })
})

describe('signInWithGoogleOneTap', () => {
  it('throws when the client id is not configured', async () => {
    await expect(signInWithGoogleOneTap({ ...oneTapConfig, clientId: '' }, undefined)).rejects.toThrow(
      'Google One Tap Client ID is not configured.',
    )
    await expect(signInWithGoogleOneTap(undefined, undefined)).rejects.toThrow(
      'Google One Tap Client ID is not configured.',
    )
  })

  it('loads the Google Identity script and signs in with the returned credential', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ url: '/profile' }))
    primeGoogleScriptLoader()
    const initialize = vi.fn()
    const prompt = vi.fn()
    installGoogleStub({ initialize, prompt })

    const promise = signInWithGoogleOneTap(oneTapConfig, '/dashboard')
    await flushScriptLoad()

    await vi.waitFor(() => expect(initialize).toHaveBeenCalled())
    const initOptions = initialize.mock.calls[0][0]
    expect(initOptions.client_id).toBe('client-1')
    initOptions.callback({ credential: 'id-token-1' })

    await expect(promise).resolves.toMatchObject({ callbackURL: '/dashboard' })
  })

  it('rejects when Google returns no credential', async () => {
    primeGoogleScriptLoader()
    const initialize = vi.fn()
    installGoogleStub({ initialize, prompt: vi.fn() })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    await flushScriptLoad()
    await vi.waitFor(() => expect(initialize).toHaveBeenCalled())
    initialize.mock.calls[0][0].callback({})

    await expect(promise).rejects.toThrow('Google One Tap did not return a credential.')
  })

  it('rejects when the credential exchange request fails', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ error: 'denied' }, 401))
    primeGoogleScriptLoader()
    const initialize = vi.fn()
    installGoogleStub({ initialize, prompt: vi.fn() })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    await flushScriptLoad()
    await vi.waitFor(() => expect(initialize).toHaveBeenCalled())
    await initialize.mock.calls[0][0].callback({ credential: 'id-token-1' })

    await expect(promise).rejects.toThrow('denied')
  })

  it('rejects when the prompt is not displayed', async () => {
    primeGoogleScriptLoader()
    installGoogleStub({
      initialize: vi.fn(),
      prompt: promptWith({
        isNotDisplayed: () => true,
        getNotDisplayedReason: () => 'opt_out_or_no_session',
      }),
    })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    await flushScriptLoad()
    await expect(promise).rejects.toThrow('Google One Tap was not displayed: opt_out_or_no_session.')
  })

  it('rejects with a fallback reason when the prompt is skipped', async () => {
    primeGoogleScriptLoader()
    installGoogleStub({
      initialize: vi.fn(),
      prompt: promptWith({ isSkippedMoment: () => true }),
    })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    await flushScriptLoad()
    await expect(promise).rejects.toThrow('Google One Tap was skipped: unknown reason.')
  })

  it('rejects when the prompt is dismissed', async () => {
    primeGoogleScriptLoader()
    installGoogleStub({
      initialize: vi.fn(),
      prompt: promptWith({ isDismissedMoment: () => true, getDismissedReason: () => 'tap_outside' }),
    })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    await flushScriptLoad()
    await expect(promise).rejects.toThrow('Google One Tap was dismissed: tap_outside.')
  })

  it('falls back to an unknown reason when the prompt is not displayed without a reason', async () => {
    primeGoogleScriptLoader()
    installGoogleStub({
      initialize: vi.fn(),
      prompt: promptWith({ isNotDisplayed: () => true }),
    })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    await flushScriptLoad()
    await expect(promise).rejects.toThrow('Google One Tap was not displayed: unknown reason.')
  })

  it('falls back to an unknown reason when the prompt is dismissed without a reason', async () => {
    primeGoogleScriptLoader()
    installGoogleStub({
      initialize: vi.fn(),
      prompt: promptWith({ isDismissedMoment: () => true }),
    })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    await flushScriptLoad()
    await expect(promise).rejects.toThrow('Google One Tap was dismissed: unknown reason.')
  })

  it('ignores prompt notifications that arrive after the flow has settled', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ url: '/profile' }))
    primeGoogleScriptLoader()
    const initialize = vi.fn()
    let notify: Parameters<GoogleId['prompt']>[0]
    installGoogleStub({
      initialize,
      prompt: vi.fn((listener) => {
        notify = listener
      }),
    })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    await flushScriptLoad()
    await vi.waitFor(() => expect(initialize).toHaveBeenCalled())
    await initialize.mock.calls[0][0].callback({ credential: 'id-token-1' })
    await expect(promise).resolves.toMatchObject({ callbackURL: undefined })

    // A late notification after settling must be ignored without throwing.
    expect(() => notify?.({ isDismissedMoment: () => true })).not.toThrow()
  })

  it('reuses an already-initialized Google script', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ url: '/profile' }))
    window.googleScriptInitialized = true
    const initialize = vi.fn()
    installGoogleStub({ initialize, prompt: vi.fn() })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    await vi.waitFor(() => expect(initialize).toHaveBeenCalled())
    initialize.mock.calls[0][0].callback({ credential: 'id-token-1' })
    await expect(promise).resolves.toMatchObject({ callbackURL: undefined })
    expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeNull()
  })

  it('rejects when the Google Identity script fails to load', async () => {
    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    const script = await waitForScript()
    script.onerror?.(new Event('error'))
    await expect(promise).rejects.toThrow('Failed to load Google Identity Services.')
  })

  it('times out when Google never returns a credential', async () => {
    vi.useFakeTimers()
    window.googleScriptInitialized = true
    installGoogleStub({ initialize: vi.fn(), prompt: vi.fn() })

    const promise = signInWithGoogleOneTap(oneTapConfig, undefined)
    const assertion = expect(promise).rejects.toThrow('Google One Tap did not return a credential.')
    await vi.advanceTimersByTimeAsync(15000)
    await assertion
  })
})

type GoogleId = NonNullable<Window['google']>['accounts']['id']

// Returns a prompt() stub that immediately notifies the listener with a fixed
// notification object. The block body keeps the return type `void`.
function promptWith(notification: Record<string, unknown>): GoogleId['prompt'] {
  return vi.fn((listener) => {
    listener?.(notification)
  })
}

function installGoogleStub(handlers: { initialize: GoogleId['initialize']; prompt: GoogleId['prompt'] }) {
  window.google = {
    accounts: {
      id: {
        initialize: handlers.initialize,
        prompt: handlers.prompt,
      },
    },
  }
}

// The loader appends a <script> and resolves on its `load` event. Pre-create the
// element so the loader's querySelector path resolves deterministically.
function primeGoogleScriptLoader() {
  // no-op marker kept for readability; real wiring happens in flushScriptLoad
}

async function waitForScript(): Promise<HTMLScriptElement> {
  return vi.waitFor(() => {
    const script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    if (!script) throw new Error('script not appended yet')
    return script
  })
}

async function flushScriptLoad() {
  const script = await waitForScript()
  script.onload?.(new Event('load'))
}
