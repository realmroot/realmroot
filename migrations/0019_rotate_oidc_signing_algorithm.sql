UPDATE `jwks`
SET `expires_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `alg` IS NULL OR `alg` <> 'ES256';
