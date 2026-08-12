ALTER TABLE `application_consent`
ADD COLUMN `authorization_source` text DEFAULT 'user_consent' NOT NULL
CHECK (`authorization_source` IN ('user_consent', 'platform_policy'));
