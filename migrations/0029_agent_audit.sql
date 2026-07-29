CREATE TABLE `agent_audit_event` (
  `id` text PRIMARY KEY NOT NULL,
  `action` text NOT NULL,
  `result` text NOT NULL,
  `controller_user_id` text,
  `subject_issuer` text,
  `subject` text,
  `agent_identity_id` text,
  `host_id` text,
  `authority_grant_id` text,
  `external_account_id` text,
  `external_account_grant_id` text,
  `target_origin` text,
  `target_path` text,
  `method` text,
  `reason_code` text,
  `metadata` text,
  `occurred_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agentAuditEvent_occurredAt_idx` ON `agent_audit_event` (`occurred_at`);
--> statement-breakpoint
CREATE INDEX `agentAuditEvent_agentIdentityId_idx` ON `agent_audit_event` (`agent_identity_id`);
--> statement-breakpoint
CREATE INDEX `agentAuditEvent_externalAccountId_idx` ON `agent_audit_event` (`external_account_id`);
--> statement-breakpoint
CREATE INDEX `agentAuditEvent_result_idx` ON `agent_audit_event` (`result`);
