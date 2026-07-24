import {
  envBoolean,
  envInteger,
  optionalEnv,
  requiredEnv,
  supabaseAdminKey,
} from "../_shared/env.ts";
import { assertGeneratedPostCopy, GroqClient, isGeneratedPostTooSimilar } from "../_shared/groq.ts";
import { SupabaseRestClient } from "../_shared/supabase.ts";
import type { ContentProfile, JobResult } from "../_shared/types.ts";

const CONTENT_BRIEFS = [
  {
    angle:
      "ФОРМАТ: обсуждение. Красивый сайт превращает запись в квест: цена в соцсетях, адрес на картах, запись в WhatsApp. Закончить простым вопросом о похожем опыте, без продажи",
    fallback:
      "Сайт красивый. Цена в соцсетях, адрес на картах, запись в WhatsApp. Клиент хотел записаться, а получил квест 🫠 Вы бы дошли до записи?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Бизнес отвечает клиенту через несколько часов и считает, что всё нормально. Показать, что человек уже мог уйти, закончить точным вопросом",
    fallback:
      "Бизнес ответил клиенту через несколько часов. Формально ответил. Только клиент уже написал другому 😅 Вы бы стали ждать?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Если цену приходится искать по актуальным в соцсетях, сайт уже не помогает. Закончить вопросом о том, где человек ищет цену, без продажи",
    fallback:
      "На сайте цены нет. Клиент идёт искать её по актуальным в соцсетях. Вы где проверяете цену в первую очередь?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Спросить, что сильнее раздражает: медленный сайт или обязательная регистрация ради одного вопроса. Без продажи",
    fallback:
      "Клиент открывает сайт и сразу ждёт загрузку. Потом форма просит регистрацию ради одного вопроса. Что раздражает сильнее?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Бот на любой вопрос просит оставить номер и превращается в форму с лишним шагом. Закончить вопросом о реакции человека, без продажи",
    fallback:
      "Бот на любой вопрос отвечает: «Оставьте номер». Получилась обычная форма, только с лишним шагом 🫠 Вы бы продолжили диалог?",
  },
  {
    angle:
      "ФОРМАТ: продающий. Клиенты ежедневно повторяют один вопрос. Спокойно предложить бота, который отвечает и передаёт сложное человеку. Один мягкий призыв",
    fallback:
      "Клиенты каждый день задают один и тот же вопрос, а менеджер снова печатает ответ. Мы настраиваем бота и оставляем человеку только сложные обращения. Показать, как это работает?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. На главной слишком много одинаково важных кнопок, поэтому посетитель закрывает страницу. Закончить простым вопросом о выборе, без продажи",
    fallback:
      "На главной куча кнопок. Каждая «главная». Клиент смотрит пару секунд и закрывает сайт. А вы куда нажали бы первой?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Бизнес просит сайт как у конкурента, а потом удивляется сходству. Закончить вопросом о допустимости такого подхода, без продажи",
    fallback:
      "Бизнес просит сделать сайт «как у конкурента». Потом удивляется, что его путают с конкурентом. Вы бы копировали чужой подход?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Спросить, что человек первым ищет на сайте: цену или примеры работ. Добавить наблюдение, что бизнес часто прячет оба",
    fallback:
      "Клиент открывает сайт и ищет две вещи: цену и примеры работ. Что вы смотрите первым?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Человек скачивает приложение ради одного действия и больше не открывает. Закончить вопросом о причине оставить приложение, без продажи",
    fallback:
      "Человек скачал приложение, записался один раз и больше его не открыл. Ради чего вы оставляете приложение на телефоне?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Спросить, где человек предпочитает писать бизнесу: в директ или WhatsApp. Без продажи",
    fallback: "Нужно быстро задать вопрос бизнесу. Вы пишете в директ или сразу ищете WhatsApp?",
  },
  {
    angle:
      "ФОРМАТ: продающий. Цена лендинга и понятный случай для одной услуги и одного действия. Указать только подтверждённую стартовую цену и один спокойный призыв",
    fallback:
      "Клиент открывает страницу ради одной услуги, но читает обо всей компании. Мы собираем лендинги с одним понятным действием, стоимость от 49 990 ₸. Разобрать вашу задачу?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Предприниматель откладывает сайт из-за отсутствия идеального ТЗ, хотя может начать со списка услуг и примеров. Закончить вопросом о таком барьере, без продажи",
    fallback:
      "Предприниматель месяцами не начинает сайт, потому что не написал идеальное ТЗ. Вас отсутствие ТЗ тоже останавливало?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Менеджер весь день копирует один ответ клиентам. Закончить вопросом о самом частом вопросе клиентов, можно один эмодзи, без продажи",
    fallback:
      "Менеджер весь день копирует один и тот же ответ клиентам 🤔 Какой вопрос вам приходится повторять чаще всего?",
  },
  {
    angle:
      "ФОРМАТ: продающий. Сайт должен сразу показать услугу и способ записаться. Сказать, что агентство начинает разработку именно с этого, без пафоса и гарантий",
    fallback:
      "Клиент открывает сайт и не понимает, как записаться. Мы начинаем разработку именно с этого шага, а не с цвета кнопок. Посмотреть ваш первый экран?",
  },
  {
    angle:
      "ФОРМАТ: продающий. Мобильное приложение уместно, когда клиент часто возвращается к записи или заказу. Коротко сказать, что агентство проектирует такой путь, и предложить демо",
    fallback:
      "Клиент постоянно возвращается проверить запись или заказ. Для такого пути мы проектируем мобильные приложения. Показать похожую механику на демо?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Кнопка записи выглядит нормально, но ничего не делает. Закончить вопросом о том, сколько раз человек попробует, без продажи",
    fallback:
      "Нажимаешь «Записаться», а кнопка ничего не делает. Сколько раз вы попробуете, прежде чем уйти?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Спросить, что раздражает сильнее: цена по запросу или обязательный номер телефона, чтобы узнать цену. Без продажи",
    fallback:
      "Клиент ищет цену, а сайт просит оставить номер. Что раздражает сильнее: «цена по запросу» или обязательный звонок?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Клиент читает обещания на сайте, но не видит примеров работ. Закончить вопросом о доверии, без продажи",
    fallback:
      "Клиент читает обещания на сайте, но примеров работ нет. Вы бы поверили одним словам?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Кнопка WhatsApp открывает пустой чат, и клиент должен сам формулировать вопрос. Закончить вопросом о подсказке, без продажи",
    fallback:
      "Кнопка WhatsApp открывает пустой чат. Клиент снова думает, с чего начать 🙂 Вам удобнее готовая подсказка или пустое поле?",
  },
  {
    angle:
      "ФОРМАТ: продающий. На первом экране сайта непонятно, куда нажать. Сказать, что агентство разбирает экран и убирает лишние шаги. Один мягкий призыв",
    fallback:
      "Клиент открывает сайт и видит пять одинаково важных кнопок. Мы пересобираем первый экран и оставляем понятный следующий шаг. Посмотреть ваш сайт?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Бот пишет, что понял клиента, а потом снова задаёт тот же вопрос. Закончить вопросом о терпении человека, без продажи",
    fallback:
      "Бот пишет: «Я вас понял». Потом снова спрашивает то же самое 🫠 После какого повтора вы закрываете чат?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Спросить, стал бы человек устанавливать мобильное приложение ради одной записи или выбрал бы сайт. Без продажи",
    fallback: "Нужно записаться один раз. Вы скачаете приложение или откроете сайт?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Менеджер отправляет цены голосовым, а клиенту приходится переслушивать. Закончить вопросом о формате ответа, без продажи",
    fallback:
      "Менеджер отправил цены голосовым. Клиент хотел быстро сравнить, а теперь переслушивает запись. Вам удобнее текст или голосовое?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. На лендинг сложили все услуги, и клиенту тяжело выбрать. Закончить вопросом о количестве вариантов, без продажи",
    fallback:
      "Клиент открывает лендинг и видит сразу все услуги компании. Сколько вариантов вы готовы сравнивать на одной странице?",
  },
  {
    angle:
      "ФОРМАТ: продающий. Клиент часто возвращается проверить запись или заказ. Сказать, что агентство проектирует для этого приложение, и предложить демо",
    fallback:
      "Клиент пишет менеджеру, чтобы снова уточнить статус заказа. Мы проектируем приложения, где он проверяет всё сам. Показать, как это выглядит?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Форма просит должность и компанию перед обычным вопросом. Закончить вопросом о допустимой длине формы, без продажи",
    fallback:
      "Клиент хочет задать вопрос, а форма просит должность и компанию. Сколько полей вы готовы заполнить?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Спросить, что вызывает больше доверия: аккуратный сайт или активный Instagram без сайта. Без продажи",
    fallback:
      "Клиент выбирает между компанией с понятным сайтом и активным Instagram без сайта. Кому вы доверитесь?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Бот притворяется человеком, но выдаёт себя странной фразой. Закончить вопросом о честной подписи, без продажи",
    fallback:
      "Бот пишет как человек, пока не отвечает совсем невпопад. Вам спокойнее, когда сразу понятно, что отвечает бот?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Кнопка Подробнее ведёт на ту же страницу. Закончить вопросом о реакции человека, без продажи",
    fallback:
      "Нажимаешь «Подробнее» и остаёшься на той же странице. Вы попробуете ещё раз или закроете сайт?",
  },
  {
    angle:
      "ФОРМАТ: продающий. Старый сайт приходится объяснять клиенту голосом. Сказать, что агентство пересобирает структуру и первый экран. Один мягкий призыв",
    fallback:
      "Менеджер голосом объясняет клиенту, где на сайте искать нужную услугу. Мы пересобираем структуру и первый экран. Посмотреть ваш случай?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Спросить, что настораживает сильнее: цена от или подрядчик, который называет точную сумму до вопросов. Без продажи",
    fallback:
      "Подрядчик называет точную цену, ещё не задав ни одного вопроса. Это успокаивает или настораживает?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. На мобильном сайте меню закрывает половину экрана и мешает смотреть услугу. Закончить вопросом о реакции человека, без продажи",
    fallback:
      "Открываешь сайт с телефона, а меню закрывает половину экрана 😅 Вы будете искать нужную услугу дальше?",
  },
  {
    angle:
      "ФОРМАТ: обсуждение. Менеджер каждый день повторяет одно действие, но боится передать его боту. Закончить вопросом о рутине, без продажи",
    fallback:
      "Менеджер каждый день копирует данные из чата в таблицу. Какую такую рутину вы бы убрали первой?",
  },
  {
    angle:
      "ФОРМАТ: продающий. Менеджер повторяет ответы и вручную передаёт сложные обращения. Сказать, что агентство настраивает бота и передачу человеку. Один призыв",
    fallback:
      "Менеджер отвечает на одинаковые вопросы и вручную сортирует сложные обращения. Мы настраиваем бота и передачу человеку. Показать схему?",
  },
  {
    angle:
      "ФОРМАТ: продающий. Подтверждённая стартовая цена многостраничного сайта для нескольких услуг. Коротко объяснить, что агентство собирает структуру, и дать один призыв",
    fallback:
      "Клиент открывает сайт и выбирает между несколькими услугами. Мы собираем для этого понятную структуру многостраничного сайта, стоимость от 89 990 ₸. Обсудить ваш проект?",
  },
];

