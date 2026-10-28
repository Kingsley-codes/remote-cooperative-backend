# Security baseline

This baseline implements the transport and request protections that can be
configured before the Remote Agric, MongoDB, and payment integrations exist.
It is not a completed authentication system or a production launch approval.

## Running locally

Copy `.env.example` to `.env` and run `corepack pnpm start:dev`.
The API listens on all IPv4 interfaces (`0.0.0.0`) using `PORT` (default 3000),
so containers and hosting platforms can reach it. Locally, use `http://localhost:<PORT>`.
The frontend in the sibling
`remote-agric-cooperative` project runs on port 3001. Origins are exact values,
without trailing slashes. Use your actual HTTPS frontend origins in production.
Startup rejects invalid ports, limits, and origins.

## Protections implemented

- Helmet security headers: restrictive API CSP, denied framing, MIME-sniffing
  protection, and HTTPS-only HSTS in production. Responses use `Cache-Control:
  no-store` and do not advertise Express. API CSP does not protect the frontend's
  HTML; the frontend has its own header configuration.
- Exact CORS allowlist, with unlisted Origin headers rejected with 403. Requests
  without Origin remain available to server clients and future webhooks. CORS
  is a browser policy, not authentication. Cross-origin cookies are disabled.
- Global IP-based limits per route: 100 requests per 60 seconds plus a burst
  limit of 10 per second, configurable in the environment. Excess requests get
  429 and Retry-After. Forwarded client IP headers are ignored; rate limits use
  the directly connected client's IP address.
- Every new route is denied with 401 until real identity verification exists.
  Only the starter `GET /` is explicitly `@Public()`. This guard intentionally
  rejects all bearer tokens, including otherwise valid ones, until integration.
  Do not mark member/admin routes public to bypass it during development.
- Global validation rejects unknown DTO fields, invalid values, and implicit
  conversion of DTO properties. Use concrete DTO classes with validation
  decorators, nested validation, length limits, enums, and numeric bounds on
  every body/query. TypeScript interfaces alone do not validate requests.
- JSON-only request bodies, a 64 KiB default body limit, no compressed bodies,
  no form parser, and a simple query parser. Raw JSON bytes are preserved for
  future provider signature checks. Multipart uploads need a separate protected
  endpoint with explicit size/type limits if added later.
- Generic error responses contain a server-generated request ID and never
  expose stack traces, submitted values, or internal exception messages. Request
  logs include ID, method, status, and duration, without bodies, URL parameters,
  cookies, bearer tokens, or sensitive financial data.
- HTTP request-receive/header timeouts and graceful shutdown hooks. These are
  not service execution deadlines; outbound calls need explicit timeouts and
  bounded retries when those integrations are added.

## Deployment requirements

Use HTTPS in production. No reverse proxy setup is required for local development.
If hosting later introduces a reverse proxy, review client-IP handling at that
point. Set request/connection limits, URL/header size limits, and DDoS protection
at the hosting layer as well: Nest guards run after parsing and do not throttle
rejected CORS requests, parser errors, or unmatched routes.

The default throttler store is in memory and resets on restart. Before running
multiple processes/replicas, configure shared rate-limit storage (such as Redis)
and edge limits. Give sign-in, payment initiation, and withdrawals stricter,
operation-specific limits and authenticated-principal keys once those routes
exist. Webhook limits must account for legitimate provider retries.

Store real secrets in deployment secret management. Keep `.env` files out of
Git; `.env.example` contains configuration examples only. Run dependency audits,
patch updates, and restore/reconciliation exercises regularly.

## Controls to implement with domain features

- Remote Agric: verify signature against trusted keys, restrict algorithms,
  issuer, audience, expiry and required claims, handle handoff state/nonce/replay,
  establish short-lived sessions, support revocation, and check current eligibility.
- Authorization: derive the member identity from verified credentials; scope
  database reads/writes to that member. Enforce least-privilege roles and explicit
  permissions for approvals, finance, exports, support, and role management.
  Add MFA/step-up verification for high-risk admin and payout actions.
- Cookies: if authentication uses cookies, implement Secure/HttpOnly/SameSite
  cookie policies and server-validated CSRF tokens before enabling credentialed
  CORS. JSON-only bodies and CORS are not substitutes for CSRF protection.
- MongoDB: least-privilege DB credentials, TLS, at-rest encryption and backups,
  explicit query construction (never spread request objects into queries),
  validated IDs and projections, unique indexes, atomic reservations/transactions,
  and durable idempotency keys bound to operation, actor, and request payload.
- Payments: verify webhook signatures over raw bytes with the selected provider's
  scheme, reject replay/duplicates with durable unique event IDs, verify account,
  currency, amount, and references, and reconcile before changing confirmed totals.
- Ledger: append-only events, linked reversals, race-safe balance reservations,
  immutable audit records, authorization and reasons for retries/loan decisions.
- Outbound integrations: fixed trusted base URLs, TLS verification, explicit
  timeouts, bounded responses/retries, and SSRF-safe handling of redirects/URLs.
- Privacy: minimize stored identity/payout information, encrypt sensitive fields
  as required, restrict exports, prevent spreadsheet formula injection in CSV,
  define retention, and audit sensitive operations without logging secrets.
- XSS: render untrusted strings as text in the frontend; validate domain inputs.
  Do not globally strip HTML or mutate signed webhook data. Sanitize rich HTML
  only where explicitly supported. API security headers alone do not stop stored XSS.

## Verification

`corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm test`, and
`corepack pnpm test:e2e` cover configuration validation, CORS, secure headers,
default-denied routes, forged-token rejection, rate limits with spoofed forwarded
headers, DTO validation, JSON limits, safe errors, and raw-body preservation.

References: https://docs.nestjs.com/security/helmet,
https://docs.nestjs.com/security/cors,
https://docs.nestjs.com/security/rate-limiting,
https://docs.nestjs.com/techniques/validation.
