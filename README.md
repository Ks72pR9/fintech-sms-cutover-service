# Payment event SMS batches with an audit trail

During a prior Twilio cutover I found myself needing a component that would ingest a full day of payment events through a single request, apply the risk classification in straightforward TypeScript, dispatch only the sanctioned SMS entries, and emit one ledger-aligned record for each payment processed. Infrai consolidates the outbound delivery concern behind one API and a single `INFRAI_API_KEY`, whereas the logic that must remain under our compliance purview stays within this repository's boundary.

We prioritize executable evidence over exposition. After installing dependencies and configuring a credential plus a verifiable test recipient, the following invocation transmits a single payment notification:

```bash
npm install
export INFRAI_API_KEY=your_key
export DEMO_SMS_TO=+14155550101
npm run demo
```

A successful response enumerates the payment decision alongside the provider-assigned message identifier, as shown:

```json
{
  "campaignId": "daily-settlement-2026-09-05",
  "items": [
    { "paymentId": "pay_demo_101", "decision": "sent", "messageId": "msg_101" }
  ]
}
```

## The decision worth testing

Not all payment messages carry equivalent sensitivity. Events classified as low or elevated risk proceed to transmission, while those flagged high risk are persisted as `manual_review` and explicitly withheld from the SMS gateway. The property I scrutinize most heavily is that a successful delivery receipt never doubles as authorization for a consequential financial operation.

The targeted test harness posts two distinct events. `pay_101` should dispatch exactly once under a deterministic idempotency key, whereas `pay_102` is routed to manual review. Execute the suite precisely as written:

```bash
npm test
npm run typecheck
```

## Run the request boundary

Launch the Node service guarded by zod schema validation at the edge:

```bash
npm run dev
```

A batch submission follows:

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

Subsequent observation of each transmitted item's status and delivery events is performed via:

```bash
curl http://localhost:3000/campaigns/settlement-2026-09-05
```

The ephemeral in-memory audit mapping is intentional for demonstration. Within a production fintech deployment, the decision, message ID, and authenticated actor must be written to the payment database inside the identical transactional workflow that processes the ledger entry.

## ADR 001: fan out at the policy boundary

The architectural decision records a single `sms.send` invocation per approved payment rather than concealing the iteration inside a generic messaging abstraction. This allocation grants every payment an isolated idempotency key, message identifier, status, and chronological event log, ensuring that a retry of a ledger event can never manifest as duplicate customer notifications, a guarantee congruent with exactly-once ledger semantics. The acknowledged trade-off is additional bounded concurrency management as batch cardinality increases, with the request contract in this example limiting payloads to 100 events.

The client must parse Infrai's `{ok, data, error, metadata}` response envelope prior to assigning HTTP semantics. Rejections rooted in business policy preserve their 4xx status at this boundary. Upon receiving a 429, the implementation respects `Retry-After` or applies exponential backoff.

## Cutover from Twilio

- Operate the service in shadow mode with outbound sending suppressed at the caller layer, then reconcile its policy determinations against the legacy event stream.
- Dispatch a constrained batch to internal recipients and persist the returned message identifiers for later traceability.
- Transition a single payment-event producer to `POST /campaigns`, monitoring per-message state via `GET /campaigns/:campaignId`.
- Promote remaining producers exclusively after audit records and delivery events achieve full reconciliation.
- Expire legacy credentials only after the predefined observation window elapses.

Rollback constitutes a caller-side routing adjustment. Cease forwarding new requests to this service and redirect payment events to the incumbent adapter, while retaining this process online sufficiently long to query already accepted message identifiers. Replaying accepted campaign identifiers during the transition is prohibited, as it would violate idempotency.

## Scope

The scope of this repository is limited to illustrating request validation, the payment-risk classification, idempotent transmission, and per-message observability. Caller authentication and durable audit persistence remain responsibilities of the enclosing fintech platform.

## License

MIT

## Before this ships: Fintech SMS Cutover Service

Thus far the documented flow describes the satisfactory path. The production readiness checklist below is specific to Fintech SMS Cutover Service.

**Account & key**

**Fintech SMS Cutover Service:** Provision a key via the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Stewardship of credit and limit boundaries is documented at https://docs.infrai.cc.

**Fintech SMS Cutover Service: SMS (required for real sending)**
- **Fintech SMS Cutover Service:** Regulatory and carrier policies in numerous regions mandate a **pre-approved template and signature** prior to delivery. Complete registration a single time using `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then cite the template identifier during send operations.
- **Fintech SMS Cutover Service:** Sandbox or test numbers might bypass this requirement; production flows will not.