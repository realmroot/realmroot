import { z } from 'zod'

const publicImageUrlSchema = z.union([z.url(), z.string().regex(/^\/api\/assets\/[A-Za-z0-9_-]+$/)])

export const publicProfileViewSchema = z.enum(['summary', 'full']).default('summary')

export const publicProfileQuerySchema = z.object({
  view: publicProfileViewSchema,
})

export const publicProfileLinkSchema = z.object({
  type: z.enum(['website', 'social']),
  label: z.string().trim().min(1).max(40),
  url: z.url(),
})

export const publicActivitySchema = z.object({
  id: z.string(),
  action: z.string(),
  title: z.string(),
  description: z.string(),
  occurredAt: z.iso.datetime(),
})

export const publicActivityOverviewSchema = z.object({
  total: z.number().int().nonnegative(),
  activeDays: z.number().int().nonnegative(),
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),
})

export const publicActivityDaySchema = z.object({
  date: z.iso.date(),
  count: z.number().int().nonnegative(),
})

export const publicAgentSummarySchema = z.object({
  subject: z.string(),
  name: z.string(),
  picture: publicImageUrlSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

const publicUserBaseSchema = z.object({
  type: z.literal('user'),
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  picture: publicImageUrlSchema.nullable(),
  joinedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const publicUserSummarySchema = publicUserBaseSchema.extend({
  view: z.literal('summary'),
})

export const publicUserProfileSchema = publicUserBaseSchema.extend({
  view: z.literal('full'),
  bio: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(publicProfileLinkSchema),
  agentCount: z.number().int().nonnegative(),
  agents: z.array(publicAgentSummarySchema),
  recentActivity: z.array(publicActivitySchema),
})

const publicAgentBaseSchema = publicAgentSummarySchema.extend({
  type: z.literal('agent'),
  issuer: z.url(),
})

export const publicAgentCompactSchema = publicAgentBaseSchema.extend({
  view: z.literal('summary'),
})

export const publicAgentProfileSchema = publicAgentBaseSchema.extend({
  view: z.literal('full'),
  owner: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('user'),
      id: z.string(),
      username: z.string().nullable(),
      displayName: z.string(),
      picture: publicImageUrlSchema.nullable(),
    }),
    z.object({
      type: z.literal('organization'),
      id: z.string(),
      slug: z.string(),
      displayName: z.string(),
      picture: publicImageUrlSchema.nullable(),
    }),
  ]),
  activity: publicActivityOverviewSchema,
  activityDays: z.array(publicActivityDaySchema),
  recentActivity: z.array(publicActivitySchema),
})

export const publicUserResponseSchema = z.discriminatedUnion('view', [publicUserSummarySchema, publicUserProfileSchema])

export const publicAgentResponseSchema = z.discriminatedUnion('view', [
  publicAgentCompactSchema,
  publicAgentProfileSchema,
])

export type PublicProfileLink = z.infer<typeof publicProfileLinkSchema>
export type PublicProfileView = z.infer<typeof publicProfileViewSchema>
export type PublicActivity = z.infer<typeof publicActivitySchema>
export type PublicActivityOverview = z.infer<typeof publicActivityOverviewSchema>
export type PublicActivityDay = z.infer<typeof publicActivityDaySchema>
export type PublicUserResponse = z.infer<typeof publicUserResponseSchema>
export type PublicAgentResponse = z.infer<typeof publicAgentResponseSchema>
