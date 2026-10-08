import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
// Consumer schema stays in the host app.
export default defineSchema({
  demoSends: defineTable({
    requestId: v.string(),
    emailId: v.string(),
    createdAt: v.number(),
  })
    .index("by_request", ["requestId"])
    .index("by_time", ["createdAt"]),
  orders: defineTable({ total: v.number(), emailId: v.optional(v.string()) }),
});
