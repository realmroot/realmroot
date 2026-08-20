UPDATE oauth_client
SET
  skip_consent = CASE
    WHEN (
      SELECT application.consent_required
      FROM application
      WHERE application.oauth_client_id = oauth_client.client_id
    ) = 1 THEN 0
    ELSE 1
  END,
  updated_at = cast(unixepoch('subsecond') * 1000 as integer)
WHERE EXISTS (
  SELECT 1
  FROM application
  WHERE application.oauth_client_id = oauth_client.client_id
);
