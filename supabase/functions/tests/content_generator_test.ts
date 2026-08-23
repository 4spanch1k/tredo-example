import {
  contentTopicFromAngle,
  fallbackPostForAngle,
  fallbackPostForNewsItem,
  generateQueuedContent,
  pickContentAngle,
  planContentSlots,
} from "../content-generator/job.ts";
import {
  assertGeneratedCopy,
  assertGeneratedEngagementReplyCopy,
  assertGeneratedPostCopy,
  assertGeneratedReplyCopy,
  generatedPostVarietyIssue,
  isGeneratedPostExactDuplicate,
  isGeneratedPostTooSimilar,
  MAX_GENERATED_POST_CHARACTERS,
  MAX_POST_GENERATION_ATTEMPTS,
  MIN_GENERATED_POST_CHARACTERS,
  normalizeGeneratedPostCopy,
  POST_GENERATION_SYSTEM_PROMPT,
  POST_PROMPT_RECENT_LIMIT,
} from "../_shared/groq.ts";
import type { ContentProfile, NewsItem } from "../_shared/types.ts";
import { assertEquals, assertRejects } from "./assert.ts";

const BUSINESS_CONTEXT = `
Лендинг — от 79 900 ₸.
ИИ-агент — от 99 900 ₸.
Многостраничный сайт — от 149 900 ₸.
`;

function profile(overrides: Partial<ContentProfile> = {}): ContentProfile {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    business_context: BUSINESS_CONTEXT,
    target_audience: "Предприниматели и компании с задачами по цифровизации.",
    tone_of_voice: "Экспертно, понятно и без агрессивных продаж.",
    publish_times_utc: [
      "01:00:00",
      "03:00:00",
      "05:00:00",
      "07:00:00",
      "09:00:00",
      "11:00:00",
      "13:00:00",
      "15:00:00",
      "17:00:00",
      "19:00:00",
      "21:00:00",
      "23:00:00",
    ],
    ...overrides,
  };
}

function generationKeyForAlmatySlot(day: number, localHour: number): string {
  const utc = new Date(Date.UTC(2026, 6, day, localHour - 5));
  const date = utc.toISOString().slice(0, 10);
  const time = utc.toISOString().slice(11, 16).replace(":", "");
  return `profile:${date}:${time}`;
}

Deno.test("content schedule creates twelve configured daily slots", () => {
  const slots = planContentSlots(profile(), new Date("2026-07-19T00:00:00.000Z"), 1);
  assertEquals(slots.map((slot) => slot.scheduledAt), [
    "2026-07-19T01:00:00.000Z",
    "2026-07-19T03:00:00.000Z",
    "2026-07-19T05:00:00.000Z",
    "2026-07-19T07:00:00.000Z",
    "2026-07-19T09:00:00.000Z",
    "2026-07-19T11:00:00.000Z",
    "2026-07-19T13:00:00.000Z",
    "2026-07-19T15:00:00.000Z",
    "2026-07-19T17:00:00.000Z",
    "2026-07-19T19:00:00.000Z",
    "2026-07-19T21:00:00.000Z",
    "2026-07-19T23:00:00.000Z",
  ]);
});

Deno.test("content schedule skips elapsed slots and continues on the next day", () => {
  const slots = planContentSlots(profile(), new Date("2026-07-19T10:00:00.000Z"), 1);
  assertEquals(slots.map((slot) => slot.scheduledAt), [
    "2026-07-19T11:00:00.000Z",
    "2026-07-19T13:00:00.000Z",
    "2026-07-19T15:00:00.000Z",
    "2026-07-19T17:00:00.000Z",
    "2026-07-19T19:00:00.000Z",
    "2026-07-19T21:00:00.000Z",
    "2026-07-19T23:00:00.000Z",
    "2026-07-20T01:00:00.000Z",
    "2026-07-20T03:00:00.000Z",
    "2026-07-20T05:00:00.000Z",
    "2026-07-20T07:00:00.000Z",
    "2026-07-20T09:00:00.000Z",
  ]);
});

Deno.test("content angle is deterministic and rotates between generation keys", () => {
  const first = pickContentAngle("profile:2026-07-20:12");
  assertEquals(first, pickContentAngle("profile:2026-07-20:12"));
  assertEquals(first === pickContentAngle("profile:2026-07-21:12"), false);
});

Deno.test("each Almaty day has exactly one selling slot out of twelve", () => {
  for (const day of [20, 21, 22, 23, 24]) {
    const angles = Array.from(
      { length: 12 },
      (_, slot) => pickContentAngle(generationKeyForAlmatySlot(day, slot * 2)),
    );
    assertEquals(angles.filter((angle) => /формат:\s*продающ/iu.test(angle)).length, 1);
  }
});

