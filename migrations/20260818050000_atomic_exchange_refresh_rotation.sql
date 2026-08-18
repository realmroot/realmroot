ALTER TABLE token_exchange_refresh_token ADD COLUMN parent_id text REFERENCES token_exchange_refresh_token(id);--> statement-breakpoint

CREATE UNIQUE INDEX token_exchange_refresh_token_parent_id_uidx
  ON token_exchange_refresh_token(parent_id);--> statement-breakpoint
