UPDATE `jwks`
SET `expires_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE
  `alg` IN ('EdDSA', 'ES256')
  OR json_extract(`public_key`, '$.kty') IN ('EC', 'OKP');
