/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    email: {
      attachMessageId: FunctionReference<
        "mutation",
        "internal",
        { id: string; messageId: string; recipient: string },
        null,
        Name
      >;
      cancel: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        boolean,
        Name
      >;
      clearSuppression: FunctionReference<
        "mutation",
        "internal",
        { recipient: string; scope: string },
        boolean,
        Name
      >;
      enqueue: FunctionReference<
        "mutation",
        "internal",
        {
          dedupDays?: number;
          expiresAt: number;
          handle: string;
          key: string;
          maxAttempts?: number;
          metadataDays?: number;
          payload: {
            attachments?: Array<{
              content: string;
              contentId?: string;
              disposition: "attachment" | "inline";
              filename: string;
              type: string;
            }>;
            bcc?: Array<string>;
            cc?: Array<string>;
            from: string;
            headers?: Record<string, string>;
            html?: string;
            replyTo?: string;
            subject: string;
            text?: string;
            to: Array<string>;
          };
          scope: string;
          transport: string;
        },
        string,
        Name
      >;
      ingest: FunctionReference<
        "mutation",
        "internal",
        {
          event: {
            at: number;
            eventId: string;
            kind:
              | "queued"
              | "accepted"
              | "delivered"
              | "deferred"
              | "bounced"
              | "failed"
              | "rejected"
              | "complained";
            messageId: string;
            permanent: boolean;
            recipient: string;
          };
          scope: string;
        },
        "duplicate" | "pending" | "applied",
        Name
      >;
      metrics: FunctionReference<
        "query",
        "internal",
        { scope: string; since: number },
        Array<{ count: number; day: number; name: string }>,
        Name
      >;
      reconcile: FunctionReference<
        "mutation",
        "internal",
        {
          attempt: number;
          decision:
            | {
                kind: "accepted";
                recipients: Array<{
                  messageId?: string;
                  recipient: string;
                  status: "accepted" | "delivered" | "bounced";
                }>;
              }
            | { kind: "not_sent" }
            | { kind: "abandon" };
          id: string;
        },
        null,
        Name
      >;
      status: FunctionReference<
        "query",
        "internal",
        { id: string },
        null | {
          attempt: number;
          cancelRequested: boolean;
          createdAt: number;
          delivery: Array<{
            count: number;
            state:
              | "queued"
              | "accepted"
              | "delivered"
              | "deferred"
              | "bounced"
              | "failed"
              | "rejected"
              | "complained";
          }>;
          expiresAt: number;
          state:
            | "queued"
            | "sending"
            | "retrying"
            | "accepted"
            | "ambiguous"
            | "cancelled"
            | "expired"
            | "failed"
            | "suppressed";
        },
        Name
      >;
    };
  };
