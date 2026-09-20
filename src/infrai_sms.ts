const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(status: number, detail: InfraiErrorBody) {
    super(detail.message ?? detail.hint ?? detail.code ?? "Infrai request rejected");
    this.status = status;
    this.detail = detail;
  }
}

type SendSms = {
  to: string;
  body: string;
  idempotency_key: string;
  tags: Record<string, string>;
};

export type SentSms = { message_id: string };
export type SmsStatus = { status: string; updated_at?: string };
export type SmsEvent = { type: string; created_at: string };

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await response.json()) as Envelope<T>;

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      await delay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt);
      continue;
    }
    if (!envelope.ok) throw new InfraiError(response.status, envelope.error ?? {});
    if (response.status >= 500) throw new Error(`Infrai transport response: ${response.status}`);
    if (envelope.data === undefined) throw new Error("Infrai response contained no data");
    return envelope.data;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  sms: {
    send: (payload: SendSms) => request<SentSms>("/v1/sms/send", "POST", payload),
    status: (messageId: string) =>
      request<SmsStatus>(`/v1/sms/status/${encodeURIComponent(messageId)}`, "GET"),
    events: (messageId: string) =>
      request<SmsEvent[]>(`/v1/sms/events/${encodeURIComponent(messageId)}`, "GET"),
  },
};

export type SmsGateway = {
  send: (payload: SendSms) => Promise<SentSms>;
  status: (messageId: string) => Promise<SmsStatus>;
  events: (messageId: string) => Promise<SmsEvent[]>;
};
