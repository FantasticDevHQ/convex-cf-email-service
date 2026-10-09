// Modified by Fantastic Dev HQ, 2026: host-only binding/REST transport, sanitized outcomes.
import type {
  DispatchRequest,
  EmailPayload,
  TransportResult,
} from "../component/shared.js";
import { allRecipients, normalize, bounded } from "../component/validation.js";
export interface EmailBinding {
  send(payload: EmailPayload): Promise<{ messageId: string }>;
}
export async function sendBinding(
  binding: EmailBinding,
  request: DispatchRequest,
): Promise<TransportResult> {
  if (Date.now() >= request.expiresAt)
    return { kind: "not_sent", retryable: false, code: "rejected" };
  let payload: EmailPayload;
  try {
    payload = normalize(request.payload);
  } catch {
    return { kind: "not_sent", retryable: false, code: "rejected" };
  }
  try {
    const result = await binding.send(payload);
    bounded(result.messageId);
    return {
      kind: "accepted",
      recipients: allRecipients(payload).map((recipient) => ({
        recipient,
        messageId: result.messageId,
        status: "accepted",
      })),
    };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    // Only documented pre-submission failures assert that a retry is safe.
    if (code === "E_RATE_LIMIT_EXCEEDED" || code === "E_DAILY_LIMIT_EXCEEDED")
      return { kind: "not_sent", retryable: true, code: "rate_limited" };
    if (
      [
        "E_VALIDATION_ERROR",
        "E_FIELD_MISSING",
        "E_TOO_MANY_RECIPIENTS",
        "E_TOO_MANY_ATTACHMENTS",
        "E_SENDER_NOT_VERIFIED",
        "E_RECIPIENT_NOT_ALLOWED",
        "E_RECIPIENT_SUPPRESSED",
        "E_SENDER_DOMAIN_NOT_AVAILABLE",
        "E_CONTENT_TOO_LARGE",
        "E_HEADER_NOT_ALLOWED",
        "E_HEADER_USE_API_FIELD",
        "E_HEADER_VALUE_INVALID",
        "E_HEADER_VALUE_TOO_LONG",
        "E_HEADER_NAME_INVALID",
        "E_HEADERS_TOO_LARGE",
        "E_HEADERS_TOO_MANY",
      ].includes(String(code))
    )
      return { kind: "not_sent", retryable: false, code: "rejected" };
    return { kind: "ambiguous" };
  }
}
export async function sendRest(
  request: DispatchRequest,
  resolve: () => Promise<{ accountId: string; apiToken: string }>,
  fetcher: typeof fetch = fetch,
): Promise<TransportResult> {
  if (Date.now() >= request.expiresAt)
    return { kind: "not_sent", retryable: false, code: "rejected" };
  let config: { accountId: string; apiToken: string };
  try {
    config = await resolve();
    if (!/^[a-f0-9]{32}$/iu.test(config.accountId) || !config.apiToken)
      throw new Error();
  } catch {
    return { kind: "not_sent", retryable: true, code: "not_configured" };
  }
  if (Date.now() >= request.expiresAt)
    return { kind: "not_sent", retryable: false, code: "rejected" };
  let p: EmailPayload;
  try {
    p = normalize(request.payload);
  } catch {
    return { kind: "not_sent", retryable: false, code: "rejected" };
  }
  const { replyTo, attachments, ...body } = p;
  try {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`,
      {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          ...(replyTo ? { reply_to: replyTo } : {}),
          ...(attachments
            ? {
                attachments: attachments.map(({ contentId, ...a }) => ({
                  ...a,
                  ...(contentId ? { content_id: contentId } : {}),
                })),
              }
            : {}),
        }),
      },
    );
    if (response.status === 429)
      return { kind: "not_sent", retryable: true, code: "rate_limited" };
    if ([400, 401, 403, 422].includes(response.status))
      return { kind: "not_sent", retryable: false, code: "rejected" };
    // 5xx, timeout, invalid JSON and unexpected 2xx can hide acceptance. Do not resubmit.
    if (!response.ok) return { kind: "ambiguous" };
    const json: unknown = await response.json();
    if (
      !json ||
      typeof json !== "object" ||
      !("success" in json) ||
      json.success !== true ||
      !("result" in json)
    )
      return { kind: "ambiguous" };
    const r = json.result as Record<string, unknown>;
    const outcomes: Extract<
      TransportResult,
      { kind: "accepted" }
    >["recipients"] = [];
    for (const [field, status] of [
      ["delivered", "delivered"],
      ["queued", "accepted"],
      ["permanent_bounces", "bounced"],
    ] as const) {
      if (
        !Array.isArray(r[field]) ||
        !(r[field] as unknown[]).every((x) => typeof x === "string")
      )
        return { kind: "ambiguous" };
      for (const recipient of r[field] as string[])
        outcomes.push({ recipient, status });
    }
    const expected = allRecipients(p);
    if (
      outcomes.length !== expected.length ||
      new Set(outcomes.map((x) => x.recipient.toLowerCase())).size !==
        expected.length ||
      outcomes.some((x) => !expected.includes(x.recipient.toLowerCase()))
    )
      return { kind: "ambiguous" };
    return { kind: "accepted", recipients: outcomes };
  } catch {
    return { kind: "ambiguous" };
  }
}
