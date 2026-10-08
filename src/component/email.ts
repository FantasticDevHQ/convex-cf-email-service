// Modified by Fantastic Dev HQ, 2026: host transport, durable dedup, fenced attempts,
// event races, suppression and retention replace upstream token-bearing work items.
import { v, type Infer } from "convex/values";
import {
  mutation,
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internal } from "./_generated/api.js";
import {
  payloadV,
  resultV,
  eventV,
  stateV,
  deliveryV,
  dispatchV,
  DAY,
  HOUR,
  LEASE,
} from "./shared.js";
import {
  normalize,
  digest,
  bounded,
  address,
  allRecipients,
  normalizedEvent,
  advance,
} from "./validation.js";

async function metric(
  ctx: MutationCtx,
  scope: string,
  name: string,
  value = 1,
) {
  const day = Math.floor(Date.now() / DAY) * DAY;
  const row = await ctx.db
    .query("metrics")
    .withIndex("by_scope_day_name", (q) =>
      q.eq("scope", scope).eq("day", day).eq("name", name),
    )
    .unique();
  if (row) await ctx.db.patch(row._id, { count: row.count + value });
  else {
    const id = await ctx.db.insert("metrics", {
      scope,
      day,
      name,
      count: value,
    });
    await ctx.scheduler.runAt(
      Math.min(day + 91 * DAY, Date.now() + 7 * DAY),
      internal.email.deleteMetric,
      { id },
    );
  }
}
async function terminal(
  ctx: MutationCtx,
  email: Doc<"emails">,
  state: Doc<"emails">["state"],
) {
  await ctx.db.patch(email._id, { state });
  await ctx.scheduler.runAt(
    Math.min(email.expiresAt, Date.now() + HOUR),
    internal.email.redact,
    { id: email._id },
  );
  await metric(ctx, email.scope, state);
}
export const enqueue = mutation({
  args: {
    scope: v.string(),
    key: v.string(),
    transport: v.string(),
    handle: v.string(),
    payload: payloadV,
    expiresAt: v.number(),
    maxAttempts: v.optional(v.number()),
    metadataDays: v.optional(v.number()),
    dedupDays: v.optional(v.number()),
  },
  returns: v.id("emails"),
  handler: async (ctx, a): Promise<Id<"emails">> => {
    bounded(a.scope);
    bounded(a.key);
    bounded(a.transport);
    bounded(a.handle, 1024);
    if (!a.handle.startsWith("function://"))
      throw new Error("Expected a Convex function handle");
    const p = normalize(a.payload),
      now = Date.now(),
      max = a.maxAttempts ?? 4,
      metadata = a.metadataDays ?? 30,
      dedup = a.dedupDays ?? 90;
    if (
      !Number.isFinite(a.expiresAt) ||
      a.expiresAt <= now ||
      a.expiresAt > now + DAY
    )
      throw new Error("Expiry must be within 24 hours");
    if (
      !Number.isInteger(max) ||
      max < 1 ||
      max > 8 ||
      !Number.isInteger(metadata) ||
      metadata < 1 ||
      metadata > 90 ||
      !Number.isInteger(dedup) ||
      dedup < metadata ||
      dedup > 365
    )
      throw new Error("Invalid bounded policy");
    const fingerprint = digest({ payload: p, transport: a.transport });
    const existing = await ctx.db
      .query("emails")
      .withIndex("by_scope_key", (q) => q.eq("scope", a.scope).eq("key", a.key))
      .unique();
    if (existing) {
      if (existing.digest !== fingerprint)
        throw new Error("Idempotency conflict");
      return existing._id;
    }
    const id = await ctx.db.insert("emails", {
      scope: a.scope,
      key: a.key,
      digest: fingerprint,
      transport: a.transport,
      handle: a.handle,
      payload: p,
      state: "queued",
      attempt: 0,
      maxAttempts: max,
      expiresAt: a.expiresAt,
      createdAt: now,
      nextAt: now,
      metadataUntil: now + metadata * DAY,
      dedupUntil: now + dedup * DAY,
      cancelRequested: false,
    });
    for (const recipient of allRecipients(p))
      await ctx.db.insert("recipients", {
        emailId: id,
        scope: a.scope,
        recipient,
        state: "queued",
        at: now,
      });
    await ctx.scheduler.runAfter(0, internal.dispatch.send, { id });
    await ctx.scheduler.runAt(a.expiresAt, internal.email.expire, { id });
    await ctx.scheduler.runAt(
      Math.min(now + metadata * DAY, now + 7 * DAY),
      internal.email.prune,
      { id },
    );
    await metric(ctx, a.scope, "enqueued");
    return id;
  },
});
const claimV = v.object({ handle: v.string(), request: dispatchV });
export const claim = internalMutation({
  args: { id: v.id("emails") },
  returns: v.union(v.null(), claimV),
  handler: async (ctx, { id }): Promise<Infer<typeof claimV> | null> => {
    const e = await ctx.db.get(id);
    if (
      !e ||
      !["queued", "retrying"].includes(e.state) ||
      Date.now() < e.nextAt
    )
      return null;
    if (Date.now() >= e.expiresAt) {
      await terminal(ctx, e, "expired");
      return null;
    }
    if (!e.payload) {
      await terminal(ctx, e, "failed");
      return null;
    }
    for (const recipient of allRecipients(e.payload)) {
      if (
        await ctx.db
          .query("suppressions")
          .withIndex("by_scope_hash", (q) =>
            q.eq("scope", e.scope).eq("hash", digest(recipient)),
          )
          .unique()
      ) {
        await terminal(ctx, e, "suppressed");
        return null;
      }
    }
    const attempt = e.attempt + 1;
    await ctx.db.patch(id, { state: "sending", attempt });
    await ctx.db.insert("attempts", {
      emailId: id,
      number: attempt,
      at: Date.now(),
    });
    await ctx.scheduler.runAfter(LEASE, internal.email.recover, {
      id,
      attempt,
    });
    await metric(ctx, e.scope, "attempts");
    await metric(ctx, e.scope, "queue_wait_ms", Date.now() - e.createdAt);
    return {
      handle: e.handle,
      request: {
        emailId: id,
        attempt,
        scope: e.scope,
        transport: e.transport,
        idempotencyKey: e.key,
        expiresAt: e.expiresAt,
        payload: e.payload,
      },
    };
  },
});
export const recover = internalMutation({
  args: { id: v.id("emails"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, a): Promise<null> => {
    const e = await ctx.db.get(a.id);
    if (e?.state === "sending" && e.attempt === a.attempt) {
      await terminal(ctx, e, "ambiguous");
      const t = await ctx.db
        .query("attempts")
        .withIndex("by_email_number", (q) =>
          q.eq("emailId", a.id).eq("number", a.attempt),
        )
        .unique();
      if (t)
        await ctx.db.patch(t._id, {
          outcome: "ambiguous",
          finishedAt: Date.now(),
        });
    }
    return null;
  },
});
async function suppress(
  ctx: MutationCtx,
  scope: string,
  recipient: string,
  reason: "bounce" | "complaint",
) {
  const hash = digest(recipient),
    row = await ctx.db
      .query("suppressions")
      .withIndex("by_scope_hash", (q) => q.eq("scope", scope).eq("hash", hash))
      .unique();
  if (row) {
    if (reason === "complaint")
      await ctx.db.patch(row._id, { reason, at: Date.now() });
  } else
    await ctx.db.insert("suppressions", {
      scope,
      hash,
      reason,
      at: Date.now(),
    });
}
async function apply(
  ctx: MutationCtx,
  r: Doc<"recipients">,
  event: Infer<typeof eventV>,
) {
  if (advance(r.state, r.at, event))
    await ctx.db.patch(r._id, { state: event.kind, at: event.at });
  if (
    event.kind === "complained" ||
    (event.kind === "bounced" && event.permanent)
  )
    await suppress(
      ctx,
      r.scope,
      r.recipient,
      event.kind === "complained" ? "complaint" : "bounce",
    );
  await metric(ctx, r.scope, `event_${event.kind}`);
}
async function correlate(
  ctx: MutationCtx,
  r: Doc<"recipients">,
  messageId: string,
) {
  const already = await ctx.db
    .query("recipients")
    .withIndex("by_scope_message_recipient", (q) =>
      q
        .eq("scope", r.scope)
        .eq("messageId", messageId)
        .eq("recipient", r.recipient),
    )
    .unique();
  if (already && already.emailId !== r.emailId)
    throw new Error("Correlation already assigned");
  await ctx.db.patch(r._id, { messageId });
  await drainPending(ctx, { ...r, messageId }, 5);
}
async function drainPending(
  ctx: MutationCtx,
  r: Doc<"recipients">,
  limit: number,
) {
  const messageId = r.messageId;
  if (!messageId) return;
  const pending = await ctx.db
    .query("events")
    .withIndex("by_correlation", (q) =>
      q
        .eq("scope", r.scope)
        .eq("event.messageId", messageId)
        .eq("event.recipient", r.recipient)
        .eq("applied", false),
    )
    .take(limit + 1);
  for (const ev of pending.slice(0, limit)) {
    const fresh = await ctx.db.get(r._id);
    if (fresh) await apply(ctx, fresh, ev.event);
    await ctx.db.patch(ev._id, { applied: true });
  }
  if (pending.length > limit)
    await ctx.scheduler.runAfter(0, internal.email.drainEvents, { id: r._id });
}
export const drainEvents = internalMutation({
  args: { id: v.id("recipients") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const r = await ctx.db.get(id);
    if (r) await drainPending(ctx, r, 25);
    return null;
  },
});
async function accepted(
  ctx: MutationCtx,
  e: Doc<"emails">,
  result: Extract<Infer<typeof resultV>, { kind: "accepted" }>,
) {
  const rows = await ctx.db
    .query("recipients")
    .withIndex("by_email", (q) => q.eq("emailId", e._id))
    .take(51);
  if (
    !rows.length ||
    result.recipients.length !== rows.length ||
    new Set(result.recipients.map((x) => address(x.recipient))).size !==
      rows.length
  )
    throw new Error("Incomplete or duplicate recipient outcomes");
  for (const outcome of result.recipients) {
    const r = rows.find((x) => x.recipient === address(outcome.recipient));
    if (!r) throw new Error("Unknown recipient outcome");
    if (outcome.messageId) bounded(outcome.messageId);
    await ctx.db.patch(r._id, { state: outcome.status, at: Date.now() });
    if (outcome.status === "bounced")
      await suppress(ctx, e.scope, r.recipient, "bounce");
    if (outcome.messageId)
      await correlate(
        ctx,
        { ...r, state: outcome.status, at: Date.now() },
        outcome.messageId,
      );
  }
  await terminal(ctx, e, "accepted");
  await metric(ctx, e.scope, "acceptance_ms", Date.now() - e.createdAt);
}
export const complete = internalMutation({
  args: { id: v.id("emails"), attempt: v.number(), result: resultV },
  returns: v.null(),
  handler: async (ctx, a): Promise<null> => {
    const e = await ctx.db.get(a.id);
    if (
      !e ||
      e.attempt !== a.attempt ||
      !["sending", "ambiguous"].includes(e.state)
    )
      return null;
    const t = await ctx.db
      .query("attempts")
      .withIndex("by_email_number", (q) =>
        q.eq("emailId", a.id).eq("number", a.attempt),
      )
      .unique();
    if (!t) return null;
    if (a.result.kind === "accepted") {
      await accepted(ctx, e, a.result);
      await ctx.db.patch(t._id, {
        outcome: "accepted",
        finishedAt: Date.now(),
      });
    } else if (a.result.kind === "ambiguous") {
      await terminal(ctx, e, "ambiguous");
      await ctx.db.patch(t._id, {
        outcome: "ambiguous",
        finishedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(t._id, {
        outcome: "not_sent",
        code: a.result.code,
        finishedAt: Date.now(),
      });
      await ctx.db.patch(e._id, { code: a.result.code });
      const nextAt = Date.now() + Math.min(300000, 1000 * 2 ** (e.attempt - 1));
      if (e.cancelRequested) await terminal(ctx, e, "cancelled");
      else if (Date.now() >= e.expiresAt || nextAt >= e.expiresAt)
        await terminal(ctx, e, "expired");
      else if (!a.result.retryable || e.attempt >= e.maxAttempts)
        await terminal(ctx, e, "failed");
      else {
        await ctx.db.patch(e._id, { state: "retrying", nextAt });
        await ctx.scheduler.runAt(nextAt, internal.dispatch.send, {
          id: e._id,
        });
        await metric(ctx, e.scope, "retries");
      }
    }
    return null;
  },
});
export const cancel = mutation({
  args: { id: v.id("emails") },
  returns: v.boolean(),
  handler: async (ctx, { id }): Promise<boolean> => {
    const e = await ctx.db.get(id);
    if (!e) return false;
    if (["queued", "retrying"].includes(e.state)) {
      await terminal(ctx, e, "cancelled");
      return true;
    }
    if (e.state === "sending" || e.state === "ambiguous")
      await ctx.db.patch(id, { cancelRequested: true });
    return false;
  },
});
export const expire = internalMutation({
  args: { id: v.id("emails") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const e = await ctx.db.get(id);
    if (e) {
      if (["queued", "retrying"].includes(e.state))
        await terminal(ctx, e, "expired");
      await ctx.db.patch(id, { payload: undefined });
    }
    return null;
  },
});
export const ingest = mutation({
  args: { scope: v.string(), event: eventV },
  returns: v.union(
    v.literal("duplicate"),
    v.literal("pending"),
    v.literal("applied"),
  ),
  handler: async (ctx, a): Promise<"duplicate" | "pending" | "applied"> => {
    bounded(a.scope);
    const event = normalizedEvent(a.event),
      hash = digest(event);
    const dup = await ctx.db
      .query("events")
      .withIndex("by_scope_event", (q) =>
        q.eq("scope", a.scope).eq("event.eventId", event.eventId),
      )
      .unique();
    if (dup) {
      if (dup.digest !== hash) throw new Error("Event ID conflict");
      await metric(ctx, a.scope, "duplicate_events");
      return "duplicate";
    }
    const r = await ctx.db
      .query("recipients")
      .withIndex("by_scope_message_recipient", (q) =>
        q
          .eq("scope", a.scope)
          .eq("messageId", event.messageId)
          .eq("recipient", event.recipient),
      )
      .unique();
    if (!r) {
      const n = await ctx.db
        .query("events")
        .withIndex("by_correlation", (q) =>
          q
            .eq("scope", a.scope)
            .eq("event.messageId", event.messageId)
            .eq("event.recipient", event.recipient)
            .eq("applied", false),
        )
        .take(100);
      if (n.length >= 100) throw new Error("Pending event limit");
    }
    const id = await ctx.db.insert("events", {
      scope: a.scope,
      event,
      digest: hash,
      applied: !!r,
    });
    await ctx.scheduler.runAfter(7 * DAY, internal.email.deleteEvent, { id });
    // Suppression applies even if the acceptance write has not arrived yet.
    if (
      event.kind === "complained" ||
      (event.kind === "bounced" && event.permanent)
    )
      await suppress(
        ctx,
        a.scope,
        event.recipient,
        event.kind === "complained" ? "complaint" : "bounce",
      );
    if (r) await apply(ctx, r, event);
    else await metric(ctx, a.scope, "pending_events");
    return r ? "applied" : "pending";
  },
});
export const attachMessageId = mutation({
  args: { id: v.id("emails"), recipient: v.string(), messageId: v.string() },
  returns: v.null(),
  handler: async (ctx, a): Promise<null> => {
    bounded(a.messageId);
    const e = await ctx.db.get(a.id);
    if (!e || e.state !== "accepted")
      throw new Error("Requires accepted intent");
    const rows = await ctx.db
        .query("recipients")
        .withIndex("by_email", (q) => q.eq("emailId", a.id))
        .take(51),
      r = rows.find((x) => x.recipient === address(a.recipient));
    if (!r) throw new Error("Missing recipient");
    if (r.messageId && r.messageId !== a.messageId)
      throw new Error("Correlation conflict");
    await correlate(ctx, r, a.messageId);
    return null;
  },
});
export const reconcile = mutation({
  args: {
    id: v.id("emails"),
    attempt: v.number(),
    decision: v.union(
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
      v.object({ kind: v.literal("not_sent") }),
      v.object({ kind: v.literal("abandon") }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, a): Promise<null> => {
    const e = await ctx.db.get(a.id);
    if (!e || e.state !== "ambiguous" || e.attempt !== a.attempt)
      throw new Error("Stale reconciliation");
    if (a.decision.kind === "accepted") await accepted(ctx, e, a.decision);
    else if (a.decision.kind === "abandon") await terminal(ctx, e, "failed");
    else if (e.cancelRequested) await terminal(ctx, e, "cancelled");
    else if (Date.now() >= e.expiresAt) await terminal(ctx, e, "expired");
    else if (e.attempt >= e.maxAttempts) await terminal(ctx, e, "failed");
    else {
      await ctx.db.patch(e._id, { state: "retrying", nextAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.dispatch.send, { id: e._id });
    }
    const t = await ctx.db
      .query("attempts")
      .withIndex("by_email_number", (q) =>
        q.eq("emailId", a.id).eq("number", a.attempt),
      )
      .unique();
    if (t)
      await ctx.db.patch(t._id, {
        outcome: a.decision.kind === "abandon" ? "abandoned" : a.decision.kind,
        finishedAt: Date.now(),
      });
    await metric(ctx, e.scope, "reconciliations");
    return null;
  },
});
export const clearSuppression = mutation({
  args: { scope: v.string(), recipient: v.string() },
  returns: v.boolean(),
  handler: async (ctx, a): Promise<boolean> => {
    const row = await ctx.db
      .query("suppressions")
      .withIndex("by_scope_hash", (q) =>
        q.eq("scope", a.scope).eq("hash", digest(address(a.recipient))),
      )
      .unique();
    if (!row) return false;
    await ctx.db.delete(row._id);
    await metric(ctx, a.scope, "suppression_cleared");
    return true;
  },
});
export const redact = internalMutation({
  args: { id: v.id("emails") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, { payload: undefined });
    return null;
  },
});
export const prune = internalMutation({
  args: { id: v.id("emails") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const e = await ctx.db.get(id);
    if (!e) return null;
    if (Date.now() < e.metadataUntil) {
      await ctx.scheduler.runAt(
        Math.min(e.metadataUntil, Date.now() + 7 * DAY),
        internal.email.prune,
        { id },
      );
      return null;
    }
    for (const r of await ctx.db
      .query("recipients")
      .withIndex("by_email", (q) => q.eq("emailId", id))
      .take(51))
      await ctx.db.delete(r._id);
    for (const a of await ctx.db
      .query("attempts")
      .withIndex("by_email_number", (q) => q.eq("emailId", id))
      .take(9))
      await ctx.db.delete(a._id);
    await ctx.db.patch(id, { payload: undefined, handle: "", transport: "" });
    await ctx.scheduler.runAt(
      Math.min(e.dedupUntil, Date.now() + 7 * DAY),
      internal.email.deleteEmail,
      { id },
    );
    return null;
  },
});
export const deleteEmail = internalMutation({
  args: { id: v.id("emails") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const e = await ctx.db.get(id);
    if (e) {
      if (Date.now() < e.dedupUntil)
        await ctx.scheduler.runAt(
          Math.min(e.dedupUntil, Date.now() + 7 * DAY),
          internal.email.deleteEmail,
          { id },
        );
      else await ctx.db.delete(id);
    }
    return null;
  },
});
export const deleteEvent = internalMutation({
  args: { id: v.id("events") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const e = await ctx.db.get(id);
    if (e) {
      const until = e._creationTime + 30 * DAY;
      if (Date.now() < until)
        await ctx.scheduler.runAt(
          Math.min(until, Date.now() + 7 * DAY),
          internal.email.deleteEvent,
          { id },
        );
      else await ctx.db.delete(id);
    }
    return null;
  },
});
export const deleteMetric = internalMutation({
  args: { id: v.id("metrics") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const e = await ctx.db.get(id);
    if (e) {
      const until = e.day + 91 * DAY;
      if (Date.now() < until)
        await ctx.scheduler.runAt(
          Math.min(until, Date.now() + 7 * DAY),
          internal.email.deleteMetric,
          { id },
        );
      else await ctx.db.delete(id);
    }
    return null;
  },
});
export const status = query({
  args: { id: v.id("emails") },
  returns: v.union(
    v.null(),
    v.object({
      state: stateV,
      attempt: v.number(),
      createdAt: v.number(),
      expiresAt: v.number(),
      cancelRequested: v.boolean(),
      delivery: v.array(v.object({ state: deliveryV, count: v.number() })),
    }),
  ),
  handler: async (ctx, { id }) => {
    const e = await ctx.db.get(id);
    if (!e) return null;
    const rows = await ctx.db
      .query("recipients")
      .withIndex("by_email", (q) => q.eq("emailId", id))
      .take(51);
    const counts = new Map<Doc<"recipients">["state"], number>();
    for (const r of rows) counts.set(r.state, (counts.get(r.state) ?? 0) + 1);
    return {
      state: e.state,
      attempt: e.attempt,
      createdAt: e.createdAt,
      expiresAt: e.expiresAt,
      cancelRequested: e.cancelRequested,
      delivery: [...counts].map(([state, count]) => ({ state, count })),
    };
  },
});
export const metrics = query({
  args: { scope: v.string(), since: v.number() },
  returns: v.array(
    v.object({ day: v.number(), name: v.string(), count: v.number() }),
  ),
  handler: async (ctx, a) => {
    if (!Number.isFinite(a.since) || a.since < Date.now() - 90 * DAY)
      throw new Error("Metrics window exceeds 90 days");
    const rows = await ctx.db
      .query("metrics")
      .withIndex("by_scope_day_name", (q) =>
        q.eq("scope", a.scope).gte("day", Math.floor(a.since / DAY) * DAY),
      )
      .take(3000);
    return rows.map(({ day, name, count }) => ({ day, name, count }));
  },
});
