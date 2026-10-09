// Fantastic Dev HQ, 2026. Cloudflare Queues event bridge; no raw event/error logging.
import type { DeliveryEvent } from "../component/shared.js";
import { address, bounded, normalizedEvent } from "../component/validation.js";
export type BridgeConfig = {
  accountId: string;
  zoneId: string;
  domain: string;
  subscriptionId: string;
  scope: string;
};
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid event envelope");
  return v as Record<string, unknown>;
}
function string(v: unknown): string {
  if (typeof v !== "string") throw new Error("Invalid event field");
  return bounded(v);
}
export function normalizeCloudflareEvent(
  raw: unknown,
  config: BridgeConfig,
): DeliveryEvent {
  const r = record(raw),
    source = record(r.source),
    meta = record(r.metadata),
    p = record(r.payload);
  if (
    source.type !== "email.sending" ||
    source.zoneId !== config.zoneId ||
    source.domain !== config.domain ||
    meta.accountId !== config.accountId ||
    meta.eventSubscriptionId !== config.subscriptionId ||
    meta.eventSchemaVersion !== 1
  )
    throw new Error("Event source mismatch");
  const kind = string(r.type).replace("cf.email.sending.message.", "");
  if (
    ![
      "delivered",
      "deferred",
      "bounced",
      "failed",
      "rejected",
      "complained",
    ].includes(kind) ||
    r.type !== `cf.email.sending.message.${kind}`
  )
    throw new Error("Unknown event type");
  if (
    p.terminal !== (kind !== "deferred") ||
    record(p.delivery).status !== kind
  )
    throw new Error("Invalid event lifecycle");
  const bounce = kind === "bounced" ? record(p.bounce) : null;
  return normalizedEvent({
    eventId: string(p.eventId),
    messageId: string(p.messageId),
    recipient: address(string(p.recipient)),
    kind: kind as DeliveryEvent["kind"],
    at: Date.parse(string(meta.eventTimestamp)),
    permanent: kind === "complained" || bounce?.type === "hard",
  });
}
export async function signBody(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  if (secret.length < 32)
    throw new Error("Bridge secret must contain at least 32 characters");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return [...new Uint8Array(signed)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function authenticatedBody(
  request: Request,
  secrets: readonly string[],
  now = Date.now(),
  maxBytes = 16384,
): Promise<unknown> {
  if (
    request.method !== "POST" ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    throw new Error("Invalid bridge request");
  const timestamp = request.headers.get("x-email-timestamp") ?? "",
    signature = request.headers.get("x-email-signature") ?? "";
  if (
    !/^\d{13}$/u.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300000 ||
    !/^[a-f0-9]{64}$/u.test(signature)
  )
    throw new Error("Invalid bridge authentication");
  // Stream bounded bytes; never buffer an arbitrary unauthenticated body.
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Empty bridge body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Bridge body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let valid = false;
  for (const secret of secrets) {
    const expected = await signBody(secret, timestamp, body);
    let difference = 0;
    for (let i = 0; i < 64; i++)
      difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    valid = valid || difference === 0;
  }
  if (!valid) throw new Error("Invalid bridge authentication");
  return JSON.parse(body) as unknown;
}
export type QueueMessage = { body: unknown; ack(): void; retry(): void };
export type ForwardFailure =
  "invalid_event" | "signing_failed" | "forward_failed";
export async function forwardEvents(
  messages: readonly QueueMessage[],
  config: BridgeConfig,
  endpoint: string,
  secret: string,
  fetcher: typeof fetch = fetch,
  onFailure?: (reason: ForwardFailure) => void,
): Promise<{ forwarded: number; retried: number }> {
  if (new URL(endpoint).protocol !== "https:")
    throw new Error("HTTPS endpoint required");
  let forwarded = 0,
    retried = 0;
  for (const message of messages) {
    let reason: ForwardFailure = "invalid_event";
    try {
      const event = normalizeCloudflareEvent(message.body, config),
        body = JSON.stringify({ scope: config.scope, event }),
        timestamp = String(Date.now());
      reason = "signing_failed";
      const signature = await signBody(secret, timestamp, body);
      reason = "forward_failed";
      const response = await fetcher(endpoint, {
        method: "POST",
        // Workers supports manual/follow only; reject 3xx via response.ok below.
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          "x-email-timestamp": timestamp,
          "x-email-signature": signature,
        },
        body,
      });
      if (!response.ok) throw new Error("Forward failed");
      message.ack();
      forwarded++;
    } catch {
      message.retry();
      retried++;
      try {
        onFailure?.(reason);
      } catch {
        /* Diagnostics must not interrupt batch retries. */
      }
    }
  }
  return { forwarded, retried };
}
