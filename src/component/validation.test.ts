import { expect, test } from "vitest";
import { normalize, digest } from "./validation.js";
const payload = () => ({
  from: "sender@example.com",
  to: ["a@example.net"],
  subject: "hello",
  text: "body",
});
test("attachment field order cannot create a false idempotency conflict", () => {
  const a = {
    content: "YQ==",
    filename: "a.txt",
    type: "text/plain",
    disposition: "attachment" as const,
  };
  const b = {
    disposition: "attachment" as const,
    type: "text/plain",
    filename: "a.txt",
    content: "YQ==",
  };
  expect(digest(normalize({ ...payload(), attachments: [a] }))).toBe(
    digest(normalize({ ...payload(), attachments: [b] })),
  );
});
test("header names that collide after case normalization reject rather than silently overwrite", () => {
  expect(() =>
    normalize({ ...payload(), headers: { "X-Trace": "a", "x-trace": "b" } }),
  ).toThrow("Duplicate header");
});
test.each([
  { ...payload(), to: [] },
  {
    ...payload(),
    to: Array.from({ length: 51 }, (_, i) => `${i}@example.net`),
  },
  { ...payload(), cc: ["a@example.net"] },
  { ...payload(), subject: "injected\r\nBcc: hidden@example.com" },
  { ...payload(), text: "x".repeat(256 * 1024) },
  { ...payload(), headers: { Authorization: "secret" } },
  {
    ...payload(),
    attachments: [
      {
        content: "invalid.",
        filename: "f",
        type: "text/plain",
        disposition: "attachment" as const,
      },
    ],
  },
])("payload bounds prevent invalid or oversized enqueue", (p) =>
  expect(() => normalize(p)).toThrow(),
);
