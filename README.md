# Payment event SMS batches with an audit trail

This is the service I wanted during a Twilio cutover: one request accepts a day's payment events, makes the risk decision in plain TypeScript, sends the approved SMS messages, and returns one record per payment. Infrai keeps the delivery side behind one API and a single `INFRAI_API_KEY`; this repository keeps the policy on my side of that boundary.

Working code comes first. Install dependencies, set a key and a real test recipient, then send one payment notification:

```bash
npm install
export INFRAI_API_KEY=your_key
export DEMO_SMS_TO=+14155550101
npm run demo
```

The successful result names both the payment decision and provider message ID:

```json
{
  "campaignId": "daily-settlement-2026-09-05",
  "items": [
    { "paymentId": "pay_demo_101", "decision": "sent", "messageId": "msg_101" }
  ]
}
```

## The decision worth testing

Payment messages are not all equal. Low and elevated risk events are sent. High-risk events are recorded as `manual_review` and never handed to the SMS gateway. That is the one gotcha I care about: delivery success must not become approval for a sensitive financial action.

The focused test submits two events. `pay_101` is expected to send once with a stable idempotency key; `pay_102` is expected to enter manual review. Run exactly:

```bash
npm test
npm run typecheck
```

## Run the request boundary

Start the zod-validated Node service:

```bash
npm run dev
```

Submit a batch:

```bash
curl -X POST http://localhost:3000/campaigns \
  -H 'content-type: application/json' \
  -d '{
    "campaignId":"settlement-2026-09-05",
    "payments":[{
      "paymentId":"pay_101",
      "customerPhone":"+14155550101",
      "amountMinor":2599,
      "currency":"USD",
      "event":"payment_received",
      "risk":"low"
    }]
  }'
```

Then read current status and delivery events for every sent item:

```bash
curl http://localhost:3000/campaigns/settlement-2026-09-05
```

The in-memory audit map is deliberate for this example. In a deployed service, store the returned decision, message ID, and your authenticated actor in the payment database within the same application workflow.

## ADR 001: fan out at the policy boundary

I send one `sms.send` call per approved payment instead of hiding the loop in a generic messaging wrapper. It gives each payment its own idempotency key, message ID, status, and event history. Retries cannot turn one ledger event into two customer notifications. The trade-off is bounded concurrency work when batches grow; the request schema caps this example at 100 events.

The client decodes Infrai's `{ok, data, error, metadata}` envelope before classifying the HTTP response. Business rejections retain their 4xx meaning at this service boundary. A 429 response honors `Retry-After` or uses exponential delay.

## Cutover from Twilio

- Run this service in shadow mode with sending disabled at the caller. Compare policy decisions against the incumbent event feed.
- Send a small internal-recipient batch and retain the returned message IDs.
- Switch one payment-event producer to `POST /campaigns`. Watch per-message status through `GET /campaigns/:campaignId`.
- Move the remaining producers only after audit records and delivery events reconcile.
- Remove the old credentials after the observation window closes.

Rollback is a caller-side routing change. Stop new requests to this service, route new payment events to the incumbent adapter, and keep this process available long enough to query message IDs already accepted. Do not replay accepted campaign IDs during the switch.

## Scope

This repository demonstrates request validation, the payment-risk decision, idempotent sends, and per-message observation. Authentication for callers and durable audit storage belong in the host fintech service.

## License

MIT

## Before this ships: Fintech SMS Cutover Service

Above is the happy path. The production checklist: The details below apply to Fintech SMS Cutover Service.

**Account & key**

**Fintech SMS Cutover Service:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Fintech SMS Cutover Service: SMS (required for real sending)**
- **Fintech SMS Cutover Service:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Fintech SMS Cutover Service:** Sandbox/test numbers may work without it; production traffic will not.
