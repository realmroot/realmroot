ALTER TABLE `agent_identity` RENAME COLUMN "retired_at" TO "deleted_at";--> statement-breakpoint
UPDATE `agent_identity` SET `status` = 'inactive' WHERE `status` = 'recovering';--> statement-breakpoint
UPDATE `agent_identity` SET `status` = 'inactive', `deleted_at` = coalesce(`deleted_at`, `updated_at`) WHERE `status` = 'retired';--> statement-breakpoint
ALTER TABLE `api_resource` RENAME COLUMN "archived_at" TO "deleted_at";--> statement-breakpoint
CREATE INDEX `agentIdentity_deletedAt_idx` ON `agent_identity` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `apiResource_deletedAt_idx` ON `api_resource` (`deleted_at`);
