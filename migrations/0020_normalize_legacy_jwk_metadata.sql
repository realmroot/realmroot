UPDATE `jwks`
SET `alg` = 'EdDSA', `crv` = coalesce(`crv`, 'Ed25519')
WHERE `alg` IS NULL AND json_extract(`public_key`, '$.kty') = 'OKP';
