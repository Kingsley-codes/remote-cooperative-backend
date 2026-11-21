<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

Set `MONGO_URI` in `.env`, including the cooperative database name, for example
`mongodb://127.0.0.1:27017/remote_cooperative`. This single database holds `users`,
`admins` and future cooperative financial collections. If
upgrading an existing environment, replace `ADMIN_MONGO_URI` and `ADMIN_MONGO_DB`
with one `MONGO_URI` pointing to the same database. For Atlas, put the database
name before the URI's `?` options; preserve any required `authSource` setting.

Remote Agric owns member authentication, passwords, and sessions. Successful
password/Google login creates or refreshes a local user linked by a unique
`remoteAgricUserId`. Existing Remote Agric sessions create a local user on their
next authenticated request if needed. Responses preserve `user.id` as the Remote
Agric ID and add `user.localUserId` and `user.membershipStatus`.

Local users start with pending membership and no recorded cooperative terms
acceptance. Authentication does not activate membership or prove investment
eligibility. After login, call `POST /auth/accept-terms` with the API session cookie
and `{ "acceptTerms": true, "termsVersion": "1.0" }`. The current version is also
returned as `user.currentTermsVersion`. This atomically activates a pending
membership and records `termsVersion` and `termsAcceptedAt`. Repeated acceptance
preserves the original timestamp, and suspended memberships cannot reactivate
themselves. Investment eligibility and financial permissions remain separate work.
Profile refreshes do not overwrite local membership or consent. No member password
or session token is stored in `users`. Admins authenticate independently against
the `admins` collection; create them with `pnpm admin:create`.

Database access returns 503 when `MONGO_URI` is missing or the initial connection
fails. Public routes remain available without a database connection.

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

For the existing Render web service, use:

- Build command: `npm install --include=dev && npm run build`
- Start command: `npm run start:prod`
- Runtime environment: `NODE_ENV=production`

The project `.npmrc` also includes development dependencies for npm installs.
The build needs `@nestjs/cli` and TypeScript from `devDependencies`, even when
`NODE_ENV=production`. Omitting them causes `nest: not found`. Keep production
mode enabled for secure session cookies. Use `&&` so a failed dependency install
stops the build. After changing installation settings, clear Render's build
cache and deploy again. The running application starts from `dist` without the
Nest CLI.

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It installs `@nestjs/observe`, wires it into `AppModule` and `main.ts`, and writes the app key and secret into `.env`, which every `nest start` script (`start`, `start:dev`, `start:debug`) then loads. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand:

```bash
$ pnpm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/sdk) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Contributions, payments and loans

Financial records use three domain collections: `contributions` (a `long_term`
or `short_term` plan), `transactions` (collections, repayments, withdrawals and
disbursements), and `loans` (principal, fee, repayment progress, decisions and
schedule). Amounts are integer **kobo**, in NGN. There is no new payment SDK or
separate service deployment.

### Setup

1. Use MongoDB Atlas or a MongoDB **replica set**. Financial writes use database
   transactions and intentionally fail rather than partially write on standalone
   MongoDB. Existing user/admin collections are retained; indexes initialize on
   the first database connection.
2. Set `PAYSTACK_SECRET_KEY` in `.env` using the placeholders in `.env.example`.
   Start with a test key. Hosted checkout requires no frontend public key.
3. Register `https://YOUR-BACKEND/finance/paystack/webhook` in Paystack's dashboard.
   `APP_ORIGIN` must be the actual frontend origin. Callback navigation goes to
   `/dashboard?view=Transactions`; the backend verifies the payment independently.
4. For withdrawals and loan payouts, activate Paystack transfers, disable transfer
   OTP in its dashboard, maintain provider liquidity, and set
   `PAYSTACK_TRANSFERS_ENABLED=true`. Until then, collection payments still work
   and the UI explains that payouts are unavailable. The cooperative currently
   absorbs provider collection/transfer fees; the member fee is zero.
5. Publish approved loan terms at `LOAN_TERMS_URL`, set `LOAN_TERMS_VERSION`,
   `LOAN_FLAT_FEE_BPS` (500 = a one-time 5% fee, 0 = explicitly fee-free) and
   `LOAN_MAX_MONTHS`. Blank pricing/version/URL keeps applications disabled.
   Repayment installments begin monthly from confirmed disbursement; rounding
   preserves the exact total in kobo.