Deno.test("each Almaty day covers all topic pillars without adjacent repeats", () => {
  for (const day of [20, 21, 22, 23, 24]) {
    const topics = Array.from(
      { length: 12 },
      (_, slot) =>
        contentTopicFromAngle(pickContentAngle(generationKeyForAlmatySlot(day, slot * 2))),
    ).filter((topic): topic is string => topic !== null);

    assertEquals(topics.length, 11);
    assertEquals(new Set(topics).size, 11);
    for (let index = 1; index < topics.length; index += 1) {
      assertEquals(topics[index] === topics[index - 1], false);
    }
  }
});

Deno.test("every curated fallback passes the post copy guard", () => {
  const angles = new Set<string>();
  for (let day = 20; day < 60; day += 1) {
    for (let slot = 0; slot < 12; slot += 1) {
      angles.add(pickContentAngle(generationKeyForAlmatySlot(day, slot * 2)));
    }
  }
  for (const angle of angles) {
    const fallback = fallbackPostForAngle(angle);
    assertGeneratedPostCopy(fallback, BUSINESS_CONTEXT, angle);
    assertEquals(Array.from(fallback).length <= MAX_GENERATED_POST_CHARACTERS, true);
    assertEquals(Array.from(fallback).length >= MIN_GENERATED_POST_CHARACTERS, true);
  }
});

Deno.test("curated fallback avoids recently used copy", () => {
  const angle = pickContentAngle("profile:2026-07-19:1100");
  const first = fallbackPostForAngle(angle);
  const second = fallbackPostForAngle(angle, [first]);
  assertEquals(first === second, false);
});

Deno.test("curated fallbacks can sustain a full week without repeating recent copy", () => {
  const recent: string[] = [];
  for (let day = 20; day < 27; day += 1) {
    for (let slot = 0; slot < 12; slot += 1) {
      const angle = pickContentAngle(generationKeyForAlmatySlot(day, slot * 2));
      const fallback = fallbackPostForAngle(angle, recent);
      assertGeneratedPostCopy(fallback, BUSINESS_CONTEXT, angle);
      recent.unshift(fallback);
      if (recent.length > 36) recent.pop();
    }
  }
  assertEquals(recent.length, 36);
});

Deno.test("news fallback keeps the Habr source and a concrete article anchor", () => {
  const newsItem: NewsItem = {
    id: "news-1",
    source_name: "Habr",
    source_url: "https://habr.com/ru/news/",
    title: "Nvidia инвестирует $105 млрд в дата-центр OpenAI",
    url: "https://habr.com/ru/news/example/",
    summary: "Компании обсуждают крупное вложение в инфраструктуру искусственного интеллекта.",
    published_at: "2026-08-18T06:00:00Z",
  };
  const angle =
    "ФОРМАТ: обсуждение. ТЕМА: IT-новости и практика. Один практический вопрос без продажи";
  const fallback = fallbackPostForNewsItem(newsItem, BUSINESS_CONTEXT, angle);

  assertEquals(fallback.includes("Habr"), true);
  assertEquals(fallback.includes("Nvidia"), true);
  assertEquals(
    fallback.includes("Что вы проверяете первым, прежде чем менять привычный процесс?"),
    false,
  );
  assertGeneratedPostCopy(
    fallback,
    BUSINESS_CONTEXT,
    angle,
    `Источник: ${newsItem.source_name}\nЗаголовок: ${newsItem.title}\nСодержание: ${newsItem.summary}`,
  );
});

Deno.test("news fallback changes the question when the generic news hook was used recently", () => {
  const newsItem: NewsItem = {
    id: "news-2",
    source_name: "Habr",
    source_url: "https://habr.com/ru/news/",
    title: "Проект Python начал публиковать документацию на русском языке",
    url: "https://habr.com/ru/news/example-2/",
    summary: "Документация проекта стала доступна на русском языке.",
    published_at: "2026-08-23T05:53:40Z",
  };
  const genericRecent =
    "Новость с Habr: «Старый заголовок». Что вы проверяете первым, прежде чем менять привычный процесс?";
  const fallback = fallbackPostForNewsItem(
    newsItem,
    BUSINESS_CONTEXT,
    "ФОРМАТ: обсуждение. ТЕМА: IT-новости и практика. Один практический вопрос без продажи",
    [genericRecent],
  );

  assertEquals(
    fallback.includes("Что вы проверяете первым, прежде чем менять привычный процесс?"),
    false,
  );
  assertEquals(fallback.includes("Python"), true);
});

