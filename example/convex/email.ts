import { internalAction, internalMutation } from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import {
  CloudflareEmail,
  dispatchV,
  resultV,
} from "@fantastic.dev/convex-cf-email-service";
import { sendRest } from "@fantastic.dev/convex-cf-email-service/transport";
import { v } from "convex/values";
const email = new CloudflareEmail(components.transactionalEmail);
export const transport = internalAction({
  args: dispatchV,
  returns: resultV,
  handler: async (_ctx, request) => {
    if (request.transport !== "primary")
      return {
        kind: "not_sent" as const,
        retryable: false,
        code: "rejected" as const,
      };
    return await sendRest(request, async () => ({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      apiToken: process.env.CLOUDFLARE_EMAIL_TOKEN ?? "",
    }));
  },
});
// An internal-only example: the consumer adds authentication and verifies order ownership
// before exposing an endpoint, and renders its own receipt template.
export const receipt = internalMutation({
  args: { orderId: v.id("orders"), recipient: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order missing");
    const id = await email.enqueue(ctx, {
      scope: "store",
      key: `receipt:${args.orderId}`,
      transport: "primary",
      send: internal.email.transport,
      expiresAt: Date.now() + 3600000,
      payload: {
        from: "receipts@example.com",
        to: [args.recipient],
        subject: "Receipt",
        text: `Total: ${order.total}`,
      },
    });
    await ctx.db.patch(order._id, { emailId: id });
    return id;
  },
});
export const workerTransport = internalAction({
  args: dispatchV,
  returns: resultV,
  handler: async (_ctx, request) => {
    const endpoint = process.env.EMAIL_WORKER_SEND_URL,
      secret = process.env.EMAIL_SEND_BRIDGE_SECRET;
    if (request.transport !== "worker" || !endpoint || !secret)
      return {
        kind: "not_sent" as const,
        retryable: false,
        code: "not_configured" as const,
      };
    // Resolve bridge credentials for this invocation. Never retry the HTTP submission.
    try {
      const { signBody } =
        await import("@fantastic.dev/convex-cf-email-service/bridge");
      if (new URL(endpoint).protocol !== "https:")
        return {
          kind: "not_sent" as const,
          retryable: false,
          code: "not_configured" as const,
        };
      if (Date.now() >= request.expiresAt)
        return {
          kind: "not_sent" as const,
          retryable: false,
          code: "rejected" as const,
        };
      const body = JSON.stringify(request),
        timestamp = String(Date.now());
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
          "x-email-timestamp": timestamp,
          "x-email-signature": await signBody(secret, timestamp, body),
        },
        body,
      });
      if (!response.ok) return { kind: "ambiguous" as const };
      return (await response.json()) as typeof resultV.type;
    } catch {
      return { kind: "ambiguous" as const };
    }
  },
});
