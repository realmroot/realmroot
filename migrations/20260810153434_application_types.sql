UPDATE `oauth_client`
SET `type` = CASE
  WHEN `type` IS NULL THEN 'confidential_web'
  WHEN `type` = 'confidential_web'
    AND EXISTS (
      SELECT 1 FROM json_each(COALESCE(`oauth_client`.`grant_types`, '[]'))
      WHERE value IN ('client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange')
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(COALESCE(`oauth_client`.`grant_types`, '[]'))
      WHERE value = 'authorization_code'
    )
    THEN 'machine'
  WHEN `type` = 'confidential_web' THEN 'confidential_web'
  ELSE `type`
END
WHERE `type` IS NULL OR `type` = 'confidential_web';--> statement-breakpoint

UPDATE `application`
SET `oidc_scopes` = CASE
  WHEN (SELECT `type` FROM `oauth_client` WHERE `client_id` = `application`.`oauth_client_id`) = 'machine'
    THEN '[]'
  ELSE '["openid","profile","email","offline_access"]'
END;--> statement-breakpoint

UPDATE `oauth_client`
SET
  `grant_types` = '["authorization_code","refresh_token"]',
  `scopes` = (
    SELECT json_group_array(value)
    FROM (
      SELECT 'openid' AS value
      UNION SELECT 'profile'
      UNION SELECT 'email'
      UNION SELECT 'offline_access'
      UNION
      SELECT scope.value
      FROM `application`, json_each(`application`.`resource_scopes`) AS resource,
        json_each(json_extract(resource.value, '$.scopes')) AS scope
      WHERE `application`.`oauth_client_id` = `oauth_client`.`client_id`
    )
  ),
  `public` = 0,
  `require_pkce` = 0,
  `token_endpoint_auth_method` = 'client_secret_basic'
WHERE `type` = 'confidential_web';--> statement-breakpoint

UPDATE `oauth_client`
SET
  `grant_types` = '["authorization_code","refresh_token"]',
  `scopes` = (
    SELECT json_group_array(value)
    FROM (
      SELECT 'openid' AS value
      UNION SELECT 'profile'
      UNION SELECT 'email'
      UNION SELECT 'offline_access'
      UNION
      SELECT scope.value
      FROM `application`, json_each(`application`.`resource_scopes`) AS resource,
        json_each(json_extract(resource.value, '$.scopes')) AS scope
      WHERE `application`.`oauth_client_id` = `oauth_client`.`client_id`
    )
  ),
  `public` = 1,
  `require_pkce` = 1,
  `token_endpoint_auth_method` = 'none'
WHERE `type` = 'public_spa';--> statement-breakpoint

UPDATE `oauth_client`
SET
  `grant_types` = CASE
    WHEN EXISTS (
      SELECT 1 FROM json_each(COALESCE(`oauth_client`.`grant_types`, '[]'))
      WHERE value = 'urn:ietf:params:oauth:grant-type:device_code'
    ) THEN '["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:device_code"]'
    ELSE '["authorization_code","refresh_token"]'
  END,
  `scopes` = (
    SELECT json_group_array(value)
    FROM (
      SELECT 'openid' AS value
      UNION SELECT 'profile'
      UNION SELECT 'email'
      UNION SELECT 'offline_access'
      UNION
      SELECT scope.value
      FROM `application`, json_each(`application`.`resource_scopes`) AS resource,
        json_each(json_extract(resource.value, '$.scopes')) AS scope
      WHERE `application`.`oauth_client_id` = `oauth_client`.`client_id`
    )
  ),
  `public` = 1,
  `require_pkce` = 1,
  `token_endpoint_auth_method` = 'none'
WHERE `type` = 'public_native';--> statement-breakpoint

UPDATE `oauth_client`
SET
  `redirect_uris` = '[]',
  `post_logout_redirect_uris` = '[]',
  `grant_types` = '["client_credentials","urn:ietf:params:oauth:grant-type:token-exchange"]',
  `scopes` = COALESCE((
    SELECT json_group_array(scope.value)
    FROM `application`, json_each(`application`.`resource_scopes`) AS resource,
      json_each(json_extract(resource.value, '$.scopes')) AS scope
    WHERE `application`.`oauth_client_id` = `oauth_client`.`client_id`
  ), '[]'),
  `response_types` = '[]',
  `public` = 0,
  `require_pkce` = 0,
  `token_endpoint_auth_method` = 'client_secret_basic'
WHERE `type` = 'machine';