Deno.test("similarity guard catches a shorter paraphrase of a recent post", () => {
  assertEquals(
    isGeneratedPostTooSimilar(
      "Где отвечают быстрее: в директ или WhatsApp?",
      [
        "Вы сами пишете бизнесу в директ или сразу ищете WhatsApp? Интересно, где обычно отвечают быстрее.",
      ],
    ),
    true,
  );
  assertEquals(
    isGeneratedPostTooSimilar(
      "Если менеджер весь день копирует один ответ, проблема уже не в скорости печати 🤔",
      ["Сайт красивый. Цена рядом, а запись снова спрятана."],
    ),
    false,
  );
});

Deno.test("exact duplicate guard ignores punctuation and spacing", () => {
  assertEquals(
    isGeneratedPostExactDuplicate(
      "Сайт красивый, а запись спрятана!",
      ["  Сайт красивый. А запись спрятана  "],
    ),
    true,
  );
});

Deno.test("variety guard rejects repeated second-person hooks", () => {
  const recent = [
    "Заходишь на сайт и ищешь цену. Где вы обычно смотрите прайс?",
    "Нажимаешь кнопку записи, а ответа нет. Как вы поступаете в такой ситуации?",
    "Менеджер прислал голосовое с ценами. Вам такое удобно?",
  ];
  assertEquals(
    generatedPostVarietyIssue(
      "Хочешь записаться, но форма просит регистрацию. Что вы делаете в таком случае?",
      recent,
    )?.includes("second_person_action"),
    true,
  );
});

Deno.test("variety guard does not allow the previous hook or question family", () => {
  const recent = [
    "Владелец бизнеса вручную отвечает клиентам. Какую рутину вы бы убрали первой?",
  ];
  assertEquals(
    generatedPostVarietyIssue(
      "Менеджер снова копирует один ответ. Что вы делаете с такими повторами?",
      recent,
    )?.includes("предыдущий шаблон third_person_scene"),
    true,
  );
});

Deno.test("variety guard rejects repeated opening words", () => {
  assertEquals(
    generatedPostVarietyIssue(
      "Номер телефона снова спрятан. Где вы обычно ищете контакты?",
      ["Номер телефона указан мелким шрифтом. Как быстро вы его нашли?"],
    )?.includes("номер телефона"),
    true,
  );
});

Deno.test("variety guard rejects a third consecutive emoji post", () => {
  const recent = [
    "Кнопка записи не работает 🫠 Вы сталкивались с таким?",
    "Менеджер снова прислал голосовое 😅 Как вы обычно отвечаете?",
  ];
  assertEquals(
    generatedPostVarietyIssue(
      "Иногда цену прячут внизу страницы 👀 Где вы обычно ищете прайс?",
      recent,
    ),
    "эмодзи уже использованы в двух последних постах",
  );
});

Deno.test("content schedule rotates presentation formats across a day", () => {
  const angles = Array.from(
    { length: 12 },
    (_, slot) => pickContentAngle(generationKeyForAlmatySlot(20, slot * 2)),
  );
  const formats = angles.map((angle) => angle.split("ПОДАЧА:")[1]);
  assertEquals(new Set(formats).size >= 9, true);
  assertEquals(angles.every((angle) => angle.includes("ПОДАЧА:")), true);
});

Deno.test("shadow generation creates drafts and skips existing slots", async () => {
  const inserted: Array<Record<string, unknown>> = [];
  const generatedFor: string[] = [];
  const recentLimits: number[] = [];
  const currentProfile = profile();
  const firstSlot = planContentSlots(
    currentProfile,
    new Date("2026-07-19T00:00:00.000Z"),
  )[0];

  const result = await generateQueuedContent({
    database: {
      getFutureGeneratedKeys: () => Promise.resolve([firstSlot.generationKey]),
      getRecentContentTexts: (limit) => {
        recentLimits.push(limit ?? 0);
        return Promise.resolve(["Недавний пост"]);
      },
      insertGeneratedContent: (values) => {
        inserted.push(values);
        return Promise.resolve(true);
      },
    },
    generator: {
      generatePost: ({ scheduledAt }) => {
        generatedFor.push(scheduledAt);
        return Promise.resolve(`Новый полезный пост для ${scheduledAt}`);
      },
    },
    profile: currentProfile,
    shadowMode: true,
    batchSize: 2,
    now: new Date("2026-07-19T00:00:00.000Z"),
  });

  assertEquals(result, { inserted: 2, failed: 0 });
  assertEquals(inserted.length, 2);
  assertEquals(inserted[0].status, "draft");
  assertEquals(inserted[0].origin, "ai_generated");
  assertEquals(generatedFor.includes(firstSlot.scheduledAt), false);
  assertEquals(recentLimits, [36, 1000]);
});

