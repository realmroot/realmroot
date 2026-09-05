-- The old Worker saves selected organizations after saving the developer policy.
-- Forward that final selection during the deployment overlap as well.
CREATE TRIGGER site_settings_developer_organization_update
AFTER UPDATE OF metadata ON organization
WHEN json_extract(OLD.metadata, '$.realmroot.console.enabled') IS NOT json_extract(NEW.metadata, '$.realmroot.console.enabled')
BEGIN
  UPDATE site_settings
  SET value = json_set(value, '$.selectedOrganizationIds', json((
    SELECT json_group_array(id) FROM organization
    WHERE json_extract(metadata, '$.realmroot.console.enabled') = 1
  ))), revision = revision + 1, updated_at = NEW.updated_at
  WHERE key = 'developer';
END;