6. In the admin Loans screen, verify the member's current Remote Agric investment
   evidence, record its source and set a maximum request no greater than that
   verified investment value. Assessments expire in 24 hours. The identity API
   currently has no trusted investment-valuation contract, so this is an audited
   staff assessment; it does not invent an upstream endpoint or eligibility rate.

### API

Authenticated member routes are under `/finance`; admin routes under
`/admin/finance` require an admin session. A member-supplied `memberId` cannot
override the authenticated member's scope.

| Method and route | Purpose |
| --- | --- |
| `GET /finance/summary` | Confirmed contributions, savings availability, withdrawals, loan totals, aggregate pool capital |
| `GET /finance/contributions` | Contribution records, filtered by `type`, status, reference search and dates |
| `POST /finance/contributions` | `{ type, amount }`, with `Idempotency-Key`; returns hosted checkout URL |
| `GET /finance/transactions` | Unified personal payment ledger |
| `POST /finance/payments/:reference/verify` | Authoritative collection/repayment verification |
| `GET /finance/banks` | Nigerian payout banks |
| `GET /finance/destination` | Payout availability, verified masked account, fee and timing |
| `POST /finance/destination` | Verify `{ accountNumber, bankCode }` against the member's name |
| `POST /finance/withdrawals` | `{ amount }`, with `Idempotency-Key`; atomically reserve available savings and initiate payout |
| `POST /finance/payouts/:reference/verify` | Verify payout completion independently of the browser |
| `GET /finance/eligibility` | Current investment assessment and published pricing |
| `GET /finance/loans` | Applications, decisions, balances and repayment schedules |
| `POST /finance/loans` | `{ amount, months, purpose, consent, termsVersion }` |
| `POST /finance/loans/:id/repay` | `{ amount }`, with `Idempotency-Key`; reserve repayment capacity and open checkout |

Admin routes provide `GET summary`, `contributions`, `transactions` and `loans`,
with additional `memberId` and reconciliation filters. All lists return 20 rows
per page, `total`, status totals and an `asOf` timestamp. `from` and `to` are
inclusive calendar dates in Africa/Lagos; `page` is one-based.

Admin mutations are `POST /admin/finance/eligibility`,
`POST /admin/finance/loans/:id/decision` (`{ decision: "approve" | "reject", reason }`),
and `POST /admin/finance/loans/:id/disburse`. Payout verification uses
`POST /admin/finance/payouts/:reference/verify`; pending payout retries use
`POST /admin/finance/payouts/:reference/retry` with a decision reason. Loan
decisions, eligibility assessments, disbursement initiation and payout retries
are audited. Approval preserves the requested principal and accepted pricing;
approval alone never creates an active loan.

### Reconciliation and product boundaries

Paystack signatures cover the exact raw webhook body. A collection must match
the persisted reference, amount, currency and payer email. Confirmation and
domain updates are atomic and conditional, so repeated callbacks cannot credit
money twice. Pending repayments reserve repayment capacity; pending withdrawals
reserve savings. Provider timeouts keep reservations intact. A payout retry uses
its **original** provider reference and cannot create a second transfer.

Abandoned but resumable checkouts remain pending. Members can continue checkout
or verify its state in record details. Failed payments do not add balances;
only verified terminal failure releases a reservation. Reversals and unexpected
late-success states are flagged `needs_review`, preserving completed history;
automatic refunds, chargeback allocation and manual adjustment posting are not
implemented. Investigate these exceptions against Paystack before correcting
the ledger; never issue a replacement payout for an ambiguous timeout.

Pool asset value is read only from an approved `poolValuations` record
(`status: "approved"`, integer-kobo `assetValue`, `valuedAt`, optional `note`).
Without an approved allocation rule, estimated member share stays unavailable.
There is no invented yield or automated collateral recovery. The long-term
five-year minimum is disclosed; precise lock-in start/release dates remain
governed by the final accepted terms. No long-term withdrawal flow is enabled.

Tests use mocked provider/database boundaries; run a Paystack test-mode pilot
against a replica-set database to validate real webhook delivery, simultaneous
withdrawals and reconciliation before enabling live credentials. Provider docs:
[collections](https://paystack.com/docs/payments/accept-payments/),
[webhooks](https://paystack.com/docs/payments/webhooks/),
[transfers](https://paystack.com/docs/transfers/single-transfers/).

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