Deno.test("generation keeps a bounded horizon and prompt budget", () => {
  assertEquals(MAX_POST_GENERATION_ATTEMPTS, 2);
  assertEquals(POST_PROMPT_RECENT_LIMIT, 12);
});

Deno.test("generation recovers only the latest missed publishing slot", async () => {
  const inserted: Array<Record<string, unknown>> = [];
  const queriedFrom: string[] = [];
  const currentProfile = profile();

  const result = await generateQueuedContent({
    database: {
      getFutureGeneratedKeys: (from) => {
        queriedFrom.push(from);
        return Promise.resolve([]);
      },
      getRecentContentTexts: () => Promise.resolve([]),
      insertGeneratedContent: (values) => {
        inserted.push(values);
        return Promise.resolve(true);
      },
    },
    generator: {
      generatePost: () =>
        Promise.resolve(
          "Кнопка есть, а куда она ведёт, никто не проверил. Вы часто тестируете сайт сами?",
        ),
    },
    profile: currentProfile,
    shadowMode: false,
    batchSize: 1,
    now: new Date("2026-07-19T17:19:00.000Z"),
  });

  assertEquals(result, { inserted: 1, failed: 0 });
  assertEquals(queriedFrom, ["2026-07-19T15:19:00.000Z"]);
  assertEquals(inserted[0].scheduled_at, "2026-07-19T17:00:00.000Z");
  assertEquals(inserted[0].status, "scheduled");
});

Deno.test("generation uses a curated fallback when the model rejects a slot", async () => {
  const inserted: Array<Record<string, unknown>> = [];
  const currentProfile = profile({ publish_times_utc: ["11:00:00"] });

  const result = await generateQueuedContent({
    database: {
      getFutureGeneratedKeys: () => Promise.resolve([]),
      getRecentContentTexts: () => Promise.resolve([]),
      insertGeneratedContent: (values) => {
        inserted.push(values);
        return Promise.resolve(true);
      },
    },
    generator: {
      generatePost: () => Promise.reject(new Error("model rejected")),
    },
    profile: currentProfile,
    shadowMode: true,
    batchSize: 1,
    now: new Date("2026-07-19T00:00:00.000Z"),
  });

  assertEquals(result, { inserted: 1, failed: 0 });
  assertEquals(
    inserted[0].text,
    fallbackPostForAngle(
      pickContentAngle(String(inserted[0].generation_key)),
    ),
  );
});

Deno.test("news generation never replaces a claimed source with a generic fallback", async () => {
  const newsItem: NewsItem = {
    id: "news-habr-1",
    source_name: "Habr",
    source_url: "https://habr.com/ru/news/",
    title: "Nvidia инвестирует $105 млрд в дата-центр OpenAI",
    url: "https://habr.com/ru/news/example/",
    summary: "Компании обсуждают крупное вложение в инфраструктуру искусственного интеллекта.",
    published_at: "2026-08-18T06:00:00Z",
  };
  let slotDate: Date | null = null;
  for (let offset = 0; offset < 60 && !slotDate; offset += 1) {
    const date = new Date(Date.UTC(2026, 6, 20 + offset));
    const key = `profile:${date.toISOString().slice(0, 10)}:0500`;
    if (contentTopicFromAngle(pickContentAngle(key)) === "it-новости и практика") {
      slotDate = date;
    }
  }
  if (!slotDate) throw new Error("Could not find an IT-news generation slot");

  const inserted: Array<Record<string, unknown>> = [];
  const used: string[] = [];
  const released: string[] = [];
  const result = await generateQueuedContent({
    database: {
      getFutureGeneratedKeys: () => Promise.resolve([]),
      getRecentContentTexts: () => Promise.resolve([]),
      claimFreshNewsItem: () => Promise.resolve(newsItem),
      markNewsItemUsed: (id) => {
        used.push(id);
        return Promise.resolve();
      },
      releaseNewsItem: (id) => {
        released.push(id);
        return Promise.resolve();
      },
      insertGeneratedContent: (values) => {
        inserted.push(values);
        return Promise.resolve(true);
      },
    },
    generator: { generatePost: () => Promise.reject(new Error("model rejected")) },
    profile: profile({ publish_times_utc: ["05:00:00"] }),
    shadowMode: false,
    batchSize: 1,
    now: slotDate,
  });

  assertEquals(result, { inserted: 1, failed: 0 });
  assertEquals(inserted[0]?.text?.toString().includes("Habr"), true);
  assertEquals(inserted[0]?.text?.toString().includes("Nvidia"), true);
  assertEquals(used, ["news-habr-1"]);
  assertEquals(released, []);
});

