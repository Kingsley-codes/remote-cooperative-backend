# Cooperative admin access and dashboard previews

The cooperative has its own administrators. No Remote Agric admin account,
password, token or database collection is used for admin access.

## Configure and create the first administrator

In this backend's `.env`, set:

```dotenv
ADMIN_MONGO_URI=mongodb://127.0.0.1:27017
ADMIN_MONGO_DB=remote_cooperative
ADMIN_SESSION_TTL_HOURS=8
```

Use a database belonging to this project. A separate MongoDB deployment/user is
recommended for isolation; the configured database name is explicit and overrides
any default database in the URI. Production database credentials should have
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
- Admin passwords are salted and hashed with scrypt. Each login creates a random
  opaque token; only its SHA-256 digest is stored in `admin_sessions`.
- Sessions expire after the configured duration (1–24 hours, default 8).
  Every request rechecks expiry, the current admin's `active` flag and
  `sessionVersion`. MongoDB's TTL index also cleans up expired session records.
- Logout deletes the current session. Disabling an admin (`active: false`) or
  increasing `sessionVersion` revokes access on the next request. A management UI
  for creating/disabling admins and password recovery is not part of this change.
- Admin routes must use `@AdminOnly()`. The global authentication guard sends
  these routes to this project's admin verifier. Member routes continue to use
  Remote Agric identity verification. Neither session type grants the other access.
- The frontend uses a separate host-only HttpOnly admin cookie, SameSite=Lax and
  Secure with a `__Host-` prefix in production. Same-origin checks protect login
  and logout POSTs. Browser JavaScript never receives admin session tokens.
- Admin login allows five attempts per IP/route per minute, plus the existing
  burst limit. As with member auth, configure shared throttling and trusted
  client IP handling for your deployment before scaling the frontend proxy.

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
