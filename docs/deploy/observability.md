# Observability

Realmroot uses Cloudflare Workers' built-in telemetry as the source of truth for server-side diagnosis. Do not add a parallel tracing SDK.

## Signals

- Workers Logs store one structured `request.complete` event at the HTTP boundary. It contains the request ID, operation correlation ID, method, path, status, duration, and surfaced error. It must not contain authorization headers, DPoP proofs, request bodies, query values, or provider credentials.
- Workers Traces automatically record Worker handlers, outbound `fetch` calls, and D1 and other binding calls. Custom spans name only stable business phases such as request preparation, resource reconciliation, auth preparation, and router dispatch.
- The Toolbox creates one 128-bit correlation ID, encoded as 32 lowercase hexadecimal characters, per command. It sends that ID to Realmroot and protected Resources as `x-correlation-id`; Realmroot forwards it on external Resource calls. Each service keeps its own trusted `Request-Id`.
- The Toolbox also sends a W3C `traceparent` header. Cross-Worker investigations must still query by the correlation ID because Cloudflare does not yet guarantee automatic external trace propagation.

## Toolbox diagnostics

The default log level is `warn`, so normal command output remains stable. Diagnostics are written to stderr as structured text:

```sh
realmroot --log-level debug exec github --context <name> -- gh api rate_limit
REALMROOT_LOG_LEVEL=trace realmroot exec cloudflare -- wrangler whoami
```

Use `debug` for HTTP status and duration plus child-process timing. Use `trace` for local phase timings. Logged URLs contain the host and path only; query parameters are intentionally excluded.

## Cloudflare configuration

Keep observability in the Wrangler configuration, which is the deployment source of truth. Logs and traces have independent sampling controls. Use 100% sampling during a bounded investigation; reduce trace sampling for sustained production traffic after a representative baseline is captured.

Use Workers Logs for correlation and errors, and the trace waterfall for latency attribution. The automatic `fetch` and D1 spans should be inspected before adding a custom span. Add a custom span only when a stable business phase cannot be identified from platform spans alone.
