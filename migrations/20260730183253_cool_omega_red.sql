CREATE UNIQUE INDEX `apiResource_resourceUrl_unique` ON `api_resource` (`resource_url`);--> statement-breakpoint
ALTER TABLE `api_resource` DROP COLUMN `audience`;