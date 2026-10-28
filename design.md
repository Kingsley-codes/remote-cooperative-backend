# Remote Agric Cooperative Backend Design

**Product:** Remote Agric Cooperative  
**Version:** 2.0  
**Status:** Backend-focused implementation design  
**Primary framework:** NestJS with TypeScript  
**Architecture:** Modular monolith  
**Database:** MongoDB

## 1. Purpose and scope

This document translates the Remote Agric Cooperative PRD into a backend implementation design. The backend is the source of truth for identity, eligibility, financial state, balances, loan decisions, payment status, reporting, and audit history.

The first release supports:

- Remote Agric identity handoff and cooperative membership.
- Long-term contributions to the pooled asset product.
- Short-term savings contributions and withdrawals.
- Loan applications, decisions, disbursement, and repayments.
- A unified immutable transaction ledger.
- Payment-provider integration and reconciliation.
- Member and admin APIs, notifications, reports, and audit logs.

The backend must not give the cooperative direct database access to Remote Agric. It communicates with Remote Agric through its authenticated APIs or trusted identity handoff.

## 2. Backend principles

1. **The server is authoritative.** The frontend displays API values and never decides eligibility, balances, loan approval, or payment completion.
2. **Financial records are append-only.** Completed entries are not silently edited. Corrections use linked reversal or adjustment entries.
3. **External events are untrusted until verified.** Webhooks and provider responses must be authenticated, validated, and processed idempotently.
4. **Pending is not successful.** A payment or payout only changes confirmed totals after authoritative confirmation.
5. **Personal and aggregate data are separate.** Member APIs return only the requesting member's details; aggregate pool metrics are explicitly labeled.
6. **Every consequential action is traceable.** Admin decisions, retries, configuration changes, and state transitions include actor, time, reason, and relevant before/after data.
7. **Business rules are configurable and explicit.** Currency, limits, lock-in rules, liquidity rules, loan policy, and role permissions must not be hidden in controllers or frontend code.

## 3. System architecture

Use a NestJS modular monolith for the first release. Modules run in one API process and share one cooperative MongoDB database, while keeping domain boundaries clear enough to extract later if scale requires it.

```text
Remote Agric identity and APIs
             |
       Auth / eligibility adapter
             |
Client -> NestJS REST API -> Domain modules -> MongoDB
                              |       |
                       Payment provider  Notification provider
                              |
                    Verified webhooks and reconciliation jobs
```

### Recommended stack

- NestJS and TypeScript.
- REST API with OpenAPI documentation.
- MongoDB with Mongoose or the NestJS-supported MongoDB integration selected during setup.
- `class-validator` and `class-transformer` for request validation and DTOs.
- `@nestjs/config` with environment-specific configuration validation.
- `@nestjs/schedule` or a queue worker for retries, reconciliation, and notifications. Use a durable queue when job volume requires it.
- Structured logging, centralized error monitoring, metrics, and health checks.

NestJS controllers should stay thin. Controllers authenticate requests, validate DTOs, and call application services. Domain services enforce rules, coordinate repositories and integrations, and emit state changes. Provider adapters isolate external SDKs from the domain.

## 4. NestJS module boundaries

Suggested structure:

```text
src/
  app.module.ts
  main.ts
  common/
    auth/
    decorators/
    filters/
    guards/
    interceptors/
    pipes/
  config/
  modules/
    auth-integration/
    members/
    eligibility/
    long-term-contributions/
    short-term-savings/
    withdrawals/
    loans/
    ledger/
    payments/
    pool-reporting/
    reconciliation/
    notifications/
    admin/
    reports/
    audit/
    health/
```

### Module responsibilities

- **Auth integration:** Verify the Remote Agric handoff, establish the local session, and expose the authenticated principal.
- **Members:** Create or retrieve the cooperative member by stable Remote Agric user ID, manage membership status, terms, and consent.
- **Eligibility:** Retrieve and cache approved Remote Agric eligibility, investment, valuation, and collateral data with a freshness policy.
- **Long-term contributions:** Initiate and confirm long-term deposits, enforce amount and lock-in rules, and write ledger entries only after confirmation.
- **Short-term savings:** Manage short-term deposits and available balance projections.
- **Withdrawals:** Validate withdrawal requests, reserve funds safely, start automated payouts, process status updates, and handle controlled retries.
- **Loans:** Create applications with eligibility and collateral snapshots, record admin decisions, track disbursement, and manage repayments and delinquency states.
- **Ledger:** Own immutable financial entries, categories, references, and balance calculations or reconciled projections.
- **Payments:** Provide collection, payout, webhook verification, provider reference mapping, and provider-specific adapters.
- **Pool reporting:** Store approved valuation snapshots and calculate clearly defined aggregate metrics.
- **Reconciliation:** Match internal records with provider events and surface unmatched, duplicated, stale, or amount-mismatched records.
- **Notifications:** Deliver transactional status notifications without exposing sensitive financial details in message previews.
- **Admin and reports:** Enforce role permissions, provide operational queries, and generate protected date-filtered exports.
- **Audit:** Record security-sensitive and financial state changes.

