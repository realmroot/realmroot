import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { agentIdentity } from '@server/db/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, seedAgent, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('management authorization owner migration over real D1', () => {
  it('upgrades verified owners and quarantines ambiguous history without guessing', async () => {
    const ownerMigrationIndex = env.TEST_MIGRATIONS.findIndex((migration) =>
      migration.name.includes('management_audit_owners'),
    )
    const ownerMigration = env.TEST_MIGRATIONS[ownerMigrationIndex]!
    expect(ownerMigration.name).toContain('management_audit_owners')

    await restorePreOwnerMigrationSchema(ownerMigrationIndex)
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
        VALUES ('user-1', 'Owner', 'owner@example.com', 1, 1, 1)`),
      env.DB.prepare(`INSERT INTO agent_identity (
        id, issuer, subject, name, owner_user_id, status, created_at, updated_at
      ) VALUES ('agent-1', 'https://issuer.example.com', 'agt_1', 'Agent', 'user-1', 'active', 1, 1)`),
      env.DB.prepare(`INSERT INTO agent_audit_event (
        id, action, result, agent_identity_id, occurred_at
      ) VALUES
        ('audit-owned', 'agent.identity_retired', 'allowed', 'agent-1', 1),
        ('audit-ambiguous', 'legacy.unknown', 'allowed', NULL, 1)`),
    ])

    await applyD1Migrations(env.DB, [ownerMigration])

    const rows = await env.DB.prepare(
      'SELECT id, owner_kind, owner_id, quarantine_reason FROM agent_audit_event ORDER BY id',
    ).all()
    expect(rows.results).toEqual([
      { id: 'audit-ambiguous', owner_kind: null, owner_id: null, quarantine_reason: 'owner_unresolved' },
      { id: 'audit-owned', owner_kind: 'account', owner_id: 'user-1', quarantine_reason: null },
    ])
    await expect(
      env.DB.prepare(
        `INSERT INTO agent_audit_event (
          id, action, result, owner_kind, owner_id, occurred_at
        ) VALUES ('audit-invalid', 'management.resource_written', 'allowed', NULL, NULL, 1)`,
      ).run(),
    ).rejects.toThrow('requires one verified owner or quarantine')
    await expect(
      env.DB.prepare(
        `INSERT INTO agent_audit_event (
          id, action, result, owner_kind, owner_id, occurred_at
        ) VALUES ('audit-invented-owner', 'management.resource_written', 'allowed', 'account', 'missing', 1)`,
      ).run(),
    ).rejects.toThrow('requires one verified owner or quarantine')
  })

  it('rolls back an Agent governance write when its audit insert fails', async () => {
    const harness = await createHarness()
    const cookie = await signInAdmin(harness)
    const owner = await env.DB.prepare("SELECT id FROM user WHERE email = 'admin@example.com'").first<{ id: string }>()
    const now = new Date()
    await harness.db.insert(agentIdentity).values({
      id: 'rollback-agent',
      issuer: 'http://localhost/api/auth',
      subject: 'rollback-agent-subject',
      name: 'Rollback Agent',
      ownerUserId: owner!.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await env.DB.prepare(`
      CREATE TRIGGER reject_management_audit
      BEFORE INSERT ON agent_audit_event
      WHEN NEW.action = 'agent.identity_retired'
      BEGIN
        SELECT RAISE(ABORT, 'simulated audit sink failure');
      END;
    `).run()

    const response = await harness.request('/api/agents/rollback-agent/retirement', {
      method: 'PUT',
      headers: { cookie },
    })

    expect(response.status).toBe(500)
    const stored = await env.DB.prepare("SELECT status FROM agent_identity WHERE id = 'rollback-agent'").first()
    expect(stored).toEqual({ status: 'active' })
  })

  it('rolls back a management authorization revocation when its audit insert fails', async () => {
    const harness = await createHarness()
    await signInAdmin(harness)
    const owner = await env.DB.prepare("SELECT id FROM user WHERE email = 'admin@example.com'").first<{ id: string }>()
    const now = new Date()
    await harness.db.insert(agentIdentity).values({
      id: 'authorization-rollback-agent',
      issuer: 'http://localhost/api/auth',
      subject: 'authorization-rollback-subject',
      name: 'Authorization Rollback Agent',
      ownerUserId: owner!.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await env.DB.prepare(`INSERT INTO agent_access_grant (
      id, resource_id, agent_identity_id, scopes, authorization_details, mode, status,
      granted_by_user_id, created_at, updated_at
    ) VALUES (
      'rollback-grant', 'res_realmroot', 'authorization-rollback-agent', '[]',
      '[{"type":"realmroot_authority","authority":"account","id":"${owner!.id}"}]',
      'persistent', 'active', '${owner!.id}', 1, 1
    )`).run()
    await env.DB.prepare(`
      CREATE TRIGGER reject_authorization_audit
      BEFORE INSERT ON agent_audit_event
      WHEN NEW.action = 'api_resource.access_revoked'
      BEGIN
        SELECT RAISE(ABORT, 'simulated authorization audit sink failure');
      END;
    `).run()

    await expect(
      harness.deps.externalResources.revokeGrantWithAudit('rollback-grant', now, {
        id: 'rollback-audit',
        action: 'api_resource.access_revoked',
        result: 'allowed',
        controllerUserId: owner!.id,
        subjectIssuer: null,
        subject: null,
        agentIdentityId: 'authorization-rollback-agent',
        hostId: null,
        ownerKind: 'account',
        ownerId: owner!.id,
        quarantineReason: null,
        resourceId: 'res_realmroot',
        resourceConnectionId: null,
        accessGrantId: 'rollback-grant',
        scopes: [],
        reasonCode: null,
        metadata: null,
        occurredAt: now,
      }),
    ).rejects.toThrow('simulated authorization audit sink failure')
    const stored = await env.DB.prepare("SELECT status FROM agent_access_grant WHERE id = 'rollback-grant'").first()
    expect(stored).toEqual({ status: 'active' })
  })

  it('commits exactly one approval and one token for concurrent one-time authorization writes', async () => {
    const harness = await createHarness()
    await signInAdmin(harness)
    const owner = await env.DB.prepare("SELECT id FROM user WHERE email = 'admin@example.com'").first<{ id: string }>()
    const protocolAgent = await seedAgent(harness, owner!.id, 'atomic')
    const now = new Date()
    await harness.db.insert(agentIdentity).values({
      id: 'atomic-agent',
      issuer: 'http://localhost/api/auth',
      subject: 'atomic-agent-subject',
      name: 'Atomic Agent',
      ownerUserId: owner!.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await env.DB.prepare(`INSERT INTO agent_identity_binding (
      id, agent_identity_id, protocol_agent_id, status, bound_at, created_at, updated_at
    ) VALUES ('atomic-binding', 'atomic-agent', '${protocolAgent.agentId}', 'active', 1, 1, 1)`).run()
    await env.DB.prepare(`INSERT INTO agent_access_request (
      id, resource_id, agent_identity_id, binding_id, scopes, authorization_details, status,
      approval_token_hash, encrypted_approval_token, expires_at, created_at, updated_at
    ) VALUES (
      'atomic-request', 'res_realmroot', 'atomic-agent', 'atomic-binding', '[]',
      '[{"type":"realmroot_authority","authority":"account","id":"${owner!.id}"}]',
      'pending', 'atomic-token-hash', 'sealed-token', 9999999999999, 1, 1
    )`).run()
    const decisionTime = new Date()
    const decisions = await Promise.all(
      ['a', 'b'].map((suffix) =>
        harness.deps.externalResources.decideAccessRequestWithAudit(
          'atomic-request',
          {
            status: 'approved',
            grantId: `atomic-grant-${suffix}`,
            decidedAt: decisionTime,
            updatedAt: decisionTime,
          },
          {
            id: `atomic-grant-${suffix}`,
            resourceId: 'res_realmroot',
            connectionId: null,
            agentIdentityId: 'atomic-agent',
            scopes: [],
            authorizationDetails: [{ type: 'realmroot_authority', authority: 'account', id: owner!.id }],
            mode: 'once',
            status: 'active',
            grantedByUserId: owner!.id,
            expiresAt: null,
            revokedAt: null,
            createdAt: decisionTime,
            updatedAt: decisionTime,
          },
          auditRecord(owner!.id, `atomic-decision-audit-${suffix}`, 'api_resource.access_decided', decisionTime),
        ),
      ),
    )
    expect(decisions.filter(Boolean)).toHaveLength(1)
    const approved = decisions.find(Boolean)!

    const tokenTime = new Date()
    const leases = await Promise.all(
      ['a', 'b'].map((suffix) =>
        harness.deps.externalResources.issueTokenLeaseWithAudit(
          {
            id: `atomic-lease-${suffix}`,
            grantId: approved.grantId!,
            requestId: 'atomic-request',
            bindingId: 'atomic-binding',
            encryptedAccessToken: `sealed-access-token-${suffix}`,
            tokenHash: `atomic-token-${suffix}`,
            confirmationJkt: 'atomic-jkt',
            scopes: [],
            authorizationDetails: [],
            expiresAt: new Date(tokenTime.getTime() + 60_000),
            revokedAt: null,
            createdAt: tokenTime,
          },
          'once',
          tokenTime,
          auditRecord(owner!.id, `atomic-token-audit-${suffix}`, 'api_resource.token_issued', tokenTime),
        ),
      ),
    )
    expect(leases.filter(Boolean)).toHaveLength(1)
    const counts = await env.DB.prepare(`SELECT
      (SELECT count(*) FROM agent_access_grant WHERE id LIKE 'atomic-grant-%') AS grants,
      (SELECT count(*) FROM external_token_lease WHERE id LIKE 'atomic-lease-%') AS leases,
      (SELECT count(*) FROM agent_audit_event WHERE id LIKE 'atomic-%-audit-%') AS audits
    `).first()
    expect(counts).toEqual({ grants: 1, leases: 1, audits: 2 })
  })
})

function auditRecord(ownerId: string, id: string, action: string, occurredAt: Date) {
  return {
    id,
    action,
    result: 'allowed',
    controllerUserId: ownerId,
    subjectIssuer: null,
    subject: null,
    agentIdentityId: 'atomic-agent',
    hostId: null,
    ownerKind: 'account' as const,
    ownerId,
    quarantineReason: null,
    resourceId: 'res_realmroot',
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: [],
    reasonCode: null,
    metadata: null,
    occurredAt,
  }
}

async function restorePreOwnerMigrationSchema(ownerMigrationIndex: number) {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, ownerMigrationIndex))
}
