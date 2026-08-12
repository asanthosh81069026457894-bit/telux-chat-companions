// Unit tests for the chunk-picker. Run with:
//   node --test --experimental-strip-types src/lib/chunk-picker.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { pickTopChunks, __test__ } from "./chunk-picker.ts";

const { tokenize } = __test__;

test("tokenize lowercases and strips punctuation", () => {
  const out = tokenize("Hello, WORLD! 123 abc.");
  // "Hello" / "WORLD" become "hello" / "world"; "abc" survives; "123" is a
  // single token; the trailing punctuation is dropped.
  assert.ok(out.includes("hello"));
  assert.ok(out.includes("world"));
  assert.ok(out.includes("abc"));
  assert.ok(out.includes("123"));
});

test("tokenize filters stopwords and 1-letter tokens", () => {
  const out = tokenize("a I am the best in this world");
  // Stopwords ("a", "am", "the", "in", "this") are removed. "I" is filtered
  // by the length>=2 rule. "best" / "world" survive.
  assert.deepEqual([...out].sort(), ["best", "world"]);
});

test("pickTopChunks ranks an on-topic chunk above off-topic", () => {
  const onTopic = "Renewal. The subscription renews automatically each month unless cancelled.";
  const offTopic = "Office hours are Monday through Friday, 9am to 6pm.";
  const question = "How does the subscription renew?";
  const top = pickTopChunks(question, [offTopic, onTopic], 1);
  assert.deepEqual(top, [onTopic]);
});

test("pickTopChunks falls back to first chunk when question is all stopwords", () => {
  const a = "First chunk.";
  const b = "Second chunk.";
  const top = pickTopChunks("a the of", [a, b], 3);
  assert.deepEqual(top, [a, b]);
});

test("pickTopChunks respects topK", () => {
  const chunks = [
    "Refund policy allows thirty days returns.",
    "Subscriptions cancel any time from the dashboard.",
    "Office hours are Monday through Friday.",
  ];
  const top = pickTopChunks("When can I cancel my subscription?", chunks, 2);
  assert.equal(top.length, 2);
  // Subscription / cancel chunks should be the top two.
  assert.ok(top.includes(chunks[1]));
  assert.ok(top.includes(chunks[0]));
});
