# Authentication setup

Registration is open to everyone. Active subscriptions or investments do not
restrict account creation or sign-in. Feature permissions will be added separately.
The current PRD still describes the former restricted registration flow; the
updated product requirement takes precedence.

## Repositories and deployment

Deploy the changes in all three projects:

1. `remote-backend`: adds `POST /api/auth/google/token`. Set
   `GOOGLE_COOPERATIVE_CLIENT_ID` to the cooperative's Google OAuth client ID.
   Existing MongoDB, JWT and email settings remain necessary. This endpoint
   independently verifies Google's token and provisions ordinary Remote Agric
   users in the existing user collection. It never grants an active investment.
2. `remote-cooperative-backend`: set `REMOTE_AGRIC_API_URL` to the Remote Agric
   API origin, without `/api`. Set `REMOTE_AGRIC_ORIGIN` to an exact frontend
   origin already allowed by Remote Agric's `FRONTEND_URL` or
   `FRONTEND_LOCALHOST`; logout checks it. Set `CORS_ORIGINS` to cooperative
   frontend origins. Configure the three Google settings together:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
   Set `MONGO_URI` to this project's MongoDB URI including its database name,
   for example `mongodb://127.0.0.1:27017/remote_cooperative`.
3. `remote-agric-cooperative`: set `NEXT_PUBLIC_API_URL` to the cooperative API
   origin. Configure `APP_ORIGIN` on this backend as the exact frontend origin
   listed in `CORS_ORIGINS`. Use HTTPS in production.

For local development the frontend is `http://localhost:3001` and the cooperative
API is `http://localhost:4000`. Register this exact authorized redirect URI on a
Google **Web application** OAuth client:

```
http://localhost:4000/auth/google/callback
```

Set that same value as `GOOGLE_REDIRECT_URI`. Use the actual HTTPS backend
origin for production with the same `/auth/google/callback` path.
Google credentials and Remote Agric JWTs must never enter `NEXT_PUBLIC_*` settings.
Both backends need network access to Google; the cooperative API needs access to
Remote Agric. Google test-mode consent screens require configured test users.

## Flows

- Email signup forwards validated name, email, international phone number and
  matching strong passwords to Remote Agric's existing registration endpoint.
  That service hashes the password and emails a six-digit verification code.
  Account creation completes through its verification endpoint. The user then
  signs in. This backend stores a local cooperative profile in `users`, linked
  by the unique Remote Agric user ID, without duplicating passwords or tokens.
- Existing Remote Agric users sign in with their current credentials.
- Password and Google login create or refresh the local profile. Existing
  sessions create a missing profile on their next protected request. Local users
  start with pending membership and no accepted terms; sign-in does not
  activate membership or record cooperative consent. Profile responses keep
  `id` as the Remote Agric ID and add `localUserId`, `membershipStatus`, accepted
  terms metadata, and `currentTermsVersion`.
- Pending members complete `/onboarding` in the frontend. Its browser calls
  authenticated `POST /auth/accept-terms` directly
  with `{ "acceptTerms": true, "termsVersion": "1.0" }`. The backend activates
  pending membership and records the version and timestamp atomically. Retries
  preserve the timestamp; suspended users cannot reactivate themselves. The
  dashboard loads the current profile from this API before rendering. Financial-service
  eligibility remains separate.
- Google uses authorization code exchange with PKCE, state and nonce. The
  callback is on this backend. The cooperative API verifies the ID token;
  Remote Agric verifies it again against its allowed client IDs before issuing
  a standard user session. Existing Google identities are reused. Automatic
  email linking requires a verified existing account and a Google-authoritative
  Gmail/Workspace address. Other existing addresses should use password login.
- Password recovery uses Remote Agric's existing email reset-code endpoints.
  Resetting a password revokes earlier sessions through `sessionVersion`.
- This backend stores the session in a host-only HttpOnly cookie, with Secure
  and the `__Host-` prefix in production. Browser JavaScript receives only a
  minimal user profile. CORS allows credentials from exact configured origins;
  cookie-authenticated mutations require a trusted Origin. Use
  `credentials: "include"` in browser requests.
- Every protected API request obtains the current identity from Remote Agric's
  authenticated profile endpoint. That endpoint verifies the JWT, account status
  and session version. Failures deny access. Logout invokes Remote Agric logout,
  revoking all user sessions on both platforms, then removes the API cookie.
- `/dashboard` is a protected member dashboard with clearly marked sample
  financial data. No subscription-based financial permissions are implemented yet.
  Independent cooperative admin access and dashboard setup are covered in
  [ADMIN.md](ADMIN.md).

## Operational notes

The existing Terms and Privacy dialogs contain provisional information, not
approved legal documents. The onboarding page labels the existing pilot
membership/privacy information and records acceptance of its version. Replace
that copy with approved policies and update the backend's
`COOPERATIVE_TERMS_VERSION` before financial services launch. Onboarding does
not implement investment eligibility or financial-service permissions.

The API's throttler currently keys on the direct client IP. Behind a deployment
reverse proxy, requests may share that IP. Configure shared rate-limit storage
and a trusted deployment-specific client-IP strategy before scaling; never
trust arbitrary forwarded headers. Remote Agric's existing account/email limits
remain in effect.

The profile check adds an upstream request to protected operations. Remote
Agric availability is required for sign-in and protected access. Request timeouts
fail closed. The frontend cookie lasts at most seven days; the upstream JWT's
expiry remains authoritative and may be shorter.

## Verification

Run `pnpm build`, `pnpm lint`, `pnpm test`, and `pnpm test:e2e` in this backend,
`pnpm build`, `pnpm lint` and `pnpm test:auth` in the frontend, and `npm run build` plus
`node --import tsx --test regression-tests/cooperative-google.test.ts` in
Remote Agric. Cooperative integration tests mock upstream HTTP and local stores
rather than creating real users or sending email. The frontend HTTP check starts an isolated
Next development server on port 3101 and a fake API to verify cookies, CSRF,
OAuth redirects and public page wording. A real Google consent round trip and email
delivery require configured credentials and a test account.

Google protocol references: [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
and [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Session migration and deployment

The frontend has no auth server routes. Password login and legacy JSON Google
login set an API-host cookie and omit `sessionToken` from the JSON response.
`GET /auth/google` starts browser OAuth; `GET /auth/google/callback` completes
it and redirects to the configured `APP_ORIGIN`. Register this backend callback
in Google Console and update `GOOGLE_REDIRECT_URI` before deploying.

Deploy both repositories together. Existing frontend-host cookies are unused;
users sign in again. Prefer same-site frontend/API domains and
`COOKIE_SAME_SITE=lax`. If the hosts are on unrelated sites, production HTTPS
requires `COOKIE_SAME_SITE=none`; browsers may still block third-party cookies.
The OAuth transaction cookie always uses Lax for top-level Google redirects.
Bearer credentials remain accepted for nonbrowser API clients; sessions issued
by browser-facing login endpoints are delivered only in HttpOnly cookies.