Deno.test("generation stops the batch after the first model rate limit", async () => {
  let attempts = 0;
  const currentProfile = profile({ publish_times_utc: ["11:00:00", "13:00:00"] });
  const usedFallbacks = new Set<string>();
  for (let day = 20; day < 60; day += 1) {
    for (let slot = 0; slot < 12; slot += 1) {
      const angle = pickContentAngle(generationKeyForAlmatySlot(day, slot * 2));
      usedFallbacks.add(fallbackPostForAngle(angle));
    }
  }

  const result = await generateQueuedContent({
    database: {
      getFutureGeneratedKeys: () => Promise.resolve([]),
      getRecentContentTexts: () => Promise.resolve(Array.from(usedFallbacks)),
      insertGeneratedContent: () => Promise.resolve(true),
    },
    generator: {
      generatePost: () => {
        attempts += 1;
        return Promise.reject(new Error("Gemini API 429: Rate limit reached"));
      },
    },
    profile: currentProfile,
    shadowMode: false,
    batchSize: 2,
    now: new Date("2026-07-19T00:00:00.000Z"),
  });

  assertEquals(attempts, 1);
  assertEquals(result.inserted, 0);
  assertEquals(result.failed, 1);
  assertEquals(result.errors?.[0]?.includes("Gemini API 429"), true);
});

Deno.test("copy guard accepts confirmed prices with the required qualifier", () => {
  assertGeneratedCopy(
    "Лендинг делаем от 79 900 ₸, ИИ-агент — от 99 900 ₸, а многостраничный сайт — от 149 900 ₸.",
    BUSINESS_CONTEXT,
  );
});

Deno.test("copy guard accepts a confirmed non-price number without the price qualifier", () => {
  assertGeneratedCopy(
    "За неделю вручную разобрали 3 обращения и нашли повторяющийся вопрос.",
    `${BUSINESS_CONTEXT}\nЗа неделю вручную разобрали 3 обращения.`,
  );
});

Deno.test("copy guard accepts approved Latin brand names", () => {
  assertGeneratedCopy(
    "AI-автоматизация и WhatsApp-бот помогают разбирать обращения из Instagram.",
    BUSINESS_CONTEXT,
  );
});

Deno.test("copy guard rejects invented numbers", async () => {
  await assertRejects(
    () => assertGeneratedCopy("Поднимем заявки на 30%.", BUSINESS_CONTEXT),
    "unsupported number",
  );
});

Deno.test("copy guard rejects a confirmed price without the word от", async () => {
  await assertRejects(
    () => assertGeneratedCopy("Лендинг стоит 79 900 ₸.", BUSINESS_CONTEXT),
    "required 'от' qualifier",
  );
});

Deno.test("copy guard rejects a landing price attached to a generic solution", async () => {
  await assertRejects(
    () => assertGeneratedCopy("Подберём решение от 79 900 ₸ после обсуждения.", BUSINESS_CONTEXT),
    "without naming лендинг",
  );
});

Deno.test("copy guard rejects accidental Latin letters inside Russian copy", async () => {
  await assertRejects(
    () => assertGeneratedCopy("Сначала проверим, rõчно ли вам нужен сайт.", BUSINESS_CONTEXT),
    "unsupported Latin word",
  );
});

Deno.test("copy guard rejects banned AI wording", async () => {
  await assertRejects(
    () => assertGeneratedCopy("Сайт играет важную роль для бизнеса.", BUSINESS_CONTEXT),
    "banned wording",
  );
});

Deno.test("post copy guard accepts useful copy without a price", () => {
  assertGeneratedPostCopy(
    "Сайт красивый. Цена в соцсетях, адрес на картах, запись в WhatsApp. Клиент хотел записаться, а получил квест 🫠 Вы бы дошли до записи?",
    BUSINESS_CONTEXT,
    "ФОРМАТ: наблюдение. Сайт превращает запись в квест",
  );
});

Deno.test("post normalizer preserves a human observation without adding a sale", () => {
  assertEquals(
    normalizeGeneratedPostCopy(
      "  Если контакты спрятаны глубоко, клиенту приходится искать способ связи. Вот и весь квест.  ",
      "ФОРМАТ: наблюдение. Контакты на сайте",
    ),
    "Если контакты спрятаны глубоко, клиенту приходится искать способ связи. Вот и весь квест.",
  );
});

