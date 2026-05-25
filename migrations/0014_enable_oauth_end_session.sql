UPDATE `oauth_client` SET `enable_end_session` = true WHERE `enable_end_session` IS NULL OR `enable_end_session` = false;
