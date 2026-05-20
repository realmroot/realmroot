# Page Acceptance

This directory is the product acceptance source of truth for page-level work.
Every UI task must reference the relevant page IDs below and must pass the
acceptance rules before review can be accepted.

Do not add external reference product names, brand terms, copied source strings,
or upstream implementation notes to repository files, task descriptions, commit
messages, PRs, screenshots, or test names.

## Global Rules

- Each visible product route has one canonical URL and one page-level acceptance
  entry in `page-matrix.md`.
- A page is not accepted until its desktop and mobile layouts match the target
  structure: 248px desktop rail, compact console canvas, 20px page titles, 14px
  body/control text, 36px navigation rows, compact tables, and non-nested page
  sections.
- Settings pages use section tabs, full-width setting cards, compact rows, and a
  right-side preview when the page configures hosted auth, branding, or content.
- Detail pages use an object header, route-backed tabs, and full-width detail
  panels. Tabs must change the URL.
- Hosted auth pages use a narrow centered auth surface, compact fields, centered
  footer links, and visible configured social providers.
- Profile is a top-level `/profile` route. `/account` exists only as a
  compatibility redirect.
- Onboarding is a gate, not a normal console menu item. When onboarding
  prerequisites are missing, all protected routes redirect to the proper
  onboarding surface.
- No disabled or dead-end product controls are allowed. If a feature is in the
  UI, it must be usable through real UI, API, persistence, tests, and E2E. If a
  v1 product decision excludes a feature, the page must hide it rather than
  present a disabled placeholder.
- Loading, empty, error, saving, and destructive states must be real and tested.
- Code coverage must remain at least 90 percent across statements, branches,
  functions, and lines. Journey coverage must remain 100 percent.

## Required Evidence

For every changed page:

- Desktop screenshot at 1440x1000 or 1280x720.
- Mobile screenshot at 390x844.
- Playwright journey or interaction test for the primary task flow.
- Unit or integration tests for API contracts, persistence, and validation
  touched by the page.
- A short PR acceptance path describing how a reviewer reaches the page and what
  to verify.

## Current Blocking Gaps

- Multiple settings pages intentionally render disabled controls instead of
  supported flows.
- Sign-in experience pages do not yet provide complete editable contracts for
  profile collection, passkey sign-in, separate content messages, and all preview
  variants.
- MFA, security, CAPTCHA, blocklist, webhooks, audit logs, and tenant settings
  contain placeholder text or disabled actions that must be either implemented
  or removed from the v1 surface.
- Existing tests assert disabled placeholders as correct behavior. Those tests
  must be rewritten to assert usable product flows.
