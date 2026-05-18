import { z } from 'zod'

export const userRoleSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
export const usernameSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/)
  .transform((value) => value.toLowerCase())

export const adminUserListQuerySchema = z.object({
  search: z.string().min(1).optional(),
  searchField: z.enum(['email', 'name']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'email', 'name']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  role: z.string().min(1).optional(),
  banned: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

export const adminCreateUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8).optional(),
  displayName: z.string().min(1),
  username: usernameSchema.optional(),
  avatarAssetId: z.string().min(1).nullable().optional(),
  role: userRoleSchema.optional(),
})

export const adminUpdateUserSchema = z.object({
  email: z.email().optional(),
  emailVerified: z.boolean().optional(),
  displayName: z.string().min(1).optional(),
  username: usernameSchema.nullable().optional(),
  avatarAssetId: z.string().min(1).nullable().optional(),
  role: userRoleSchema.optional(),
})

export const adminBanUserSchema = z.object({
  reason: z.string().min(1).optional(),
  expiresInSeconds: z.number().int().positive().optional(),
})

export const adminPasswordResetSchema = z.object({
  email: z.email(),
  redirectTo: z.string().url().optional(),
})

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>
