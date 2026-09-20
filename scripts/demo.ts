import { sendPaymentCampaign } from "../src/payment_campaign";
import { infrai } from "../src/infrai_sms";

const recipient = process.env.DEMO_SMS_TO;
if (!recipient) throw new Error("DEMO_SMS_TO is required");

const result = await sendPaymentCampaign({
  campaignId: `daily-settlement-${new Date().toISOString().slice(0, 10)}`,
  payments: [{
    paymentId: process.env.DEMO_PAYMENT_ID ?? "pay_demo_101",
    customerPhone: recipient,
    amountMinor: 2599,
    currency: "USD",
    event: "payment_received",
    risk: "low",
  }],
}, { send: infrai.sms.send });

console.log(JSON.stringify(result, null, 2));
