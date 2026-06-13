/**
 * Shared http-layer config types. Kept out of app.ts so route modules
 * (app-auth-mounts) can depend on them without importing the app assembler,
 * which would form an app <-> routes import cycle.
 */
import type { SecurityPolicy } from '@shared/api/security'

export type AgentConfiguration = {
  issuer: string
  default_location: string
  endpoints: Record<string, string>
  [key: string]: unknown
}

export interface AppConfig {
  trustedOrigins?: string[]
  securityPolicy?: SecurityPolicy
}
