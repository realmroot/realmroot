import { conflict } from '@server/domain/errors'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Database } from '../../db/client'
import { siteSettings } from '../../db/schema'

export type SiteSettingsKey =
  | 'general'
  | 'branding'
  | 'sign_in'
  | 'account_center'
  | 'navigation'
  | 'security'
  | 'developer'
  | 'email'

export async function readSiteSettings<T>(db: Database, key: SiteSettingsKey, schema: z.ZodType<T>) {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, key)).limit(1)
  return row ? { value: schema.parse(row.value), revision: row.revision } : null
}

export async function writeSiteSettings(
  db: Database,
  key: SiteSettingsKey,
  value: Record<string, unknown>,
  revision: number | null,
) {
  const changed =
    revision === null
      ? await db
          .insert(siteSettings)
          .values({ key, value, revision: 1, updatedAt: new Date() })
          .onConflictDoNothing()
          .returning({ key: siteSettings.key })
      : await db
          .update(siteSettings)
          .set({ value, revision: revision + 1, updatedAt: new Date() })
          .where(and(eq(siteSettings.key, key), eq(siteSettings.revision, revision)))
          .returning({ key: siteSettings.key })
  if (changed.length === 0) throw conflict('Site settings changed. Reload and try again.')
}
