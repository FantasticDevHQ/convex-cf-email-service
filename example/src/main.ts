import { ConvexClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api.js";
import "./style.css";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}
const form = element<HTMLFormElement>("compose-form");
const send = element<HTMLButtonElement>("send");
const error = element<HTMLParagraphElement>("form-error");
const status = element<HTMLDivElement>("status");
const connection = element<HTMLSpanElement>("connection");
const url = import.meta.env.VITE_CONVEX_URL;
let client: ConvexClient | undefined;
let unsubscribe: (() => void) | undefined;
let pending: { fingerprint: string; requestId: string } | undefined;
let sending = false;

function showError(cause: unknown) {
  error.textContent =
    cause instanceof ConvexError && typeof cause.data === "string"
      ? cause.data
      : "Could not complete the request. Check your connection and retry with the same message.";
  error.hidden = false;
}
function line(tag: string, text: string, className?: string) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function render(
  result: {
    state: string;
    attempt: number;
    createdAt: number;
    expiresAt: number;
    cancelRequested: boolean;
    delivery: { state: string; count: number }[];
  } | null,
) {
  status.replaceChildren();
  if (!result) {
    status.append(
      line("p", "STATUS UNAVAILABLE", "status-label"),
      line("h3", "Status is no longer available."),
      line(
        "p",
        "Demo references are retained for 24 hours. The component also applies its retention policy.",
        "status-description",
      ),
    );
    return;
  }
  const description: Record<string, string> = {
    queued: "Safely recorded. Waiting for the host transport.",
    sending: "The host is contacting Cloudflare.",
    accepted:
      "Cloudflare accepted this send. This does not confirm inbox delivery.",
    ambiguous:
      "The send outcome is uncertain. Reconcile it before submitting a new send.",
    failed: "The send failed. Check the host’s sanitized diagnostics.",
    suppressed:
      "This recipient is suppressed. The component did not send the message.",
    expired: "The send window has closed.",
    cancelled: "The send was cancelled.",
    retrying: "A bounded retry is scheduled.",
  };
  status.append(
    line("div", "✉", "stamp"),
    line("p", "LIVE COMPONENT STATE", "status-label"),
    line("h3", result.state.replaceAll("_", " ")),
    line(
      "p",
      description[result.state] ?? "The component is tracking this message.",
      "status-description",
    ),
  );
  const facts = document.createElement("dl");
  facts.className = "send-facts";
  for (const [label, value] of [
    ["Attempts", String(result.attempt)],
    ["Created", new Date(result.createdAt).toLocaleTimeString()],
    ["Expires", new Date(result.expiresAt).toLocaleTimeString()],
    ["Cancellation", result.cancelRequested ? "Requested" : "None"],
  ]) {
    const row = document.createElement("div");
    row.append(line("dt", label!), line("dd", value!));
    facts.append(row);
  }
  status.append(facts);
  if (result.delivery.length)
    status.append(
      line(
        "p",
        result.delivery.map((x) => `${x.count} ${x.state}`).join(" · "),
        "recipient-states",
      ),
    );
}
if (url) {
  try {
    const parsed = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
      throw new Error("Invalid URL");
    client = new ConvexClient(url);
    element("setup").hidden = true;
    send.disabled = false;
    connection.textContent = "Backend configured";
  } catch {
    connection.textContent = "Invalid backend URL";
  }
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client || sending || !form.reportValidity()) return;
  const data = new FormData(form);
  const payload = {
    recipient: String(data.get("recipient")).trim(),
    subject: String(data.get("subject")),
    text: String(data.get("message")),
  };
  const fingerprint = JSON.stringify(payload);
  if (!pending || pending.fingerprint !== fingerprint)
    pending = { fingerprint, requestId: crypto.randomUUID() };
  const requestId = pending.requestId;
  const accessCode = String(data.get("access-code"));
  sending = true;
  send.disabled = true;
  send.firstChild!.textContent = "Recording send… ";
  error.hidden = true;
  try {
    await client.mutation(api.demo.submit, {
      ...payload,
      requestId,
      accessCode,
    });
    unsubscribe?.();
    unsubscribe = client.onUpdate(
      api.demo.status,
      { requestId, accessCode },
      render,
      showError,
    );
    pending = undefined;
  } catch (cause) {
    showError(cause);
  } finally {
    sending = false;
    send.disabled = false;
    send.firstChild!.textContent = "Send email ";
  }
});
window.addEventListener("pagehide", () => {
  unsubscribe?.();
  void client?.close();
});
