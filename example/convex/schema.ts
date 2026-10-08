import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
// Consumer schema stays in the host app.
export default defineSchema({
  orders: defineTable({ total: v.number(), emailId: v.optional(v.string()) }),
});
