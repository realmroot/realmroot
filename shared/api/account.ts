import { z } from 'zod'
import { usernameSchema } from './users'

export const accountProfileUpdateSchema = z.object({
  displayName: z.string().min(1).optional(),
  username: usernameSchema.nullable().optional(),
  avatarAssetId: z.string().min(1).nullable().optional(),
})

export const accountEmailChangeSchema = z.object({
  email: z.email(),
  callbackURL: z.string().optional(),
})

export const accountPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
  revokeOtherSessions: z.boolean().optional(),
})

export type AccountProfileUpdateInput = z.infer<typeof accountProfileUpdateSchema>
