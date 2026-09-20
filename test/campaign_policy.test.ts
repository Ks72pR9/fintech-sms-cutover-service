import assert from "node:assert/strict";
import test from "node:test";
import { sendPaymentCampaign } from "../src/payment_campaign";

test("sends ordinary events and diverts high-risk actions for review", async () => {
  const sent: Array<{ to: string; idempotency_key: string }> = [];
  const sms = {
    send: async (message: { to: string; body: string; idempotency_key: string; tags: Record<string, string> }) => {
      sent.push(message);
      return { message_id: "msg_101" };
    },
  };
  const result = await sendPaymentCampaign({
    campaignId: "settlement-2026-09-05",
    payments: [
      { paymentId: "pay_101", customerPhone: "+14155550101", amountMinor: 2599, currency: "USD", event: "payment_received", risk: "low" },
      { paymentId: "pay_102", customerPhone: "+14155550102", amountMinor: 84000, currency: "USD", event: "refund_issued", risk: "high" },
    ],
  }, sms);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].idempotency_key, "settlement-2026-09-05:pay_101:payment_received");
  assert.deepEqual(result.items, [
    { paymentId: "pay_101", decision: "sent", messageId: "msg_101" },
    { paymentId: "pay_102", decision: "manual_review", reason: "high-risk payment requires approval" },
  ]);
});
