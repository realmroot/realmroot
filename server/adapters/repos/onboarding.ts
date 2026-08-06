import { forbidden } from '@server/domain/errors'
import { platformOrganization } from '@server/domain/platform-organization'
import type { OnboardingRepository } from '@server/usecases/ports'

export function createOnboardingRepository(db: D1Database): OnboardingRepository {
  return {
    async hasUsers() {
      const row = await db.prepare('select 1 as value from user limit 1').first<{ value: number }>()
      return row !== null
    },

    async createBootstrapAdmin(input) {
      const userId = crypto.randomUUID()
      const accountId = crypto.randomUUID()
      const statements = [
        db
          .prepare(
            `
insert into user (id, name, username, email, email_verified, role)
select ?1, ?2, ?3, ?4, true, 'admin'
where not exists (select 1 from user)
`.trim(),
          )
          .bind(userId, input.name, input.username ?? null, input.email),
        db
          .prepare(
            `
insert into account (id, account_id, provider_id, user_id, password)
select ?1, ?2, 'credential', ?2, ?3
where exists (select 1 from user where id = ?2 and role = 'admin')
`.trim(),
          )
          .bind(accountId, userId, input.passwordHash),
        db
          .prepare(
            `
insert into organization (id, slug, name, metadata)
values (?1, ?2, ?3, ?4)
on conflict(id) do nothing
`.trim(),
          )
          .bind(
            platformOrganization.id,
            platformOrganization.slug,
            platformOrganization.name,
            JSON.stringify(platformOrganization.metadata),
          ),
      ]

      const [userInsert, accountInsert] = await db.batch(statements)

      if (userInsert.meta.changes !== 1 || accountInsert.meta.changes !== 1) {
        throw forbidden('Onboarding is locked after the first user exists.')
      }

      return {
        id: userId,
        email: input.email,
        role: 'admin',
      }
    },
  }
}
