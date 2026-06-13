import { resetState } from './helpers/real-app'

// Reset + migrate the isolated E2E D1 once before the serial suite. Individual
// specs re-seed their own starting state (fresh deployment vs. bootstrapped
// admin) so they remain order-independent within the run.
export default function globalSetup() {
  resetState()
}
