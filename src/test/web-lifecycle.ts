import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(async () => {
  cleanup()
  // Radix FocusScope deliberately restores focus in the next task after unmount.
  // Drain that lifecycle callback before Vitest replaces the jsdom Event realm.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
})
