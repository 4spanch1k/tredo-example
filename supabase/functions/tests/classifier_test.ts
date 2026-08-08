import { Classifier } from "../_shared/classifier.ts";
import { assertEquals } from "./assert.ts";

const unusedGroq = {
  classify: () => Promise.reject(new Error("Groq must not be called")),
};

Deno.test("explicit commercial need is a high-confidence lead without Groq", async () => {
  const result = await new Classifier(unusedGroq, "https://wa.me/77000000000")
    .classify("Нужен сайт, сколько стоит разработка?");

  assertEquals(result.intent, "lead");
  assertEquals(result.confidenceLevel, "high");
  assertEquals(result.riskFlags, []);
  assertEquals(result.botReplyText?.includes("https://wa.me/77000000000"), true);
});

Deno.test("known promotion is classified as spam without Groq", async () => {
  const result = await new Classifier(unusedGroq).classify("Казино и гарантированный доход");
  assertEquals(result.intent, "spam");
  assertEquals(result.confidenceLevel, "high");
  assertEquals(result.botReplyText, null);
});

Deno.test("risk flags prevent automatic reply", async () => {
  const result = await new Classifier(unusedGroq).classify("Вы мошенники, верните деньги");
  assertEquals(result.riskFlags, ["complaint"]);
  assertEquals(result.confidenceLevel, "low");
  assertEquals(result.botReplyText, null);
});

Deno.test("ambiguous text is delegated to Groq evidence", async () => {
  const groq = {
    classify: () =>
      Promise.resolve({
        intent: "engagement" as const,
        signals: ["conversation"],
        riskFlags: [],
        proposedReply: "Да, тут легко запутаться 😅",
      }),
  };
  const result = await new Classifier(groq).classify("Что вы думаете об этом?");
  assertEquals(result.intent, "engagement");
  assertEquals(result.confidenceLevel, "high");
  assertEquals(result.botReplyText, "Да, тут легко запутаться 😅");
});

Deno.test("supportive comments receive a short human reply without a contact link", async () => {
  const groq = {
    classify: () =>
      Promise.resolve({
        intent: "engagement" as const,
        signals: ["conversation", "praise"],
        riskFlags: [],
        proposedReply: "Вот именно 😅 клиент не должен собирать запись по частям.",
      }),
  };
  const result = await new Classifier(groq, "https://wa.me/77000000000")
    .classify("Класс, у меня было так же");

  assertEquals(result.intent, "engagement");
  assertEquals(result.botReplyText, "Вот именно 😅 клиент не должен собирать запись по частям.");
  assertEquals(result.botReplyText?.includes("wa.me"), false);
});

Deno.test("calm criticism receives a short human reply", async () => {
  const groq = {
    classify: () =>
      Promise.resolve({
        intent: "engagement" as const,
        signals: ["conversation", "criticism"],
        riskFlags: [],
        proposedReply: "Тут можно не соглашаться 🙂 А что в вашем опыте было иначе?",
      }),
  };
  const result = await new Classifier(groq).classify(
    "Не согласен, это ерунда. Почему вы так решили?",
  );

  assertEquals(result.intent, "engagement");
  assertEquals(result.signals.includes("criticism"), true);
  assertEquals(result.botReplyText, "Тут можно не соглашаться 🙂 А что в вашем опыте было иначе?");
  assertEquals(result.riskFlags, []);
});

Deno.test("sarcastic paraphrase is not a lead even when Groq overclassifies it", async () => {
  const groq = {
    classify: () =>
      Promise.resolve({
        intent: "lead" as const,
        signals: ["explicit_need", "service_interest"],
        riskFlags: [],
        proposedReply: "Давайте обсудим сайт.",
      }),
  };
  const result = await new Classifier(groq).classify(
    "Перевожу: у вас нет сайта или он настолько плох, что никто не покупает без менеджера",
  );

  assertEquals(result.intent, "engagement");
  assertEquals(result.confidenceLevel, "high");
  assertEquals(result.botReplyText, null);
  assertEquals(result.signals.includes("explicit_need"), false);
});

Deno.test("a direct service question can remain a lead", async () => {
  const groq = {
    classify: () =>
      Promise.resolve({
        intent: "lead" as const,
        signals: ["explicit_need", "service_interest"],
        riskFlags: [],
        proposedReply: "Да, делаем. Какой сайт вам нужен?",
      }),
  };
  const result = await new Classifier(groq).classify("Вы делаете сайты для клиник?");

  assertEquals(result.intent, "lead");
  assertEquals(result.confidenceLevel, "high");
});

Deno.test("a clarifying question about service scope can remain a lead", async () => {
  const groq = {
    classify: () =>
      Promise.resolve({
        intent: "lead" as const,
        signals: ["explicit_need", "service_interest"],
        riskFlags: [],
        proposedReply: "Сначала уточняем задачу и список страниц.",
      }),
  };
  const result = await new Classifier(groq).classify("Что входит в разработку сайта?");

  assertEquals(result.intent, "lead");
  assertEquals(result.confidenceLevel, "high");
});

Deno.test("a direct question about other services is a high-confidence lead", async () => {
  const result = await new Classifier(unusedGroq, "https://wa.me/77000000000")
    .classify("Есть другие услуги?");

  assertEquals(result.intent, "lead");
  assertEquals(result.confidenceLevel, "high");
  assertEquals(result.signals.includes("service_scope"), true);
  assertEquals(result.botReplyText?.includes("мобильные приложения"), true);
  assertEquals(result.botReplyText?.includes("https://wa.me/77000000000"), true);
});

Deno.test("unknown factual question is deferred instead of hallucinated", async () => {
  const groq = {
    classify: () =>
      Promise.resolve({
        intent: "engagement" as const,
        signals: ["conversation"],
        riskFlags: ["unknown_answer"],
        proposedReply: null,
      }),
  };
  const result = await new Classifier(groq).classify(
    "А сколько заявок этот сайт принёс в прошлом месяце?",
    "Исходный пост @mononyx: Мы обновили первый экран сайта.",
  );

  assertEquals(result.botReplyText, null);
  assertEquals(result.riskFlags, ["unknown_answer"]);
});

Deno.test("bounded thread context is passed to the reply model", async () => {
  let receivedContext = "";
  const groq = {
    classify: (_text: string, _business: string, context: string) => {
      receivedContext = context;
      return Promise.resolve({
        intent: "engagement" as const,
        signals: ["conversation"],
        riskFlags: [],
        proposedReply: "Да, в пустом чате всегда сложнее начать разговор 😅",
      });
    },
  };
  const context =
    "Исходный пост @mononyx: Кнопка открывает пустой чат.\nВетка:\n@reader: Да, это неудобно";
  const result = await new Classifier(groq).classify("Да, это неудобно", context);

  assertEquals(receivedContext, context);
  assertEquals(result.botReplyText, "Да, в пустом чате всегда сложнее начать разговор 😅");
});
