# Sign-In Experience Settings Design

## Scope

This task removes v1 dead-end controls from sign-in experience pages and makes
account center settings real persisted configuration.

## Frontend

- Hide passkey sign-in, dark mode, content language, password message, account
  message, and custom profile-field controls because those runtime contracts are
  not complete for v1.
- Remove the custom profile collection tab from v1 navigation and redirect the
  legacy route to the main sign-in settings page.
- Add editable account center section and field-permission switches.
- Reflect account center settings in `/profile` by hiding disabled sections and
  non-editable profile fields.

## Backend

- Reuse the existing `account_center_setting` table.
- Expose account center settings through `/api/configz` for hosted profile
  rendering.
- Add authenticated management GET/PATCH routes for account center settings.

## Security

- Management writes remain behind `requireAdmin`.
- Input is validated by shared Zod schemas at the HTTP boundary.
- Hosted profile output exposes only UI policy booleans, not user data.