## 5. Data model

Use separate domain collections plus a unified ledger view. Do not use one mutable balance field as the only record of money movement. Balances should be derived from ledger entries or maintained as carefully reconciled projections.

### Core collections

| Collection               | Important fields                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `members`                | `remoteAgricUserId` (unique), status, cooperative profile, terms and consent timestamps                                                             |
| `longTermContributions`  | member ID, amount, currency, status, payment and provider references, reconciliation status, timestamps                                             |
| `shortTermContributions` | member ID, amount, status, payment and provider references, reconciliation status, timestamps                                                       |
| `withdrawalRequests`     | member ID, amount, destination reference, status, idempotency key, payout reference, attempts, timestamps                                           |
| `loans`                  | member ID, requested and approved amounts, term, pricing snapshot, status, eligibility and collateral snapshots, decision and disbursement metadata |
| `loanRepayments`         | loan ID, member ID, amount, allocation, status, payment reference, timestamps                                                                       |
| `transactions`           | immutable category, direction, amount, status, member ID, linked record, internal and external references, timestamps                               |
| `poolValuations`         | valuation date, aggregate contributions, asset value, gain/loss, fees, source, approval state                                                       |
| `auditLogs`              | actor, action, target, timestamp, reason, metadata, change summary                                                                                  |
| `notifications`          | member ID, type, channel, status, related entity, delivery timestamps                                                                               |
| `reconciliationRecords`  | provider event, internal record, match state, exception reason, resolution metadata                                                                 |

Create unique indexes for stable Remote Agric IDs, idempotency keys within their operation scope, provider references, and payment event IDs. Add indexes for member and status lookups, date-filtered reports, loan queues, and admin transaction searches. Paginate every list endpoint.

## 6. Financial state and invariants

### Contribution and repayment states

`Initiated -> Pending -> Successful` with terminal `Failed`, `Cancelled`, or `Reversed` states.

### Withdrawal states

`Requested -> Validating -> Processing -> Completed` with `Rejected`, `Failed`, `Reversed`, or `Needs investigation` exception states.

### Loan states

Application: `Draft -> Submitted -> Pending review -> Approved | Rejected -> Disbursement pending -> Active`.

Lifecycle: `Active -> Paid off`, or `Overdue -> Default review -> Defaulted | Recovered | Restructured` according to approved policy.

### Required invariants

- A pending provider event cannot increase confirmed contribution totals.
- A withdrawal cannot spend more than the reconciled available balance.
- Concurrent withdrawal requests must not reserve the same funds twice.
- Repeated requests, webhooks, and retry jobs produce one financial outcome.
- A loan is not `Active` until disbursement is authoritatively confirmed.
- A reversal or adjustment links to the original entry and never deletes it.
- "Contributions," "current pool value," "reported gain/loss," and "completed withdrawal" use the PRD definitions consistently in every report.

Use MongoDB transactions or atomic conditional updates for reservation, ledger posting, status transitions, and other operations where a partial write could create or lose money.

## 7. Integration boundaries

### Remote Agric

Accept only a verified identity handoff or token. Validate signature, issuer, audience, expiry, and required claims. Use protected Remote Agric APIs for current account status, eligibility, approved investment valuation, and any collateral or recovery data. Never trust stale client-provided eligibility.

### Payment provider

Implement a provider interface for collections and payouts:

- Initiate payment with an idempotency key.
- Store internal, payment, and provider references.
- Verify webhook signatures and event IDs.
- Ignore or safely reprocess duplicate events.
- Confirm status server-side where callbacks are delayed.
- Reconcile provider reports against internal records.
- Expose controlled retry operations for authorized staff only.

The provider adapter must not directly mutate domain data. It returns a normalized event to the payments or reconciliation module, which applies the domain transition and writes the ledger entry.

### Notifications

Send status changes for contributions, withdrawals, loan decisions, due dates, and security events. Notifications are best-effort delivery records; they do not determine financial state.

## 8. API design

Protect all non-public routes with authentication and server-side authorization. Use DTOs, consistent error responses, request IDs, pagination, filtering, and idempotency headers for consequential POST requests.

### Member routes

- `GET /v1/me`
- `GET /v1/me/overview`
- `GET /v1/me/long-term-contributions`
- `POST /v1/me/long-term-contributions`
- `GET /v1/me/short-term-savings`
- `POST /v1/me/short-term-contributions`
- `POST /v1/me/withdrawals`
- `GET /v1/me/withdrawals`
- `GET /v1/me/loans`
- `POST /v1/me/loans`
- `GET /v1/me/transactions`

### Admin routes

