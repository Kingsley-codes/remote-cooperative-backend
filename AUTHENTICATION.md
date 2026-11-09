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
3. `remote-agric-cooperative`: set `COOPERATIVE_API_URL` to the cooperative API
   origin and `APP_ORIGIN` to the exact frontend origin. `NEXT_PUBLIC_API_URL`
   configures the existing public API/CSP setting. Use HTTPS in production.

For local development the frontend is `http://localhost:3001` and the cooperative
API is `http://localhost:4000`. Register this exact authorized redirect URI on a
Google **Web application** OAuth client:

```
http://localhost:3001/api/auth/google/callback
```

Set that same value as `GOOGLE_REDIRECT_URI`. Use the actual HTTPS frontend
origin for production; the backend validates that it is in `CORS_ORIGINS`.
Google credentials and Remote Agric JWTs must never enter `NEXT_PUBLIC_*` settings.
Both backends need network access to Google; the cooperative API needs access to
Remote Agric. Google test-mode consent screens require configured test users.

## Flows

- Email signup forwards validated name, email, international phone number and
  matching strong passwords to Remote Agric's existing registration endpoint.
  That service hashes the password and emails a six-digit verification code.
  Account creation completes through its verification endpoint. The user then
  signs in. No second password or user database is created here.
- Existing Remote Agric users sign in with their current credentials.
- Google uses authorization code exchange with PKCE, state and nonce. The
  callback is on the frontend server. The cooperative API verifies the ID token;
  Remote Agric verifies it again against its allowed client IDs before issuing
  a standard user session. Existing Google identities are reused. Automatic
  email linking requires a verified existing account and a Google-authoritative
  Gmail/Workspace address. Other existing addresses should use password login.
- Password recovery uses Remote Agric's existing email reset-code endpoints.
  Resetting a password revokes earlier sessions through `sessionVersion`.
- The frontend server stores the session in a host-only HttpOnly, SameSite=Lax
  cookie, with Secure and the `__Host-` prefix in production. Browser JavaScript
  receives only a minimal user profile. Same-origin checks protect POST routes.
- Every protected API request obtains the current identity from Remote Agric's
  authenticated profile endpoint. That endpoint verifies the JWT, account status
  and session version. Failures deny access. Logout invokes Remote Agric logout,
  revoking all user sessions on both platforms, then removes the frontend cookie.
- `/dashboard` is a protected member dashboard with clearly marked sample
  financial data. No subscription-based financial permissions are implemented yet.
  Independent cooperative admin access and dashboard setup are covered in
  [ADMIN.md](ADMIN.md).

## Operational notes

The existing Terms and Privacy dialogs contain provisional information, not
approved legal documents. Publish the full policies before launch. This change
does not record versioned legal consent or implement financial memberships.

The API's throttler currently keys on the direct client IP. With the frontend
server proxy, requests may share that IP. Configure shared rate-limit storage
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
Remote Agric. Cooperative integration tests mock upstream HTTP rather than
creating users or sending email. The frontend HTTP check starts an isolated
Next development server on port 3101 and a fake API to verify cookies, CSRF,
OAuth redirects and public page wording. A real Google consent round trip and email
delivery require configured credentials and a test account.

Google protocol references: [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
and [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
