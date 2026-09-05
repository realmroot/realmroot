-- Apply only after the new Worker and migrated configuration are verified.
-- Refuse to discard a populated source when its target group is missing.
CREATE TABLE site_settings_cleanup_guard (valid INTEGER CHECK(valid = 1));
INSERT INTO site_settings_cleanup_guard SELECT NOT EXISTS(SELECT 1 FROM sign_in_experience) OR EXISTS(SELECT 1 FROM site_settings WHERE key='sign_in');
INSERT INTO site_settings_cleanup_guard SELECT NOT EXISTS(SELECT 1 FROM sign_in_experience) OR EXISTS(SELECT 1 FROM site_settings WHERE key='general');
INSERT INTO site_settings_cleanup_guard SELECT NOT EXISTS(SELECT 1 FROM sign_in_experience) OR EXISTS(SELECT 1 FROM site_settings WHERE key='security');
INSERT INTO site_settings_cleanup_guard SELECT NOT EXISTS(SELECT 1 FROM sign_in_experience) OR EXISTS(SELECT 1 FROM site_settings WHERE key='developer');
INSERT INTO site_settings_cleanup_guard SELECT NOT EXISTS(SELECT 1 FROM account_center_setting) OR EXISTS(SELECT 1 FROM site_settings WHERE key='account_center');
INSERT INTO site_settings_cleanup_guard SELECT NOT EXISTS(SELECT 1 FROM branding_setting) OR EXISTS(SELECT 1 FROM site_settings WHERE key='branding');
INSERT INTO site_settings_cleanup_guard SELECT NOT EXISTS(SELECT 1 FROM email_service_config) OR EXISTS(SELECT 1 FROM site_settings WHERE key='email');
INSERT INTO site_settings_cleanup_guard SELECT NOT EXISTS(SELECT 1 FROM deployment_setting);
DROP TABLE site_settings_cleanup_guard;
DROP TRIGGER site_settings_developer_organization_update;
DROP TABLE `account_center_setting`;--> statement-breakpoint
DROP TABLE `branding_setting`;--> statement-breakpoint
DROP TABLE `deployment_setting`;--> statement-breakpoint
DROP TABLE `email_service_config`;--> statement-breakpoint
DROP TABLE `sign_in_experience`;