Deno.test("post normalizer preserves a specific question without adding an offer", () => {
  assertEquals(
    normalizeGeneratedPostCopy(
      "Повторяющиеся вопросы занимают время менеджера. Какой вопрос клиенты задают чаще всего?",
      "ФОРМАТ: обсуждение. Повторяющиеся вопросы клиентов",
    ),
    "Повторяющиеся вопросы занимают время менеджера. Какой вопрос клиенты задают чаще всего?",
  );
});

Deno.test("post copy guard accepts a confirmed non-price number in a regular angle", () => {
  assertGeneratedPostCopy(
    "Менеджер за неделю ответил на 3 одинаковых обращения. Мы собираем такие вопросы в сценарий бота. Что у вас повторяется чаще всего?",
    `${BUSINESS_CONTEXT}\nМенеджер за неделю ответил на 3 одинаковых обращения.`,
    "ФОРМАТ: продающий. Повторяющиеся вопросы клиентов до автоматизации",
  );
});

Deno.test("post copy guard rejects uncontrolled lead promises", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Сделаем лендинг, который принесёт вам заявки.",
        BUSINESS_CONTEXT,
        "что проверить бизнесу перед заказом лендинга",
      ),
    "uncontrolled business outcome",
  );
});

Deno.test("reply copy guard rejects a promise of leads without a manager", async () => {
  await assertRejects(
    () =>
      assertGeneratedReplyCopy(
        "Сделаем сайт, который будет приносить заявки без участия менеджера.",
        BUSINESS_CONTEXT,
      ),
    "promises leads",
  );
});

Deno.test("engagement reply guard accepts a short human reaction", () => {
  assertGeneratedEngagementReplyCopy(
    "Вот именно 😅 иначе запись превращается в квест.",
    BUSINESS_CONTEXT,
  );
});

Deno.test("engagement reply guard allows a grounded nuance without a question", () => {
  assertGeneratedEngagementReplyCopy(
    "Именно здесь автоматизация начинает мешать: человек уже передумал, а сценарий продолжает идти по старой ветке.",
    BUSINESS_CONTEXT,
  );
});

Deno.test("engagement reply guard rejects WhatsApp and bot-like service language", async () => {
  await assertRejects(
    () =>
      assertGeneratedEngagementReplyCopy(
        "Спасибо за обратную связь. Напишите нам в WhatsApp.",
        BUSINESS_CONTEXT,
      ),
    "sales or contact language",
  );
});

Deno.test("engagement reply guard rejects empty generic agreement", async () => {
  for (
    const reply of [
      "Это хороший вопрос, зависит от того, что нужно",
      "Да, удобство и ясность важны",
      "Интересная мысль, опыт действительно многое решает",
    ]
  ) {
    await assertRejects(
      () => assertGeneratedEngagementReplyCopy(reply, BUSINESS_CONTEXT),
      "generic agreement",
    );
  }
});

Deno.test("post copy guard rejects prices outside a price-focused angle", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Перед запуском проверьте структуру лендинга. Разработка — от 79 900 ₸.",
        BUSINESS_CONTEXT,
        "что проверить бизнесу перед заказом лендинга",
      ),
    "outside a price-focused content angle",
  );
});

Deno.test("post copy guard accepts prices in a price-focused angle", () => {
  assertGeneratedPostCopy(
    "Клиент открывает лендинг ради одной услуги. Мы собираем страницу под одно предложение и действие, стоимость от 79 900 ₸. Что вы хотите показывать?",
    BUSINESS_CONTEXT,
    "ФОРМАТ: продающий. Ответ на сомнение о цене лендинга",
  );
});

Deno.test("copy guard accepts the AI agent price only with the named service", async () => {
  assertGeneratedCopy("Настраиваем ИИ-агента от 99 900 ₸.", BUSINESS_CONTEXT);
  await assertRejects(
    () => assertGeneratedCopy("Настраиваем автоматизацию от 99 900 ₸.", BUSINESS_CONTEXT),
    "without naming ИИ-агент",
  );
});

Deno.test("post copy guard rejects the old incoherent sales phrasing", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Клиент не понимает, какую услугу выбрать, и уходит с сайта. Мы упрощаем структуру и путь до обращения. Посмотреть, где он теряется у вас?",
        BUSINESS_CONTEXT,
        "ФОРМАТ: продающий. Клиент выбирает услугу",
      ),
    "generic sales wording",
  );
});

