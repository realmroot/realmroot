ALTER TABLE `branding_setting` ADD COLUMN `logo_url` text;
ALTER TABLE `branding_setting` ADD COLUMN `favicon_url` text;
UPDATE `branding_setting`
SET `custom_css` = NULL
WHERE
  `custom_css` IS NOT NULL
  AND (
    `custom_css` NOT LIKE '%--auth-%'
    OR `custom_css` LIKE '%{%'
    OR `custom_css` LIKE '%}%'
    OR `custom_css` LIKE '%@%'
    OR lower(`custom_css`) LIKE '%url(%'
    OR lower(`custom_css`) LIKE '%expression(%'
    OR lower(`custom_css`) LIKE '%javascript:%'
    OR lower(`custom_css`) LIKE '%import%'
  );
UPDATE `branding_setting`
SET `primary_color` = NULL
WHERE `primary_color` IS NOT NULL AND `primary_color` NOT GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]';
UPDATE `branding_setting`
SET `background_color` = NULL
WHERE `background_color` IS NOT NULL AND `background_color` NOT GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]';
