import { buildReplyContext, ThreadsClient } from "../_shared/threads.ts";
import { assertEquals } from "./assert.ts";

Deno.test("text replies use atomic auto publish", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; method: string | undefined }> = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
    requests.push({ url, method: init?.method });
    return Promise.resolve(
      new Response(JSON.stringify({ id: "published-reply-id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  try {
    const client = new ThreadsClient("token", "user-id", "https://graph.example");
    assertEquals(await client.reply("source-reply-id", "Ответ"), "published-reply-id");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assertEquals(requests.length, 1);
  assertEquals(requests[0]?.method, "POST");
  assertEquals(requests[0]?.url.pathname, "/user-id/threads");
  assertEquals(requests[0]?.url.searchParams.get("media_type"), "TEXT");
  assertEquals(requests[0]?.url.searchParams.get("reply_to_id"), "source-reply-id");
  assertEquals(requests[0]?.url.searchParams.get("auto_publish_text"), "true");
});

Deno.test("reply context follows only the current bounded branch", () => {
  const context = buildReplyContext(
    {
      id: "root",
      text: "Цена спрятана, и клиент ищет её по всему интернету.",
      username: "mononyx",
    },
    [
      {
        id: "first",
        text: "Да, особенно когда пишут «цена в директ»",
        username: "reader",
        replied_to: { id: "root" },
      },
      {
        id: "our-reply",
        text: "Вот именно, один простой ответ превращают в отдельный квест 😅",
        username: "mononyx",
        is_reply_owned_by_me: true,
        replied_to: { id: "first" },
      },
      {
        id: "follow-up",
        text: "А если стоимость зависит от задачи?",
        username: "reader",
        replied_to: { id: "our-reply" },
      },
      {
        id: "other-branch",
        text: "У меня другая история",
        username: "someone",
        replied_to: { id: "root" },
      },
    ],
    "follow-up",
    "mononyx",
  );

  assertEquals(context.status, "ready");
  if (context.status !== "ready") return;
  assertEquals(context.text.includes("Цена спрятана"), true);
  assertEquals(context.text.includes("стоимость зависит от задачи"), true);
  assertEquals(context.text.includes("У меня другая история"), false);
});

Deno.test("reply context stops when the branch exceeds the safe window", () => {
  const replies = Array.from({ length: 9 }, (_, index) => ({
    id: `reply-${index}`,
    text: `Сообщение ${index}`,
    username: "reader",
    replied_to: { id: index === 0 ? "root" : `reply-${index - 1}` },
  }));
  const context = buildReplyContext(
    { id: "root", text: "Исходный пост", username: "mononyx" },
    replies,
    "reply-8",
  );

  assertEquals(context.status, "too_large");
});

Deno.test("reply context stops instead of guessing a missing parent", () => {
  const context = buildReplyContext(
    { id: "root", text: "Исходный пост", username: "mononyx" },
    [{
      id: "follow-up",
      text: "Продолжение",
      username: "reader",
      replied_to: { id: "missing-parent" },
    }],
    "follow-up",
  );

  assertEquals(context.status, "unavailable");
});
