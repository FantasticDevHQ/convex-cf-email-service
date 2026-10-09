// Host-only demo admission and UI references; provider credentials stay in email.transport.
import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import { CloudflareEmail } from "@fantastic.dev/convex-cf-email-service";
const email = new CloudflareEmail(components.transactionalEmail);
function authorize(code: string) {
  const expected = process.env.EMAIL_DEMO_ACCESS_CODE;
  if (!expected || expected.length < 32 || code !== expected)
    throw new ConvexError("Demo access denied");
}
export const submit = mutation({
  args: {
    accessCode: v.string(),
    requestId: v.string(),
    recipient: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  returns: v.id("demoSends"),
  handler: async (ctx, a) => {
    authorize(a.accessCode);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        a.requestId,
      )
    )
      throw new ConvexError("Invalid request ID");
    const recipient = a.recipient.trim().toLowerCase();
    const allowed = (process.env.EMAIL_DEMO_RECIPIENTS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes("*") && !allowed.includes(recipient))
      throw new ConvexError("Recipient is not enabled for this demo");
    const from = process.env.EMAIL_DEMO_FROM;
    if (!from) throw new ConvexError("Demo sender is not configured");
    const transport = process.env.EMAIL_DEMO_TRANSPORT ?? "primary";
    if (transport !== "primary" && transport !== "worker")
      throw new ConvexError("Demo transport is not configured");
    if (
      !a.subject.trim() ||
      a.subject.length > 200 ||
      !a.text.trim() ||
      a.text.length > 10000
    )
      throw new ConvexError(
        "Use a subject up to 200 characters and a message up to 10000 characters",
      );
    const existing = await ctx.db
      .query("demoSends")
      .withIndex("by_request", (q) => q.eq("requestId", a.requestId))
      .unique();
    if (!existing) {
      const recent = await ctx.db
        .query("demoSends")
        .withIndex("by_time", (q) => q.gte("createdAt", Date.now() - 60000))
        .take(6);
      if (recent.length >= 6)
        throw new ConvexError("Demo send limit reached; wait one minute");
    }
    const emailId = await email.enqueue(ctx, {
      scope: "store",
      key: `demo:${a.requestId}`,
      transport,
      send:
        transport === "worker"
          ? internal.email.workerTransport
          : internal.email.transport,
      expiresAt: Date.now() + 5 * 60000,
      maxAttempts: 3,
      metadataDays: 1,
      dedupDays: 7,
      payload: { from, to: [recipient], subject: a.subject, text: a.text },
    });
    if (existing) return existing._id;
    const id = await ctx.db.insert("demoSends", {
      requestId: a.requestId,
      emailId,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(86400000, internal.demo.cleanup, { id });
    return id;
  },
});
export const status = query({
  args: { accessCode: v.string(), requestId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      state: v.string(),
      attempt: v.number(),
      createdAt: v.number(),
      expiresAt: v.number(),
      cancelRequested: v.boolean(),
      delivery: v.array(v.object({ state: v.string(), count: v.number() })),
    }),
  ),
  handler: async (ctx, a) => {
    authorize(a.accessCode);
    const row = await ctx.db
      .query("demoSends")
      .withIndex("by_request", (q) => q.eq("requestId", a.requestId))
      .unique();
    return row
      ? await ctx.runQuery(components.transactionalEmail.email.status, {
          id: row.emailId,
        })
      : null;
  },
});
export const cleanup = internalMutation({
  args: { id: v.id("demoSends") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row && Date.now() >= row.createdAt + 86400000) await ctx.db.delete(id);
    return null;
  },
});
