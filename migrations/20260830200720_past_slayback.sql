DROP INDEX `api_resource_identifier_unique`;--> statement-breakpoint
DROP INDEX `apiResource_resourceUrl_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `apiResource_activeIdentifier_unique` ON `api_resource` (`identifier`) WHERE "api_resource"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `apiResource_activeResourceUrl_unique` ON `api_resource` (`resource_url`) WHERE "api_resource"."deleted_at" is null;