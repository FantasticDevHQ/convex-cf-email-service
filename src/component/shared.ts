// Modified by Fantastic Dev HQ, 2026: secret-free host contracts and validators.
import { v, type Infer } from "convex/values";
export const payloadV = v.object({
  from: v.string(),
  to: v.array(v.string()),
  cc: v.optional(v.array(v.string())),
  bcc: v.optional(v.array(v.string())),
  subject: v.string(),
  text: v.optional(v.string()),
  html: v.optional(v.string()),
  replyTo: v.optional(v.string()),
  headers: v.optional(v.record(v.string(), v.string())),
  attachments: v.optional(
    v.array(
      v.object({
        content: v.string(),
        filename: v.string(),
        type: v.string(),
        disposition: v.union(v.literal("attachment"), v.literal("inline")),
        contentId: v.optional(v.string()),
      }),
    ),
  ),
});
export const deliveryV = v.union(
  v.literal("queued"),
  v.literal("accepted"),
  v.literal("delivered"),
  v.literal("deferred"),
  v.literal("bounced"),
  v.literal("failed"),
  v.literal("rejected"),
  v.literal("complained"),
);
export const stateV = v.union(
  v.literal("queued"),
  v.literal("sending"),
  v.literal("retrying"),
  v.literal("accepted"),
  v.literal("ambiguous"),
  v.literal("cancelled"),
  v.literal("expired"),
  v.literal("failed"),
  v.literal("suppressed"),
);
export const codeV = v.union(
  v.literal("rate_limited"),
  v.literal("unavailable"),
  v.literal("not_configured"),
  v.literal("rejected"),
  v.literal("unknown"),
);
export const resultV = v.union(
  v.object({
    kind: v.literal("accepted"),
    recipients: v.array(
      v.object({
        recipient: v.string(),
        messageId: v.optional(v.string()),
        status: v.union(
          v.literal("accepted"),
          v.literal("delivered"),
          v.literal("bounced"),
        ),
      }),
    ),
  }),
  v.object({
    kind: v.literal("not_sent"),
    retryable: v.boolean(),
    code: codeV,
  }),
  v.object({ kind: v.literal("ambiguous") }),
);
export const eventV = v.object({
  eventId: v.string(),
  messageId: v.string(),
  recipient: v.string(),
  kind: deliveryV,
  at: v.number(),
  permanent: v.boolean(),
});
export type EmailPayload = Infer<typeof payloadV>;
export type TransportResult = Infer<typeof resultV>;
export type DeliveryEvent = Infer<typeof eventV>;
export const dispatchV = v.object({
  emailId: v.string(),
  attempt: v.number(),
  scope: v.string(),
  transport: v.string(),
  idempotencyKey: v.string(),
  expiresAt: v.number(),
  payload: payloadV,
});
export type DispatchRequest = Infer<typeof dispatchV>;
export const HOUR = 3600000,
  DAY = 24 * HOUR,
  LEASE = 60000;
