import {
  buildGeminiPostRequest,
  extractGeminiPostJson,
  GEMINI_POST_RESPONSE_SCHEMA,
  isRetryableGeminiError,
  MAX_GEMINI_POST_GENERATION_ATTEMPTS,
} from "../_shared/gemini.ts";
import type { PostGenerationRequest } from "../_shared/groq.ts";
import { assertEquals, assertRejects } from "./assert.ts";

const REQUEST: PostGenerationRequest = {
  businessContext: "Лендинги — от 79 900 ₸.",
  targetAudience: "Малый и средний бизнес Казахстана.",
  toneOfVoice: "Коротко и по-человечески.",
  contentAngle: "ФОРМАТ: обсуждение. Клиент ищет цену на сайте",
  scheduledAt: "2026-08-02T17:00:00.000Z",
  recentPosts: ["Сайт красивый, а цена снова спрятана."],
};

Deno.test("Gemini post request uses structured JSON and the shared writing prompt", () => {
  const payload = buildGeminiPostRequest(REQUEST) as {
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: Record<string, unknown>;
  };

  assertEquals(payload.generationConfig.thinkingConfig, { thinkingLevel: "low" });
  assertEquals(payload.generationConfig.maxOutputTokens, 800);
  assertEquals(payload.generationConfig.responseFormat, {
    text: {
      mimeType: "APPLICATION_JSON",
      schema: GEMINI_POST_RESPONSE_SCHEMA,
    },
  });
  assertEquals(payload.systemInstruction.parts[0].text.includes("Mononyx"), true);
  assertEquals(payload.contents[0].parts[0].text.includes("от 79 900 ₸"), true);
  assertEquals(payload.contents[0].parts[0].text.includes(REQUEST.recentPosts[0]), true);
});

Deno.test("Gemini correction request contains the rejection reason", () => {
  const payload = buildGeminiPostRequest(REQUEST, "финальный вопрос не связан с ситуацией") as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };

  assertEquals(
    payload.contents[0].parts[0].text.includes("финальный вопрос не связан с ситуацией"),
    true,
  );
});

Deno.test("Gemini response extraction joins text parts and rejects empty output", async () => {
  assertEquals(
    extractGeminiPostJson({
      candidates: [{ content: { parts: [{ text: '{"text":"Пост"' }, { text: "}" }] } }],
    }),
    '{"text":"Пост"}',
  );
  await assertRejects(() => extractGeminiPostJson({ candidates: [] }), "no generated post");
});

Deno.test("Gemini retries temporary server overload but not a rate limit", () => {
  assertEquals(isRetryableGeminiError(new Error("Gemini API 503: high demand")), true);
  assertEquals(isRetryableGeminiError(new Error("Gemini API request failed")), true);
  assertEquals(isRetryableGeminiError(new Error("Gemini API 429: quota exceeded")), false);
  assertEquals(isRetryableGeminiError(new Error("Gemini API 400: invalid request")), false);
});

Deno.test("Gemini uses one attempt before the reserve model", () => {
  assertEquals(MAX_GEMINI_POST_GENERATION_ATTEMPTS, 1);
});
