import { createDb } from '@server/db/client'
import { externalTokenLease } from '@server/db/schema'
import { conflict, notFound } from '@server/domain/errors'
import type { AccountDeletionRepository } from '@server/usecases/ports'
import { eq } from 'drizzle-orm'

// These subqueries also include access granted to another Agent through a personal connection.
const identities = 'SELECT id FROM agent_identity WHERE owner_user_id = ?1'
const agents = `SELECT protocol_agent_id FROM agent_identity_binding WHERE agent_identity_id IN (${identities}) UNION SELECT id FROM agent WHERE user_id = ?1`
const connections =
  'SELECT id FROM provider_resource_authorization WHERE provider_connection_id IN (SELECT id FROM provider_connection WHERE owner_user_id = ?1)'
const requests = `SELECT id FROM agent_access_request WHERE agent_identity_id IN (${identities}) OR connection_id IN (${connections})`
const leases = `SELECT id FROM external_token_lease WHERE request_id IN (${requests})`

export function createAccountDeletionRepository(db: D1Database): AccountDeletionRepository {
  const statement = (sql: string, userId: string) => db.prepare(sql).bind(userId)
  return {
    async enqueueAssetCleanup(userId, key) {
      const result = await db
        .prepare(`INSERT INTO account_deletion_cleanup (user_id, asset_keys, organization_ids, next_attempt_at)
        SELECT id, json_array(?2), '[]', 0 FROM user WHERE id = ?1 AND deleted_at IS NOT NULL
        ON CONFLICT(user_id) DO UPDATE SET asset_keys = json_insert(asset_keys, '$[#]', ?2), claim_id = NULL, claim_until = NULL, next_attempt_at = 0`)
        .bind(userId, key)
        .run()
      return result.meta.changes > 0
    },
    async erase(userId, now) {
      const existing = await statement('SELECT deleted_at FROM user WHERE id = ?1', userId).first<{
        deleted_at: number | null
      }>()
      if (!existing) throw notFound('User not found.')
      if (existing.deleted_at !== null) return
      const queries = [
        `INSERT INTO account_deletion_cleanup (user_id, asset_keys, organization_ids, next_attempt_at)
         SELECT id, (SELECT json_group_array(storage_key) FROM uploaded_asset WHERE created_by_user_id = ?1 AND purpose = 'avatar'), (SELECT json_group_array(organization_id) FROM member WHERE user_id = ?1), ${now}
         FROM user WHERE id = ?1 AND deleted_at IS NULL ON CONFLICT(user_id) DO NOTHING`,
        // Match complete subjects, not email substrings belonging to another account.
        `DELETE FROM verification WHERE identifier = ?1 OR value = ?1
          OR identifier IN (SELECT prefix || email FROM user CROSS JOIN
            (SELECT '' AS prefix UNION ALL SELECT 'sign-in-otp-' UNION ALL SELECT 'email-verification-otp-' UNION ALL SELECT 'forget-password-otp-') WHERE id = ?1)
          OR substr(identifier, 1, length('change-email-otp-' || (SELECT email FROM user WHERE id = ?1) || '-')) = 'change-email-otp-' || (SELECT email FROM user WHERE id = ?1) || '-'
          OR (json_valid(value) AND EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(value) THEN value ELSE 'null' END)
            WHERE type = 'text' AND atom IN (?1, (SELECT email FROM user WHERE id = ?1))))`,
        ...[
          'session',
          'account',
          'passkey',
          'two_factor',
          'wallet_address',
          'password_reset_request',
          'user_profile',
          'oauth_access_token',
          'oauth_refresh_token',
          'oauth_consent',
          'device_code',
          'application_consent',
          'team_member',
          'member',
        ].map((table) => `DELETE FROM ${table} WHERE user_id = ?1`),
        `DELETE FROM invitation WHERE email = (SELECT email FROM user WHERE id = ?1)`,
        `UPDATE invitation SET inviter_id = NULL WHERE inviter_id = ?1`,
        `DELETE FROM approval_request WHERE user_id = ?1 OR agent_id IN (${agents})`,
        `DELETE FROM resource_connection_intent WHERE owner_user_id = ?1 OR initiated_by_user_id = ?1`,
        `DELETE FROM agent_enrollment_intent WHERE owner_user_id = ?1 OR created_by_user_id = ?1 OR approved_by_user_id = ?1`,
        `DELETE FROM agent_application_creation WHERE actor_user_id = ?1`,
        `UPDATE agent_identity_binding SET status = 'revoked', revoked_at = ${now}, updated_at = ${now} WHERE agent_identity_id IN (${identities})`,
        `UPDATE agent SET status = 'revoked', name = 'Deleted agent', public_key = '', kid = NULL, jwks_url = NULL, metadata = NULL, updated_at = ${now} WHERE id IN (${agents})`,
        `UPDATE agent_host SET status = 'revoked', name = NULL, public_key = NULL, kid = NULL, jwks_url = NULL, default_capabilities = NULL, enrollment_token_hash = NULL, enrollment_token_expires_at = NULL, updated_at = ${now} WHERE user_id = ?1`,
        `DELETE FROM agent_capability_grant WHERE agent_id IN (${agents}) OR granted_by = ?1 OR denied_by = ?1`,
        `UPDATE agent_identity SET status = 'inactive', deleted_at = coalesce(deleted_at, ${now}), name = 'Deleted agent', runtime = NULL, updated_at = ${now} WHERE owner_user_id = ?1`,
        `UPDATE resource_scope_entitlement SET ended_at = coalesce(ended_at, ${now}), end_reason = coalesce(end_reason, 'revoked'), authorization_details = '[]', updated_at = ${now} WHERE user_id = ?1 OR agent_identity_id IN (${identities}) OR connection_id IN (${connections})`,
        `UPDATE external_token_lease SET revoked_at = coalesce(revoked_at, ${now}), authorization_details = '[]', scopes = '[]' WHERE id IN (${leases})`,
        `UPDATE agent_access_request SET status = 'revoked', reason = NULL, encrypted_approval_token = '', authorization_details = '[]', approved_entitlements = '[]', scopes = '[]', decided_at = coalesce(decided_at, ${now}) WHERE id IN (${requests})`,
        `UPDATE provider_credential SET status = 'revoked', revoked_at = coalesce(revoked_at, ${now}), refresh_claim_id = NULL, refresh_claim_expires_at = NULL, granted_scopes = '[]', authorization_details = '[]' WHERE provider_resource_authorization_id IN (${connections})`,
        `UPDATE provider_resource_authorization SET status = 'revoked', revoked_at = coalesce(revoked_at, ${now}) WHERE id IN (${connections})`,
        `UPDATE provider_connection SET status = 'revoked', external_subject = '', display_name = 'Deleted account', updated_at = ${now} WHERE owner_user_id = ?1`,
        `UPDATE agent_audit_event SET metadata = NULL, scopes = NULL, reason_code = NULL, subject = NULL, subject_issuer = NULL, host_id = NULL WHERE owner_user_id = ?1 OR controller_user_id = ?1 OR agent_identity_id IN (${identities})`,
        `DELETE FROM webhook_delivery_request WHERE json_valid(request_body) AND (json_extract(request_body, '$.data.user.id') = ?1 OR json_extract(request_body, '$.data.session.userId') = ?1)`,
        `DELETE FROM uploaded_asset WHERE created_by_user_id = ?1 AND purpose = 'avatar'`,
        ...['uploaded_asset', 'webhook_endpoint', 'application_client_secret'].map(
          (table) => `UPDATE ${table} SET created_by_user_id = NULL WHERE created_by_user_id = ?1`,
        ),
        // This terminal write comes last so cleanup can update rows protected against future writes.
        `UPDATE user SET deleted_at = ${now}, name = 'Deleted user', username = NULL, display_username = NULL,
          email = 'deleted-' || lower(hex(randomblob(16))) || '@account.invalid', email_verified = 0,
          two_factor_enabled = 0, image = NULL, avatar_asset_id = NULL, role = 'user', banned = 1,
          ban_reason = NULL, ban_expires = NULL, created_at = ${now}, updated_at = ${now} WHERE id = ?1 AND deleted_at IS NULL`,
      ]
      // Atomic guard runs while membership still exists. Its abort rolls back the whole D1 batch.
      try {
        await db.batch(queries.map((sql) => statement(sql, userId)))
      } catch (error) {
        if (String(error).includes('account_last_owner'))
          throw conflict(
            'Transfer ownership or delete organizations where you are the last owner before deleting this account.',
          )
        if (
          String(error).includes('account_deleted') &&
          (await statement('SELECT deleted_at FROM user WHERE id = ?1', userId).first('deleted_at'))
        )
          return
        throw error
      }
    },
    async claim(now, claimId) {
      const row = await db
        .prepare(`UPDATE account_deletion_cleanup SET claim_id = ?1, claim_until = ?2
        WHERE user_id = (SELECT user_id FROM account_deletion_cleanup WHERE next_attempt_at <= ?3 AND (claim_until IS NULL OR claim_until <= ?3) ORDER BY next_attempt_at LIMIT 1)
        RETURNING user_id, asset_keys, organization_ids, attempts`)
        .bind(claimId, now + 300_000, now)
        .first<{ user_id: string; asset_keys: string; organization_ids: string; attempts: number }>()
      return row
        ? {
            userId: row.user_id,
            assetKeys: JSON.parse(row.asset_keys),
            organizationIds: JSON.parse(row.organization_ids),
            attempts: row.attempts,
            claimId,
          }
        : null
    },
    async findLease(id) {
      const [row] = await createDb(db).select().from(externalTokenLease).where(eq(externalTokenLease.id, id))
      return row ?? null
    },
    async pendingConnections(userId) {
      const rows = await statement(
        `SELECT DISTINCT provider_resource_authorization_id AS id FROM provider_credential WHERE encrypted_tokens != '' AND provider_resource_authorization_id IN (${connections})`,
        userId,
      ).all<{ id: string }>()
      return rows.results.map((row) => row.id)
    },
    async pendingLeases(userId) {
      const rows = await statement(
        `SELECT id FROM external_token_lease WHERE encrypted_access_token != '' AND id IN (${leases})`,
        userId,
      ).all<{ id: string }>()
      return rows.results.map((row) => row.id)
    },
    async clearConnection(id) {
      await db
        .prepare("UPDATE provider_credential SET encrypted_tokens = '' WHERE provider_resource_authorization_id = ?")
        .bind(id)
        .run()
    },
    async clearLease(id) {
      await db.prepare("UPDATE external_token_lease SET encrypted_access_token = '' WHERE id = ?").bind(id).run()
    },
    async finish(job) {
      await db
        .prepare('DELETE FROM account_deletion_cleanup WHERE user_id = ? AND claim_id = ?')
        .bind(job.userId, job.claimId)
        .run()
    },
    async retry(job, now) {
      await db
        .prepare(
          'UPDATE account_deletion_cleanup SET attempts = attempts + 1, next_attempt_at = ?, claim_id = NULL, claim_until = NULL WHERE user_id = ? AND claim_id = ?',
        )
        .bind(now + Math.min(3600_000, 60_000 * 2 ** Math.min(job.attempts, 6)), job.userId, job.claimId)
        .run()
    },
  }
}
