UPDATE `api_resource`
SET `scope_registry` = json_remove(`scope_registry`, '$.accountConnection')
WHERE `scope_registry` IS NOT NULL;
