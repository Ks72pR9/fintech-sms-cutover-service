import { z } from "zod";
import type { SmsGateway } from "./infrai_sms";

export const campaignSchema = z.object({
  campaignId: z.string().min(3).max(80),
  payments: z.array(z.object({
    paymentId: z.string().min(1).max(80),
    customerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    amountMinor: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    event: z.enum(["payment_received", "payment_failed", "refund_issued"]),
    risk: z.enum(["low", "elevated", "high"]),
  })).min(1).max(100),
});

export type CampaignInput = z.infer<typeof campaignSchema>;
export type AuditItem = {
  paymentId: string;
  decision: "sent" | "manual_review";
  messageId?: string;
  reason?: string;
};

function messageFor(payment: CampaignInput["payments"][number]): string {
  const amount = (payment.amountMinor / 100).toFixed(2);
  const action = {
    payment_received: "received",
    payment_failed: "could not be completed",
    refund_issued: "was refunded",
  }[payment.event];
  return `Payment ${payment.paymentId} for ${amount} ${payment.currency} ${action}. Review your account for details.`;
}

export async function sendPaymentCampaign(
  input: CampaignInput,
  sms: Pick<SmsGateway, "send">,
): Promise<{ campaignId: string; items: AuditItem[] }> {
  const items: AuditItem[] = [];
  for (const payment of input.payments) {
    if (payment.risk === "high") {
      items.push({
        paymentId: payment.paymentId,
        decision: "manual_review",
        reason: "high-risk payment requires approval",
      });
      continue;
    }

    const sent = await sms.send({
      to: payment.customerPhone,
      body: messageFor(payment),
      idempotency_key: `${input.campaignId}:${payment.paymentId}:${payment.event}`,
      tags: { campaign_id: input.campaignId, payment_id: payment.paymentId },
    });
    items.push({ paymentId: payment.paymentId, decision: "sent", messageId: sent.message_id });
  }
  return { campaignId: input.campaignId, items };
}
