UPDATE `api_resource`
SET `authorization_details` = '[]',
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `identifier` = 'linear'
  AND `resource_url` = 'https://adapters.realmroot.dev/linear';
