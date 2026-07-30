import { createSiweMessage, requestWalletNonce, signInWithOneTap, signInWithWallet, type useConfigz } from './shared'

export async function signInWithEthereum(enabledChains: number[], callback: string | undefined) {
  const ethereum = window.ethereum
  if (!ethereum) throw new Error('No wallet provider was found in this browser.')
  const accounts = await ethereum.request({
    method: 'eth_requestAccounts',
  })
  const walletAddress = readFirstString(accounts)
  if (!walletAddress) throw new Error('No wallet account was selected.')
  const chainValue = await ethereum.request({
    method: 'eth_chainId',
  })
  const chainId = readChainId(chainValue)
  if (!enabledChains.includes(chainId)) {
    throw new Error(`This wallet network is not enabled. Switch to chain ${enabledChains[0]}.`)
  }
  const { nonce } = await requestWalletNonce({
    walletAddress,
    chainId,
  })
  const message = createSiweMessage({
    address: walletAddress as `0x${string}`,
    chainId,
    domain: window.location.host,
    nonce,
    statement: 'Sign in to Realmroot.',
    uri: window.location.origin,
    version: '1',
  })
  const signature = readString(
    await ethereum.request({
      method: 'personal_sign',
      params: [message, walletAddress],
    }),
  )
  if (!signature) throw new Error('Wallet did not return a signature.')
  return signInWithWallet({
    message,
    signature,
    walletAddress,
    chainId,
    email: undefined,
  }).then((response) => ({
    ...response,
    callbackURL: callback,
  }))
}

export async function signInWithGoogleOneTap(
  config: NonNullable<ReturnType<typeof useConfigz>['data']>['builtInProviders']['oneTap'] | undefined,
  callback: string | undefined,
) {
  if (!config?.clientId) throw new Error('Google One Tap Client ID is not configured.')
  await loadGoogleIdentityScript()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result: unknown) => {
      settled = true
      resolve(result)
    }
    const fail = (message: string) => {
      settled = true
      reject(new Error(message))
    }
    const timeout = window.setTimeout(() => {
      if (!settled) fail('Google One Tap did not return a credential.')
    }, 15000)
    window.google?.accounts.id.initialize({
      client_id: config.clientId,
      auto_select: config.autoSelect,
      cancel_on_tap_outside: config.cancelOnTapOutside,
      context: config.context,
      ux_mode: config.uxMode,
      use_fedcm_for_prompt: true,
      callback: async (response) => {
        try {
          if (!response.credential) throw new Error('Google One Tap did not return a credential.')
          const result = await signInWithOneTap({
            idToken: response.credential,
          })
          window.clearTimeout(timeout)
          finish({
            ...result,
            callbackURL: callback,
          })
        } catch (error) {
          window.clearTimeout(timeout)
          reject(error)
        }
      },
    })
    window.google?.accounts.id.prompt((notification) => {
      if (settled) return
      if (notification.isNotDisplayed?.()) {
        window.clearTimeout(timeout)
        fail(`Google One Tap was not displayed: ${notification.getNotDisplayedReason?.() ?? 'unknown reason'}.`)
        return
      }
      if (notification.isSkippedMoment?.()) {
        window.clearTimeout(timeout)
        fail(`Google One Tap was skipped: ${notification.getSkippedReason?.() ?? 'unknown reason'}.`)
        return
      }
      if (notification.isDismissedMoment?.()) {
        window.clearTimeout(timeout)
        fail(`Google One Tap was dismissed: ${notification.getDismissedReason?.() ?? 'unknown reason'}.`)
      }
    })
  })
}

function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.googleScriptInitialized) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.src = 'https://accounts.google.com/gsi/client'
    script.onload = () => {
      window.googleScriptInitialized = true
      resolve()
    }
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'))
    document.head.appendChild(script)
  })
}

function readFirstString(value: unknown) {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function readChainId(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.startsWith('0x')) return Number.parseInt(value, 16)
  if (typeof value === 'string') return Number(value)
  throw new Error('Wallet did not return a chain ID.')
}
