# Cooperative admin access and dashboard previews

The cooperative has its own administrators. No Remote Agric admin account,
password, token or database collection is used for admin access.

## Configure and create the first administrator

In this backend's `.env`, set:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/remote_cooperative
ADMIN_SESSION_TTL_HOURS=8
ADMIN_TOKEN_SECRET=<random secret of at least 32 bytes>
```

Use a database belonging to this project. A separate MongoDB deployment/user is
recommended for isolation; the database name is included in the URI. Users and
admins use separate collections in this same cooperative database. Production database credentials should have
access only to this project's database. Missing configuration leaves admin login
unavailable with 503; there are no built-in accounts or default passwords.

Start MongoDB, then run from this backend:

```sh
corepack pnpm admin:create
```

The command builds the backend, loads `.env`, and prompts for the admin's email,
name and password. Password entry is hidden. Use 12–128 characters. It creates a
new account and refuses duplicate emails; it does not reset existing accounts.
There is no public admin registration endpoint. Do not place passwords in shell
arguments or commit them to environment files.

Start the cooperative API and frontend using the existing configuration from
[AUTHENTICATION.md](AUTHENTICATION.md). Open `/admin/login` on the frontend.
Successful login routes to `/admin/dashboard`. `/admin` also routes there and
requires a valid admin session. Member login continues to route to `/dashboard`.

## Session behavior

- The API exposes `POST /admin/auth/login`, `GET /admin/auth/me` and
  `POST /admin/auth/logout`.
- Admin passwords are salted and hashed with scrypt. Login issues a signed JWT
  with an admin-specific issuer and audience. No admin session records or session
  versions are stored. Configure `ADMIN_TOKEN_SECRET` with a cryptographically
  random secret of at least 32 bytes, shared across backend instances. Without
  it, admin authentication is unavailable. For example, generate one with
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
- Tokens expire after the configured duration (1–24 hours, default 8).
  Every request verifies the signature, issuer, audience and expiry, then checks
  the current admin account exists and is active.
- Logout clears the browser cookie. A copied token remains valid until expiry.
  Disabling an admin (`active: false`) denies access on the next request;
  re-enabling the account permits any unexpired tokens again. Password changes
  do not revoke tokens. Rotating `ADMIN_TOKEN_SECRET` invalidates all admin tokens.
  A management UI for creating/disabling admins and password recovery is not
  part of this change.
- Deploying this change requires admins to sign in again. Legacy
  `admin_sessions` records and `sessionVersion` fields are unused and may be
  removed from MongoDB separately; the application does not migrate or delete them.
- Admin routes must use `@AdminOnly()`. The global authentication guard sends
  these routes to this project's admin verifier. Member routes continue to use
  Remote Agric identity verification. Neither session type grants the other access.
- The backend sets a separate host-only HttpOnly admin cookie, Secure with a
  `__Host-` prefix in production. Browser requests include credentials. Exact
  trusted-origin checks protect cookie-authenticated POSTs. Browser JavaScript never receives admin session tokens.
- Admin login allows five attempts per IP/route per minute, plus the existing
  burst limit. As with member auth, configure shared throttling and trusted
  client IP handling for your deployment before scaling behind a reverse proxy.

## Dashboard previews

The member dashboard follows the supplied visual reference: sidebar, profile
header, personal/platform views, balance cards, chart, quick actions and recent
transactions. A Remote Agric introduction is included beneath the overview.

The admin dashboard uses the same design system for platform totals, members,
loan requests, transactions, reports and administrator profile. Navigation,
search, chart period controls, transaction detail dialogs and sample CSV export
work locally. The signed-in identity is real; financial data, members and loan
requests are clearly marked as sample data. Financial action dialogs do not
submit payments, approve loans or change balances.

Verification: backend build/lint/unit tests and HTTP integration tests; frontend
build/lint and `pnpm test:auth`, which runs both dashboards and authentication
routes against an isolated simulated API. Tests do not create real admins or
connect to a production database. A live MongoDB login requires the configuration
and provisioning steps above.
