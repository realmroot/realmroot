UPDATE `jwks`
SET `expires_at` = cast(unixepoch('subsecond') * 1000 as integer) - 2678400000
WHERE `alg` = 'EdDSA' OR json_extract(`public_key`, '$.kty') = 'OKP';