const SELLING_BRIEFS = CONTENT_BRIEFS.filter((brief) => /формат:\s*продающ/iu.test(brief.angle));
const CONVERSATION_BRIEFS = CONTENT_BRIEFS.filter((brief) =>
  !/формат:\s*продающ/iu.test(brief.angle)
);
const ALMATY_UTC_OFFSET_HOURS = 5;

export interface ContentSlot {
  generationKey: string;
  scheduledAt: string;
}

interface ContentGeneratorDatabase {
  getFutureGeneratedKeys(from: string, until: string): Promise<string[]>;
  getRecentContentTexts(limit?: number): Promise<string[]>;
  insertGeneratedContent(values: Record<string, unknown>): Promise<boolean>;
}

interface PostGenerator {
  generatePost(request: {
    businessContext: string;
    targetAudience: string;
    toneOfVoice: string;
    contentAngle: string;
    scheduledAt: string;
    recentPosts: string[];
  }): Promise<string>;
}

export function pickContentAngle(generationKey: string): string {
  const slot = /:(\d{4})-(\d{2})-(\d{2}):(\d{2})(\d{2})$/.exec(generationKey);
  if (slot) {
    const utcMilliseconds = Date.UTC(
      Number(slot[1]),
      Number(slot[2]) - 1,
      Number(slot[3]),
      Number(slot[4]),
      Number(slot[5]),
    );
    const almaty = new Date(utcMilliseconds + ALMATY_UTC_OFFSET_HOURS * 3_600_000);
    const localDay = Math.floor(
      Date.UTC(almaty.getUTCFullYear(), almaty.getUTCMonth(), almaty.getUTCDate()) / 86_400_000,
    );
    const localSlot = Math.floor((almaty.getUTCHours() * 60 + almaty.getUTCMinutes()) / 120);
    const sellingSlot = (localDay * 5 + 7) % 12;

    if (localSlot === sellingSlot) {
      return SELLING_BRIEFS[localDay % SELLING_BRIEFS.length].angle;
    }

    const conversationRank = localSlot - (localSlot > sellingSlot ? 1 : 0);
    const conversationIndex = (localDay * 11 + conversationRank) % CONVERSATION_BRIEFS.length;
    return CONVERSATION_BRIEFS[conversationIndex].angle;
  }

  const hash = Array.from(generationKey).reduce((value, character) => {
    const mixed = value ^ character.codePointAt(0)!;
    return Math.imul(mixed, 16_777_619) >>> 0;
  }, 2_166_136_261);
  return CONTENT_BRIEFS[hash % CONTENT_BRIEFS.length].angle;
}

