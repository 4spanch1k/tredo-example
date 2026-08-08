import { SupabaseRestClient } from "../_shared/supabase.ts";
import { assertEquals } from "./assert.ts";

Deno.test("recent content excludes retired drafts from duplicate history", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
  globalThis.fetch = (input: string | URL | Request) => {
    requestedUrls.push(input instanceof Request ? new URL(input.url) : new URL(String(input)));
    return Promise.resolve(
      new Response(JSON.stringify([{ text: "Опубликованный пост" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  try {
    const client = new SupabaseRestClient("https://project.supabase.co", "service-role-key");
    assertEquals(await client.getRecentContentTexts(1000), ["Опубликованный пост"]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assertEquals(
    requestedUrls[0]?.searchParams.get("status"),
    "in.(scheduled,publishing,published)",
  );
  assertEquals(requestedUrls[0]?.searchParams.get("limit"), "1000");
});

Deno.test("exact content fingerprint conflicts are treated as a skipped insert", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ code: "23505", message: "duplicate key" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

  try {
    const client = new SupabaseRestClient("https://project.supabase.co", "service-role-key");
    assertEquals(await client.insertGeneratedContent({ text: "Повтор" }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