Deno.test("post copy guard rejects unnatural booking wording", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Заполняешь форму на сайте, прося запись. Она требует должность и компанию. Сколько полей вы заполните?",
        BUSINESS_CONTEXT,
        "ФОРМАТ: обсуждение. Слишком длинная форма записи",
      ),
    "generic sales wording",
  );
});

Deno.test("post copy guard rejects generic sales wording", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Если вашему бизнесу нужен сайт, мы можем помочь с разработкой.",
        BUSINESS_CONTEXT,
        "как сайт поддерживает цифровой статус компании",
      ),
    "generic sales wording",
  );
});

Deno.test("post copy guard rejects lead-acquisition claims", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Добавьте на сайт форму, чтобы привлечь заявки из поиска.",
        BUSINESS_CONTEXT,
        "аудит первого экрана сайта",
      ),
    "will attract leads or clients",
  );
});

Deno.test("post copy guard rejects client-acquisition claims", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Добавьте форму записи для привлечения клиентов.",
        BUSINESS_CONTEXT,
        "аудит первого экрана сайта",
      ),
    "will attract leads or clients",
  );
});

Deno.test("post copy guard rejects split spelling of насколько", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "На сколько глубоко спрятана форма записи на вашем сайте?",
        BUSINESS_CONTEXT,
        "контакты и запись спрятаны слишком глубоко",
      ),
    "split spelling",
  );
});

Deno.test("post copy guard rejects ambiguous bot-hours wording", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Обсудите, кто отвечает на обращения после часа работы бота.",
        BUSINESS_CONTEXT,
        "процессы и ограничения до запуска бизнес-бота",
      ),
    "ambiguous bot-hours phrase",
  );
});

Deno.test("post copy guard rejects an invented manager identity", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Пишешь боту, а он представляется как менеджер Алия. Вы доверяете таким ответам?",
        BUSINESS_CONTEXT,
        "ФОРМАТ: обсуждение. Бот притворяется человеком",
      ),
    "invents a personal identity",
  );
});

Deno.test("post copy guard rejects ищите in a question about search", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Что обычно ищите на сайте компании: цену или примеры работ?",
        BUSINESS_CONTEXT,
        "ФОРМАТ: обсуждение. Цена или примеры работ на сайте",
      ),
    "ищите",
  );
});

Deno.test("post generator prompt requires varied human copy", () => {
  for (
    const requirement of [
      "от 45 до 240 символов",
      "понятная ситуация",
      "лёгкая точка входа",
      "понятен с первого чтения",
      "конкретное действие",
      "не копирайтер",
      "Не повторяй тему",
    ]
  ) {
    assertEquals(POST_GENERATION_SYSTEM_PROMPT.includes(requirement), true);
  }
});

Deno.test("post generator prompt varies questions and forbids unsupported promises", () => {
  for (
    const requirement of [
      "ровно один короткий и конкретный вопрос",
      "легко ответить своим опытом",
      "Не используй «Что думаете?»",
      "Не обещай позиции или топ в Google",
      "Не гарантируй сроки",
      "юридических и финансовых гарантий",
      "отдельная статья расходов",
    ]
  ) {
    assertEquals(POST_GENERATION_SYSTEM_PROMPT.includes(requirement), true);
  }
});

Deno.test("post generator requires an explicit semantic cohesion self-check", () => {
  for (
    const requirement of [
      "Все фразы должны описывать одну и ту же ситуацию",
      "Последний вопрос должен прямо продолжать предыдущую фразу",
      '"one_situation":true',
      '"clear_connection":true',
      '"question_follows":true',
      '"topic_match":true',
    ]
  ) {
    assertEquals(POST_GENERATION_SYSTEM_PROMPT.includes(requirement), true);
  }
});

Deno.test("post generator prompt sells only in selling angles", () => {
  for (
    const requirement of [
      "не добавляй фразу о том, что делает Mononyx",
      "Если формат продающий",
      "Не продавай в каждом посте",
      "Могу показать демо",
      "Можем разобрать ваш случай",
    ]
  ) {
    assertEquals(POST_GENERATION_SYSTEM_PROMPT.includes(requirement), true);
  }
});

Deno.test("post copy guard rejects a conversational post without a question", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "На сайте услуга понятна сразу. А кнопку записи всё равно приходится искать по всей странице 🫠",
        BUSINESS_CONTEXT,
        "ФОРМАТ: обсуждение. Кнопка записи на сайте",
      ),
    "must contain one specific question",
  );
});

