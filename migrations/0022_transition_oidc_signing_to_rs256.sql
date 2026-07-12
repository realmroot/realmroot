UPDATE `jwks`
SET
  `alg` = 'ES256',
  `crv` = coalesce(`crv`, json_extract(`public_key`, '$.crv'))
WHERE
  `alg` IS NULL
  AND json_extract(`public_key`, '$.kty') = 'EC'
  AND json_extract(`public_key`, '$.crv') = 'P-256';

UPDATE `jwks`
SET
  `alg` = 'EdDSA',
  `crv` = coalesce(`crv`, 'Ed25519')
WHERE
  `alg` IS NULL
  AND json_extract(`public_key`, '$.kty') = 'OKP'
  AND json_extract(`public_key`, '$.crv') = 'Ed25519';
