// Modified by Fantastic Dev HQ, 2026: no credentials; indexed durable intent and events.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { payloadV, stateV, deliveryV, eventV, codeV } from "./shared.js";
export default defineSchema({
  emails: defineTable({
    scope: v.string(),
    key: v.string(),
    digest: v.string(),
    transport: v.string(),
    handle: v.string(),
    payload: v.optional(payloadV),
    state: stateV,
    attempt: v.number(),
    maxAttempts: v.number(),
    expiresAt: v.number(),
    createdAt: v.number(),
    nextAt: v.number(),
    metadataUntil: v.number(),
    dedupUntil: v.number(),
    cancelRequested: v.boolean(),
    code: v.optional(codeV),
  })
    .index("by_scope_key", ["scope", "key"])
    .index("by_scope_state", ["scope", "state"]),
  attempts: defineTable({
    emailId: v.id("emails"),
    number: v.number(),
    at: v.number(),
    finishedAt: v.optional(v.number()),
    outcome: v.optional(
      v.union(
        v.literal("accepted"),
        v.literal("not_sent"),
        v.literal("ambiguous"),
        v.literal("abandoned"),
      ),
    ),
    code: v.optional(codeV),
  }).index("by_email_number", ["emailId", "number"]),
  recipients: defineTable({
    emailId: v.id("emails"),
    scope: v.string(),
    recipient: v.string(),
    messageId: v.optional(v.string()),
    state: deliveryV,
    at: v.number(),
  })
    .index("by_email", ["emailId"])
    .index("by_scope_message_recipient", ["scope", "messageId", "recipient"]),
  events: defineTable({
    scope: v.string(),
    event: eventV,
    digest: v.string(),
    applied: v.boolean(),
  })
    .index("by_scope_event", ["scope", "event.eventId"])
    .index("by_correlation", [
      "scope",
      "event.messageId",
      "event.recipient",
      "applied",
    ]),
  suppressions: defineTable({
    scope: v.string(),
    hash: v.string(),
    reason: v.union(v.literal("bounce"), v.literal("complaint")),
    at: v.number(),
  }).index("by_scope_hash", ["scope", "hash"]),
  metrics: defineTable({
    scope: v.string(),
    day: v.number(),
    name: v.string(),
    count: v.number(),
  }).index("by_scope_day_name", ["scope", "day", "name"]),
});
