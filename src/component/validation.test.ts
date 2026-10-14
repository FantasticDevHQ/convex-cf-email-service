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

test("branded mailbox normalization preserves names and canonicalizes only addresses", () => {
  const p = normalize({
    ...payload(),
    from: " TinyDirs <SUPPORT@MAIL-DEV.TINYDIRS.DEV> ",
    replyTo: '"TinyDirs" <CONTACT@TINYDIRS.DEV>',
  });
  expect(p.from).toBe('"TinyDirs" <support@mail-dev.tinydirs.dev>');
  expect(p.replyTo).toBe('"TinyDirs" <contact@tinydirs.dev>');
  expect(normalize(p)).toEqual(p);
  expect(digest(p)).toBe(
    digest(
      normalize({
        ...payload(),
        from: '"TinyDirs" <support@mail-dev.tinydirs.dev>',
        replyTo: "TinyDirs <contact@tinydirs.dev>",
      }),
    ),
  );
  expect(digest(p)).not.toBe(
    digest(
      normalize({ ...p, from: "Other Brand <support@mail-dev.tinydirs.dev>" }),
    ),
  );
});

test("quoted mailbox names preserve punctuation, escapes and Unicode", () => {
  const p = normalize({
    ...payload(),
    from: '"TinyDirs, \\"Support\\" \\\\ Team" <sender@example.com>',
    replyTo: "Équipe 日本 <contact@example.com>",
  });
  expect(p.from).toBe(
    '"TinyDirs, \\"Support\\" \\\\ Team" <sender@example.com>',
  );
  expect(p.replyTo).toBe('"Équipe 日本" <contact@example.com>');
});

const invalidMailboxes = [
  "",
  " ",
  "TinyDirs",
  "TinyDirs <bad>",
  "TinyDirs <a@example.com",
  "TinyDirs a@example.com>",
  "TinyDirs <a@example.com> trailing",
  "A <a@example.com>, B <b@example.com>",
  "a@example.com,b@example.com",
  "a@example.com; b@example.com",
  '"unterminated <a@example.com>',
  'A"B <a@example.com>',
  "A (comment) <a@example.com>",
  "A <a@example.com><b@example.com>",
  "A <a@example.com>>",
  '"" <a@example.com>',
  '"   " <a@example.com>',
  '"bad\\q" <a@example.com>',
  "Brand <a@b..com>",
  "\r\na@example.com",
  "a@example.com\n",
  "TinyDirs\0 <a@example.com>",
  "TinyDirs <a@example.com>\r\nBcc: hidden@example.com",
];
for (const field of ["from", "replyTo"] as const) {
  test.each(invalidMailboxes)(
    `invalid ${field} mailbox rejects safely: %j`,
    (value) => {
      expect(() => normalize({ ...payload(), [field]: value })).toThrow();
    },
  );
}
test("recipient fields remain bare and reject header controls before trimming", () => {
  for (const field of ["to", "cc", "bcc"] as const) {
    for (const value of [
      "Name <a@example.net>",
      "\na@example.net",
      "a@example.net\0",
    ]) {
      expect(() => normalize({ ...payload(), [field]: [value] })).toThrow();
    }
  }
});

test("canonical mailbox length is bounded before storing an undispatchable intent", () => {
  expect(() =>
    normalize({ ...payload(), from: `${"A".repeat(982)} <a@example.com>` }),
  ).toThrow();
});
