import {
  authenticatedBody,
  forwardEvents,
  type BridgeConfig,
  type QueueMessage,
} from "@fantastic.dev/convex-cf-email-service/bridge";
import {
  sendBinding,
  type EmailBinding,
} from "@fantastic.dev/convex-cf-email-service/transport";
import type { DispatchRequest } from "@fantastic.dev/convex-cf-email-service";
interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  EMAIL: EmailBinding;
  SEND_BRIDGE_SECRET: string;
  EVENT_BRIDGE_SECRET: string;
  EVENT_BRIDGE_PREVIOUS_SECRET?: string;
  CONVEX_EVENTS_URL: string;
  ACCOUNT_ID: string;
  ZONE_ID: string;
  SENDING_DOMAIN: string;
  SUBSCRIPTION_ID: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/send")
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response(null, { status: 404 });
    let input: DispatchRequest;
    try {
      input = (await authenticatedBody(
        request,
        [env.SEND_BRIDGE_SECRET],
        Date.now(),
        270000,
      )) as DispatchRequest;
    } catch {
      return new Response(null, { status: 401 });
    }
    if (
      !input ||
      typeof input !== "object" ||
      input.scope !== "store" ||
      input.transport !== "worker" ||
      !Number.isFinite(input.expiresAt) ||
      !input.payload
    )
      return new Response(null, { status: 400 });
    // No HTTP retries here or in the caller: lost responses are ambiguous.
    return Response.json(await sendBinding(env.EMAIL, input));
  },
  async queue(batch: { messages: QueueMessage[] }, env: Env): Promise<void> {
    const config: BridgeConfig = {
      accountId: env.ACCOUNT_ID,
      zoneId: env.ZONE_ID,
      domain: env.SENDING_DOMAIN,
      subscriptionId: env.SUBSCRIPTION_ID,
      scope: "store",
    };
    const responseCounts: Record<string, number> = {};
    const failureCounts: Record<string, number> = {};
    const result = await forwardEvents(
      batch.messages,
      config,
      env.CONVEX_EVENTS_URL,
      env.EVENT_BRIDGE_SECRET,
      async (input, init) => {
        const response = await fetch(input, init);
        const status = String(response.status);
        responseCounts[status] = (responseCounts[status] ?? 0) + 1;
        return response;
      },
      (reason) => {
        failureCounts[reason] = (failureCounts[reason] ?? 0) + 1;
      },
    );
    // Aggregate outcomes only: never log event bodies, recipient addresses or keys.
    console.info(
      JSON.stringify({
        event: "email_queue_batch",
        ...result,
        responseCounts,
        failureCounts,
      }),
    );
  },
};
