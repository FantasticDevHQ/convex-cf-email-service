// Modified by Fantastic Dev HQ, 2026: create validated host handles instead of passing tokens.
import {
  createFunctionHandle,
  type FunctionReference,
  type GenericMutationCtx,
  type GenericDataModel,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type {
  DispatchRequest,
  TransportResult,
  EmailPayload,
} from "../component/shared.js";
export { payloadV, dispatchV, resultV, eventV } from "../component/shared.js";
export type {
  DispatchRequest,
  TransportResult,
  EmailPayload,
  DeliveryEvent,
} from "../component/shared.js";
type HostCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
export class CloudflareEmail {
  constructor(public readonly component: ComponentApi) {}
  async enqueue(
    ctx: HostCtx,
    options: {
      scope: string;
      key: string;
      transport: string;
      send: FunctionReference<
        "action",
        "internal",
        DispatchRequest,
        TransportResult
      >;
      payload: EmailPayload;
      expiresAt: number;
      maxAttempts?: number;
      metadataDays?: number;
      dedupDays?: number;
    },
  ) {
    const { send, ...rest } = options;
    return await ctx.runMutation(this.component.email.enqueue, {
      ...rest,
      handle: await createFunctionHandle(send),
    });
  }
}
