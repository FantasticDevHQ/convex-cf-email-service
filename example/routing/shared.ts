// Host utility: authenticate/source-pin ingress before calling this in a mutation.
import type { GenericDataModel, GenericMutationCtx } from "convex/server";
import type { DeliveryEvent } from "@fantastic.dev/convex-cf-email-service";
import {
  routeDeliveryEvent,
  type EventOwnershipReceipt,
} from "@fantastic.dev/convex-cf-email-service/bridge";
import { components } from "../convex/_generated/api.js";
const routes = new Map([
  ["auth", { component: components.authEmail, scope: "authentication" }],
  ["receipts", { component: components.transactionalEmail, scope: "store" }],
]);
export function ingestSharedEvent(
  ctx: Pick<GenericMutationCtx<GenericDataModel>, "runMutation">,
  event: DeliveryEvent,
  lookup: (messageId: string) => Promise<EventOwnershipReceipt | null>,
) {
  return routeDeliveryEvent(event, lookup, async (route, event) => {
    const owner = routes.get(route);
    if (!owner) throw new Error("Unconfigured event owner");
    return ctx.runMutation(owner.component.email.ingest, {
      scope: owner.scope,
      event,
    });
  });
}
