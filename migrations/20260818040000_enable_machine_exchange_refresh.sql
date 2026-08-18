UPDATE oauth_client
SET grant_types = json_insert(COALESCE(grant_types, '[]'), '$[#]', 'refresh_token'),
    updated_at = cast(unixepoch('subsecond') * 1000 as integer)
WHERE type = 'machine'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(COALESCE(oauth_client.grant_types, '[]'))
    WHERE value = 'refresh_token'
  );

UPDATE application
SET oidc_scopes = json_insert(COALESCE(oidc_scopes, '[]'), '$[#]', 'offline_access'),
    updated_at = cast(unixepoch('subsecond') * 1000 as integer)
WHERE EXISTS (
    SELECT 1 FROM oauth_client
    WHERE oauth_client.client_id = application.oauth_client_id
      AND oauth_client.type = 'machine'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(COALESCE(application.oidc_scopes, '[]'))
    WHERE value = 'offline_access'
  );
