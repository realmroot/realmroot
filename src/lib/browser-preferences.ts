// Theme and language are optional preferences. Authentication state must not use this helper.
export function readBrowserPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch (error) {
    if (isStorageUnavailable(error)) return null
    throw error
  }
}

export function writeBrowserPreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch (error) {
    if (!isStorageUnavailable(error)) throw error
  }
}

function isStorageUnavailable(error: unknown) {
  return error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'QuotaExceededError')
}
