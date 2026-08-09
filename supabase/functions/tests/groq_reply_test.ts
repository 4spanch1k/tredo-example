import { GroqClient } from "../_shared/groq.ts";
import { assertEquals } from "./assert.ts";

Deno.test("Groq regenerates an empty generic engagement reply", async () => {
  const originalFetch = globalThis.fetch;
  const systemPrompts: string[] = [];
  let calls = 0;

  globalThis.fetch = (_input, init) => {
    calls += 1;
    const request = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    systemPrompts.push(request.messages[0].content);
    const proposedReply = calls === 1
      ? "Это хороший вопрос, зависит от того, что нужно"
      : "Тогда выбирали между двумя обещаниями, а не решениями 😅";
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                intent: "engagement",
                signals: ["conversation"],
                risk_flags: [],
                comment_point: "Автор сомневается в обоих вариантах.",
                post_connection: "Это продолжает сравнение двух подходов из поста.",
                reply_mode: "continue",
                proposed_reply: proposedReply,
              }),
            },
          }],
        }),
        { status: 200 },
      ),
    );
  };

  try {
    const result = await new GroqClient("test-key", "test-model").classify(
      "Если оба варианта не выполнят задачу?",
      "Тестовая компания создаёт сайты.",
      "Обсуждается выбор подрядчика.",
    );

    assertEquals(calls, 2);
    assertEquals(result.proposedReply, "Тогда выбирали между двумя обещаниями, а не решениями 😅");
    assertEquals(systemPrompts[1].includes("Предыдущая proposed_reply отклонена"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
