# Error handling and recovery

Realmroot owns four levels of failure handling. Errors should be handled at the smallest layer that knows their meaning; the final layers cover failures outside those owners.

| Layer | Owner | User-visible behavior |
| --- | --- | --- |
| Expected business failures | Sign-in, consent, Context, device and Agent approval components | Persistent field/form/page feedback. Keep the request context and allow explicit recovery. Never automatically replay an authorization decision. |
| Route loading and rendering | Root route error/not-found components; router pending component | Explain failed access/loading, show 404 recovery, or show a visible pending state. Preserve public API descriptions. Unexpected render errors use generic wording. |
| Application and browser runtime | `ApplicationErrorBoundary` and the recovery document in `index.html` | Failures outside routes, failures in the route error UI, uncaught errors and unhandled rejections hide the application and reveal an independent recovery screen. Failed entry-module loading is covered before React runs. With JavaScript disabled or stalled, the initial document itself provides a message and recovery links. |
| Request preparation and dispatch | `withRequestErrorBoundary` around the Worker fetch entry | Initialization failures return standalone HTML to browser navigations, ordinary JSON to API clients, and OAuth errors to OAuth clients. HTML requires neither assets, JavaScript nor database access. Responses use HTTP 500, no-store and a generated request ID correlated with the logged cause. |

The router's built-in global catch is disabled because it renders framework error details instead of delegating to our application boundary. Route-level boundaries remain enabled. The application boundary does not import the router, translations, branding configuration or UI components. Its recovery DOM is outside the React root and survives unmounting the entire application.

The browser recovery handler is installed inline before application imports. It never renders exception text, redirect URLs, tokens or stack traces. A fatal state is sticky until explicit navigation/reload; a later ready event cannot restore the failed interface. Handled business rejections stay in their owning forms and do not invoke global recovery. Optional image failures do not replace the page. Theme/language storage denial is treated as an unavailable optional preference; authentication storage is not silently substituted.

## Hosted HTTP errors

`hostedAuthErrors` converts failed browser GET/POST navigations at actual authorization/logout/callback endpoints to `/auth/error`, including `/oauth/account-connection/callback`. Fetches, token requests and existing OAuth redirect responses retain their protocol semantics. Expected 4xx errors preserve public descriptions; unexpected 5xx errors use generic wording. The outer Worker boundary covers preparation errors that occur before this middleware exists.

Consent and Context request-loading failures offer account switching while preserving the authorization request. An empty Context list explains why approval is unavailable. Sign-up, password recovery and email verification do not enable forms when required configuration cannot load.

## Verification

- `pnpm exec vitest run --project unit server/request-error-boundary.test.ts server/http/middleware/hosted-auth-errors.test.ts` exercises real Worker initialization failures behind dependency doubles, mounted callback errors, protocol formats and safe server responses.
- `src/features/auth/authorization-failures.test.tsx` exercises expected configuration/access/Context errors; existing auth/Agent tests cover approval, denial, expired/incomplete requests and account switching.
- `pnpm exec playwright test e2e/error-recovery.spec.ts` uses the real application entry point with deliberate browser fault injection: disabled JavaScript, blocked/stalled entry script, provider crash, broken route error UI, uncaught errors, unhandled rejection and denied preference storage.
- Full Web tests, typecheck, architecture checks and spec traceability remain required local checks for changes to these boundaries.

This covers failures the application can handle. No HTML error screen can run if the browser process has crashed, the network cannot deliver any document, or the hosting platform terminates execution before a response can be produced. Such failures belong to browser/hosting availability rather than React error boundaries.