- `GET /v1/admin/overview`
- `GET /v1/admin/members`
- `GET /v1/admin/transactions`
- `GET /v1/admin/contributions/long-term`
- `GET /v1/admin/contributions/short-term`
- `GET /v1/admin/withdrawals`
- `POST /v1/admin/withdrawals/:id/retry`
- `GET /v1/admin/loans`
- `POST /v1/admin/loans/:id/approve`
- `POST /v1/admin/loans/:id/reject`
- `GET /v1/admin/reports`
- `GET /v1/admin/audit-logs`

### Integration routes

- `POST /v1/integrations/payments/webhooks`
- `POST /v1/integrations/payments/reconcile`
- `GET /v1/health`
- `GET /v1/health/readiness`

The exact route names may change during implementation, but domain ownership, authorization, idempotency, and state-transition behavior must remain stable.

## 9. Authorization, privacy, and security

- Use short-lived sessions or access tokens and secure cookies where applicable.
- Apply role-based guards for member, support, loan approver, finance, and administrator capabilities.
- Enforce member ownership checks in services, not only in controllers.
- Rate-limit authentication, payment initiation, withdrawal, and webhook paths.
- Use strict CORS, secure headers, input validation, safe error messages, and environment-managed secrets.
- Encrypt sensitive data in transit and at rest where supported; minimize stored payout and identity data.
- Do not expose another member's personal transactions, balances, loans, or provider references.
- Require reason notes for loan rejection, manual exception handling, and operational retries.
- Audit loan decisions, exports, permission changes, configuration changes, retries, and any collateral or recovery action.

## 10. Jobs, reconciliation, and operations

Background work must be retryable, observable, and idempotent. Candidate jobs:

- Poll delayed payment and payout statuses.
- Retry notifications and permitted payouts with backoff.
- Match provider events to internal records.
- Detect unmatched events, duplicate references, amount mismatches, and stale valuations.
- Recalculate or verify balance projections.
- Mark overdue loans according to configured policy.
- Generate reports and exports asynchronously when they are large.

Expose readiness checks for MongoDB, queue infrastructure, Remote Agric, and payment dependencies as appropriate. Log structured events with request ID, member or admin ID where permitted, operation, internal reference, provider reference, and outcome. Never log secrets or full sensitive payment data.

## 11. Frontend contract

The frontend may use Next.js, React, TypeScript, and the existing visual design direction, but it is an API client rather than a business-rule layer. It must:

- Render authoritative values and explicit statuses from the NestJS API.
- Keep member figures separate from approved aggregate pool figures.
- Show pending, processing, completed, failed, and stale states clearly.
- Require confirmation before consequential requests.
- Display fees, terms, limits, references, and relevant timestamps returned by the backend.
- Avoid implying guaranteed returns or treating redirects as payment proof.

## 12. Decisions required before production

Confirm these with the product, legal, finance, and integration owners before locking implementation:

- Contribution currency and minimum/maximum amounts.
- Long-term lock-in and release rules.
- Pool valuation, allocation, fee, and loss treatment.
- Short-term withdrawal liquidity and risk rules.
- Payment collection and payout provider, settlement behavior, and fees.
- Loan pricing, duration, limits, eligibility, and repayment policy.
- Collateral valuation and default recovery consent.
- Admin roles, approval thresholds, and export permissions.
- Notification channels, support process, retention, and incident response.
- Regulatory, cooperative, investment, lending, and data-protection approvals.

## 13. Implementation sequence

1. Confirm business rules, legal constraints, provider contracts, and Remote Agric integration claims.
2. Scaffold the NestJS application, configuration, logging, health checks, authentication handoff, and authorization guards.
3. Build members, eligibility, terms acceptance, ledger foundations, indexes, and idempotency handling.
4. Build payment adapters and long-term and short-term contribution flows.
5. Build withdrawal reservation, payout automation, status handling, retries, and reconciliation exceptions.
6. Build loan applications, admin decisions, disbursement, repayments, and delinquency tracking.
7. Add pool reporting, member/admin queries, exports, notifications, and audit views.
8. Run end-to-end tests for duplicate callbacks, concurrency, unauthorized access, eligibility changes, withdrawal races, failed payments, loan audit history, and reconciliation.
9. Launch a controlled pilot with monitoring, backups, restore testing, and documented operational escalation.

## 14. Backend acceptance checklist

- [ ] NestJS modular monolith is the documented and implemented API stack.
- [ ] Remote Agric remains an external integration and identity source.
- [ ] Protected routes enforce authentication and authorization server-side.
- [ ] Long-term and short-term financial domains remain distinct.
- [ ] Confirmed totals are not updated by pending payment attempts.
- [ ] Withdrawal validation and payout processing are automatic and idempotent.
- [ ] Loan decision and disbursement are separate auditable states.
- [ ] Ledger corrections use linked adjustment or reversal records.
- [ ] Provider callbacks and retries are verified and idempotent.
- [ ] Member data is isolated from other members.
- [ ] Admin filters, exports, exception handling, and audit logs are protected.
- [ ] Operational jobs, health checks, logs, metrics, backups, and reconciliation procedures are defined before production.
