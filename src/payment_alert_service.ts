import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { infrai, InfraiError } from "./infrai_sms";
import { campaignSchema, sendPaymentCampaign, type AuditItem } from "./payment_campaign";

const batches = new Map<string, AuditItem[]>();

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request: AsyncIterable<Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/campaigns") {
      const input = campaignSchema.parse(await readJson(request));
      const result = await sendPaymentCampaign(input, { send: infrai.sms.send });
      batches.set(result.campaignId, result.items);
      return json(response, 202, result);
    }

    const match = request.url?.match(/^\/campaigns\/([^/]+)$/);
    if (request.method === "GET" && match) {
      const campaignId = decodeURIComponent(match[1]);
      const items = batches.get(campaignId);
      if (!items) return json(response, 404, { error: "campaign not found" });
      const statuses = await Promise.all(items.map(async (item) => {
        if (!item.messageId) return item;
        const [status, events] = await Promise.all([
          infrai.sms.status(item.messageId),
          infrai.sms.events(item.messageId),
        ]);
        return { ...item, status, events };
      }));
      return json(response, 200, { campaignId, items: statuses });
    }

    return json(response, 404, { error: "route not found" });
  } catch (error) {
    if (error instanceof ZodError) return json(response, 400, { error: "invalid request", issues: error.issues });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return json(response, status, { error: error.detail });
    }
    return json(response, 500, { error: error instanceof Error ? error.message : "unexpected error" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Payment alert service listening on http://localhost:${port}`));
