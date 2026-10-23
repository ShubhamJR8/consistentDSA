# Deploying CommitDSA

Short runbook. Settings are documented in `server/.env.example` and `client/.env.example`.

## Before the first deploy

1. **Environment.** In production the server refuses to boot (exit 1, naming each missing setting)
   without `JWT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
   `EMAIL_HOST/USER/PASS`, an `https://` `CLIENT_URL`, and `LEETCODE_VERIFICATION_ENABLED=true`.
2. **Razorpay webhook.** Dashboard → Settings → Webhooks: URL `https://<api-host>/api/payments/webhook`,
   the same secret as `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `order.paid`,
   `payment.dispute.*`, `refund.processed`, `refund.failed`. Payments must auto-capture: orders are
   created with `payment_capture: true`, but that has not been checked against the live API, so also
   confirm the account setting and test one payment.
3. **LeetCode provider.** The hosted Alfa allows 120 requests/hour per IP, shared by everything on this
   server. Build `infra/alfa` (the stock image has the same hardcoded limit), keep it on a private
   network, and set `LEETCODE_API_BASE_URL` and a larger `LEETCODE_API_HOURLY_BUDGET`.
4. **Client origin.** Same-origin `/api` by default. For an API on its own origin set
   `VITE_API_BASE_URL` at build time; both sites need https (cookies are `SameSite=None; Secure`).

## Startup checks

The server verifies every unique index on boot. Several are the last guard on money (one successful
deposit and one pending order per commitment, one forfeiture per day, one refund per payment), and a
unique index cannot be built over rows that already break it. If one fails, production **refuses to
start** and logs `index_build_failed` naming the model. Fix the conflicting documents, then restart.

## Running more than one instance

Safe. Sweeps take a database lease so one instance runs each at a time, and rate limits are counted in
MongoDB. **Not shared:** the Alfa request budget and its 429 cooldown are per instance, so divide
`LEETCODE_API_HOURLY_BUDGET` by the instance count when using the hosted Alfa.

## Alerts

Log lines with `"alert":true` need a person: `payment_dispute`, `refund_failed_at_razorpay`,
`payment_amount_mismatch`, `duplicate_payment_refund_queued`, `paid_commitment_cancelled_refund_queued`,
`paid_commitment_not_activated`, `leetcode_provider_down`, `index_build_failed`, `uncaught_exception`,
`unhandled_rejection`. Nothing routes them yet; add a log-based alert on your host.

## Refunds

Refunds are queued automatically and executed by hand: `node dist/scripts/refunds.js list`, then
`execute <transactionId>`. A row left `PROCESSING` means the outcome was unknown: check Razorpay, then
re-run `execute` (it looks for an existing refund first). A refund against a payment under dispute is
refused.

## Rolling back

Redeploy the previous image. Schema changes are additive (new fields, new indexes), except that
startup drops the legacy `one_refund_per_commitment` index, which an older version recreates on boot if
the data allows. Indexes added by newer versions stay, and an older version can be refused by one
that blocks something it used to allow (for example a second pending deposit for a commitment). That
is the guard doing its job, not a fault.
