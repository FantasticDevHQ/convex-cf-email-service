import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { authenticatedBody } from "@fantastic.dev/convex-cf-email-service/bridge";
import { eventV } from "@fantastic.dev/convex-cf-email-service";
import { v } from "convex/values";
const http = httpRouter();
http.route({
  path: "/email/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: unknown;
    try {
      body = await authenticatedBody(request, [
        process.env.EMAIL_BRIDGE_SECRET ?? "",
        ...(process.env.EMAIL_BRIDGE_PREVIOUS_SECRET
          ? [process.env.EMAIL_BRIDGE_PREVIOUS_SECRET]
          : []),
      ]);
    } catch {
      return new Response(null, { status: 401 });
    }
    // This endpoint serves one trusted subscription/scope; do not accept scope from a caller.
    if (
      !body ||
      typeof body !== "object" ||
      !("scope" in body) ||
      body.scope !== "store" ||
      !("event" in body)
    )
      return new Response(null, { status: 400 });
    try {
      await ctx.runMutation(components.transactionalEmail.email.ingest, {
        scope: "store",
        event: body.event as typeof eventV.type,
      });
    } catch {
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 204 });
  }),
});
export default http;
