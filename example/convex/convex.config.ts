import { defineApp } from "convex/server";
import email from "@fantastic.dev/convex-cf-email-service/convex.config";
const app = defineApp();
app.use(email, { name: "transactionalEmail" });
app.use(email, { name: "authEmail" });
export default app;