Deno.test("post copy guard accepts an adjacent business topic without naming a service", () => {
  assertGeneratedPostCopy(
    "Бизнес ответил клиенту утром. Формально ответил. Только клиент уже написал другому 😅 Вы бы стали ждать?",
    BUSINESS_CONTEXT,
    "ФОРМАТ: наблюдение. Скорость ответа клиенту",
  );
});

Deno.test("post copy guard rejects drift away from the scheduled topic pillar", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "На сайте спрятана кнопка записи. Где вы обычно ищете её?",
        BUSINESS_CONTEXT,
        "ФОРМАТ: обсуждение. ТЕМА: работа над digital-проектом. Правки и согласование",
      ),
    "drifted away from the required topic",
  );
});

Deno.test("post copy guard rejects a generic engagement question", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Мы делаем сайт понятным с первого экрана для ваших клиентов. Что думаете?",
        BUSINESS_CONTEXT,
        "аудит первого экрана сайта",
      ),
    "generic engagement question",
  );
});

Deno.test("post copy guard rejects more than one question", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Ваш сайт сразу объясняет услугу? Мы упрощаем его структуру. Что сейчас мешает вашему сайту?",
        BUSINESS_CONTEXT,
        "аудит первого экрана сайта",
      ),
    "more than one question",
  );
});

Deno.test("post copy guard rejects an agency offer in a non-selling angle", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Клиент открывает сайт и не понимает услугу. Мы упрощаем первый экран и кнопку записи. Вы бы остались?",
        BUSINESS_CONTEXT,
        "ФОРМАТ: наблюдение. Первый экран сайта",
      ),
    "Non-selling post contains an agency offer",
  );
});

Deno.test("post copy guard requires an agency offer in a selling angle", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "На сайте услуга должна быть понятна сразу. Если актуально, напишите.",
        BUSINESS_CONTEXT,
        "ФОРМАТ: продающий. Первый экран сайта",
      ),
    "Selling post does not state what the agency does",
  );
});

Deno.test("post copy guard allows zero to two reaction emoji", () => {
  assertGeneratedPostCopy(
    "Сайт красивый. Запись спрятана, цена в соцсетях. Клиент получил квест 🫠😅 Вы бы продолжили искать?",
    BUSINESS_CONTEXT,
    "ФОРМАТ: наблюдение. Сайт превращает запись в квест",
  );
});

Deno.test("post copy guard rejects more than two emoji", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Сайт красивый. Запись спрятана, цена в соцсетях. Клиент получил квест 🫠😅🤔",
        BUSINESS_CONTEXT,
        "ФОРМАТ: наблюдение. Сайт превращает запись в квест",
      ),
    "more than two emoji",
  );
});

Deno.test("post copy guard rejects advertising emoji", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Сайт красивый. Запись понятна, цена рядом. Клиенту удобно 🚀",
        BUSINESS_CONTEXT,
        "ФОРМАТ: наблюдение. Сайт и запись",
      ),
    "advertising emoji",
  );
});

Deno.test("post copy guard rejects a long dash", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Сайт красивый — запись спрятана. Клиент снова ищет кнопку.",
        BUSINESS_CONTEXT,
        "ФОРМАТ: наблюдение. Сайт и запись",
      ),
    "long dash",
  );
});

Deno.test("post copy guard rejects off-platform CTA", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Форма записи спрятана внизу страницы. Напишите мне в WhatsApp?",
        BUSINESS_CONTEXT,
        "аудит первого экрана сайта",
      ),
    "off-platform or subscription CTA",
  );
});

Deno.test("post copy guard rejects promised Google ranking", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Мы выведем ваш сайт в топ Google. Что мешает вам начать?",
        BUSINESS_CONTEXT,
        "как сайт поддерживает цифровой статус компании",
      ),
    "search ranking",
  );
});

Deno.test("post copy guard rejects guaranteed delivery timeline", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Гарантируем срок разработки. Какой проект вы планируете?",
        BUSINESS_CONTEXT,
        "подготовка к заказу сайта",
      ),
    "delivery timeline",
  );
});

Deno.test("post copy guard rejects legal or financial guarantees", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Даём финансовую гарантию окупаемости. Хотите обсудить проект?",
        BUSINESS_CONTEXT,
        "что проверить до заказа автоматизации",
      ),
    "legal or financial guarantee",
  );
});

Deno.test("post copy guard rejects guaranteed ROI", async () => {
  await assertRejects(
    () =>
      assertGeneratedPostCopy(
        "Гарантируем ROI после запуска сайта. Что хотите улучшить?",
        BUSINESS_CONTEXT,
        "что проверить до заказа сайта",
      ),
    "guarantees an uncontrolled business outcome",
  );
});
