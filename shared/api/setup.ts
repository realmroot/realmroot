import { z } from 'zod'
import { usernameSchema } from './users'

export const setupAdminRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().trim().min(1),
  username: usernameSchema.optional(),
})

export type SetupAdminRequest = z.infer<typeof setupAdminRequestSchema>
