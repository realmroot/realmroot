import { z } from 'zod'

export const externalServiceLinkSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  label: z.string().trim().min(1).max(80),
  url: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password
    }, 'Use an HTTPS URL without embedded credentials.'),
  icon: z.enum(['wallet', 'app', 'link', 'book', 'folder']).default('link'),
})
export const siteNavigationSchema = z.object({
  externalLinks: z
    .array(externalServiceLinkSchema)
    .max(20)
    .refine((links) => new Set(links.map((link) => link.id)).size === links.length, 'Link IDs must be unique.'),
})
export const siteNavigationResponseSchema = siteNavigationSchema.extend({ revision: z.number().int().nonnegative() })
export type SiteNavigation = z.infer<typeof siteNavigationSchema>
export type SiteNavigationResponse = z.infer<typeof siteNavigationResponseSchema>