export function fallbackPostForAngle(contentAngle: string, recentPosts: string[] = []): string {
  const preferred = CONTENT_BRIEFS.findIndex((brief) => brief.angle === contentAngle);
  const start = preferred >= 0 ? preferred : 0;
  const selling = /формат:\s*продающ/iu.test(CONTENT_BRIEFS[start].angle);

  for (let offset = 0; offset < CONTENT_BRIEFS.length; offset += 1) {
    const brief = CONTENT_BRIEFS[(start + offset) % CONTENT_BRIEFS.length];
    if (/формат:\s*продающ/iu.test(brief.angle) !== selling) continue;
    if (!isGeneratedPostTooSimilar(brief.fallback, recentPosts)) return brief.fallback;
  }
  throw new Error("No unused curated fallback remains for this content type");
}

function parseUtcTime(value: string): { hour: number; minute: number; key: string } {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) throw new Error(`Invalid publish time: ${value}`);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid publish time: ${value}`);
  return { hour, minute, key: `${match[1]}${match[2]}` };
}

export function planContentSlots(
  profile: ContentProfile,
  now: Date,
  horizonDays = 14,
): ContentSlot[] {
  const end = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const cursor = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const slots: ContentSlot[] = [];

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    for (const configuredTime of profile.publish_times_utc) {
      const time = parseUtcTime(configuredTime);
      const scheduledAt = new Date(Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate(),
        time.hour,
        time.minute,
      ));
      if (scheduledAt > now && scheduledAt <= end) {
        slots.push({
          generationKey: `${profile.id}:${date}:${time.key}`,
          scheduledAt: scheduledAt.toISOString(),
        });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown content generation error";
}

export async function generateQueuedContent(options: {
  database: ContentGeneratorDatabase;
  generator: PostGenerator;
  profile: ContentProfile;
  shadowMode: boolean;
  batchSize: number;
  now?: Date;
}): Promise<JobResult> {
  const now = options.now ?? new Date();
  const horizonEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const existing = new Set(
    await options.database.getFutureGeneratedKeys(now.toISOString(), horizonEnd.toISOString()),
  );
  const slots = planContentSlots(options.profile, now)
    .filter((slot) => !existing.has(slot.generationKey))
    .slice(0, options.batchSize);
  const recentPosts = await options.database.getRecentContentTexts(1000);
  let inserted = 0;
  let failed = 0;

  for (const slot of slots) {
    try {
      const contentAngle = pickContentAngle(slot.generationKey);
      let text: string;
      try {
        text = await options.generator.generatePost({
          businessContext: options.profile.business_context,
          targetAudience: options.profile.target_audience,
          toneOfVoice: options.profile.tone_of_voice,
          contentAngle,
          scheduledAt: slot.scheduledAt,
          recentPosts,
        });
      } catch (error) {
        text = fallbackPostForAngle(contentAngle, recentPosts);
        assertGeneratedPostCopy(text, options.profile.business_context, contentAngle);
        console.warn(JSON.stringify({
          event: "content_generation_fallback",
          generation_key: slot.generationKey,
          message: message(error),
        }));
      }
      const created = await options.database.insertGeneratedContent({
        text,
        status: options.shadowMode ? "draft" : "scheduled",
        scheduled_at: slot.scheduledAt,
        origin: "ai_generated",
        generation_key: slot.generationKey,
      });
      if (created) {
        inserted += 1;
        recentPosts.unshift(text);
      }
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({
        event: "content_generation_failed",
        generation_key: slot.generationKey,
        message: message(error),
      }));
    }
  }

  return { inserted, failed };
}

export async function runContentGenerator(): Promise<JobResult> {
  const database = new SupabaseRestClient(requiredEnv("SUPABASE_URL"), supabaseAdminKey());
  const profile = await database.getActiveContentProfile();
  if (!profile) return { inserted: 0, skipped: true, failed: 0 };

  const generator = new GroqClient(
    requiredEnv("GROQ_API_KEY"),
    optionalEnv("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
  );
  return generateQueuedContent({
    database,
    generator,
    profile,
    shadowMode: envBoolean("SHADOW_MODE", true),
    batchSize: envInteger("CONTENT_GENERATION_BATCH_SIZE", 7, 10),
  });
}
