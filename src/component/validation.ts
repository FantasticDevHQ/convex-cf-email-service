// Modified by Fantastic Dev HQ, 2026: bounded canonical payloads and cryptographic digests.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { EmailPayload, DeliveryEvent } from "./shared.js";
export function digest(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
}
export function bounded(value: string, max = 256): string {
  if (!value || value.length > max || /[\r\n\0]/u.test(value))
    throw new Error("Invalid bounded identifier");
  return value;
}
export function address(value: string): string {
  const s = value.trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(s))
    throw new Error("Invalid email address");
  return s;
}
export function normalize(payload: EmailPayload): EmailPayload {
  const recipients = (a: string[] | undefined) =>
    [...new Set((a ?? []).map(address))].sort();
  const to = recipients(payload.to),
    cc = recipients(payload.cc),
    bcc = recipients(payload.bcc);
  if (
    !to.length ||
    to.length + cc.length + bcc.length > 50 ||
    new Set([...to, ...cc, ...bcc]).size !== to.length + cc.length + bcc.length
  )
    throw new Error("Invalid recipient count or overlap");
  if (!payload.text && !payload.html) throw new Error("Body required");
  bounded(payload.subject, 998);
  if ((payload.attachments?.length ?? 0) > 32)
    throw new Error("Too many attachments");
  for (const a of payload.attachments ?? []) {
    bounded(a.filename);
    bounded(a.type);
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        a.content,
      )
    )
      throw new Error("Invalid attachment");
    if (a.disposition === "inline") bounded(a.contentId ?? "");
  }
  const names = Object.keys(payload.headers ?? {}).map((name) =>
    name.toLowerCase(),
  );
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate header name");
  const headers = Object.fromEntries(
    Object.entries(payload.headers ?? {})
      .map(([k, val]) => {
        bounded(k, 100);
        bounded(val, 2048);
        if (!/^X-[A-Za-z0-9-]+$/iu.test(k))
          throw new Error("Only X- headers supported");
        return [k.toLowerCase(), val];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  if (Object.keys(headers).length > 20) throw new Error("Too many headers");
  const p: EmailPayload = {
    from: address(payload.from),
    to,
    subject: payload.subject,
  };
  if (cc.length) p.cc = cc;
  if (bcc.length) p.bcc = bcc;
  if (payload.replyTo) p.replyTo = address(payload.replyTo);
  if (payload.text) p.text = payload.text;
  if (payload.html) p.html = payload.html;
  if (Object.keys(headers).length) p.headers = headers;
  if (payload.attachments?.length)
    p.attachments = payload.attachments.map((a) => ({
      content: a.content,
      filename: a.filename,
      type: a.type,
      disposition: a.disposition,
      ...(a.contentId ? { contentId: a.contentId } : {}),
    }));
  if (new TextEncoder().encode(JSON.stringify(p)).byteLength > 256 * 1024)
    throw new Error("Component payload exceeds 256 KiB");
  return p;
}
export function allRecipients(p: EmailPayload) {
  return [...p.to, ...(p.cc ?? []), ...(p.bcc ?? [])];
}
export function normalizedEvent(e: DeliveryEvent): DeliveryEvent {
  bounded(e.eventId);
  bounded(e.messageId);
  if (!Number.isFinite(e.at) || e.at < 0 || e.at > Date.now() + 300000)
    throw new Error("Invalid event timestamp");
  if (e.kind === "accepted" || e.kind === "queued")
    throw new Error("Acceptance is not a delivery event");
  return { ...e, recipient: address(e.recipient) };
}
const rank = {
  queued: -1,
  accepted: 0,
  deferred: 1,
  delivered: 2,
  failed: 3,
  rejected: 4,
  bounced: 5,
  complained: 6,
};
export function advance(
  current: DeliveryEvent["kind"],
  at: number,
  event: DeliveryEvent,
) {
  // Terminal evidence cannot be undone by provider retry notifications. Contradictory
  // terminal events resolve by severity, with complaint always sticky, independent of arrival.
  return (
    rank[event.kind] > rank[current] ||
    (event.kind === current && event.at > at)
  );
}
