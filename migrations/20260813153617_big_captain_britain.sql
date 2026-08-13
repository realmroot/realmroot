DROP INDEX `providerCredential_authorization_subject_unique`;--> statement-breakpoint
DELETE FROM `provider_credential`
WHERE EXISTS (
  SELECT 1 FROM `provider_credential` AS `newer`
  WHERE `newer`.`provider_resource_authorization_id` = `provider_credential`.`provider_resource_authorization_id`
    AND (
      `newer`.`updated_at` > `provider_credential`.`updated_at`
      OR (`newer`.`updated_at` = `provider_credential`.`updated_at` AND `newer`.`id` > `provider_credential`.`id`)
    )
);--> statement-breakpoint
CREATE UNIQUE INDEX `providerCredential_authorization_unique` ON `provider_credential` (`provider_resource_authorization_id`);
