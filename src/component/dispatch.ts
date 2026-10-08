// Modified by Fantastic Dev HQ, 2026: only the host action resolves secrets.
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { type FunctionHandle } from "convex/server";
import { v } from "convex/values";
import type { DispatchRequest, TransportResult } from "./shared.js";
export const send = internalAction({
  args: { id: v.id("emails") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const claim = await ctx.runMutation(internal.email.claim, { id });
    if (!claim) return null;
    let result: TransportResult;
    try {
      result = await ctx.runAction(
        claim.handle as FunctionHandle<
          "action",
          DispatchRequest,
          TransportResult
        >,
        claim.request,
      );
    } catch {
      result = { kind: "ambiguous" };
    }
    // A malformed adapter result or a failed completion leaves the fenced attempt in sending.
    // The durable lease callback moves it to ambiguous; never retry the provider call here.
    await ctx.runMutation(internal.email.complete, {
      id,
      attempt: claim.request.attempt,
      result,
    });
    return null;
  },
});
